const {test}=require('node:test');
const assert=require('node:assert/strict');
const {make,sleep}=require('./app-env.cjs');

const {setup}=require('./rewrite-env.cjs');

test('same memo can expand repeatedly and reports the session count',async t=>{
  const e=await setup(t);e.expand();e.complete('第一次扩写后的正文，条理更加清晰。');
  assert.match(e.$('memo-stat').textContent,/可.*继续|可.*再次/);
  e.expand();e.complete('第二次扩写后的正文，依然保留全部事实。');
  assert.match(e.$('memo-stat').textContent,/第\s*2\s*次/);
  assert.equal(e.$('memo-rw-new').textContent,'第二次扩写后的正文，依然保留全部事实。');
});
test('replace body applies and saves immediately without another confirmation or navigation',async t=>{
  const e=await setup(t);e.expand();e.complete('现在就替换并保存的新正文。');e.$('memo-rw-adopt').click();
  assert.equal(e.$('memo-body-input').value,'现在就替换并保存的新正文。');
  assert.equal(e.$('confirm-layer').classList.contains('is-hidden'),true);
  assert.equal(e.$('memo-layer').classList.contains('is-hidden'),false);
  assert.equal(e.w.MemoService.list(e.user)[0].body,'现在就替换并保存的新正文。');
  assert.match(e.$('toast').textContent,/已.*替换|正文已/);
  e.expand();e.complete('替换以后仍然可以再次扩写。');
  assert.match(e.$('memo-stat').textContent,/第\s*2\s*次/);
});
test('rewrite callback from a closed memo does not leak into the next memo',async t=>{
  const e=await setup(t);e.expand();e.$('memo-close').click();await e.memo('这是第二篇笔记，请保持正文不变。','SECOND');
  e.complete('第一篇的迟到结果');
  assert.equal(e.$('memo-rwcard').classList.contains('is-hidden'),true);
  assert.equal(e.$('memo-body-input').value,'这是第二篇笔记，请保持正文不变。');
});
test('throwing model call releases the lock and allows retry',async t=>{
  const e=await setup(t);const transport=e.w.AiTaskRegistry.run;
  e.w.AiTaskRegistry.run=()=>{throw new Error('模型暂不可用');};e.expand();
  e.w.AiTaskRegistry.run=transport;e.expand();e.complete('错误恢复后可以继续扩写。');
  assert.equal(e.$('memo-rw-new').textContent,'错误恢复后可以继续扩写。');
});
test('new edits invalidate an old rewrite instead of silently overwriting them',async t=>{
  const e=await setup(t);e.expand();e.complete('旧改写稿');
  e.$('memo-body-input').value='用户在生成以后补充的新正文，必须保留。';
  e.$('memo-body-input').dispatchEvent(new e.w.Event('input',{bubbles:true}));e.$('memo-rw-adopt').click();
  assert.equal(e.$('memo-body-input').value,'用户在生成以后补充的新正文，必须保留。');
  assert.match(e.$('memo-stat').textContent,/正文.*改|重新/);
});
test('timed-out rewrite releases its state and ignores the old late result',async t=>{
  const e=await setup(t);e.w.__MEMO_REWRITE_TIMEOUT_MS__=30;e.expand();
  const old=e.requests.shift();await sleep(55);e.expand();e.complete('新的扩写结果应该保留。');
  old.cb(null,{text:JSON.stringify({text:'旧结果不应覆盖'}),realModel:'demo'});
  assert.equal(e.$('memo-rw-new').textContent,'新的扩写结果应该保留。');
});
test('failed replacement save restores the visible original and keeps the draft retryable',async t=>{
  const e=await setup(t);const original=e.$('memo-body-input').value;e.expand();e.complete('保存失败时不能谎报成功的新正文。');
  const write=e.w.AppStorage.write;
  e.w.AppStorage.write=(key,value)=>key.startsWith('memo:')?false:write(key,value);
  e.$('memo-rw-adopt').click();
  assert.equal(e.$('memo-body-input').value,original);
  assert.equal(e.w.MemoService.list(e.user)[0].body,original);
  assert.equal(e.$('memo-rwcard').classList.contains('is-hidden'),false);
  assert.match(e.$('memo-stat').textContent,/失败/);
  e.w.AppStorage.write=write;e.$('memo-rw-adopt').click();
  assert.equal(e.$('memo-body-input').value,'保存失败时不能谎报成功的新正文。');
});
test('failed original archive prevents replacement and permits retry',async t=>{
  const e=await setup(t);const original=e.$('memo-body-input').value;e.expand();e.complete('需要先保留原稿的新正文。');
  const write=e.w.AppStorage.write;
  e.w.AppStorage.write=(key,value)=>key.startsWith('derived:')?false:write(key,value);
  e.$('memo-rw-adopt').click();
  assert.equal(e.$('memo-body-input').value,original);
  assert.equal(e.w.MemoService.list(e.user)[0].body,original);
  assert.match(e.$('memo-stat').textContent,/原稿.*失败/);
  e.w.AppStorage.write=write;e.$('memo-rw-adopt').click();
  assert.equal(e.$('memo-body-input').value,'需要先保留原稿的新正文。');
});
test('a missing note record produces an explicit replacement error instead of a silent no-op',async t=>{
  const e=await setup(t);e.expand();e.complete('待替换的新正文。');
  const memo=e.w.MemoService.list(e.user)[0];e.w.MemoService.remove(e.user,memo.id);
  e.$('memo-rw-adopt').click();
  assert.match(e.$('memo-stat').textContent,/笔记.*未找到|笔记.*不可读/);
});
test('unchanged polish output is retried rather than presented as a successful rewrite',async t=>{
  const e=await setup(t);const original=e.$('memo-body-input').value;
  e.$('memo-rewrite').click();e.$('memo-rw-polish').click();e.complete(original);
  assert.equal(e.requests.length,1,'unchanged output triggers the existing repair retry');
  e.complete('今天把读书笔记梳理清楚，记下三个明确的小目标。');
  assert.notEqual(e.$('memo-rw-new').textContent,original);
});
test('two unchanged model outputs produce an honest error and leave the original unchanged',async t=>{
  const e=await setup(t);const original=e.$('memo-body-input').value;
  e.expand();e.complete(original);e.complete(original);
  assert.equal(e.$('memo-rwcard').classList.contains('is-hidden'),true);
  assert.match(e.$('memo-stat').textContent,/相同|一致|未.*修改/);
  assert.equal(e.$('memo-body-input').value,original);
});
function touch(w,type,x,y) {
  const event=new w.Event(type,{bubbles:true,cancelable:true});
  Object.defineProperty(event,'touches',{value:type==='touchend'?[]:[{clientX:x,clientY:y}]});
  Object.defineProperty(event,'changedTouches',{value:[{clientX:x,clientY:y}]});
  return event;
}
test('mobile touch release immediately adopts once even when compatibility click follows',async t=>{
  const e=await setup(t);e.expand();e.complete('用手机触控直接采用并保存的正文。');
  const btn=e.$('memo-rw-adopt');btn.dispatchEvent(touch(e.w,'touchstart',100,100));
  const end=touch(e.w,'touchend',100,100);btn.dispatchEvent(end);btn.click();
  assert.equal(end.defaultPrevented,true);
  assert.equal(e.$('memo-body-input').value,'用手机触控直接采用并保存的正文。');
  assert.match(e.$('memo-stat').textContent,/正文已替换/);
});
test('scrolling from the replacement button does not accidentally adopt its draft',async t=>{
  const e=await setup(t);const original=e.$('memo-body-input').value;e.expand();e.complete('滚动时不应自动采用的草稿。');
  const btn=e.$('memo-rw-adopt');btn.dispatchEvent(touch(e.w,'touchstart',100,100));
  btn.dispatchEvent(touch(e.w,'touchmove',100,160));btn.dispatchEvent(touch(e.w,'touchend',100,160));
  assert.equal(e.$('memo-body-input').value,original);
});
test('a completed rewrite brings its replacement action fully into the editor viewport',async t=>{
  const e=await setup(t);let requested=null;
  e.$('memo-rw-adopt').scrollIntoView=options=>{requested=options;};
  e.expand();e.complete('较长改写稿完成后，替换按钮也应完整露出，不应被底部裁切。');await sleep(35);
  assert.ok(requested,'completed preview requests viewport placement');
  assert.equal(requested.block,'center');
  assert.equal(requested.behavior,'auto');
});
