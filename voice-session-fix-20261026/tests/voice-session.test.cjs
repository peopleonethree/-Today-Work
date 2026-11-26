const {test}=require('node:test');
const assert=require('node:assert/strict');
const {make,sleep,PREFS}=require('./app-env.cjs');

test('cold boot restores each voice setting, including Ollama',async t=>{
  const store={[PREFS]:JSON.stringify({guideSeen:true,voiceTodoMode:'realtime',voiceMemoMode:'dict',voiceEngine:'ollama'})};
  const {w,$}=await make(t,{store});
  $('settings-btn').click();
  for(const selector of ['[data-vt="realtime"]','[data-vm="dict"]','[data-engine="ollama"]'])
    assert.equal(w.document.querySelector(selector).getAttribute('aria-checked'),'true',selector);
});
test('switching input mode during recording persists its new default',async t=>{
  const e=await make(t);e.w.document.querySelector('[data-vt="realtime"]').click();
  e.$('voice-btn').click();e.$('voice-dictate').click();
  assert.equal(JSON.parse(e.backing[PREFS]).voiceTodoMode,'dict');
});
test('stop waits for a late final segment and stopped acknowledgement',async t=>{
  const e=await make(t);const id=await e.memo();e.start();e.$('memo-voice').click();
  assert.equal(e.$('memo-voice').getAttribute('data-state'),'stopping');
  const req=e.segment(1);e.stopped();e.done(req,'尾段');
  assert.equal(e.w.MemoService.get(e.user,id).body,'BASELINE-尾段');
  assert.equal(e.$('memo-voice').getAttribute('data-state'),'idle');
});
test('recognized text is durable immediately without closing the editor',async t=>{
  const e=await make(t);const id=await e.memo();e.start();const req=e.segment(1);e.done(req,'已保存');
  assert.equal(e.w.MemoService.get(e.user,id).body,'BASELINE-已保存');
  const reboot=await make(t,{store:e.backing});
  assert.equal(reboot.w.MemoService.get(reboot.user,id).body,'BASELINE-已保存');
});
test('failed transcript storage is visible and closing cannot discard the unsaved body',async t=>{
  const e=await make(t);const id=await e.memo();const write=e.w.AppStorage.write;
  e.w.AppStorage.write=(key,value)=>key.startsWith('memo:')?false:write(key,value);
  e.start();e.done(e.segment(1),'未保存文字');e.$('memo-voice').click();e.stopped();
  assert.match(e.$('memo-stat').textContent,/保存失败|未保存/);
  assert.equal(e.w.MemoService.get(e.user,id).body,'BASELINE-');
  e.$('memo-close').click();assert.equal(e.$('memo-layer').classList.contains('is-hidden'),false);
  e.w.AppStorage.write=write;e.$('memo-close').click();
  assert.equal(e.w.MemoService.get(e.user,id).body,'BASELINE-未保存文字');
});
test('closing recording preserves committed text and releases the microphone',async t=>{
  const e=await make(t);const id=await e.memo();e.start();e.done(e.segment(1),'保留文字');e.$('memo-close').click();
  assert.equal(e.native.recording,false);
  assert.equal(e.w.MemoService.get(e.user,id).body,'BASELINE-保留文字');
});
test('cancelled old callbacks cannot write into a new memo',async t=>{
  const e=await make(t);await e.memo();e.start();const old=e.segment(1);e.$('memo-close').click();
  await e.memo('NEW-','SECOND');e.done(old,'旧回包');
  assert.equal(e.$('memo-body-input').value,'NEW-');
});
test('next transcription segment preserves edits made between segments',async t=>{
  const e=await make(t);const id=await e.memo();e.start();e.done(e.segment(1),'第一段');
  const body=e.$('memo-body-input');body.value+='手工补充';body.setSelectionRange(body.value.length,body.value.length);
  body.dispatchEvent(new e.w.Event('input',{bubbles:true}));e.done(e.segment(2),'第二段');
  assert.equal(body.value,'BASELINE-第一段手工补充第二段');
  assert.equal(e.w.MemoService.get(e.user,id).body,body.value);
});
test('insertion at caret zero stays at the start of an existing memo',async t=>{
  const e=await make(t);await e.memo('原文');e.$('memo-body-input').setSelectionRange(0,0);e.start();e.done(e.segment(1),'开头');
  assert.equal(e.$('memo-body-input').value,'开头原文');
});
test('bridge rejection does not permanently lock the transcription queue',async t=>{
  const e=await make(t);await e.memo();e.start();e.native.reject=true;e.segment(1);e.native.reject=false;
  const req=e.segment(2);e.done(req,'恢复');assert.equal(e.$('memo-body-input').value,'BASELINE-恢复');
});
test('timed out transcription is skipped and the next segment can complete',async t=>{
  const e=await make(t,{timeout:35});await e.memo();e.start();e.segment(1);await sleep(65);
  const req=e.segment(2);e.done(req,'下一段');assert.equal(e.$('memo-body-input').value,'BASELINE-下一段');
});
test('three consecutive errors release the native recorder',async t=>{
  const e=await make(t);await e.memo();e.start();const r1=e.segment(1);e.segment(2);e.segment(3);e.segment(4);
  e.w.DictationNet.error(r1.rid,'fail');
  e.w.DictationNet.error(e.native.requests[1].rid,'fail');
  e.w.DictationNet.error(e.native.requests[2].rid,'fail');
  assert.equal(e.native.recording,false);
  assert.equal(e.$('memo-voice').getAttribute('data-state'),'idle');
});
test('three consecutive errors also stop recording without a backlog',async t=>{
  const e=await make(t);await e.memo();e.start();
  for(let seq=1;seq<=3;seq++) {
    const req=e.segment(seq);e.w.DictationNet.error(req.rid,'fail');
  }
  assert.equal(e.native.recording,false);
  assert.equal(e.$('memo-voice').getAttribute('data-state'),'idle');
});
test('the main microphone cannot open a second input over a memo recording',async t=>{
  const e=await make(t);await e.memo();e.start();e.$('voice-btn').click();
  assert.equal(e.$('voice-layer').classList.contains('is-hidden'),true);
  assert.equal(e.native.recording,true);
});
test('missing native stop acknowledgement has a bounded recovery',async t=>{
  const e=await make(t,{stopTimeout:35});await e.memo();e.start();e.$('memo-voice').click();await sleep(65);
  assert.equal(e.native.recording,false);
  assert.equal(e.$('memo-voice').getAttribute('data-state'),'idle');
});
test('system realtime recognition remains available for memo input',async t=>{
  const e=await make(t);const id=await e.memo();e.w.document.querySelector('[data-vm="realtime"]').click();
  e.$('memo-voice').click();e.w.VoiceHost.partial('系统文字');e.$('memo-voice').click();e.w.VoiceHost.result('系统文字');
  e.$('memo-close').click();assert.equal(e.w.MemoService.get(e.user,id).body,'BASELINE-系统文字');
});
test('guide supports previous page, keyboard navigation and closing focus',async t=>{
  const e=await make(t);e.$('settings-btn').click();e.$('guide-row').click();
  assert.ok(e.$('guide-prev'),'visible previous-page control exists');
  assert.equal(e.$('guide-prev').disabled,true);
  const first=e.$('guide-pager').textContent;
  e.$('guide-next').click();assert.notEqual(e.$('guide-pager').textContent,first);
  e.$('guide-prev').click();assert.equal(e.$('guide-pager').textContent,first);
  e.$('guide-layer').dispatchEvent(new e.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  assert.notEqual(e.$('guide-pager').textContent,first);
  e.$('guide-skip').click();
  assert.equal(e.$('guide-layer').classList.contains('is-hidden'),true);
  assert.equal(e.w.document.activeElement,e.$('user-btn'));
});
