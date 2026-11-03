'use strict';
// Per-seat schedules: at a cron time, the AI runs a saved request on that seat's phone (browser closed or not).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Cron = require('./public/cron');

function createSchedules({ dataDir, runAgent }) {
  const file = n => path.join(dataDir, `schedules-${n}.json`);
  const load = n => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return []; } };
  const save = (n, list) => { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(file(n), JSON.stringify(list, null, 1)); };

  function list(n) {
    return load(n).map(s => ({ ...s, label: Cron.describe(s.cron), next: (() => { try { return Cron.next(Cron.parse(s.cron))?.getTime() || null; } catch { return null; } })() }));
  }
  function upsert(n, body) {
    const prompt = String(body.prompt || '').trim().slice(0, 2000);
    const cron = String(body.cron || '').trim();
    if (!prompt) throw Object.assign(new Error('Describe the task'), { status: 400 });
    try { Cron.parse(cron); } catch (e) { throw Object.assign(new Error(`Invalid time: ${e.message}`), { status: 400 }); }
    const items = load(n);
    const existing = items.find(s => s.id === body.id);
    if (existing) Object.assign(existing, { prompt, cron, enabled: body.enabled !== false });
    else { if (items.length >= 20) throw Object.assign(new Error('Up to 20 schedules'), { status: 400 }); items.push({ id: crypto.randomUUID(), prompt, cron, enabled: body.enabled !== false, runs: [] }); }
    save(n, items); return list(n);
  }
  function remove(n, id) { save(n, load(n).filter(s => s.id !== id)); return list(n); }

  // The server runs in Asia/Seoul (TZ in the service unit), so cron times are Korean time.
  let lastMinute = '';
  async function tick(seatCount) {
    const now = new Date(), key = now.toISOString().slice(0, 16);
    if (key === lastMinute) return; lastMinute = key;
    for (let n = 1; n <= seatCount; n++) {
      for (const s of load(n)) {
        if (!s.enabled) continue;
        let due = false; try { due = Cron.matches(Cron.parse(s.cron), now); } catch {}
        if (!due) continue;
        const started = Date.now();
        runAgent(n, s.prompt, { source: 'schedule' }).then(answer => record(n, s.id, started, 'done', answer), error => record(n, s.id, started, 'failed', error.message));
      }
    }
  }
  function record(n, id, started, status, answer) {
    const items = load(n), s = items.find(x => x.id === id);
    if (!s) return;
    s.runs = [{ at: started, ms: Date.now() - started, status, answer: String(answer || '').slice(0, 300) }, ...(s.runs || [])].slice(0, 10);
    save(n, items);
  }
  return { list, upsert, remove, tick };
}

module.exports = { createSchedules };
