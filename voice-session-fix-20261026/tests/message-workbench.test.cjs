const {test} = require('node:test');
const assert = require('node:assert/strict');
const {make,sleep} = require('./app-env.cjs');

test('desktop handoff keeps the draft and job ID until the computer acknowledges it', async t => {
  const requests = [];
  const env = await make(t, {androidHost: {
    enqueueDesktopMessage(_, body) {
      requests.push(JSON.parse(body));
      return requests.length === 1 ? 0 : 201;
    },
  }});
  env.$('open-message-workbench').click();
  env.$('message-recipient').value = '文件传输助手';
  env.$('message-text').value = 'USB 接单测试';
  env.w.Date.now = () => new Date(2026, 10, 26, 14, 30).getTime();
  env.$('message-when').value = '2026-11-26T14:35';
  env.$('message-desktop-code').value = 'a'.repeat(32);
  env.$('message-desktop').click();
  assert.equal(env.$('message-text').value, 'USB 接单测试');
  env.$('message-desktop').click();
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(env.$('message-text').value, '');
  assert.match(env.$('message-status').textContent, /电脑已接单/);
});

test('recording handoff retains the same WAV across reload and cannot send text in its place', async t => {
  const prepared = await make(t);
  prepared.$('open-message-workbench').click();
  const draftOwner = prepared.w.AppAuth.currentUser().key;
  const audio = 'data:audio/wav;base64,UklGRg==';
  assert.equal(prepared.w.AppStorage.write('message-recording-draft:v1:' + draftOwner, audio), true);
  let received;
  const env = await make(t, {store:prepared.backing, androidHost:{
    enqueueDesktopMessage(_, payload) { received = JSON.parse(payload); return 201; },
  }});
  env.$('open-message-workbench').click();
  env.$('message-desktop-self').click();
  env.$('message-desktop-code').value = 'a'.repeat(32);
  env.$('message-text').value = 'WAV test';
  env.w.Date.now = () => new Date(2026, 10, 26, 14, 30).getTime();
  env.$('message-when').value = '2026-11-26T14:35';
  assert.equal(env.$('message-desktop-audio-state').textContent, 'WAV 录音已就绪');
  env.$('message-desktop-audio').click();
  assert.equal(received.plan.audio, audio);
  assert.match(env.$('message-status').textContent, /包含 WAV/);
  received = null;
  env.$('message-when').value = '2026-11-26T14:35';
  env.$('message-text').value = 'text must not leak through audio mode';
  env.$('message-desktop-audio').click();
  assert.equal(received, null);
  assert.match(env.$('message-status').textContent, /请先完成录音/);
});

test('native recording remains available when closing and reopening the workbench', async t => {
  const wav = 'data:audio/wav;base64,UklGRg==';
  let starts = 0, stops = 0;
  const env = await make(t, {androidHost:{
    startMessageVoice() { starts++; return true; },
    stopMessageVoice() { stops++; return wav; },
    enqueueDesktopMessage() { return 201; },
  }});
  env.$('open-message-workbench').click();
  env.$('message-record').click();
  assert.equal(env.$('message-record').textContent, '停止录音');
  env.$('close-message-workbench').click();
  env.$('open-message-workbench').click();
  assert.equal(starts, 1);
  assert.equal(stops, 1);
  assert.equal(env.$('message-audio').getAttribute('src'), wav);
  assert.equal(env.$('message-desktop-audio-state').textContent, 'WAV 录音已就绪');
});

test('a message uses the todo reminder, preserves its content, and shares only on an explicit click after due', async t => {
  const e = await make(t);
  const shares = [];
  e.w.AndroidHost = {openMessageShare: (...args) => {shares.push(args); return true;}};
  e.$('open-message-workbench').click();
  e.$('message-platform').value = 'qq';
  e.$('message-recipient').value = '测试自用会话';
  e.$('message-text').value = '山东菏泽见。';
  e.w.Date.now = () => new Date(2026,10,25,9,0).getTime();
  e.$('message-when').value = '2026-11-25T09:15';
  e.$('message-schedule').click();
  const records = Object.values(e.backing).flatMap(value => {
    try { const x = JSON.parse(value); return Array.isArray(x) ? x : []; } catch { return []; }
  });
  const todo = records.find(row => row.messagePlan?.recipient === '测试自用会话');
  assert.equal(todo.dueAt, new Date(2026,10,25,9,15).getTime());
  assert.equal(todo.text, '消息发送提醒 · QQ');
  assert.equal(todo.messagePlan.text,'山东菏泽见。');
  assert.equal(e.$('message-queue').querySelector('button').disabled,true);
  e.w.Date.now = () => todo.dueAt + 1;
  e.$('open-message-workbench').click();
  assert.equal(shares.length,0);
  e.$('message-queue').querySelector('button').click();
  assert.deepEqual(shares,[['qq','山东菏泽见。','']]);
});

test('a recorded voice draft survives scheduling and hands the WAV to the chosen app after confirmation', async t => {
  const e = await make(t);
  const shares = [];
  let released = false;
  e.w.AndroidHost = {openMessageShare: (...args) => {shares.push(args); return true;}};
  Object.defineProperty(e.w.navigator,'mediaDevices',{value:{getUserMedia:async () => ({
    getTracks:() => [{stop:() => {released=true;}}]
  })}});
  e.w.MediaRecorder = class {
    static isTypeSupported(mimeType) {return mimeType === 'audio/mp4';}
    constructor(stream, options) { this.mimeType = options.mimeType; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.ondataavailable({data:new e.w.Blob(['fixture'])});
      this.onstop();
    }
  };
  e.w.OfflineAudioContext = class {
    async decodeAudioData() {
      return {length:320,numberOfChannels:1,getChannelData:() => new Float32Array(320)};
    }
  };
  e.$('open-message-workbench').click();
  e.$('message-recipient').value = '测试备注';
  e.$('message-record').click();
  await sleep(20);
  e.$('message-record').click();
  await sleep(70);
  assert.equal(released,true);
  const audio = e.$('message-audio').getAttribute('src');
  assert.match(audio,/^data:audio\/wav;base64,UklGR/);
  const due = new Date(2026,10,25,9,15).getTime();
  e.w.Date.now = () => due - 60000;
  e.$('message-when').value = '2026-11-25T09:15';
  e.$('message-schedule').click();
  assert.equal(e.$('message-queue').querySelector('button').disabled,true);
  e.w.Date.now = () => due + 1;
  e.$('open-message-workbench').click();
  assert.equal(shares.length,0);
  e.$('message-queue').querySelector('button').click();
  assert.deepEqual(shares,[['wechat','',audio]]);
});

test('local vocabulary searches pronunciation and inserts approved examples into the draft', async t => {
  const e = await make(t);
  e.$('open-message-workbench').click();
  e.$('word-kind').value = '时间';
  e.$('word-standard').value = '22:22';
  e.$('word-spoken').value = '两两两两';
  e.$('word-example').value = '22:22 在西安和李娜开会';
  e.$('word-save').click();
  e.$('word-search').value = '两两';
  e.$('word-search').dispatchEvent(new e.w.Event('input'));
  const list = e.$('word-list');
  assert.match(list.textContent,/两两两两/);
  Array.from(list.querySelectorAll('button')).find(b=>b.textContent==='填入例句').click();
  assert.equal(e.$('message-text').value,'22:22 在西安和李娜开会');
  assert.ok(Object.keys(e.backing).some(key=>key.includes('message-vocabulary:v1:')));
});

function importFile(e, id, content, name) {
  const input = e.$(id);
  Object.defineProperty(input,'files',{configurable:true,value:[new e.w.File([content],name)]});
  input.dispatchEvent(new e.w.Event('change'));
}

test('text-file names merge with pasted names and improve todo transcription', async t => {
  const e = await make(t);
  e.$('open-message-workbench').click();
  e.$('word-names-text').value = '李娜、李娜，王芳';
  e.$('word-import-names').click();
  importFile(e,'word-names-file','\ufeff李娜\r\n欧阳明宇\r\n4001234567','names.txt');
  await sleep(90);
  const names = e.w.MessageWorkbench.names(e.w.AppStorage,e.user).split('、');
  assert.deepEqual(names,['李娜','王芳','欧阳明宇']);
  e.$('close-message-workbench').click();
  e.w.document.querySelector('[data-vt="dict"]').click();
  e.$('voice-btn').click();
  e.done(e.segment(1),'给里纳发消息。跟欧阳明雨交接材料。');
  e.stopped();
  e.$('voice-to-todo').click();
  assert.equal(e.$('new-todo').value,'给李娜发消息。跟欧阳明宇交接材料。');
});

test('local contacts and actual imported call records coexist with launch-only history', async t => {
  const e = await make(t);
  const when = new Date(2026,10,25,18,30).getTime();
  let snapshot = JSON.stringify({
    contacts:[{name:'李娜',channel:'QQ'},{name:'电话联系人',channel:'手机',numbers:['13700000001']}],
    calls:[{name:'李娜',channel:'QQ',when,result:'已打开客户端',origin:'launch'}]
  });
  e.w.AndroidHost = {readVocabularyDirectory: () => snapshot};
  e.$('open-message-workbench').click();
  e.$('word-sync-directory').click();
  e.$('word-list').querySelector('button').click();
  assert.equal(e.$('message-platform').value,'qq');
  assert.equal(e.$('message-recipient').value,'李娜');
  const rows = '2026-11-25 18:30\t李娜\tQQ\t已接通';
  importFile(e,'word-calls-file',rows + '\n' + rows + '\n2026-02-30 21:02\t李娜\t微信\t已接通','calls.tsv');
  await sleep(90);
  assert.match(e.$('word-status').textContent,/新增 1 条.*1 条重复和 1 行无效/);
  e.$('word-filter').value = '通话记录';
  e.$('word-filter').dispatchEvent(new e.w.Event('change'));
  assert.equal(e.$('word-list').querySelectorAll('li').length,2);
  assert.match(e.$('word-list').textContent,/通话入口.*已打开客户端/);
  assert.match(e.$('word-list').textContent,/导入通话记录.*已接通/);
  snapshot = '';
  e.$('word-sync-directory').click();
  assert.equal(e.$('word-list').querySelectorAll('li').length,2);
  assert.match(e.$('word-status').textContent,/同步失败/);

  const restored = await make(t,{store:e.backing});
  restored.$('open-message-workbench').click();
  assert.match(restored.$('word-list').textContent,/13700000001/);
  assert.match(restored.$('word-list').textContent,/已接通/);
});
