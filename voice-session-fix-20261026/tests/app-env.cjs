const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PREFS = 'today-todo:v1:prefs';

async function make(t, options = {}) {
  const backing = options.store || {};
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT,'assets/index.html'),'utf8'),
    {url:'https://test.invalid/',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(() => dom.window.close());
  const w = dom.window;
  if (options.viewport) {
    const viewport = new w.EventTarget();
    Object.assign(viewport, {height: w.innerHeight, offsetTop: 0});
    Object.defineProperty(w, 'visualViewport', {value: viewport});
  }
  if(options.database) {
    const db=options.database;
    w.AndroidHost={
      dbReady:()=>true,
      dbExec(sql,raw){try {const p=JSON.parse(raw);const result=db.prepare(sql).run(...p);
        return JSON.stringify({ok:true,changes:Number(result.changes),lastId:Number(result.lastInsertRowid)});
      }catch(e){return JSON.stringify({error:e.message});}},
      dbQuery(sql,raw){try {const stmt=db.prepare(sql);const rows=stmt.all(...JSON.parse(raw));
        const cols=stmt.columns().map(c=>c.name);
        return JSON.stringify({ok:true,cols,rows:rows.map(row=>cols.map(c=>row[c]))});
      }catch(e){return JSON.stringify({error:e.message});}}
    };
  }
  const native = {recording:false, requests:[], starts:0, cancels:0, stops:0, reject:false};
  const storage = {getItem:k=>backing[k]??null,setItem:(k,v)=>{backing[k]=String(v);},
    removeItem:k=>{delete backing[k];},clear:()=>{for(const k of Object.keys(backing))delete backing[k];}};
  Object.defineProperty(w,'localStorage',{value:storage,configurable:true});
  Object.defineProperty(w,'sessionStorage',{value:storage,configurable:true});
  w.matchMedia=q=>({matches:false,media:q,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  w.__DICT_LOCAL_TIMEOUT_MS__=options.timeout || 90000;
  w.__MEMO_DICT_STOP_TIMEOUT_MS__=options.stopTimeout || 6000;
  w.TodoNative={
    isNative:()=>true,whisperAvailable:()=>true,
    startVoiceListening:()=>true,stopVoiceListening:()=>true,cancelVoiceListening:()=>true,
    startDictation(){if(native.recording)return false; native.recording=true;native.starts++;return true;},
    stopDictation(){native.stops++;return true;},
    cancelDictation(){native.recording=false;native.cancels++;return true;},
    cleanupDictation:()=>true,
    transcribeSegmentLocal(rid,seq){if(native.reject)return false;native.requests.push({rid,seq});return true;}
  };
  if (options.androidHost) w.AndroidHost = options.androidHost;
  const run = file => w.eval(fs.readFileSync(path.join(ROOT,'assets',file),'utf8'));
  run('js/storage.js');run('js/auth.js');
  if(!w.AppAuth.currentUser()) {
    assert.equal((await w.AppAuth.register('voice_test','abc12345')).ok,true);
    assert.equal((await w.AppAuth.login('voice_test','abc12345')).ok,true);
  }
  if(!backing[PREFS])backing[PREFS]=JSON.stringify({guideSeen:true,voiceTodoMode:'realtime',voiceMemoMode:'dict',voiceEngine:'local'});
  const scripts = [...fs.readFileSync(path.join(ROOT,'assets/index.html'),'utf8').matchAll(/<script[^>]*src="([^"?]+)/g)]
    .map(m=>m[1]).filter(s=>!['js/storage.js','js/auth.js','js/native.js','js/app.js'].includes(s));
  for(const script of scripts)run(script);
  const appPath=process.env.APP_SOURCE_FILE || path.join(ROOT,'assets/js/app.js');
  w.eval(fs.readFileSync(appPath,'utf8'));
  await sleep(70);
  const $=id=>w.document.getElementById(id);
  if(!$('guide-layer').classList.contains('is-hidden'))$('guide-skip').click();
  const user=w.AppAuth.currentUser().key;
  async function memo(body='BASELINE-',title='VOICE TEST') {
    w.document.querySelector('[data-vm="dict"]').click();
    $('tab-memos').click();$('memo-new').click();
    $('memo-title-input').value=title;
    $('memo-title-input').dispatchEvent(new w.Event('input',{bubbles:true}));
    $('memo-body-input').value=body;
    $('memo-body-input').setSelectionRange(body.length,body.length);
    $('memo-body-input').dispatchEvent(new w.Event('input',{bubbles:true}));
    await sleep(480);
    return w.MemoService.list(user).find(m=>m.title===title).id;
  }
  function start(){ $('memo-voice').click(); assert.equal(native.recording,true,'offline recorder started'); }
  function segment(seq){w.DictationHost.segment(seq,2);return native.requests.find(r=>r.seq===seq);}
  function done(req,text){assert.ok(req,'a native transcription request exists');w.DictationNet.done(req.rid,200,JSON.stringify({text}));}
  function stopped(){native.recording=false;w.DictationHost.stopped();}
  return {w,$,backing,native,user,memo,start,segment,done,stopped};
}


module.exports = {make,sleep,PREFS};
