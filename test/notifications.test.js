'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNotifications } = require('../notifications');

const record = (pkg, flags, title, text, when) => `    NotificationRecord(0x0e9b98b2: pkg=${pkg} user=UserHandle{0} id=1 tag=t importance=3 key=0|${pkg}|1|t|10123: Notification(channel=c)
      flags=0x${flags}
      key=0|${pkg}|1|t|10123
            when=${when}
                android.title=String (${title})
                android.text=String (${text})
`;

test('keeps messages and skips ongoing, system and keyboard notifications', () => {
  const dump = 'Notification List:\n' + record('com.kakao.talk', '10', 'Mina', 'Dinner at 7?', 1)
    + record('com.android.vending', '0', 'Installed', 'Chrome', 2)
    + record('com.whatsapp', '62', 'Backup', 'running', 3)
    + record('com.android.adbkeyboard', '0', 'ADB Keyboard', 'on', 4);
  const list = parseNotifications(dump);
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].app, list[0].title, list[0].text], ['KakaoTalk', 'Mina', 'Dinner at 7?']);
});

test('a new message on the same notification gets a new id', () => {
  const a = parseNotifications(record('com.kakao.talk', '0', 'Mina', 'Hi', 1))[0];
  const b = parseNotifications(record('com.kakao.talk', '0', 'Mina', 'Are you there?', 2))[0];
  assert.notEqual(a.id, b.id);
});
