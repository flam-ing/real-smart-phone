'use strict';
// Android notifications -> Web Push. While a seat's phone runs and someone subscribed to that seat,
// its notification list is read every few seconds and each new notification is pushed to the subscribers.
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const seats = require('./seats');

const POLL_MS = Number(process.env.NOTIFY_POLL_MS || 5000);
// System, keyboard and store notices are not worth a push.
const SKIP = new Set(['android', 'com.android.systemui', 'com.android.adbkeyboard', 'com.android.vending', 'com.google.android.gms', 'com.android.providers.downloads']);
const FLAG_ONGOING = 0x2, FLAG_FOREGROUND = 0x40, FLAG_GROUP_SUMMARY = 0x200;
const APP_NAMES = {
  'com.kakao.talk': 'KakaoTalk', 'com.whatsapp': 'WhatsApp', 'com.instagram.android': 'Instagram', 'com.instagram.barcelona': 'Threads',
  'com.facebook.katana': 'Facebook', 'com.towneers.www': 'Karrot', 'com.android.chrome': 'Chrome', 'com.google.android.apps.photos': 'Photos',
  'com.android.calendar': 'Calendar', 'com.android.shell': 'Real Smart Phone',
};

/** Parse `dumpsys notification --noredact` into active, user-facing notifications. */
function parseNotifications(dump) {
  const list = [];
  for (const block of String(dump).split('NotificationRecord(').slice(1)) {
    const pkg = /pkg=(\S+)/.exec(block)?.[1];
    const key = /\bkey=(\S+)/.exec(block)?.[1];
    if (!pkg || !key || SKIP.has(pkg)) continue;
    const flags = parseInt(/\bflags=0x([0-9a-f]+)/i.exec(block)?.[1] || '0', 16);
    if (flags & (FLAG_ONGOING | FLAG_FOREGROUND | FLAG_GROUP_SUMMARY)) continue;
    const extra = name => {
      const m = new RegExp(`android\\.${name}=(?:String|SpannableString|SpannedString) \\((.*)\\)\\s*$`, 'm').exec(block);
      return m ? m[1].slice(0, 300) : '';
    };
    const title = extra('title'), text = extra('bigText') || extra('text');
    if (!title && !text) continue;
    list.push({ id: `${key}@${/\bwhen=(\d+)/.exec(block)?.[1] || ''}|${title}|${text}`, pkg, app: APP_NAMES[pkg] || pkg.split('.').pop(), title, text });
  }
  return list;
}

function createNotifications({ dataDir, subject = 'https://mobile.ai-ing.org', log = console }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const keyFile = path.join(dataDir, 'vapid.json');
  let keys;
  try { keys = JSON.parse(fs.readFileSync(keyFile, 'utf8')); }
  catch { keys = webpush.generateVAPIDKeys(); fs.writeFileSync(keyFile, JSON.stringify(keys), { mode: 0o600 }); }
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);

  const subFile = n => path.join(dataDir, `push-${n}.json`);
  const load = n => { try { return JSON.parse(fs.readFileSync(subFile(n), 'utf8')); } catch { return []; } };
  const save = (n, list) => fs.writeFileSync(subFile(n), JSON.stringify(list), { mode: 0o600 });
  const valid = s => s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1000 && typeof s.keys?.p256dh === 'string' && typeof s.keys?.auth === 'string';

  function subscribe(n, subscription) {
    if (!valid(subscription)) throw Object.assign(new Error('Invalid subscription'), { status: 400 });
    const list = load(n).filter(s => s.endpoint !== subscription.endpoint);
    list.push({ endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } });
    save(n, list.slice(-10));
  }
  function unsubscribe(n, endpoint) { save(n, load(n).filter(s => s.endpoint !== endpoint)); }
  const hasSubscribers = n => load(n).length > 0;

  async function push(n, payload) {
    const list = load(n);
    log.log(JSON.stringify({ event: 'push', seat: n, subscribers: list.length }));
    let changed = false;
    await Promise.all(list.map(async s => {
      try { await webpush.sendNotification(s, JSON.stringify(payload), { TTL: 600, urgency: 'high' }); }
      catch (error) { if ([404, 410].includes(error.statusCode)) { s.gone = true; changed = true; } else log.warn(JSON.stringify({ event: 'push_failed', seat: n, status: error.statusCode || null })); }
    }));
    if (changed) save(n, list.filter(s => !s.gone));
  }

  const seen = new Map(); // seat -> Set of notification ids already handled
  async function poll() {
    for (let n = 1; n <= seats.SEAT_COUNT; n++) {
      if (!hasSubscribers(n) || !(await seats.isRunning(n))) { seen.delete(n); continue; }
      let current;
      try { current = parseNotifications(await seats.adb(seats.serialOf(n), ['shell', 'dumpsys', 'notification', '--noredact'], 10000)); }
      catch { continue; }
      const before = seen.get(n);
      seen.set(n, new Set(current.map(item => item.id)));
      if (!before) continue; // first look after start: remember what is already there, push nothing
      for (const item of current) {
        if (before.has(item.id)) continue;
        push(n, { title: item.title ? `${item.app} · ${item.title}` : item.app, body: item.text, tag: `${n}:${item.pkg}`, seat: n }).catch(() => {});
      }
    }
  }
  let busy = false;
  setInterval(() => { if (busy) return; busy = true; poll().finally(() => { busy = false; }); }, POLL_MS).unref();

  return { publicKey: keys.publicKey, subscribe, unsubscribe, hasSubscribers, push };
}

module.exports = { createNotifications, parseNotifications };
