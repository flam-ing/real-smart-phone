'use strict';
// The viewer's real camera, inside the cloud phone. The phone's Camera shortcut opens /camera in its own browser;
// while that page watches, the viewer's device streams JPEG frames here, the page shows them live, and the
// shutter saves the current frame into the phone's gallery. Pages on the phone prove their seat with a key
// derived from a server secret, because the phone's browser has no invite cookie.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const seats = require('./seats');

const BOUNDARY = 'rspframe';

function createCamera({ dataDir, deviceFor }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'camera-secret');
  let secret;
  try { secret = fs.readFileSync(file, 'utf8').trim(); }
  catch { secret = crypto.randomBytes(32).toString('base64url'); fs.writeFileSync(file, secret, { mode: 0o600 }); }
  const keyFor = n => crypto.createHmac('sha256', secret).update(`cam:${n}`).digest('base64url').slice(0, 24);
  function seatFromKey(key) {
    if (typeof key !== 'string' || key.length !== 24) return null;
    for (let n = 1; n <= seats.SEAT_COUNT; n++) {
      const a = Buffer.from(keyFor(n)), b = Buffer.from(key);
      if (crypto.timingSafeEqual(a, b)) return n;
    }
    return null;
  }

  const state = new Map(); // seat -> { frame, at, watchers:Set<res>, facing, offTimer }
  const of = n => { if (!state.has(n)) state.set(n, { frame: null, at: 0, watchers: new Set(), facing: 'environment', offTimer: null }); return state.get(n); };
  const tell = (n, payload) => deviceFor(n).sendJson({ type: 'camera', ...payload });

  /** A frame from the viewer's device. */
  function frame(n, jpeg) {
    if (!Buffer.isBuffer(jpeg) || jpeg.length < 4 || jpeg.length > 1024 * 1024 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return;
    const s = of(n);
    s.frame = jpeg; s.at = Date.now();
    for (const res of s.watchers) {
      if (res.writableLength > 512 * 1024) continue; // a slow page skips frames instead of falling behind
      res.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
      res.write(jpeg); res.write('\r\n');
    }
  }

  /** The phone's camera page watches the live picture as MJPEG. */
  function stream(n, req, res) {
    const s = of(n);
    res.writeHead(200, { 'content-type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`, 'cache-control': 'no-store', connection: 'close', 'x-accel-buffering': 'no' });
    s.watchers.add(res);
    clearTimeout(s.offTimer);
    if (s.watchers.size === 1) tell(n, { on: true, facing: s.facing });
    if (s.frame) frame(n, s.frame);
    req.on('close', () => {
      s.watchers.delete(res);
      // Page reloads and app switches reconnect quickly; only turn the camera off when nobody comes back.
      if (!s.watchers.size) s.offTimer = setTimeout(() => { if (!s.watchers.size) tell(n, { on: false }); }, 4000);
    });
  }

  function flip(n) {
    const s = of(n);
    s.facing = s.facing === 'user' ? 'environment' : 'user';
    tell(n, { on: s.watchers.size > 0, facing: s.facing });
    return s.facing;
  }

  /** The current frame goes into the phone's gallery. */
  async function shoot(n) {
    const s = of(n);
    if (!s.frame || Date.now() - s.at > 5000) throw Object.assign(new Error('No live picture. Open Real Smart Phone on your device and allow the camera.'), { status: 409 });
    const name = `IMG_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}.jpg`;
    const temp = path.join(os.tmpdir(), `rsp-${n}-${name}`);
    fs.writeFileSync(temp, s.frame, { mode: 0o600 });
    try {
      const serial = seats.serialOf(n);
      await seats.adb(serial, ['push', temp, `/sdcard/DCIM/Camera/${name}`], 30000);
      await seats.adb(serial, ['shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file:///sdcard/DCIM/Camera/${name}`]);
    } finally { fs.rmSync(temp, { force: true }); }
    return name;
  }

  const wanted = n => ({ on: of(n).watchers.size > 0, facing: of(n).facing });
  return { keyFor, seatFromKey, frame, stream, flip, shoot, wanted, link: (n, origin) => `${origin}/camera?k=${keyFor(n)}` };
}

module.exports = { createCamera };
