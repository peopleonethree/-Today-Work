const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {make}=require('./app-env.cjs');

test('quota does not prevent deleting the session and logging out',async t=>{
 const e=await make(t);
 e.w.localStorage.setItem=()=>{throw new e.w.DOMException('full','QuotaExceededError');};
 e.w.AppAuth.logout();
 assert.equal(e.backing['today-todo:v1:session'],undefined);
});

test('quota at startup preserves access to existing local accounts and notes',async t=>{
 const e=await make(t),id=await e.memo('已保存的正文不能因空间已满而消失。');
 e.w.localStorage.setItem=()=>{throw new e.w.DOMException('full','QuotaExceededError');};
 e.w.eval(fs.readFileSync(path.join(__dirname,'../assets/js/storage.js'),'utf8'));
 assert.equal(e.w.AppStorage.available,true,'readable storage must not block app boot');
 assert.ok(e.w.AppAuth.currentUser());
 assert.ok(e.w.MemoService.get(e.user,id));
});

test('a shrinking overwrite remains allowed when a new probe key cannot fit',async t=>{
 const e=await make(t);e.w.AppStorage.write('existing','long previous value');
 const set=e.w.localStorage.setItem;
 e.w.localStorage.setItem=(key,value)=>{
  if(key==='today-todo:v1:__probe__')throw new e.w.DOMException('full','QuotaExceededError');
  return set(key,value);
 };
 assert.equal(e.w.AppStorage.write('existing','short'),true);
 assert.equal(e.w.AppStorage.read('existing'), 'short');
});

test('inaccessible storage still reports unavailable and fails without throwing',async t=>{
 const e=await make(t);Object.defineProperty(e.w,'localStorage',{configurable:true,get(){throw new e.w.DOMException('denied','SecurityError');}});
 e.w.eval(fs.readFileSync(path.join(__dirname,'../assets/js/storage.js'),'utf8'));
 assert.equal(e.w.AppStorage.available,false);
 assert.equal(e.w.AppStorage.read('existing','fallback'),'fallback');
 assert.equal(e.w.AppStorage.write('existing','value'),false);
 assert.doesNotThrow(()=>e.w.AppStorage.remove('existing'));
});

test('registration session failure keeps the created account usable for a later login',async t=>{
 const e=await make(t);e.w.AppAuth.logout();const set=e.w.localStorage.setItem;
 e.w.localStorage.setItem=(key,value)=>{
  if(key==='today-todo:v1:session')throw new e.w.DOMException('full','QuotaExceededError');
  return set(key,value);
 };
 const result=await e.w.AppAuth.register('recover_account','abc12345');
 assert.equal(result.ok,false);
 assert.match(result.error,/账号已创建.*登录/);
 assert.equal(e.w.AppAuth.currentUser(),null);
 assert.equal(e.w.AppAuth.userExists('recover_account'),true);
 e.w.localStorage.setItem=set;
 assert.equal((await e.w.AppAuth.login('recover_account','abc12345')).ok,true);
 assert.equal(e.w.AppAuth.currentUser().key,'recover_account');
});
