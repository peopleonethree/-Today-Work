const {test}=require('node:test');
const assert=require('node:assert/strict');
const {make,sleep}=require('./app-env.cjs');
const {setup}=require('./rewrite-env.cjs');
function choices(e,text,now){e.w.Date.now=()=>now;e.$('new-todo').value=text;e.$('new-todo').dispatchEvent(new e.w.Event('input',{bubbles:true}));return [...e.$('add-time-options').querySelectorAll('button[data-at]')].map(b=>Number(b.dataset.at));}

test('audit: same weekday with an explicit future clock stays in the current week',async t=>{
 const e=await make(t), now=new Date(2026,9,26,10).getTime();
 assert.deepEqual(choices(e,'周一下午三点开会',now),[new Date(2026,9,26,15).getTime()]);
});
test('audit: same calendar day with an explicit future clock stays in the current year',async t=>{
 const e=await make(t), now=new Date(2026,9,26,10).getTime();
 assert.deepEqual(choices(e,'10月26号下午三点开会',now),[new Date(2026,9,26,15).getTime()]);
});
test('audit: tomorrow morning with an explicit clock produces one correct choice',async t=>{
 const e=await make(t), now=new Date(2026,9,26,10).getTime();
 assert.deepEqual(choices(e,'明早九点开会',now),[new Date(2026,9,27,9).getTime()]);
});
test('audit: expired explicit morning does not become afternoon',async t=>{
 const e=await make(t), now=new Date(2026,9,26,10).getTime();
 assert.deepEqual(choices(e,'上午九点吃药',now),[new Date(2026,9,27,9).getTime()]);
});
test('audit: late tags from a closed memo do not appear on the next memo',async t=>{
 const e=await setup(t);e.$('memo-tags-btn').click();const old=e.requests.shift();assert.ok(old);
 e.$('memo-close').click();await e.memo('这是第二篇完全不同的笔记内容。','SECOND');
 old.cb(null,{text:JSON.stringify({tags:['旧笔记标签','旧笔记主题']}),realModel:'demo'});
 assert.equal(e.$('memo-tagsug').classList.contains('is-hidden'),true);
});
test('audit: removing the last tag preserves summary and original rewrite archive',async t=>{
 const e=await setup(t),m=e.w.MemoService.list(e.user)[0],d=e.w.DerivedStore;
 d.put(e.user,m.id,'summary',{summary:'需保留的摘要'});d.put(e.user,m.id,'rewrite',{text:'需保留的原稿'});
 d.put(e.user,m.id,'tags',{tags:['读书']});d.adopt(e.user,m.id,'tags');
 e.$('memo-close').click();e.w.document.querySelector('#memo-list [data-id] button').click();
 e.$('memo-tagsug').querySelector('.memo__tagchip--ok').click();
 assert.ok(d.get(e.user,m.id,'summary'),'summary must survive tag removal');
 assert.ok(d.get(e.user,m.id,'rewrite'),'archived original must survive tag removal');
});
test('audit: failed memo deletion keeps its editor open and preserves derived records',async t=>{
 const e=await setup(t),m=e.w.MemoService.list(e.user)[0],d=e.w.DerivedStore;
 d.put(e.user,m.id,'summary',{summary:'仍需保留'});const write=e.w.AppStorage.write;
 e.w.AppStorage.write=(key,value)=>key.startsWith('memo:')?false:write(key,value);
 e.$('memo-delete').click();e.$('confirm-ok').click();await sleep(20);
 assert.ok(e.w.MemoService.get(e.user,m.id),'source memo is still stored');
 assert.equal(e.$('memo-layer').classList.contains('is-hidden'),false,'failed deletion must keep editor open');
 assert.ok(d.get(e.user,m.id,'summary'),'failed deletion must preserve summary');
});
test('audit: existing data remains readable when quota rejects writes',async t=>{
 const e=await make(t);const id=await e.memo('已有的已保存内容。');
 e.w.localStorage.setItem=()=>{throw new e.w.DOMException('full','QuotaExceededError');};
 assert.ok(e.w.MemoService.get(e.user,id),'read must not require a successful probe write');
 assert.ok(e.w.AppAuth.currentUser(),'quota must not make the account disappear');
});
test('audit: registration reports session persistence failure',async t=>{
 const e=await make(t);e.w.AppAuth.logout();const write=e.w.AppStorage.write;
 e.w.AppStorage.write=(key,value)=>key==='session'?false:write(key,value);
 const result=await e.w.AppAuth.register('new_account','abc12345');
 assert.equal(result.ok,false,'registration UI expects a usable session on success');
});
