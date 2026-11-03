'use strict';
// Closed beta access: an invite link carries a signed token (JWT, HS256) naming the tester's phone.
// node invites.js <seat> [name] prints a link; the secret lives in APP_DATA/invite-secret.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const b64 = value => Buffer.from(value).toString('base64url');

function createInvites({ dataDir }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'invite-secret');
  let secret;
  try { secret = fs.readFileSync(file, 'utf8').trim(); }
  catch { secret = crypto.randomBytes(32).toString('base64url'); fs.writeFileSync(file, secret, { mode: 0o600 }); }
  const sign = data => crypto.createHmac('sha256', secret).update(data).digest('base64url');

  function issue(seat, name = '') {
    const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = b64(JSON.stringify({ seat, ...(name ? { name } : {}), iat: Math.floor(Date.now() / 1000) }));
    return `${head}.${body}.${sign(`${head}.${body}`)}`;
  }
  /** The claims of a valid token, or null. */
  function verify(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || parts.some(p => !/^[\w-]+$/.test(p))) return null;
    const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`)), actual = Buffer.from(parts[2]);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
    try {
      const head = JSON.parse(Buffer.from(parts[0], 'base64url'));
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
      if (head.alg !== 'HS256' || (claims.exp && claims.exp * 1000 < Date.now())) return null;
      return claims;
    } catch { return null; }
  }
  return { issue, verify };
}

module.exports = { createInvites };

if (require.main === module) {
  const seat = Number(process.argv[2]);
  if (!Number.isInteger(seat) || seat < 1) { console.error('usage: node invites.js <seat> [name]'); process.exit(1); }
  const invites = createInvites({ dataDir: process.env.APP_DATA || path.join(__dirname, 'data') });
  console.log(`${process.env.PUBLIC_URL || 'https://mobile.ai-ing.org'}/?t=${invites.issue(seat, process.argv[3] || '')}`);
}
