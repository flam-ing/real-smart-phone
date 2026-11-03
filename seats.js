'use strict';
// Seat N = one Android container (phone-seat-N) with its own /data directory and ADB port.
// Seats boot on demand, at most MAX_RUNNING at once, and sleep after being idle. Data is kept while sleeping.
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const run = promisify(execFile);

const env = process.env;
const SEAT_COUNT = Number(env.SEAT_COUNT || 10);
const MAX_RUNNING = Number(env.MAX_RUNNING || 2);
const IMAGE = env.ANDROID_IMAGE || 'real-smart-phone-android:12';
const DATA_ROOT = env.SEAT_DATA || '/home/ubuntu/phone-seats';
const TEMPLATE = path.join(DATA_ROOT, 'template');
const ADB_BASE = Number(env.ADB_BASE_PORT || 5600);
const WIDTH = 720, HEIGHT = 1560;
const IME = 'com.android.adbkeyboard/.AdbIME';

const docker = (args, timeout = 30000) => run('docker', args, { timeout, maxBuffer: 4 * 1024 * 1024 }).then(r => r.stdout.trim());
const adb = (serial, args, timeout = 15000) => run('adb', ['-s', serial, ...args], { timeout, maxBuffer: 4 * 1024 * 1024 }).then(r => r.stdout.trim());
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function seatNumber(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= SEAT_COUNT ? n : null;
}
const containerName = n => `phone-seat-${n}`;
const serialOf = n => `127.0.0.1:${ADB_BASE + n}`;

const booting = new Map(); // seat -> Promise of a running, configured device
const states = new Map();  // seat -> 'starting' | 'booting' | 'running' | 'sleeping' | 'error'
let lastError = new Map();

async function isRunning(n) {
  try { return (await docker(['inspect', '-f', '{{.State.Running}}', containerName(n)], 10000)) === 'true'; }
  catch { return false; }
}
async function runningSeats() {
  const out = await docker(['ps', '--filter', 'label=real-smart-phone.seat', '--format', '{{.Label "real-smart-phone.seat"}}'], 10000);
  return out ? out.split('\n').map(Number).filter(Boolean) : [];
}

async function prepareData(n) {
  const dir = path.join(DATA_ROOT, String(n), 'data');
  if (fs.existsSync(dir)) return dir;
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  // A new seat starts from the prepared home screen when one exists; otherwise Android creates a fresh /data.
  if (fs.existsSync(TEMPLATE)) await run('cp', ['-a', TEMPLATE, dir], { timeout: 300000 });
  else fs.mkdirSync(dir);
  return dir;
}

async function create(n, dataDir) {
  try { await docker(['rm', '-f', containerName(n)], 20000); } catch {}
  await docker(['run', '-d', '--name', containerName(n), '--privileged', '--restart', 'no',
    '--label', `real-smart-phone.seat=${n}`, '--memory', env.SEAT_MEMORY || '3g', '--cpus', env.SEAT_CPUS || '2',
    '-v', `${dataDir}:/data`, '-p', `${serialOf(n)}:5555`, IMAGE,
    'androidboot.redroid_gpu_mode=guest', 'androidboot.use_memfd=true',
    `androidboot.redroid_width=${WIDTH}`, `androidboot.redroid_height=${HEIGHT}`,
    'androidboot.redroid_dpi=320', `androidboot.redroid_fps=${env.SEAT_FPS || 20}`], 60000);
}

async function configure(serial) {
  // Keep the display awake and make the ADB keyboard available for Korean text.
  const steps = [
    ['shell', 'settings', 'put', 'system', 'screen_off_timeout', '2147483647'],
    ['shell', 'svc', 'power', 'stayon', 'true'],
    ['shell', 'input', 'keyevent', '224'],
    ['shell', 'ime', 'enable', IME],
    // Typing comes from the viewer's own keyboard, so Android's on-screen keyboard never covers the screen.
    ['shell', 'ime', 'set', IME],
  ];
  for (const step of steps) { try { await adb(serial, step); } catch {} }
}

async function boot(n) {
  const serial = serialOf(n);
  if (!(await isRunning(n))) {
    const running = (await runningSeats()).filter(s => s !== n);
    if (running.length >= MAX_RUNNING) throw Object.assign(new Error('capacity'), { code: 'capacity', running });
    states.set(n, 'starting');
    const dataDir = await prepareData(n);
    // A seat made from an older image is recreated on the current one; its /data stays.
    const [have, want] = await Promise.all([
      docker(['inspect', '-f', '{{.Image}}', containerName(n)], 10000).catch(() => ''),
      docker(['image', 'inspect', '-f', '{{.Id}}', IMAGE], 10000).catch(() => ''),
    ]);
    if (have && have === want) await docker(['start', containerName(n)], 30000).catch(() => create(n, dataDir));
    else await create(n, dataDir);
  }
  states.set(n, 'booting');
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    try {
      await run('adb', ['connect', serial], { timeout: 5000 });
      if ((await adb(serial, ['shell', 'getprop', 'sys.boot_completed'], 5000)) === '1') {
        await configure(serial);
        states.set(n, 'running'); lastError.delete(n);
        return serial;
      }
    } catch {}
    await sleep(1500);
  }
  throw Object.assign(new Error('boot timeout'), { code: 'boot_timeout' });
}

function wake(n) {
  if (booting.has(n)) return booting.get(n);
  const pending = boot(n).catch(error => {
    states.set(n, error.code === 'capacity' ? 'sleeping' : 'error');
    lastError.set(n, error.code || 'error');
    throw error;
  }).finally(() => booting.delete(n));
  booting.set(n, pending);
  return pending;
}

async function sleepSeat(n) {
  states.set(n, 'sleeping');
  try { await run('adb', ['disconnect', serialOf(n)], { timeout: 5000 }); } catch {}
  try { await docker(['stop', '-t', '10', containerName(n)], 30000); } catch {}
}

async function status(n) {
  const running = await isRunning(n);
  let state = states.get(n) || (running ? 'running' : 'sleeping');
  if (!running && state === 'running') state = 'sleeping';
  if (running && state === 'sleeping') state = 'running';
  const seats = await runningSeats().catch(() => []);
  return { seat: n, state, error: lastError.get(n) || null, running: seats.length, maxRunning: MAX_RUNNING };
}

module.exports = { SEAT_COUNT, MAX_RUNNING, WIDTH, HEIGHT, IME, seatNumber, serialOf, wake, sleepSeat, status, isRunning, adb };
