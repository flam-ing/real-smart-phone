'use strict';
const $ = id => document.getElementById(id);
const canvas = $('screen'), ctx = canvas.getContext('2d'), phone = $('phone'), drawer = $('drawer'), connection = $('connection');
const W = 720, H = 1560;
let ws = null, pendingFrame = null, decoding = false, currentBitmap = null, seatState = null;

// ---------- video ----------
async function drawLatest() {
  if (decoding || !pendingFrame) return;
  const { data, socket } = pendingFrame; pendingFrame = null; decoding = true;
  try {
    const bitmap = await createImageBitmap(data);
    if (ws === socket) { ctx.drawImage(bitmap, 0, 0, W, H); currentBitmap?.close(); currentBitmap = bitmap; connection.hidden = true; }
    else bitmap.close();
  } catch {}
  finally { decoding = false; if (pendingFrame) drawLatest(); }
}
function showConnection(text) { connection.textContent = text; connection.hidden = !text; }
function stateText(s) {
  if (!s) return '휴대폰에 연결하는 중…';
  if (s.state === 'running') return currentBitmap ? '' : '화면을 불러오는 중…';
  if (s.state === 'starting' || s.state === 'booting') return `${s.seat}번 휴대폰을 켜는 중… 처음에는 1~2분 걸립니다.`;
  if (s.error === 'capacity') return `지금 ${s.running}대가 실행 중이라 잠시 기다려야 합니다. 곧 다시 시도합니다.`;
  if (s.state === 'error') return '휴대폰을 켜지 못했습니다. 잠시 뒤 다시 시도합니다.';
  return `${s.seat}번 휴대폰을 깨우는 중…`;
}
function connect() {
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${location.pathname.replace(/\/?$/, '/')}ws`);
  ws = socket; socket.binaryType = 'blob';
  socket.onopen = () => { socket.send(JSON.stringify({ type: 'frame_ack_hello' })); showConnection(stateText(seatState)); };
  socket.onmessage = event => {
    if (event.data instanceof Blob) {
      // Acknowledge on receipt so the server always sends the newest frame instead of queueing old ones.
      if (socket.readyState === WebSocket.OPEN) socket.send('{"type":"frame_ack"}');
      pendingFrame = { data: event.data, socket }; drawLatest(); return;
    }
    let msg; try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type === 'state') { seatState = msg; if (msg.state !== 'running' || !currentBitmap) showConnection(stateText(msg)); }
    else if (msg.type === 'chat_history') renderMessages(msg.messages);
    else if (msg.type === 'chat') addMessage(msg.message);
    else if (msg.type === 'ai') setAi(msg);
  };
  socket.onclose = () => {
    if (ws !== socket) return;
    cancelGesture(false); pendingFrame = null;
    showConnection('연결이 끊겼습니다. 다시 연결하는 중…');
    setTimeout(connect, 2000);
  };
  socket.onerror = () => socket.close();
}
const sendJson = payload => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)); };

// ---------- touch: down/move/up stream live so scrolling follows the finger ----------
let gesture = null, moveFrame = null, pendingMove = null;
function point(event) {
  const r = canvas.getBoundingClientRect();
  if (!r.width) return null;
  return { x: Math.max(0, Math.min(W - 1, Math.round((event.clientX - r.left) / r.width * W))), y: Math.max(0, Math.min(H - 1, Math.round((event.clientY - r.top) / r.height * H))) };
}
function flushMove() {
  if (moveFrame !== null) cancelAnimationFrame(moveFrame);
  moveFrame = null;
  if (pendingMove && gesture) sendJson({ type: 'pointer_move', ...pendingMove });
  pendingMove = null;
}
function cancelGesture(release = true) {
  if (!gesture) return;
  flushMove();
  if (release) sendJson({ type: 'pointer_up', ...gesture.last });
  try { canvas.releasePointerCapture(gesture.id); } catch {}
  gesture = null;
}
canvas.addEventListener('pointerdown', event => {
  if (gesture || (event.pointerType === 'mouse' && event.button !== 0)) return;
  const p = point(event); if (!p) return;
  gesture = { id: event.pointerId, last: p };
  try { canvas.setPointerCapture(event.pointerId); } catch {}
  sendJson({ type: 'pointer_down', ...p });
  if (event.pointerType === 'mouse') keyboard.focus({ preventScroll: true });
});
canvas.addEventListener('pointermove', event => {
  if (!gesture || event.pointerId !== gesture.id) return;
  const p = point(event); if (!p) return;
  gesture.last = p; pendingMove = p;
  if (moveFrame === null) moveFrame = requestAnimationFrame(flushMove);
});
canvas.addEventListener('pointerup', event => {
  if (!gesture || event.pointerId !== gesture.id) return;
  gesture.last = point(event) || gesture.last;
  if (pendingMove) pendingMove = gesture.last;
  cancelGesture(true);
});
canvas.addEventListener('pointercancel', event => { if (gesture && event.pointerId === gesture.id) cancelGesture(true); });
window.addEventListener('pagehide', () => cancelGesture(true));
$('back').onclick = () => sendJson({ type: 'key', keyCode: 4 });
$('home').onclick = () => sendJson({ type: 'key', keyCode: 3 });
$('recent').onclick = () => sendJson({ type: 'key', keyCode: 187 });

// ---------- desktop keyboard (Korean IME composition is sent as finished text) ----------
const keyboard = document.createElement('textarea');
Object.assign(keyboard.style, { position: 'fixed', top: 0, left: 0, width: '1px', height: '1px', opacity: 0, border: 0, padding: 0, pointerEvents: 'none' });
keyboard.setAttribute('aria-hidden', 'true'); keyboard.tabIndex = -1; document.body.appendChild(keyboard);
let composing = false;
const flushText = () => { if (composing) return; const text = keyboard.value; keyboard.value = ''; if (text) sendJson({ type: 'text', text }); };
keyboard.addEventListener('compositionstart', () => { composing = true; });
keyboard.addEventListener('compositionend', () => { composing = false; setTimeout(flushText, 20); });
keyboard.addEventListener('input', event => { if (!composing && !event.isComposing) flushText(); });
const KEYS = { Backspace: 67, Delete: 112, Enter: 66, Tab: 61, Escape: 111, ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22 };
keyboard.addEventListener('keydown', event => {
  if (composing || event.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey) return;
  if (KEYS[event.key] === undefined) return;
  event.preventDefault(); flushText(); sendJson({ type: 'key', keyCode: KEYS[event.key] });
});

// ---------- AI ----------
function setAi(state) {
  phone.classList.toggle('ai-on', !!state.running);
  $('aiBadge').hidden = !state.running;
  if (state.running) $('aiText').textContent = state.text ? `AI · ${state.text}` : 'AI가 조작 중';
}
$('aiStop').onclick = () => sendJson({ type: 'ai_stop' });
function messageNode(m) {
  const node = document.createElement('div');
  node.className = `msg ${m.role === 'user' ? 'user' : ''} ${m.error ? 'error' : ''}`;
  if (m.source === 'schedule') { const tag = document.createElement('small'); tag.textContent = '스케줄 실행'; node.append(tag); }
  node.append(document.createTextNode(m.text));
  return node;
}
function renderMessages(list) {
  const box = $('messages'); box.replaceChildren();
  if (!list.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = '예: "크롬에서 오늘 서울 날씨 찾아줘", "인스타그램 열어서 첫 게시물 좋아요 눌러줘"'; box.append(p); }
  for (const m of list) box.append(messageNode(m));
  box.scrollTop = box.scrollHeight;
}
function addMessage(m) { const box = $('messages'); box.querySelector('.empty')?.remove(); box.append(messageNode(m)); box.scrollTop = box.scrollHeight; }
$('compose').addEventListener('submit', event => {
  event.preventDefault();
  const text = $('prompt').value.trim(); if (!text) return;
  sendJson({ type: 'chat', text }); $('prompt').value = '';
  showDrawer(false);
});

// ---------- drawer & tabs ----------
function showDrawer(open) {
  phone.classList.toggle('open', open);
  $('ai').setAttribute('aria-expanded', String(open));
  drawer.setAttribute('aria-hidden', String(!open)); drawer.inert = !open;
}
$('ai').onclick = () => showDrawer(!phone.classList.contains('open'));
$('close').onclick = () => showDrawer(false);
$('shade').onclick = () => showDrawer(false);
function selectTab(name) {
  $('tabChat').setAttribute('aria-selected', String(name === 'chat'));
  $('tabSchedule').setAttribute('aria-selected', String(name === 'schedule'));
  $('paneChat').hidden = name !== 'chat'; $('paneSchedule').hidden = name !== 'schedule';
  if (name === 'schedule') loadSchedules();
}
$('tabChat').onclick = () => selectTab('chat');
$('tabSchedule').onclick = () => selectTab('schedule');

// ---------- schedules ----------
const api = (url, options = {}) => fetch(url, { headers: { 'content-type': 'application/json' }, ...options }).then(async r => { const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(data.error || '요청하지 못했습니다'); return data; });
function renderSchedules(list) {
  const box = $('schedules'); box.replaceChildren();
  if (!list.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = '정해진 시간에 AI가 이 휴대폰에서 할 일을 등록하세요.'; box.append(p); return; }
  for (const s of list) {
    const row = document.createElement('div'); row.className = 'sched';
    const info = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = `${s.label}${s.enabled ? '' : ' · 꺼짐'}`;
    const prompt = document.createElement('p'); prompt.textContent = s.prompt;
    const last = document.createElement('p'); const run = s.runs?.[0];
    last.textContent = run ? `최근: ${new Date(run.at).toLocaleString('ko-KR')} · ${run.status === 'done' ? run.answer : '실패'}` : (s.next ? `다음: ${new Date(s.next).toLocaleString('ko-KR')}` : '');
    info.append(title, prompt, last);
    const toggle = document.createElement('button'); toggle.textContent = s.enabled ? '끄기' : '켜기';
    toggle.onclick = () => api('api/schedules', { method: 'POST', body: JSON.stringify({ ...s, enabled: !s.enabled }) }).then(d => renderSchedules(d.schedules));
    const remove = document.createElement('button'); remove.textContent = '삭제';
    remove.onclick = () => api(`api/schedules?id=${encodeURIComponent(s.id)}`, { method: 'DELETE' }).then(d => renderSchedules(d.schedules));
    row.append(info, toggle, remove); box.append(row);
  }
}
const loadSchedules = () => api('api/schedules').then(d => renderSchedules(d.schedules)).catch(e => { $('schedNote').textContent = e.message; });
$('schedPreset').onchange = () => {
  const v = $('schedPreset').value;
  $('schedTime').hidden = !(v === 'daily' || v === 'weekday'); $('schedEvery').hidden = v !== 'every'; $('schedCron').hidden = v !== 'cron';
};
$('scheduleForm').addEventListener('submit', event => {
  event.preventDefault();
  const v = $('schedPreset').value, [hh, mm] = ($('schedTime').value || '09:00').split(':').map(Number);
  const cron = v === 'daily' ? `${mm} ${hh} * * *` : v === 'weekday' ? `${mm} ${hh} * * 1-5` : v === 'every' ? `*/${Math.max(5, Number($('schedEvery').value) || 60)} * * * *` : $('schedCron').value.trim();
  try { Cron.parse(cron); } catch (e) { $('schedNote').textContent = `시간 형식: ${e.message}`; return; }
  api('api/schedules', { method: 'POST', body: JSON.stringify({ prompt: $('schedPrompt').value, cron }) })
    .then(d => { $('schedPrompt').value = ''; $('schedNote').textContent = '한국 시간 기준입니다. 브라우저를 닫아도 서버에서 실행됩니다.'; renderSchedules(d.schedules); })
    .catch(e => { $('schedNote').textContent = e.message; });
});

// ---------- camera: a photo from this device goes into the phone's gallery ----------
$('camera').onclick = () => $('cameraInput').click();
$('cameraInput').onchange = async () => {
  const file = $('cameraInput').files[0]; $('cameraInput').value = '';
  if (!file) return;
  showConnection('사진을 휴대폰 갤러리에 넣는 중…');
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement('canvas'); c.width = Math.round(bitmap.width * scale); c.height = Math.round(bitmap.height * scale);
    c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height); bitmap.close();
    const jpeg = await new Promise(resolve => c.toBlob(resolve, 'image/jpeg', 0.9));
    const res = await fetch('api/photo', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: jpeg });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '넣지 못했습니다');
    showConnection('갤러리에 사진을 넣었습니다.'); setTimeout(() => showConnection(''), 1800);
  } catch (e) { showConnection(`사진: ${e.message}`); setTimeout(() => showConnection(''), 3000); }
};

connect();
