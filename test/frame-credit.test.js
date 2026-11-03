'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const createFrameCredit = require('../frame-credit');

test('legacy clients receive every frame', () => {
  const sent = [], fc = createFrameCredit({credits:2, send:(c, f) => sent.push(f)});
  const client = {};
  for (const f of [1, 2, 3, 4]) fc.offer(client, f);
  assert.deepEqual(sent, [1, 2, 3, 4]);
});

test('acknowledging clients hold at most two frames and then get only the newest', () => {
  const sent = [], fc = createFrameCredit({credits:2, send:(c, f) => sent.push(f)});
  const client = {}; fc.enable(client);
  for (const f of [1, 2, 3, 4, 5]) fc.offer(client, f);
  assert.deepEqual(sent, [1, 2]);
  fc.ack(client);
  assert.deepEqual(sent, [1, 2, 5]);
  fc.ack(client); fc.ack(client);
  assert.deepEqual(sent, [1, 2, 5]);
  fc.offer(client, 6);
  assert.deepEqual(sent, [1, 2, 5, 6]);
});

test('an extra acknowledgement never grants more than the credit limit', () => {
  const sent = [], fc = createFrameCredit({credits:2, send:(c, f) => sent.push(f)});
  const client = {}; fc.enable(client);
  fc.ack(client); fc.ack(client);
  for (const f of [1, 2, 3]) fc.offer(client, f);
  assert.deepEqual(sent, [1, 2]);
});
