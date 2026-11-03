'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBoxes } = require('../providers/sam');

test('reads SAM 3.1 boxes in ranked order and ignores masks', () => {
  const text = '<0f>0<|box;x1=183;y1=341;x2=272;y2=431;w=720;h=1560|><|mask;x=0;y=0;data=91,90,~!!|>,1<|box;x1=50;y1=815;x2=139;y2=906;w=720;h=1560|><|mask;x=0;y=0;data=xx|>';
  assert.deepEqual(parseBoxes(text), [
    { x1: 183, y1: 341, x2: 272, y2: 431, w: 720, h: 1560 },
    { x1: 50, y1: 815, x2: 139, y2: 906, w: 720, h: 1560 },
  ]);
  assert.deepEqual(parseBoxes('<0f>'), []);
});
