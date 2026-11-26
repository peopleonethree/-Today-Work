const {test} = require('node:test');
const assert = require('node:assert/strict');
const {make, sleep} = require('./app-env.cjs');

test('import merges over 80 names and requires explicit save', async t => {
  const e = await make(t);
  e.$('voice-names').value = '原姓名';
  const names = Array.from({length:166}, (_, i) => '王' + String.fromCharCode(0x4e00+i));
  const file = new e.w.File([names.join('\r\n') + '\r\n' + names[0] + '\r\n1234567890'], 'names.txt');
  const input = e.$('voice-names-file');
  Object.defineProperty(input,'files',{value:[file]});
  input.dispatchEvent(new e.w.Event('change'));
  await sleep(80);
  assert.equal(e.$('voice-names').value.split('、').length,167);
  assert.ok(!Object.values(e.backing).some(value => String(value).includes('原姓名')));
  e.$('save-voice-names').click();
  assert.ok(Object.values(e.backing).some(value => String(value).includes(names.at(-1))));
});

test('saved spellings correct recorded homophones before saving a todo', async t => {
  const e = await make(t);
  e.$('voice-names').value = '李娜，欧阳明宇';
  e.$('save-voice-names').click();
  e.w.document.querySelector('[data-vt="dict"]').click();
  e.$('voice-btn').click();
  e.done(e.segment(1), '明天下午三点在西安根里纳开会。去山东合则跟欧阳明雨交接材料');
  e.stopped();
  e.$('voice-to-todo').click();
  assert.equal(e.$('new-todo').value,'明天下午三点在西安跟李娜开会。去山东菏泽跟欧阳明宇交接材料');
  assert.equal(e.$('add-time-options').querySelectorAll('button[data-at]').length,1);
  assert.ok(Object.values(e.backing).some(value => String(value).includes('李娜、欧阳明宇')));
});

test('notes keep unconfigured names, duplicate homophones and ordinary words', async t => {
  const e = await make(t);
  e.$('voice-names').value = '张伟、章伟、李娜';
  e.$('save-voice-names').click();
  await e.memo();
  e.start();
  e.done(e.segment(1),'跟张玮开会。给欧阳明雨发消息。和梨纳果汁。联系里纳，核对材料。');
  assert.equal(e.$('memo-body-input').value,
    'BASELINE-跟张玮开会。给欧阳明雨发消息。和梨纳果汁。联系李娜，核对材料。');
});

test('system recognition applies saved names to the final note text', async t => {
  const e = await make(t);
  e.$('voice-names').value = '李娜';
  e.$('save-voice-names').click();
  await e.memo();
  e.w.document.querySelector('[data-vm="realtime"]').click();
  e.$('memo-voice').click();
  e.w.VoiceHost.result('给里纳打电话。');
  assert.equal(e.$('memo-body-input').value,'BASELINE-给李娜打电话。');
});
