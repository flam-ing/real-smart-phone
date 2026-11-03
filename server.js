'use strict';
// Real Smart Phone: each seat number gets its own Android phone in the cloud, with an AI that can operate it.
// Beta: a seat is chosen by number only; accounts come later.
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const seats = require('./seats');
const { deviceFor } = require('./device');
const { createAgents } = require('./agent');
const { createSchedules } = require('./schedules');

const env = process.env;
const PORT = Number(env.PORT || 18100);
const BASE = (env.BASE_PATH || '').replace(/\/+$/, '');
const DATA = env.APP_DATA || path.join(__dirname, 'data');
const ORIGINS = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const PUBLIC = path.join(__dirname, 'public');
const COOKIE = 'cp_seat';
const IDLE_SLEEP_MS = Number(env.IDLE_SLEEP_MIN || 30) * 60000;

const agents = createAgents({ dataDir: DATA, deviceFor, ensureSeat: n => deviceFor(n).ensure() });
const schedules = createSchedules({ dataDir: DATA, runAgent: (n, prompt, options) => agents.run(n, prompt, options) });
setInterval(() => schedules.tick(seats.SEAT_COUNT).catch?.(() => {}), 15000).unref();

// Sleep seats nobody has watched or used for a while, so others can wake theirs.
const lastUsed = new Map();
const touchSeat = n => lastUsed.set(n, Date.now());
setInterval(async () => {
  for (let n = 1; n <= seats.SEAT_COUNT; n++) {
    const device = deviceFor(n);
    if (device.inUse() || agents.isRunning(n)) { touchSeat(n); continue; }
    if (Date.now() - (lastUsed.get(n) || 0) > IDLE_SLEEP_MS && await seats.isRunning(n)) seats.sleepSeat(n);
  }
}, 60000).unref();

function seatFromCookie(req) {
  const match = /(?:^|;\s*)cp_seat=(\d+)/.exec(req.headers.cookie || '');
  return match ? seats.seatNumber(match[1]) : null;
}
function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json' : 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(data);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const readJson = async req => { try { return JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}'); } catch (e) { throw Object.assign(new Error('invalid request'), { status: e.status || 400 }); } };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/manifest+json' };
function serveFile(res, file) {
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC + path.sep) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return send(res, 404, 'Not found');
  res.writeHead(200, { 'content-type': TYPES[path.extname(full)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(full).pipe(res);
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  return !origin || ORIGINS.length === 0 || ORIGINS.includes(origin);
}

async function seatStatus(n) {
  const status = await seats.status(n);
  return { ...status, seatCount: seats.SEAT_COUNT, ai: { running: agents.isRunning(n), provider: agents.providerName() } };
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  if (BASE && !url.pathname.startsWith(BASE)) return send(res, 404, 'Not found');
  const route = url.pathname.slice(BASE.length) || '/';
  if (route === '' ) return send(res, 308, '', { location: `${BASE}/` });
  if (req.method !== 'GET' && !sameOrigin(req)) return send(res, 403, { error: 'origin' });
  const seat = seatFromCookie(req);

  if (req.method === 'GET' && route === '/') return serveFile(res, seat ? 'phone.html' : 'seat.html');
  if (req.method === 'POST' && route === '/api/seat') {
    const n = seats.seatNumber((await readJson(req)).seat);
    if (!n) return send(res, 400, { error: `Enter a number from 1 to ${seats.SEAT_COUNT}.` });
    return send(res, 200, { seat: n }, { 'set-cookie': `${COOKIE}=${n}; Path=${BASE || '/'}; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax` });
  }
  if (req.method === 'POST' && route === '/api/leave') return send(res, 200, { ok: true }, { 'set-cookie': `${COOKIE}=; Path=${BASE || '/'}; Max-Age=0; HttpOnly; Secure; SameSite=Lax` });
  if (route.startsWith('/api/')) {
    if (!seat) return send(res, 401, { error: 'seat' });
    touchSeat(seat);
    if (req.method === 'GET' && route === '/api/status') return send(res, 200, await seatStatus(seat));
    if (req.method === 'POST' && route === '/api/wake') {
      deviceFor(seat).ensure().catch(() => {});
      return send(res, 202, await seatStatus(seat));
    }
    if (req.method === 'GET' && route === '/api/usage') return send(res, 200, agents.usage());
    if (req.method === 'GET' && route === '/api/chat') return send(res, 200, { messages: agents.history(seat) });
    if (req.method === 'POST' && route === '/api/ai/stop') { agents.stop(seat); return send(res, 200, { ok: true }); }
    if (req.method === 'GET' && route === '/api/schedules') return send(res, 200, { schedules: schedules.list(seat) });
    if (req.method === 'POST' && route === '/api/schedules') return send(res, 200, { schedules: schedules.upsert(seat, await readJson(req)) });
    if (req.method === 'DELETE' && route === '/api/schedules') return send(res, 200, { schedules: schedules.remove(seat, url.searchParams.get('id')) });
    return send(res, 404, { error: 'not found' });
  }
  if (req.method === 'GET') return serveFile(res, route.replace(/^\/+/, ''));
  return send(res, 405, 'Method not allowed');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(error => { if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : 'Server error.' }); else res.end(); if (!error.status) console.error(error); });
});

const wss = new WebSocket.Server({ noServer: true, maxPayload: 64 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const seat = seatFromCookie(req);
  if (new URL(req.url, 'http://local').pathname !== `${BASE}/ws` || !seat || !sameOrigin(req)) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => connect(ws, seat));
});

function connect(ws, n) {
  const device = deviceFor(n);
  device.addClient(ws); touchSeat(n);
  const state = async () => { try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'state', ...(await seatStatus(n)) })); } catch {} };
  ws.send(JSON.stringify({ type: 'chat_history', messages: agents.history(n) }));
  ws.send(JSON.stringify({ type: 'ai', running: agents.isRunning(n) }));
  state();
  device.ensure().then(() => { state(); if (device.latestFrame && ws.readyState === WebSocket.OPEN) ws.send(device.latestFrame, { binary: true }); }, () => state());
  const timer = setInterval(state, 5000);
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    touchSeat(n);
    const clamp = (v, hi) => Math.max(0, Math.min(hi, Math.round(Number(v) || 0)));
    switch (msg.type) {
      case 'frame_ack_hello': return device.credit.enable(ws);
      case 'frame_ack': return device.credit.ack(ws);
      case 'pointer_down': case 'pointer_move': case 'pointer_up': return device.touch.handle(ws, msg);
      case 'tap': return device.tap(clamp(msg.x, 719), clamp(msg.y, 1559)).catch(() => {});
      case 'swipe': return device.swipe(clamp(msg.x1, 719), clamp(msg.y1, 1559), clamp(msg.x2, 719), clamp(msg.y2, 1559), Math.max(40, Math.min(1000, Number(msg.duration) || 200))).catch(() => {});
      case 'key': return device.key(Number(msg.keyCode)).catch(() => {});
      case 'text': return device.text(msg.text).catch(() => {});
      case 'chat': {
        const text = String(msg.text || '').trim().slice(0, 2000);
        if (!text) return;
        agents.addMessage(n, 'user', text);
        if (agents.isRunning(n)) return agents.addMessage(n, 'assistant', 'I am still working on the last request. Stop it first, then ask again.');
        agents.run(n, text).catch(() => {});
        return;
      }
      case 'ai_stop': return agents.stop(n);
    }
  });
  ws.on('close', () => { clearInterval(timer); device.removeClient(ws); });
}

server.listen(PORT, '127.0.0.1', () => console.log(`Real Smart Phone on 127.0.0.1:${PORT}${BASE}/`));
