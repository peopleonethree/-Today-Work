const assert=require('node:assert/strict');
const {make}=require('./app-env.cjs');
async function setup(t, options={}) {
  const e=await make(t,options);await e.memo('今天整理读书笔记，记录三个清晰的小目标。');
  // Only the external model transport is simulated; real task validation and storage remain active.
  const prefs=e.w.AppStorage.read('prefs',{});
  prefs.llmModels=[{id:'test-model',name:'Test',endpoint:'https://example.invalid/v1/chat/completions',model:'demo',key:'test-key'}];
  e.w.AppStorage.write('prefs',prefs);
  // Reboot once so the app uses the persisted real model configuration.
  const next=await make(t,{...options,store:e.backing});
  next.$('tab-memos').click();next.w.document.querySelector('#memo-list [data-id] button').click();
  next.w.ConsentPolicy.setMode('online');
  const requests=[];
  next.w.AiTaskRegistry.setTransport((job,cb)=>requests.push({job,cb}));
  function expand(){next.$('memo-rewrite').click();next.$('memo-rw-expand').click();}
  function complete(text){assert.ok(requests.length,'model request exists');requests.shift().cb(null,{text:JSON.stringify({text}),realModel:'demo'});}
  return {...next,requests,expand,complete};
}


module.exports={setup};
