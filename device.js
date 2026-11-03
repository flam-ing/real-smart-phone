'use strict';
// Live connection to one seat's Android: video stream, touch, keys and text.
// Started while someone watches or the AI works on the seat; stopped a minute after both leave.
const net = require('net');
const { spawn, execFile } = require('child_process');
const WebSocket = require('ws');
const ScrcpyStream = require('./scrcpy-stream');
const createTouchStream = require('./touch-stream');
const createFrameCredit = require('./frame-credit');
const seats = require('./seats');

const MONKEY_BASE = Number(process.env.MONKEY_BASE_PORT || 11000);
const devices = new Map();

class Device {
  constructor(n) {
    this.n = n; this.serial = seats.serialOf(n);
    this.clients = new Set(); this.holds = 0; this.latestFrame = null; this.frameAt = 0;
    this.stream = null; this.monkey = null; this.monkeyProc = null; this.stopTimer = null; this.listeners = new Set();
    this.credit = createFrameCredit({ credits: 2, send: (client, frame) => client.send(frame, { binary: true }) });
    this.touch = createTouchStream({
      width: seats.WIDTH, height: seats.HEIGHT,
      send: (kind, p) => this.monkeyWrite(`touch ${kind} ${p.x} ${p.y}\n`),
      fallbackTap: (x, y) => this.tap(x, y),
      fallbackSwipe: (x1, y1, x2, y2, d) => this.swipe(x1, y1, x2, y2, d),
    });
    this.textChain = Promise.resolve();
  }

  shell(args, timeout = 15000) { return seats.adb(this.serial, ['shell', ...args], timeout); }

  async ensure() {
    clearTimeout(this.stopTimer); this.stopTimer = null;
    await seats.wake(this.n);
    if (!this.stream) this.startStream();
    this.connectMonkey();
  }

  startStream() {
    const stream = new ScrcpyStream({
      device: this.serial,
      onFrame: frame => { if (this.stream === stream) this.broadcastFrame(frame); },
      onExit: () => {
        if (this.stream !== stream) return;
        this.stream = null;
        // The encoder exits when Android rotates or restarts; reconnect while still in use.
        if (this.inUse()) setTimeout(() => { if (!this.stream && this.inUse()) this.startStream(); }, 1500);
      },
    });
    this.stream = stream; stream.start();
  }

  broadcastFrame(frame) {
    this.latestFrame = frame; this.frameAt = Date.now();
    for (const client of this.clients) if (client.readyState === WebSocket.OPEN && client.bufferedAmount < 512 * 1024) this.credit.offer(client, frame);
    for (const listener of this.listeners) listener(frame);
  }
  sendJson(payload) {
    const message = JSON.stringify(payload);
    for (const client of this.clients) if (client.readyState === WebSocket.OPEN) client.send(message);
  }

  connectMonkey() {
    if (this.monkey || this.monkeyConnecting) return;
    this.monkeyConnecting = true;
    const port = MONKEY_BASE + this.n;
    execFile('adb', ['-s', this.serial, 'forward', `tcp:${port}`, 'tcp:1080'], { timeout: 5000 }, () => {
      execFile('adb', ['-s', this.serial, 'shell', 'pidof', 'com.android.commands.monkey'], { timeout: 5000 }, (err, out) => {
        if (!(parseInt(out, 10) > 0) && !this.monkeyProc) {
          this.monkeyProc = spawn('adb', ['-s', this.serial, 'shell', 'monkey', '--port', '1080'], { stdio: 'ignore' });
          this.monkeyProc.on('exit', () => { this.monkeyProc = null; });
        }
        setTimeout(() => {
          const socket = net.createConnection({ host: '127.0.0.1', port }, () => { this.monkey = socket; this.monkeyConnecting = false; });
          socket.on('data', () => {}); // Drain acknowledgements so commands never stall on a full socket.
          const drop = () => { if (this.monkey === socket) this.monkey = null; this.monkeyConnecting = false; };
          socket.on('error', drop); socket.on('close', drop);
        }, 1500);
      });
    });
  }
  monkeyWrite(command) {
    if (!this.monkey || this.monkey.destroyed) return false;
    try { this.monkey.write(command); return true; } catch { return false; }
  }

  tap(x, y) {
    if (this.monkeyWrite(`touch down ${x} ${y}\ntouch up ${x} ${y}\n`)) return Promise.resolve();
    return this.shell(['input', 'tap', String(x), String(y)]);
  }
  swipe(x1, y1, x2, y2, duration = 300) {
    if (this.monkey && !this.monkey.destroyed) {
      const steps = Math.max(3, Math.min(12, Math.round(duration / 25)));
      let command = `touch down ${x1} ${y1}\n`;
      for (let i = 1; i <= steps; i++) command += `touch move ${Math.round(x1 + (x2 - x1) * i / steps)} ${Math.round(y1 + (y2 - y1) * i / steps)}\n`;
      if (this.monkeyWrite(command + `touch up ${x2} ${y2}\n`)) return Promise.resolve();
    }
    return this.shell(['input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(duration)]);
  }
  key(code) {
    if (!Number.isInteger(code) || code < 0 || code > 288) return Promise.resolve();
    if (this.monkeyWrite(`press ${code}\n`)) return Promise.resolve();
    return this.shell(['input', 'keyevent', String(code)]);
  }
  // Korean and other Unicode text go through the ADB keyboard broadcast. Android's own keyboard comes back
  // a few seconds after the last typed text, so touch typing on the phone screen keeps working.
  text(value) {
    if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 8192) return Promise.resolve();
    const encoded = Buffer.from(value, 'utf8').toString('base64');
    clearTimeout(this.imeRestore);
    this.textChain = this.textChain.catch(() => {}).then(async () => {
      const current = await this.shell(['settings', 'get', 'secure', 'default_input_method']).catch(() => '');
      if (current !== seats.IME) { await this.shell(['ime', 'set', seats.IME]); await new Promise(r => setTimeout(r, 400)); }
      await this.shell(['am', 'broadcast', '--user', '0', '-a', 'ADB_INPUT_B64', '-p', 'com.android.adbkeyboard', '--es', 'msg', encoded]);
    });
    this.imeRestore = setTimeout(() => {
      this.textChain = this.textChain.catch(() => {}).then(() => this.shell(['ime', 'set', seats.DEFAULT_IME])).catch(() => {});
    }, 8000);
    return this.textChain;
  }
  // `monkey -p` cannot start while the touch monkey runs, so resolve the launcher activity and start it.
  async launch(pkg) {
    if (!/^[A-Za-z][\w]*(\.[A-Za-z][\w]*)+$/.test(pkg || '')) throw new Error('invalid package');
    const component = (await this.shell(['cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', pkg])).split('\n').pop().trim();
    if (!component.startsWith(`${pkg}/`)) throw new Error(`${pkg} is not installed`);
    await this.shell(['am', 'start', '-n', component]);
  }
  openUrl(url) {
    if (!/^https?:\/\/[^\s'"`]+$/.test(url || '')) return Promise.reject(new Error('invalid url'));
    return this.shell(['am', 'start', '-a', 'android.intent.action.VIEW', '-d', url]);
  }

  /** A fresh JPEG of the screen. Uses the live stream when it is current. */
  async frame(maxAgeMs = 1500) {
    if (this.latestFrame && Date.now() - this.frameAt < maxAgeMs) return this.latestFrame;
    if (!this.stream) this.startStream();
    // A still screen produces no new video frames; wait briefly, then use the last one.
    const fresh = await new Promise(resolve => {
      const listener = frame => { clearTimeout(timer); this.listeners.delete(listener); resolve(frame); };
      const timer = setTimeout(() => { this.listeners.delete(listener); resolve(null); }, 1200);
      this.listeners.add(listener);
    });
    return fresh || this.latestFrame;
  }

  async dumpUi() {
    // uiautomator runs one dump at a time; the AI and the keyboard watcher share this chain.
    const run = (this.dumpChain || Promise.resolve()).catch(() => {}).then(async () => {
      await this.shell(['uiautomator', 'dump', '--compressed', '/data/local/tmp/real-smart-phone-ui.xml'], 15000);
      return this.shell(['cat', '/data/local/tmp/real-smart-phone-ui.xml'], 8000);
    });
    this.dumpChain = run;
    return run;
  }

  /** Visible UI elements with text, for the AI to aim taps. */
  async uiNodes() {
    try {
      const xml = await this.dumpUi();
      const nodes = [];
      for (const m of xml.matchAll(/<node ([^>]*?)\/?>/g)) {
        const attr = name => (new RegExp(`${name}="([^"]*)"`).exec(m[1]) || [])[1] || '';
        const bounds = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attr('bounds'));
        const label = (attr('text') || attr('content-desc')).replace(/&amp;/g, '&').replace(/&#10;/g, ' ').slice(0, 60);
        const clickable = attr('clickable') === 'true', editable = /EditText/.test(attr('class'));
        if (!bounds || (!label && !editable) || (!clickable && !editable && !label)) continue;
        const [x1, y1, x2, y2] = bounds.slice(1).map(Number);
        if (x2 <= x1 || y2 <= y1) continue;
        nodes.push({ label, x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2), ...(editable ? { input: true } : {}) });
        if (nodes.length >= 60) break;
      }
      return nodes;
    } catch { return []; }
  }

  inUse() { return this.clients.size > 0 || this.holds > 0; }
  hold() { this.holds++; clearTimeout(this.stopTimer); this.stopTimer = null; }
  release() { this.holds = Math.max(0, this.holds - 1); this.scheduleStop(); }
  addClient(ws) { this.clients.add(ws); clearTimeout(this.stopTimer); this.stopTimer = null; }
  removeClient(ws) { this.clients.delete(ws); this.touch.release(ws, null, false); this.scheduleStop(); }
  scheduleStop() {
    if (this.inUse() || this.stopTimer) return;
    this.stopTimer = setTimeout(() => {
      this.stopTimer = null;
      if (this.inUse()) return;
      const stream = this.stream; this.stream = null; stream?.stop();
      this.monkey?.destroy(); this.monkey = null;
    }, 60000);
  }
}

function deviceFor(n) {
  if (!devices.has(n)) devices.set(n, new Device(n));
  return devices.get(n);
}

module.exports = { deviceFor, devices };
