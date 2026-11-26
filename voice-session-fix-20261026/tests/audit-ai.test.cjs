const {test}=require('node:test');
const assert=require('node:assert/strict');
const {setup}=require('./rewrite-env.cjs');
const {sleep}=require('./app-env.cjs');
const summary={summary:'这是可靠的测试摘要。',keyPoints:['要点一'],quotes:[]};
test('audit: summary result is discarded after user edits its source',async t=>{
 const e=await setup(t);e.$('memo-summarize').click();const r=e.requests.shift();
 const id=e.w.MemoService.list(e.user)[0].id;e.$('memo-body-input').value+='新写的内容';
 e.$('memo-body-input').dispatchEvent(new e.w.Event('input',{bubbles:true}));
 r.cb(null,{text:JSON.stringify(summary),realModel:'demo'});
 assert.equal(e.w.DerivedStore.get(e.user,id,'summary'),null);
 assert.match(e.$('memo-stat').textContent,/改变|改动|重新/);
});
test('audit: summary archive failure is not reported as success',async t=>{
 const e=await setup(t);e.$('memo-summarize').click();const r=e.requests.shift();
 const write=e.w.AppStorage.write;e.w.AppStorage.write=(k,v)=>k.startsWith('derived:')?false:write(k,v);
 r.cb(null,{text:JSON.stringify(summary),realModel:'demo'});
 assert.match(e.$('memo-stat').textContent,/保存失败/);
});
test('audit: thrown memo task releases its lock and allows retry',async t=>{
 const e=await setup(t);e.w.AiTaskRegistry.run=()=>{throw Error('transport failed');};
 e.$('memo-summarize').click();e.$('memo-tags-btn').click();
 assert.match(e.$('memo-stat').textContent,/失败|异常/);
 assert.doesNotMatch(e.$('memo-stat').textContent,/上一次还在跑/);
});
test('audit: failed structured save restores body and never opens task drafts',async t=>{
 const e=await setup(t);const original=e.$('memo-body-input').value;
 e.$('memo-struct').click();const r=e.requests.shift();
 const write=e.w.AppStorage.write;e.w.AppStorage.write=(k,v)=>k.startsWith('memo:')?false:write(k,v);
 r.cb(null,{text:JSON.stringify({title:'新标题',body:'整理后新的正文内容。',todos:[{text:'新任务',when:'',who:''}],unclear:[]}),realModel:'demo'});
 assert.equal(e.$('memo-body-input').value,original);
 assert.match(e.$('memo-stat').textContent,/保存失败/);
 assert.equal(e.$('draft-layer').classList.contains('is-hidden'),true);
});
test('audit: timed-out memo task permits another task and ignores old response',async t=>{
 const e=await setup(t);e.w.__MEMO_AI_TIMEOUT_MS__=25;e.$('memo-summarize').click();
 const old=e.requests.shift();await sleep(45);assert.match(e.$('memo-stat').textContent,/超时/);
 e.$('memo-tags-btn').click();assert.equal(e.requests.length,1);
 old.cb(null,{text:JSON.stringify(summary),realModel:'demo'});
 assert.match(e.$('memo-stat').textContent,/标签/);
});
test('audit: QA references open their corresponding note rather than the last reference',async t=>{
 const e=await setup(t);
 const a=e.w.MemoService.create(e.user,{title:'FIRST',body:'这是第一条引用的完整内容。'});
 const b=e.w.MemoService.create(e.user,{title:'SECOND',body:'这是第二条引用的完整内容。'});
 e.w.SearchService.topSnippets=()=>[{n:1,memoId:a.id,title:'FIRST',text:a.body},{n:2,memoId:b.id,title:'SECOND',text:b.body}];
 e.$('memo-close').click();e.$('memo-ask').click();e.$('qa-input').value='引用问题';e.$('qa-ask').click();
 e.requests.shift().cb(null,{text:JSON.stringify({answer:'可以参考两条笔记。',refs:[1,2],enough:true}),realModel:'demo'});
 e.$('qa-refs').querySelector('button').click();assert.equal(e.$('memo-title-input').value,'FIRST');
});
test('audit: QA callback from an earlier closed panel cannot fill a newly opened panel',async t=>{
 const e=await setup(t);e.w.SearchService.topSnippets=()=>[{n:1,memoId:e.w.MemoService.list(e.user)[0].id,title:'NOTE',text:'完整笔记内容。'}];
 e.$('memo-close').click();e.$('memo-ask').click();e.$('qa-input').value='旧的问题';e.$('qa-ask').click();const old=e.requests.shift();
 e.$('qa-close').click();e.$('memo-ask').click();
 old.cb(null,{text:JSON.stringify({answer:'上一轮不应出现的答案。',refs:[1],enough:true}),realModel:'demo'});
 assert.equal(e.$('qa-result').classList.contains('is-hidden'),true);
});
test('audit: clearing search invalidates an older delayed search response',async t=>{
 const e=await setup(t);e.$('memo-close').click();let respond;
 e.w.SearchService.hybrid=(owner,q,cb)=>{respond=cb;};
 e.$('memo-search').value='旧搜索';e.$('memo-search').dispatchEvent(new e.w.Event('input',{bubbles:true}));await sleep(180);
 assert.ok(respond);e.$('memo-search').value='';e.$('memo-search').dispatchEvent(new e.w.Event('input',{bubbles:true}));await sleep(180);
 assert.equal(e.$('memo-list').children.length,1);respond({items:[],final:true});
 assert.equal(e.$('memo-list').children.length,1);
});
