'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Cron = require('../public/cron');

test('weekday 09:00 matches Monday, not Sunday', () => {
  const cp = Cron.parse('0 9 * * 1-5');
  assert.equal(Cron.matches(cp, new Date(2026, 10, 2, 9, 0)), true);
  assert.equal(Cron.matches(cp, new Date(2026, 10, 1, 9, 0)), false);
});
test('next run of every 15 minutes', () => {
  const next = Cron.next(Cron.parse('*/15 * * * *'), new Date(2026, 10, 4, 10, 7));
  assert.equal(next.getHours() * 60 + next.getMinutes(), 10 * 60 + 15);
});
test('labels and invalid input', () => {
  assert.equal(Cron.describe('30 8 * * *'), '매일 08:30');
  assert.throws(() => Cron.parse('61 * * * *'));
});
