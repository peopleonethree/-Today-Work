const {test}=require('node:test');
const assert=require('node:assert/strict');
const {make}=require('./app-env.cjs');
function transfer(e,text){
  e.w.document.querySelector('[data-vt="realtime"]').click();e.$('voice-btn').click();
  e.w.VoiceHost.result(text);e.$('voice-to-todo').click();
}
test('number labels accept short and mixed radio digits without changing reminder words',async t=>{
  const e=await make(t);
  transfer(e,'明天下午三点开会编号是动幺兩三四五六拐八勾，尾号沟。');
  assert.equal(e.$('new-todo').value,'明天下午三点开会编号是0123456789，尾号9。');
});
test('todo voice transfer offers digit correction without touching reminder wording',async t=>{
  const e=await make(t);transfer(e,'有两三四五六拐八沟。明天下午三点开会。');
  assert.equal(e.$('new-todo').value,'有两三四五六拐八沟。明天下午三点开会。');
  assert.equal(e.$('add-digit-fix').classList.contains('is-hidden'),false);
  assert.match(e.$('add-digit-adopt').textContent,/123456789/);
  e.$('add-time-options').querySelector('button').click();
  const time=e.$('time-chip-text').textContent;
  e.$('add-digit-adopt').click();
  assert.equal(e.$('new-todo').value,'123456789。明天下午三点开会。');
  assert.equal(e.$('time-chip-text').textContent,time);
  assert.equal(e.$('add-time-options').querySelectorAll('button').length,1);
  e.$('add-digit-undo').click();
  assert.equal(e.$('new-todo').value,'有两三四五六拐八沟。明天下午三点开会。');
});
test('todo clean numeric sentence auto normalizes in mixed speech and preserves leading zero',async t=>{
  const e=await make(t);transfer(e,'洞幺两三四五六拐八勾。明天下午三点开会。');
  assert.equal(e.$('new-todo').value,'0123456789。明天下午三点开会。');
  assert.equal(e.$('add-digit-fix').classList.contains('is-hidden'),true);
});
test('manual changes invalidate todo digit candidate and it cannot overwrite new text',async t=>{
  const e=await make(t);transfer(e,'腰两三四五。');
  e.$('new-todo').value='手工修改后的正文';
  e.$('new-todo').dispatchEvent(new e.w.Event('input',{bubbles:true}));
  e.$('add-digit-adopt').click();assert.equal(e.$('new-todo').value,'手工修改后的正文');
  assert.equal(e.$('add-digit-fix').classList.contains('is-hidden'),true);
});
test('numeric correction on mixed note segment preserves nonnumeric sentences',async t=>{
  const e=await make(t);await e.memo();e.start();
  e.done(e.segment(1),'洞幺两三四五六拐八勾。明天下午三点开会。');
  assert.equal(e.$('memo-body-input').value,'BASELINE-0123456789。明天下午三点开会。');
});
test('correcting a numeric clause keeps relative reminder anchored to original speech',async t=>{
  const e=await make(t);let now=new Date(2026,9,26,10).getTime();e.w.Date.now=()=>now;
  transfer(e,'腰两三四五。半小时后喝水。');
  const at=e.$('add-time-options').querySelector('button').dataset.at;
  now+=120000;e.$('add-digit-adopt').click();
  const button=e.$('add-time-options').querySelector('button');
  assert.equal(button.dataset.at,at);button.click();
  assert.match(e.$('add-hint').textContent,/已选提醒时间/);
});
test('clearing reminder time does not discard the independent digit candidate',async t=>{
  const e=await make(t);transfer(e,'腰两三四五。明天下午三点开会。');
  e.$('add-time-options').querySelector('button').click();e.$('time-clear').click();
  assert.equal(e.$('add-digit-fix').classList.contains('is-hidden'),false);
  e.$('add-digit-adopt').click();assert.equal(e.$('new-todo').value,'12345。明天下午三点开会。');
  assert.match(e.$('time-chip-text').textContent,/设置提醒时间/);
});
