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
  if (!s) return 'Connecting to your phone…';
  if (s.state === 'running') return currentBitmap ? '' : 'Loading the screen…';
  if (s.state === 'starting' || s.state === 'booting') return 'Starting your phone… the first start can take a minute.';
  if (s.error === 'capacity') return 'All phones are busy right now. Retrying shortly…';
  if (s.state === 'error') return 'Could not start the phone. Retrying shortly…';
  return 'Waking your phone…';
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
    // Once the screen is live, status messages never cover it.
    if (msg.type === 'state') { seatState = msg; if (!currentBitmap) showConnection(stateText(msg)); else if (msg.state === 'running') showConnection(''); }
    else if (msg.type === 'chat_history') renderMessages(msg.messages);
    else if (msg.type === 'chat') addMessage(msg.message);
    else if (msg.type === 'ai') setAi(msg);
    else if (msg.type === 'ai_target') showTarget(msg);
    else if (msg.type === 'camera') setCamera(msg);
    else if (msg.type === 'schedules') renderSchedules(msg.schedules || []);

  };
  socket.onclose = () => {
    if (ws !== socket) return;
    cancelGesture(false); pendingFrame = null;
    showConnection('Connection lost. Reconnecting…');
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

// ---------- keyboard: desktop keys, or the iPhone/Android keyboard via the keyboard button ----------
// A hidden field keeps one placeholder character so Backspace is visible even when nothing was typed.
const SEED = '​';
const keyboard = document.createElement('textarea');
keyboard.className = 'typing-input';
for (const [k, v] of Object.entries({ 'aria-label': 'Type on the phone', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false' })) keyboard.setAttribute(k, v);
document.body.appendChild(keyboard);
let composing = false;
const resetKeyboard = () => { keyboard.value = SEED; try { keyboard.setSelectionRange(1, 1); } catch {} };
function flushText() {
  if (composing) return;
  const value = keyboard.value;
  if (!value.includes(SEED)) sendJson({ type: 'key', keyCode: 67 }); // the placeholder was deleted: Backspace
  const text = value.replaceAll(SEED, '');
  if (text) sendJson({ type: 'text', text });
  resetKeyboard();
}
keyboard.addEventListener('compositionstart', () => { composing = true; });
keyboard.addEventListener('compositionend', () => { composing = false; setTimeout(flushText, 20); });
keyboard.addEventListener('input', event => { if (!composing && !event.isComposing) flushText(); });
const KEYS = { Enter: 66, Tab: 61, Escape: 111, ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22, Delete: 112 };
keyboard.addEventListener('keydown', event => {
  if (composing || event.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey) return;
  if (KEYS[event.key] === undefined) return;
  event.preventDefault(); flushText(); sendJson({ type: 'key', keyCode: KEYS[event.key] });
});
keyboard.addEventListener('focus', resetKeyboard);
keyboard.addEventListener('blur', flushText);
// With a mouse, typing on this computer goes to the phone right after clicking its screen.
// On touch screens Android's own keyboard appears on the phone screen.
canvas.addEventListener('pointerup', event => { if (event.pointerType === 'mouse') { keyboard.focus({ preventScroll: true }); resetKeyboard(); } });

// ---------- AI ----------
function setAi(state) {
  // While waiting for the user, the blue frame goes away: the phone is in the user's hands.
  phone.classList.toggle('ai-on', !!state.running && !state.waiting);
  $('aiBadge').hidden = !state.running;
  $('aiBadge').classList.toggle('waiting', !!state.waiting);
  $('aiResume').hidden = !state.waiting;
  if (state.running) $('aiText').textContent = state.waiting ? `Your turn: ${state.text}` : state.text ? `AI · ${state.text}` : 'AI is using the phone';
}
$('aiStop').onclick = () => sendJson({ type: 'ai_stop' });
$('aiResume').onclick = () => sendJson({ type: 'ai_resume' });
let targetTimer = null;
function showTarget({ box, label }) {
  const el = $('aiTarget');
  if (!box) return;
  Object.assign(el.style, { left: `${box.x1 / W * 100}%`, top: `${box.y1 / H * 100}%`, width: `${(box.x2 - box.x1) / W * 100}%`, height: `${(box.y2 - box.y1) / H * 100}%` });
  $('aiTargetLabel').textContent = `SAM 3.1 · ${label}`;
  el.hidden = false; clearTimeout(targetTimer); targetTimer = setTimeout(() => { el.hidden = true; }, 1600);
}
function messageNode(m) {
  const node = document.createElement('div');
  node.className = `msg ${m.role === 'user' ? 'user' : ''} ${m.error ? 'error' : ''}`;
  if (m.source === 'schedule') { const tag = document.createElement('small'); tag.textContent = 'Scheduled run'; node.append(tag); }
  node.append(document.createTextNode(m.text));
  return node;
}
function renderMessages(list) {
  const box = $('messages'); box.replaceChildren();
  if (!list.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'Try: "Search today\'s weather in Seoul" or "Open Instagram and like the first post"'; box.append(p); }
  for (const m of list) box.append(messageNode(m));
  box.scrollTop = box.scrollHeight;
}
function addMessage(m) { const box = $('messages'); box.querySelector('.empty')?.remove(); box.append(messageNode(m)); box.scrollTop = box.scrollHeight; }
$('compose').addEventListener('submit', event => {
  event.preventDefault();
  const text = $('prompt').value.trim(); if (!text) return;
  // The sheet stays open after sending; it closes with × or a tap outside it.
  sendJson({ type: 'chat', text }); $('prompt').value = '';
});

// ---------- drawer & tabs ----------
function showDrawer(open) {
  phone.classList.toggle('open', open);
  if (!open) drawer.classList.remove('full');
  $('ai').setAttribute('aria-expanded', String(open));
  drawer.setAttribute('aria-hidden', String(!open)); drawer.inert = !open;
}
$('ai').onclick = () => showDrawer(!phone.classList.contains('open'));
$('close').onclick = () => showDrawer(false);
$('shade').onclick = () => showDrawer(false);
// Drag the handle up to cover the whole phone, down to go back to half or to close; a tap toggles the size.
(() => {
  const grip = drawer.querySelector('.handle-area');
  let start = null;
  grip.addEventListener('pointerdown', event => { start = { y: event.clientY, h: drawer.getBoundingClientRect().height }; try { grip.setPointerCapture(event.pointerId); } catch {} drawer.classList.add('dragging'); });
  grip.addEventListener('pointermove', event => {
    if (!start) return;
    const max = phone.getBoundingClientRect().height;
    drawer.style.height = `${Math.max(120, Math.min(max, start.h - (event.clientY - start.y)))}px`;
  });
  const end = event => {
    if (!start) return;
    const dy = event.clientY - start.y, full = drawer.classList.contains('full');
    start = null; drawer.classList.remove('dragging'); drawer.style.height = '';
    if (Math.abs(dy) < 6) return drawer.classList.toggle('full');
    if (dy < -40) drawer.classList.add('full');
    else if (dy > 40) { if (full) drawer.classList.remove('full'); else showDrawer(false); }
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
})();
function selectTab(name) {
  for (const [tab, pane, key] of [['tabChat', 'paneChat', 'chat'], ['tabSchedule', 'paneSchedule', 'schedule'], ['tabModel', 'paneModel', 'model']]) {
    $(tab).setAttribute('aria-selected', String(name === key)); $(pane).hidden = name !== key;
  }
  if (name === 'schedule') loadSchedules();
  if (name === 'model') loadModel();
}
$('tabChat').onclick = () => selectTab('chat');
$('tabSchedule').onclick = () => selectTab('schedule');
$('tabModel').onclick = () => selectTab('model');

// ---------- model: Muse Spark by default; testers can connect their own provider and pick model and reasoning ----------
let modelView = null, keyFor = null;
const LEVELS = { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High' };
function modelNote(text) { $('modelNote').textContent = text || ''; }
async function loadModel() {
  try { modelView = await api('api/model'); drawModel(); loadModelList(); }
  catch (e) { modelNote(e.message); }
}
function drawModel() {
  const v = modelView, active = v.providers.find(p => p.id === v.active);
  $('modelCurrent').innerHTML = '';
  $('modelCurrent').append('Using ', Object.assign(document.createElement('b'), { textContent: `${active?.name || v.active} · ${v.model}` }), active?.builtIn ? ' (included)' : ' (your key)');
  const box = $('providers'); box.replaceChildren();
  for (const p of v.providers) {
    const b = el('button', `provider${p.id === v.active ? ' on' : ''}`);
    b.type = 'button';
    const img = el('img'); img.src = p.icon; img.alt = '';
    b.append(img, el('span', '', p.name), el('small', '', p.id === v.active ? 'In use' : p.builtIn ? 'Included' : p.connected ? 'Connected' : 'Add key'));
    b.onclick = () => p.connected ? choose({ active: p.id }) : openKeyForm(p);
    if (p.connected && !p.builtIn) b.oncontextmenu = event => { event.preventDefault(); if (confirm(`Remove your ${p.name} key from this phone?`)) api(`api/model/key?id=${p.id}`, { method: 'DELETE' }).then(d => { modelView = d; drawModel(); loadModelList(); }); };
    box.append(b);
  }
  const opts = $('effortOptions'); opts.replaceChildren();
  $('effortRow').hidden = !active?.reasoning;
  for (const level of active?.reasoning || []) {
    const b = el('button', '', LEVELS[level] || level); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(level === v.reasoning));
    b.onclick = () => choose({ reasoning: level });
    opts.append(b);
  }
}
async function loadModelList() {
  const select = $('modelSelect');
  select.replaceChildren(el('option', '', modelView.model)); select.value = modelView.model;
  try {
    const { models } = await api(`api/model/models?id=${encodeURIComponent(modelView.active)}`);
    select.replaceChildren(...[...new Set([modelView.model, ...models])].map(m => { const o = el('option', '', m); o.value = m; return o; }));
    select.value = modelView.model;
  } catch (e) { modelNote(e.message); }
}
$('modelSelect').onchange = () => choose({ model: $('modelSelect').value });
async function choose(change) {
  try { const switching = change.active && change.active !== modelView.active; modelView = await api('api/model', { method: 'POST', body: JSON.stringify(change) }); drawModel(); if (switching) loadModelList(); modelNote('Saved. The next request uses it.'); }
  catch (e) { modelNote(e.message); }
}
function openKeyForm(p) {
  keyFor = p; $('keyForm').hidden = false; $('keyTitle').textContent = `Connect your ${p.name} key`; $('keyInput').value = ''; $('keyInput').focus();
}
$('keyCancel').onclick = () => { $('keyForm').hidden = true; keyFor = null; };
$('keyForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!keyFor) return;
  modelNote('Checking the key…');
  try {
    const d = await api('api/model/key', { method: 'POST', body: JSON.stringify({ id: keyFor.id, apiKey: $('keyInput').value }) });
    $('keyInput').value = ''; $('keyForm').hidden = true;
    modelView = d; await choose({ active: keyFor.id }); keyFor = null;
  } catch (e) { modelNote(e.message); }
});

// ---------- schedules ----------
const api = (url, options = {}) => fetch(url, { headers: { 'content-type': 'application/json' }, ...options }).then(async r => { const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(data.error || 'Request failed'); return data; });
// Schedules: a compact list with details, a month calendar, and a one-day timeline (bars last as long as past runs did).
const COLORS = ['#0866ff', '#00a884', '#e8710a', '#9334e6', '#d93025', '#1e8e3e', '#c5221f', '#185abc'];
let schedList = [], schedView = 'list', calMonth = new Date(), timelineDay = new Date(), openDetails = new Set();
const pad2 = n => String(n).padStart(2, '0');
const fmt = t => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
function renderSchedules(list) { schedList = list; drawSchedules(); }
function drawSchedules() {
  const box = $('schedules'); box.replaceChildren();
  for (const b of document.querySelectorAll('.views button')) b.setAttribute('aria-selected', String(b.dataset.view === schedView));
  if (!schedList.length) { box.append(el('p', 'empty', 'No schedules yet.')); return; }
  if (schedView === 'calendar') return drawCalendar(box);
  if (schedView === 'timeline') return drawTimeline(box);
  schedList.forEach((s, i) => {
    const card = el('div', 'sched'), top = el('div', 'sched-top');
    const swatch = el('span', 'swatch'); swatch.style.background = COLORS[i % COLORS.length];
    const toggle = el('button', '', s.enabled ? 'Pause' : 'Resume');
    toggle.onclick = () => api('api/schedules', { method: 'POST', body: JSON.stringify({ ...s, enabled: !s.enabled }) }).then(d => renderSchedules(d.schedules));
    const remove = el('button', '', 'Delete');
    remove.onclick = () => api(`api/schedules?id=${encodeURIComponent(s.id)}`, { method: 'DELETE' }).then(d => renderSchedules(d.schedules));
    top.append(swatch, el('strong', '', `${s.label}${s.enabled ? '' : ' · paused'}`), toggle, remove);
    const run = s.runs?.[0];
    const meta = el('p', 'meta', [run ? `Last ${fmt(run.at)} · ${run.status}` : '', s.enabled && s.next ? `Next ${fmt(s.next)}` : ''].filter(Boolean).join('  ·  '));
    const details = el('div', 'details'); details.hidden = !openDetails.has(s.id);
    for (const r of (s.runs || []).slice(0, 5)) {
      const item = el('div', 'run', `${fmt(r.at)} · ${r.status}${r.ms ? ` · ${Math.round(r.ms / 1000)}s` : ''}`);
      if (r.answer) item.append(el('p', '', r.answer));
      details.append(item);
    }
    if (!s.runs?.length) details.append(el('div', 'run', 'No runs yet.'));
    const more = el('button', 'more', details.hidden ? 'Details' : 'Hide details');
    more.onclick = () => { details.hidden = !details.hidden; more.textContent = details.hidden ? 'Details' : 'Hide details'; details.hidden ? openDetails.delete(s.id) : openDetails.add(s.id); };
    card.append(top, el('p', 'prompt', s.prompt), meta, more, details);
    box.append(card);
  });
}
function drawCalendar(box) {
  const head = el('div', 'cal-head'), prev = el('button', '', '‹'), next = el('button', '', '›');
  prev.onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); drawSchedules(); };
  next.onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); drawSchedules(); };
  head.append(prev, el('span', '', calMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' })), next);
  const grid = el('div', 'cal');
  for (const d of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) grid.append(el('span', 'dow', d));
  const first = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1), start = new Date(first); start.setDate(1 - first.getDay());
  const parsed = schedList.map(s => { try { return s.enabled ? Cron.parse(s.cron) : null; } catch { return null; } });
  const today = new Date().toDateString();
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const cell = el('button', `day${d.getMonth() !== calMonth.getMonth() ? ' out' : ''}${d.toDateString() === today ? ' today' : ''}`);
    cell.append(el('span', '', String(d.getDate())));
    const dots = el('div', 'dots'); let total = 0;
    parsed.forEach((cp, k) => { if (!cp) return; const n = Cron.dayRuns(cp, d).length; if (!n) return; total += n; const dot = el('i'); dot.style.background = COLORS[k % COLORS.length]; dots.append(dot); });
    cell.append(dots); if (total) cell.append(el('span', 'count', total >= 1000 ? `${(total / 1000).toFixed(1)}k runs` : `${total} run${total > 1 ? 's' : ''}`));
    cell.onclick = () => { timelineDay = d; schedView = 'timeline'; drawSchedules(); };
    grid.append(cell);
  }
  box.append(head, grid);
}
function drawTimeline(box) {
  const head = el('div', 'cal-head'), prev = el('button', '', '‹'), next = el('button', '', '›');
  prev.onclick = () => { timelineDay = new Date(timelineDay.getTime() - 864e5); drawSchedules(); };
  next.onclick = () => { timelineDay = new Date(timelineDay.getTime() + 864e5); drawSchedules(); };
  head.append(prev, el('span', '', timelineDay.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })), next);
  const gantt = el('div', 'gantt'), axis = el('div', 'gantt-axis');
  for (const h of [0, 6, 12, 18, 24]) { const t = el('span', '', `${pad2(h)}:00`); t.style.left = `${Math.min(96, Math.max(4, h / 24 * 100))}%`; axis.append(t); }
  gantt.append(axis);
  const isToday = timelineDay.toDateString() === new Date().toDateString(), nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  schedList.forEach((s, k) => {
    let cp; try { cp = Cron.parse(s.cron); } catch { return; }
    const runs = s.enabled ? Cron.dayRuns(cp, timelineDay) : [];
    const done = (s.runs || []).filter(r => r.ms);
    const minutes = Math.max(1, Math.round((done.reduce((a, r) => a + r.ms, 0) / Math.max(1, done.length) || 60000) / 60000));
    const row = el('div', 'gantt-row'), track = el('div', 'gantt-track');
    row.append(el('small', '', `${s.label} · ${s.prompt}`));
    // Merge back-to-back runs into one bar so "every minute" reads as a solid line.
    const bars = [];
    for (const m of runs) { const last = bars[bars.length - 1]; if (last && m <= last[1]) last[1] = Math.max(last[1], m + minutes); else bars.push([m, m + minutes]); }
    for (const [a, b] of bars) { const bar = el('i'); bar.style.left = `${a / 1440 * 100}%`; bar.style.width = `${Math.min(1440 - a, b - a) / 1440 * 100}%`; bar.style.background = COLORS[k % COLORS.length]; track.append(bar); }
    if (isToday) { const now = el('span', 'gantt-now'); now.style.left = `${nowMin / 1440 * 100}%`; track.append(now); }
    row.append(track); gantt.append(row);
  });
  box.append(head, gantt);
}
for (const b of document.querySelectorAll('.views button')) b.onclick = () => { schedView = b.dataset.view; drawSchedules(); };
const loadSchedules = () => api('api/schedules').then(d => renderSchedules(d.schedules)).catch(e => { $('schedNote').textContent = e.message; });

// ---------- notifications: the phone's Android notifications arrive as push notifications ----------
const bell = $('bell'), pushNote = $('pushNote');
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
function note(text) { pushNote.textContent = text; pushNote.hidden = !text; }
const fromBase64Url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
async function pushState() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.register('sw.js');
  const sub = await reg.pushManager?.getSubscription();
  bell.setAttribute('aria-pressed', String(Boolean(sub)));
  return reg;
}
bell.onclick = async () => {
  try {
    if (isIos && !standalone) return note('On iPhone: tap Share, then Add to Home Screen. Open Real Smart Phone from the home screen and tap the bell again.');
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return note('This browser cannot receive notifications.');
    const reg = await pushState();
    const current = await reg.pushManager.getSubscription();
    if (current) {
      await api('api/push', { method: 'DELETE', body: JSON.stringify({ endpoint: current.endpoint }) });
      await current.unsubscribe();
      bell.setAttribute('aria-pressed', 'false');
      return note('Notifications are off.');
    }
    if (await Notification.requestPermission() !== 'granted') return note('Notifications are blocked. Allow them in your browser settings.');
    const { publicKey } = await api('api/push');
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(publicKey) });
    await api('api/push', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
    bell.setAttribute('aria-pressed', 'true');
    note('Notifications are on. New notifications on your phone (KakaoTalk, WhatsApp, Instagram…) will appear here, and the phone stays on to receive them.');
  } catch (e) { note(`Notifications: ${e.message}`); }
};
pushState().catch(() => {});

// ---------- camera: this device's camera, live inside the phone's Camera page ----------
// The server asks for it only while that page is open; frames go up the same WebSocket as JPEGs.
let camStream = null, camTimer = null, camFacing = 'environment', camWanted = false;
const camVideo = $('camVideo'), camCanvas = document.createElement('canvas');
async function startCamera(facing) {
  stopCamera(false);
  camFacing = facing || camFacing;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: camFacing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) {
    $('camChip').hidden = false; $('camText').textContent = `Camera blocked: ${e.name === 'NotAllowedError' ? 'allow camera access for this site' : e.message}`;
    return;
  }
  camVideo.srcObject = camStream; await camVideo.play().catch(() => {});
  $('camChip').hidden = false; $('camText').textContent = 'Your camera is live in the phone';
  camTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 256 * 1024 || !camVideo.videoWidth) return;
    const scale = Math.min(1, 960 / Math.max(camVideo.videoWidth, camVideo.videoHeight));
    camCanvas.width = Math.round(camVideo.videoWidth * scale); camCanvas.height = Math.round(camVideo.videoHeight * scale);
    camCanvas.getContext('2d').drawImage(camVideo, 0, 0, camCanvas.width, camCanvas.height);
    camCanvas.toBlob(blob => { if (blob && ws && ws.readyState === WebSocket.OPEN) ws.send(blob); }, 'image/jpeg', 0.72);
  }, 100);
}
function stopCamera(hideChip = true) {
  clearInterval(camTimer); camTimer = null;
  camStream?.getTracks().forEach(t => t.stop()); camStream = null; camVideo.srcObject = null;
  if (hideChip) $('camChip').hidden = true;
}
function setCamera({ on, facing }) {
  camWanted = !!on;
  if (!on) return stopCamera();
  if (!camStream || (facing && facing !== camFacing)) startCamera(facing);
}
$('camStop').onclick = () => { camWanted = false; stopCamera(); };
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(false); else if (camWanted) startCamera(); });

// Installed as an app on a computer: shape the window like the phone (Chrome keeps a minimum width).
if (matchMedia('(display-mode: standalone)').matches && !matchMedia('(pointer: coarse)').matches && !sessionStorage.getItem('rsp-sized')) {
  try {
    sessionStorage.setItem('rsp-sized', '1');
    const frameW = window.outerWidth - window.innerWidth, frameH = window.outerHeight - window.innerHeight;
    const height = Math.round(screen.availHeight * 0.92), inner = height - frameH;
    window.resizeTo(Math.round((inner - 62) * 720 / 1560) + frameW, height);
  } catch {}
}

connect();
