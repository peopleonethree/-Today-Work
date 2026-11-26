const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {setup}=require('./rewrite-env.cjs');

test('native SQLite backend immediately replaces, archives and repeatedly expands the same memo',async t=>{
  const database=new DatabaseSync(':memory:');t.after(()=>database.close());
  const e=await setup(t,{database});
  assert.equal(e.w.SqlRepo.available(),true);
  e.expand();e.complete('在原生数据库路径里，立即保存的扩写正文。');
  e.$('memo-rw-adopt').click();
  assert.equal(e.$('memo-body-input').value,'在原生数据库路径里，立即保存的扩写正文。');
  const memo=e.w.MemoService.list(e.user)[0];
  assert.equal(memo.body,'在原生数据库路径里，立即保存的扩写正文。');
  const rec=e.w.DerivedStore.get(e.user,memo.id,'rewrite');
  assert.equal(rec.payload.original,'今天整理读书笔记，记录三个清晰的小目标。');
  assert.equal(rec.status,'adopted');
  e.expand();e.complete('同一篇原生数据库笔记可以第二次扩写。');
  assert.match(e.$('memo-stat').textContent,/第\s*2\s*次/);
});
test('native SQLite tag edits preserve other derived records and fail without losing existing tags',async t=>{
 const database=new DatabaseSync(':memory:');t.after(()=>database.close());
 const e=await setup(t,{database}),m=e.w.MemoService.list(e.user)[0],d=e.w.DerivedStore;
 d.put(e.user,m.id,'summary',{summary:'已保存的摘要'});d.put(e.user,m.id,'rewrite',{original:'已保存的原稿'});
 d.put(e.user,m.id,'tags',{tags:['读书']},{},'adopted');
 e.$('memo-close').click();e.w.document.querySelector('#memo-list [data-id] button').click();
 const put=e.w.SqlRepo.putDerived;e.w.SqlRepo.putDerived=()=>false;
 e.$('memo-tagsug').querySelector('.memo__tagchip--ok').click();
 assert.deepEqual(Array.from(d.get(e.user,m.id,'tags').payload.tags),['读书']);
 assert.match(e.$('memo-stat').textContent,/失败/);
 e.w.SqlRepo.putDerived=put;e.$('memo-tagsug').querySelector('.memo__tagchip--ok').click();
 assert.deepEqual(Array.from(d.get(e.user,m.id,'tags').payload.tags),[]);
 assert.ok(d.get(e.user,m.id,'summary'));assert.ok(d.get(e.user,m.id,'rewrite'));
});
