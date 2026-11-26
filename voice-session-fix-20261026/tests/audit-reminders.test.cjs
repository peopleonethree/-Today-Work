const {test}=require('node:test');
const assert=require('node:assert/strict');
const {make}=require('./app-env.cjs');
async function seeded(t){
 const first=await make(t),now=Date.now();
 first.w.AppStorage.write('todos:'+first.user,[{id:'extra-test',text:'分两次提醒',done:false,dueAt:now+3600000,
  reminded:[],extraTimes:[now+7200000],remindedExtra:[],createdAt:now,updatedAt:now}]);
 const e=await make(t,{store:first.backing});return {...e,now};
}
test('audit: clearing reminder time also cancels hidden extra reminder times',async t=>{
 const e=await seeded(t);
 e.w.document.querySelector('#todo-list .timefield__clear').click();
 const saved=e.w.AppStorage.read('todos:'+e.user,[])[0];
 assert.equal(saved.dueAt,null);
 assert.deepEqual(Array.from(saved.extraTimes),[],'clear reminder must not leave invisible alarms');
});
test('audit: native resume suppresses extra reminders already delivered in background',async t=>{
 const e=await seeded(t);
 e.w.TodoNative.backgroundReady=()=>true;
 e.w.Date.now=()=>e.now+7201000;
 e.w.__onNativeResume();
 assert.equal(e.$('reminder-layer').children.length,0,'native resume must not ring again for an extra alarm');
});
test('audit: failed clear rolls back both main and extra reminder times',async t=>{
 const e=await seeded(t),before=e.w.AppStorage.read('todos:'+e.user,[])[0];
 const write=e.w.AppStorage.write;e.w.AppStorage.write=(key,value)=>key.startsWith('todos:')?false:write(key,value);
 e.w.document.querySelector('#todo-list .timefield__clear').click();
 const saved=e.w.AppStorage.read('todos:'+e.user,[])[0];
 assert.equal(saved.dueAt,before.dueAt);assert.deepEqual(Array.from(saved.extraTimes),Array.from(before.extraTimes));
 e.w.AppStorage.write=write;e.w.Date.now=()=>e.now+7201000;e.w.__onNativeResume();
 assert.ok(e.$('reminder-layer').children.length>0,'without native background delivery, restored alarm still fires');
});
test('audit: app kept open across midnight refreshes its date when resumed',async t=>{
 const e=await make(t),RealDate=e.w.Date;
 const next=new RealDate(2026,9,27,8).getTime();
 e.w.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[next]));} static now(){return next;}};
 e.$('today-date').textContent='10月26日 星期一';e.w.__onNativeResume();
 assert.equal(e.$('today-date').textContent,'10月27日 星期二');
});
