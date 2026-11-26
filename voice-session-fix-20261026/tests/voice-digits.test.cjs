const {test}=require('node:test');
const assert=require('node:assert/strict');
const {make}=require('./app-env.cjs');
test('short ambiguous callsigns can be adopted while normal verbs stay intact',async t=>{
  const e=await make(t);await e.memo();e.start();
  e.done(e.segment(1),'动。拐。勾。编号幺。编号两。向左拐。请不要动。');
  e.$('memo-voice').click();e.stopped();e.$('memo-digit-adopt').click();
  assert.equal(e.$('memo-body-input').value,'BASELINE-0。7。9。编号1。编号2。向左拐。请不要动。');
});

test('standalone unambiguous spoken digits become digits and save, retaining leading zero',async t=>{
  const e=await make(t);const id=await e.memo();e.start();
  e.done(e.segment(1),'零幺两三四五。');
  assert.equal(e.$('memo-body-input').value,'BASELINE-012345。');
  assert.equal(e.w.MemoService.get(e.user,id).body,'BASELINE-012345。');
});
test('ambiguous digit homophones require confirmation and apply both sequences immediately',async t=>{
  const e=await make(t);const id=await e.memo();e.start();
  e.done(e.segment(1),'有两三四五。腰两三四五。');
  e.$('memo-voice').click();e.stopped();
  assert.match(e.$('memo-body-input').value,/有两三四五/);
  assert.equal(e.$('memo-digit-fix').classList.contains('is-hidden'),false);
  assert.match(e.$('memo-digit-adopt').textContent,/12345。12345/);
  e.$('memo-digit-adopt').click();
  assert.equal(e.$('memo-body-input').value,'BASELINE-12345。12345。');
  assert.equal(e.w.MemoService.get(e.user,id).body,'BASELINE-12345。12345。');
  e.$('memo-digit-undo').click();
  assert.equal(e.w.MemoService.get(e.user,id).body,'BASELINE-有两三四五。腰两三四五。');
});
test('ordinary sentences, amounts, dates, decimals and short words are preserved',async t=>{
  for(const raw of ['腰有点痛。','我有两三四五个朋友。','一百二十三元。','二零二六年十月。','一点二三四五。','一心一意。','一二。','两个人。','拐弯后跨过水沟。','请不要动。']){
    const e=await make(t);await e.memo();e.start();e.done(e.segment(1),raw);
    assert.equal(e.$('memo-body-input').value,'BASELINE-'+raw);
    assert.equal(e.$('memo-digit-fix').classList.contains('is-hidden'),true);
  }
});
test('radio digit names keep leading zero while similar ordinary words remain opt-in',async t=>{
  const e=await make(t);await e.memo();e.start();e.done(e.segment(1),'洞幺两三四五六拐八勾。');
  assert.equal(e.$('memo-body-input').value,'BASELINE-0123456789。');
  e.done(e.segment(2),'动幺两三四五六拐八沟。');e.$('memo-voice').click();e.stopped();
  assert.match(e.$('memo-body-input').value,/动幺两三四五六拐八沟/);
  e.$('memo-digit-adopt').click();
  assert.equal(e.$('memo-body-input').value,'BASELINE-0123456789。0123456789。');
});
test('common spoken phone digits and unit numerals retain distinct meanings',async t=>{
  for(const [raw,expected] of [['幺幺零。','110。'],['两千。','2000。'],['两万两千二百二十二。','22222。'],['两百二十二。','222。'],['两千零二十。','2020。'],['一万两千。','12000。'],['一千二百三十四。','1234。'],['十万。','100000。'],['一二三四五和一二三四五。','12345和12345。']]){
    const e=await make(t);await e.memo();e.start();e.done(e.segment(1),raw);
    assert.equal(e.$('memo-body-input').value,'BASELINE-'+expected,raw);
  }
});
test('separate segments keep all digit candidates and correct only their insertion ranges',async t=>{
  const e=await make(t);await e.memo('原文腰两三四五。');e.start();
  e.done(e.segment(1),'腰两三四五。');e.done(e.segment(2),'有六七八九。');
  e.$('memo-voice').click();e.stopped();e.$('memo-digit-adopt').click();
  assert.equal(e.$('memo-body-input').value,'原文腰两三四五。12345。16789。');
});
test('manual edit invalidates digit correction instead of overwriting user text',async t=>{
  const e=await make(t);await e.memo();e.start();e.done(e.segment(1),'腰两三四五。');
  e.$('memo-voice').click();e.stopped();
  e.$('memo-body-input').value+='手工编辑';
  e.$('memo-body-input').dispatchEvent(new e.w.Event('input',{bubbles:true}));
  e.$('memo-digit-adopt').click();assert.match(e.$('memo-body-input').value,/手工编辑$/);
  assert.doesNotMatch(e.$('memo-body-input').value,/12345/);
});
test('digit candidate cannot leak into a newly opened note',async t=>{
  const e=await make(t);await e.memo();e.start();e.done(e.segment(1),'腰两三四五。');
  e.$('memo-voice').click();e.stopped();e.$('memo-close').click();
  await e.memo('另一篇正文','SECOND');e.$('memo-digit-adopt').click();
  assert.equal(e.$('memo-body-input').value,'另一篇正文');
  assert.equal(e.$('memo-digit-fix').classList.contains('is-hidden'),true);
});
test('failed digit correction save rolls back original and keeps candidate retryable',async t=>{
  const e=await make(t);await e.memo();e.start();e.done(e.segment(1),'腰两三四五。');
  e.$('memo-voice').click();e.stopped();const write=e.w.AppStorage.write;
  e.w.AppStorage.write=()=>false;e.$('memo-digit-adopt').click();
  assert.equal(e.$('memo-body-input').value,'BASELINE-腰两三四五。');
  assert.match(e.$('memo-stat').textContent,/失败/);
  e.w.AppStorage.write=write;e.$('memo-digit-adopt').click();
  assert.equal(e.$('memo-body-input').value,'BASELINE-12345。');
});
