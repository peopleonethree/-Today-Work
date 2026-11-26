const {test}=require('node:test');
const assert=require('node:assert/strict');
const {make}=require('./app-env.cjs');

test('offline panel displays handset dictation as digits before any transfer',async t=>{
  const e=await make(t);
  e.w.document.querySelector('[data-vt="dict"]').click();
  e.$('voice-btn').click();
  e.done(e.segment(1),'幺两三四五五四三两幺');
  assert.equal(e.$('voice-edit').value,'1234554321');
  e.done(e.segment(2),'幺两三四五六拐八沟');
  e.stopped();
  assert.equal(e.$('voice-edit').value,'1234554321 123456789');
  assert.equal(e.w.localStorage.getItem('voice.draft'),e.$('voice-edit').value);
});
