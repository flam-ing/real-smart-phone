'use strict';
// Cron (minute hour day month weekday), the same rules as cloud-agent's schedules. Shared by server and page.
(function (root) {
  const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  function field(spec, lo, hi) {
    const out = new Set();
    const num = x => { if (!/^\d+$/.test(x)) throw new Error(spec); return Number(x); };
    for (let part of spec.split(',')) {
      let step = 1;
      const sl = part.split('/');
      if (sl.length > 2) throw new Error(spec);
      if (sl.length === 2) { part = sl[0]; step = num(sl[1]); if (step < 1) throw new Error(spec); }
      let a, b;
      if (part === '*') { a = lo; b = hi; }
      else if (part.includes('-')) { const r = part.split('-'); if (r.length !== 2) throw new Error(spec); a = num(r[0]); b = num(r[1]); }
      else { a = num(part); b = step > 1 ? hi : a; }
      if (a < lo || b > hi || a > b) throw new Error(spec);
      for (let v = a; v <= b; v += step) out.add(v);
    }
    return out;
  }
  function parse(expr) {
    const f = String(expr || '').trim().split(/\s+/);
    if (f.length !== 5) throw new Error('5칸(분 시 일 월 요일)이어야 합니다');
    const s = f.map((x, i) => field(x, ...RANGES[i]));
    if (s[4].has(7)) s[4].add(0);
    return { mi: s[0], ho: s[1], dom: s[2], mon: s[3], dow: s[4], domAny: f[2].startsWith('*'), dowAny: f[4].startsWith('*') };
  }
  function matches(cp, d) {
    if (!cp.mi.has(d.getMinutes()) || !cp.ho.has(d.getHours()) || !cp.mon.has(d.getMonth() + 1)) return false;
    const dOk = cp.dom.has(d.getDate()), wOk = cp.dow.has(d.getDay());
    if (cp.domAny && cp.dowAny) return true;
    if (cp.domAny || cp.dowAny) return cp.domAny ? wOk : dOk;
    return dOk || wOk;
  }
  function next(cp, from = new Date()) {
    const t = new Date(from); t.setSeconds(0, 0);
    for (let i = 0; i < 60 * 24 * 370; i++) { t.setMinutes(t.getMinutes() + 1); if (matches(cp, t)) return t; }
    return null;
  }
  const pad = n => String(n).padStart(2, '0');
  function describe(expr) {
    const f = String(expr || '').trim().split(/\s+/);
    if (f.length !== 5) return expr;
    const [mi, ho, dom, mon, dow] = f;
    const at = /^\d+$/.test(mi) && /^\d+$/.test(ho) ? `${pad(ho)}:${pad(mi)}` : '';
    if (mon === '*' && dom === '*') {
      if (at && dow === '*') return `매일 ${at}`;
      if (at && dow === '1-5') return `평일 ${at}`;
      if (at && (dow === '0,6' || dow === '6,0')) return `주말 ${at}`;
      if (/^\*\/\d+$/.test(mi) && ho === '*' && dow === '*') return `${mi.slice(2)}분마다`;
    }
    return expr;
  }
  const api = { parse, matches, next, describe };
  if (typeof module !== 'undefined') module.exports = api; else root.Cron = api;
})(this);
