const {test}=require('node:test');
const assert=require('node:assert/strict');
const {make}=require('./app-env.cjs');
const NOW=new Date(2026,9,26,10,0).getTime();
function draft(e,text){e.$('new-todo').value=text;e.$('new-todo').dispatchEvent(new e.w.Event('input',{bubbles:true}));}
function buttons(e){return [...e.$('add-time-options').querySelectorAll('button[data-at]')];}
test('offline voice recognizes compact 24-hour time and keeps Chinese names, places and tasks',async t=>{
  const e=await make(t);e.w.Date.now=()=>NOW;
  e.w.document.querySelector('[data-vt="dict"]').click();e.$('voice-btn').click();
  e.done(e.segment(1),'时间是两两两两，去山东菏泽跟欧阳明宇交接材料');
  e.stopped();
  assert.equal(e.$('voice-edit').value,'时间是22:22，去山东菏泽跟欧阳明宇交接材料');
  e.$('voice-to-todo').click();
  assert.equal(buttons(e).length,1);
  assert.equal(Number(buttons(e)[0].dataset.at),new Date(2026,9,26,22,22).getTime());
  buttons(e)[0].click();
  e.$('form-add').dispatchEvent(new e.w.Event('submit',{bubbles:true,cancelable:true}));
  const tasks=Object.values(e.backing).map(v=>JSON.parse(v)).filter(Array.isArray).flat();
  assert.ok(tasks.some(r=>r && r.text==='时间是22:22，去山东菏泽跟欧阳明宇交接材料' && r.dueAt===new Date(2026,9,26,22,22).getTime()));
});
test('compact times bind to dates, keep 24-hour rollover, and reject invalid times and IDs',async t=>{
  const e=await make(t);e.w.Date.now=()=>NOW;
  for (const [input, expected] of [
    ['明天两两两两在西安和李娜开会',new Date(2026,9,27,22,22)],
    ['明早洞拐动勾到贵州六盘水接张伟',new Date(2026,9,27,7,9)],
    ['0705',new Date(2026,9,27,7,5)],
    ['时间是零零零零，给王芳发邮件',new Date(2026,9,27,0,0)]
  ]) {
    draft(e,input);assert.deepEqual(buttons(e).map(b=>Number(b.dataset.at)),[+expected],input);
  }
  for (const input of ['订单2222在上海核对','电话是12222','时间为2360','明天下午2460在重庆开会','到2222号房间找王芳','明天时间是两两两去菏泽']) {
    draft(e,input);assert.equal(buttons(e).length,0,input);
  }
});
test('incomplete time from actual decoder output is flagged without guessing a digit or a name',async t=>{
  const e=await make(t);e.w.Date.now=()=>NOW;
  e.w.document.querySelector('[data-vt="dict"]').click();e.$('voice-btn').click();
  e.done(e.segment(1),'时间是两两两去山东合则跟欧阳明雨交接材料');e.stopped();
  assert.equal(e.$('voice-edit').value,'时间是两两两去山东菏泽跟欧阳明雨交接材料');
  assert.match(e.$('voice-sub').textContent,/请核对时间/);
  e.$('voice-to-todo').click();assert.equal(buttons(e).length,0);
});
test('time keywords provide concrete choices without setting a reminder until chosen',async t=>{
  const e=await make(t);e.w.Date.now=()=>NOW;
  draft(e,'明天下午三点给客户回电话');
  const b=buttons(e);assert.equal(b.length,1);assert.match(b[0].textContent,/明天下午三点/);
  assert.equal(Number(b[0].dataset.at),new Date(2026,9,27,15,0).getTime());
  assert.match(e.$('time-chip-text').textContent,/设置提醒时间/);
  b[0].click();assert.doesNotMatch(e.$('time-chip-text').textContent,/设置提醒时间/);
  assert.equal(e.$('new-todo').value,'明天下午三点给客户回电话');
});
test('relative duration and next natural week are extracted',async t=>{
  const e=await make(t);e.w.Date.now=()=>NOW;
  draft(e,'半小时后喝水');assert.equal(Number(buttons(e)[0].dataset.at),NOW+1800000);
  draft(e,'下周三下午两点开会');assert.equal(Number(buttons(e)[0].dataset.at),new Date(2026,10,4,14).getTime());
});
test('date-only wording offers explicit suggested hours rather than assuming one',async t=>{
  const e=await make(t);e.w.Date.now=()=>NOW;draft(e,'明天交报告');
  assert.deepEqual(buttons(e).map(b=>new Date(Number(b.dataset.at)).getHours()),[9,14,20]);
  assert.match(e.$('add-time-suggestions').textContent,/建议/);
});
test('today suggestions exclude past hours and invalid calendar dates are ignored',async t=>{
  const e=await make(t);e.w.Date.now=()=>NOW;draft(e,'今天交报告');
  assert.deepEqual(buttons(e).map(b=>new Date(Number(b.dataset.at)).getHours()),[14,20]);
  draft(e,'2月30号交报告');assert.equal(buttons(e).length,0);
});
test('chosen time is stored on explicit add and suggestions reset for the next task',async t=>{
  const e=await make(t);e.w.Date.now=()=>NOW;draft(e,'明天下午三点开会');
  buttons(e)[0].click();e.$('form-add').dispatchEvent(new e.w.Event('submit',{bubbles:true,cancelable:true}));
  const lists=Object.values(e.backing).map(v=>{try{return JSON.parse(v);}catch{return null;}}).filter(Array.isArray);
  const stored=lists.flat().find(r=>r && r.text==='明天下午三点开会');
  assert.ok(stored);assert.equal(stored.dueAt,new Date(2026,9,27,15).getTime());
  assert.equal(buttons(e).length,0);assert.equal(e.$('new-todo').value,'');
});
test('multiple times remain choices, cleared text and dismissed suggestions do not retain stale choices',async t=>{
  const e=await make(t);e.w.Date.now=()=>NOW;draft(e,'明天下午三点或后天上午九点开会');
  assert.equal(buttons(e).length,2);e.$('add-time-dismiss').click();
  assert.equal(e.$('add-time-suggestions').classList.contains('is-hidden'),true);
  draft(e,'买牛奶');assert.equal(buttons(e).length,0);
  draft(e,'半小时后喝水');e.w.Date.now=()=>NOW+3600000;buttons(e)[0].click();
  assert.match(e.$('time-chip-text').textContent,/设置提醒时间/);
});
test('voice to todo transfer displays time choices and still requires explicit add',async t=>{
  const e=await make(t);e.w.Date.now=()=>NOW;
  e.w.document.querySelector('[data-vt="realtime"]').click();e.$('voice-btn').click();
  e.w.VoiceHost.result('明天下午三点开会');e.$('voice-to-todo').click();
  assert.equal(e.$('new-todo').value,'明天下午三点开会');assert.equal(buttons(e).length,1);
  assert.match(e.$('time-chip-text').textContent,/设置提醒时间/);
});
