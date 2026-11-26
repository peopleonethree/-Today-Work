(function (global) {
  'use strict';
  var AUDIO_LIMIT = 512 * 1024;
  var kinds = ['人名', '地名', '数字', '时间', '句子'];
  var channels = ['手机', 'QQ', '微信'];
  var WORD_LIMIT = 2500;

  function field(value, limit) {
    return typeof value === 'string' ? value.trim().slice(0, limit) : '';
  }

  function cleanPlan(raw) {
    if (!raw || ['wechat', 'qq'].indexOf(raw.platform) < 0) return null;
    var text = field(raw.text, 4000);
    var audio = field(raw.audio, Math.ceil(AUDIO_LIMIT * 4 / 3) + 100);
    if (audio && (audio !== raw.audio ||
        !/^data:audio\/(?:mp4|m4a|webm|ogg|wav|x-wav|mpeg|aac)(?:;codecs=[\w.+-]+)?;base64,[A-Za-z0-9+/]+={0,2}$/i.test(audio))) return null;
    var recipient = field(raw.recipient, 60);
    if (!recipient || (!text && !audio)) return null;
    return {platform: raw.platform, recipient: recipient, text: text, audio: audio};
  }

  function wordsKey(owner) { return 'message-vocabulary:v1:' + owner; }

  function readWords(store, owner) {
    var stored = store.read(wordsKey(owner), []);
    return Array.isArray(stored) ? stored.filter(function(w) {
      return w && typeof w.id === 'string' && kinds.indexOf(w.kind) >= 0 && typeof w.standard === 'string';
    }).slice(0,WORD_LIMIT) : [];
  }

  function parseCalls(text) {
    var calls = [], rejected = 0;
    text.replace(/^\uFEFF/, '').split(/\r?\n/).forEach(function(line) {
      if (!line.trim()) return;
      var cols = line.split('\t').map(function(value) { return value.trim(); });
      if (cols.join('\t') === '时间\t联系人\t平台\t结果') return;
      var date = cols[0].replace(' ', 'T');
      var when = new global.Date(date);
      function pad(part) { return String(part).padStart(2, '0'); }
      var localTime = when.getFullYear() + '-' + pad(when.getMonth() + 1) + '-' + pad(when.getDate()) +
        'T' + pad(when.getHours()) + ':' + pad(when.getMinutes());
      if (cols.length !== 4 || date !== localTime || !Number.isFinite(when.getTime()) ||
          !cols[1] || cols[1].length > 60 || channels.indexOf(cols[2]) < 0 || !cols[3] || cols[3].length > 60) {
        rejected++;
        return;
      }
      calls.push({when:when.getTime(),name:cols[1],channel:cols[2],result:cols[3],origin:'import'});
    });
    return {calls:calls, rejected:rejected};
  }

  function bind(api) {
    var doc = global.document;
    function $(id) { return doc.getElementById(id); }
    var dialog = $('message-workbench');
    if (!dialog || dialog.dataset.bound) return;
    dialog.dataset.bound = 'true';
    var owner = '', audio = '', capture = null, requesting = false, words = [], timer = null;
    var directory = {contacts:[], launches:[], imported:[]}, resultLimit = 100;
    var draftText = $('message-text');
    var draftRecipient = $('message-recipient');
    var player = $('message-audio');

    function status(text) { $('message-status').textContent = text || ''; }
    function wordStatus(text) { $('word-status').textContent = text || ''; }
    function showAudio() {
      if (audio) player.src = audio;
      else player.removeAttribute('src');
      player.hidden = !audio;
      $('message-drop-audio').hidden = !audio;
      $('message-desktop-audio-state').textContent = audio ? 'WAV 录音已就绪' : '尚无录音';
    }
    function updateAudio(value) {
      audio = value;
      var saved = api.store.write('message-recording-draft:v1:' + owner, audio);
      showAudio();
      return saved;
    }
    function wordKey() { return wordsKey(owner); }
    function directoryKey() { return 'message-directory:v1:' + owner; }
    function account() {
      var key = api.userKey();
      if (!key) return false;
      if (owner !== key) {
        owner = key;
        var savedAudio = api.store.read('message-recording-draft:v1:' + owner, '');
        audio = cleanPlan({platform:'wechat', recipient:'draft', audio:savedAudio})?.audio || '';
        draftText.value = '';
        draftRecipient.value = '';
        $('message-when').value = '';
        ['word-standard', 'word-spoken', 'word-example', 'word-search', 'word-names-text'].forEach(function(id) { $(id).value = ''; });
        $('word-filter').value = 'all';
        resultLimit = 100;
        wordStatus('');
        words = readWords(api.store, owner);
        var saved = api.store.read(directoryKey(), {});
        directory = {
          contacts: Array.isArray(saved.contacts) ? saved.contacts : [],
          launches: Array.isArray(saved.launches) ? saved.launches : [],
          imported: Array.isArray(saved.imported) ? saved.imported : []
        };
        showAudio();
      }
      return true;
    }
    function button(label, action) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', action);
      return b;
    }
    function description(parent, value) {
      var p = doc.createElement('p');
      p.textContent = value;
      parent.appendChild(p);
    }
    function platform(plan) { return plan.platform === 'qq' ? 'QQ' : '微信'; }

    function share(plan) {
      if (!plan) { status('请输入好友备注和文字，或先录一段语音。'); return; }
      var host = global.AndroidHost;
      if (!host || typeof host.openMessageShare !== 'function') {
        status('当前版本没有手机客户端分享入口。');
        return;
      }
      try {
        if (!host.openMessageShare(plan.platform, plan.text, plan.audio)) {
          status('无法准备分享，请检查内容大小。');
          return;
        }
        status('请在' + platform(plan) + '确认好友「' + plan.recipient + '」并发送。');
      } catch (error) { status('无法打开分享，请检查客户端是否可用。'); }
    }

    function renderQueue() {
      var list = $('message-queue');
      list.textContent = '';
      var now = global.Date.now();
      var active = api.todos().filter(function(todo) { return !todo.done && todo.messagePlan; })
        .slice().sort(function(a,b){return (a.dueAt || 0) - (b.dueAt || 0);});
      active.forEach(function(todo) {
        var entry = doc.createElement('li'), plan = todo.messagePlan;
        description(entry, platform(plan) + ' · ' + plan.recipient + ' · ' +
          (todo.dueAt ? new global.Date(todo.dueAt).toLocaleString('zh-CN') : '未设时间'));
        description(entry, plan.audio ? '录音文件' : plan.text);
        var send = button('核对后打开分享', function(){
          if (account() && api.todos().indexOf(todo) >= 0 && !todo.done &&
              (!todo.dueAt || todo.dueAt <= global.Date.now())) share(plan);
        });
        send.disabled = !!todo.dueAt && todo.dueAt > global.Date.now();
        entry.appendChild(send);
        entry.appendChild(button('结束提醒', function() {
          if (account() && api.todos().indexOf(todo) >= 0) {
            api.finish(todo);
            renderQueue();
          }
        }));
        list.appendChild(entry);
      });
      if (active.length === 0) description(list, '暂无待发送提醒');
      global.clearTimeout(timer);
      if (dialog.open) {
        var next = active.find(function(todo){return todo.dueAt && todo.dueAt > now;});
        if (next) timer = global.setTimeout(renderQueue, Math.min(60000, next.dueAt - now));
      }
    }

    function renderWords() {
      var list = $('word-list');
      list.textContent = '';
      var query = $('word-search').value.trim().toLowerCase();
      var scope = $('word-filter').value;
      var matching = 0;
      function include(values) {
        if (values.join(' ').toLowerCase().indexOf(query) < 0) return false;
        return matching++ < resultLimit;
      }
      words.forEach(function(w) {
        if (scope !== 'all' && scope !== (w.kind === '人名' ? '人名' : '词句')) return;
        if (!include([w.kind,w.standard,w.spoken,w.example])) return;
        var wordOwner = owner;
        var item = doc.createElement('li');
        description(item, w.kind + ' · ' + w.standard);
        if (w.spoken) description(item, '我的读法：' + w.spoken);
        if (w.example) description(item, '例句：' + w.example);
        function insert(value) {
          if (api.userKey() !== wordOwner) { open(); return; }
          draftText.value = (draftText.value ? draftText.value + '\n' : '') + value;
          draftText.value = draftText.value.slice(0,4000);
          wordStatus('已填入消息草稿。');
        }
        item.appendChild(button('填入写法', function(){insert(w.standard);}));
        if (w.example) item.appendChild(button('填入例句', function(){insert(w.example);}));
        item.appendChild(button('删除词条', function() {
          if (api.userKey() !== wordOwner || !global.confirm('删除这条本地词汇？')) return;
          var next = words.filter(function(item){return item.id !== w.id;});
          if (api.store.write(wordKey(), next)) { words = next; renderWords(); wordStatus('已删除词条。'); }
          else wordStatus('保存失败，词条仍保留。');
        }));
        list.appendChild(item);
      });
      if (scope === 'all' || scope === '联系人') directory.contacts.forEach(function(entry) {
        var numbers = Array.isArray(entry.numbers) ? entry.numbers.join('、') : '';
        if (!include(['联系人',entry.name,entry.channel,numbers])) return;
        var item = doc.createElement('li');
        description(item, '联系人 · ' + entry.channel + ' · ' + entry.name);
        if (numbers) description(item, numbers);
        if (entry.channel !== '手机') item.appendChild(button('选为消息好友', function() {
          if (!account()) return;
          $('message-platform').value = entry.channel === 'QQ' ? 'qq' : 'wechat';
          draftRecipient.value = entry.name;
          selectPage(false);
          status('已填入好友备注，发送时请在客户端核对。');
        }));
        list.appendChild(item);
      });
      if (scope === 'all' || scope === '通话记录') directory.imported.concat(directory.launches)
        .sort(function(a,b) {return b.when-a.when;}).forEach(function(entry) {
          var time = new global.Date(entry.when).toLocaleString('zh-CN');
          var kind = entry.origin === 'launch' ? '通话入口' : '导入通话记录';
          if (!include([kind,time,entry.name,entry.channel,entry.number,entry.result])) return;
          var item = doc.createElement('li');
          description(item, kind + ' · ' + entry.name + ' · ' + entry.channel);
          description(item, time + ' · ' + entry.result + (entry.number ? ' · ' + entry.number : ''));
          var callOwner = owner;
          if (entry.origin === 'import') item.appendChild(button('删除导入记录', function() {
            if (api.userKey() !== callOwner || !global.confirm('删除这条已导入的通话记录？')) return;
            var next = {contacts:directory.contacts, launches:directory.launches,
              imported:directory.imported.filter(function(call) {return call !== entry;})};
            if (!api.store.write(directoryKey(),next)) {wordStatus('删除失败，记录仍保留。');return;}
            directory = next;
            renderWords();
            wordStatus('已删除导入记录。');
          }));
          list.appendChild(item);
        });
      if (!matching) description(list, '没有匹配的本地记录。');
      $('word-more-results').hidden = matching <= resultLimit;
    }

    function syncDirectory() {
      if (!account()) return;
      var host = global.AndroidHost;
      try {
        var snapshot = JSON.parse(host.readVocabularyDirectory());
        if (!Array.isArray(snapshot.contacts) || !Array.isArray(snapshot.calls)) throw new Error();
        var next = {contacts:snapshot.contacts, launches:snapshot.calls, imported:directory.imported};
        if (!api.store.write(directoryKey(), next)) throw new Error();
        directory = next;
        renderWords();
        wordStatus('已同步 ' + next.contacts.length + ' 位联系人和 ' + next.launches.length + ' 条通话入口记录。');
      } catch (error) { wordStatus('同步失败，原词库保留。请先在手机客户端管理联系人。'); }
    }

    function newWord(kind, standard, spoken, example) {
      return {id:global.Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,11),
        kind:kind, standard:standard, spoken:spoken || '', example:example || ''};
    }

    function importNames(text) {
      var names = api.normalizeNames(text).split('、').filter(Boolean);
      var existing = new Set(words.filter(function(w) {return w.kind === '人名';})
        .map(function(w) {return w.standard;}));
      var additions = names.filter(function(name) {return !existing.has(name);});
      if (!names.length) {wordStatus('未找到可导入的姓名。请输入 2 至 4 个汉字的姓名。');return;}
      var next = words.concat(additions.map(function(name) {return newWord('人名',name);}));
      if (next.length > WORD_LIMIT) {wordStatus('词库容量不足，本次未导入。');return;}
      if (!api.store.write(wordKey(),next)) {wordStatus('导入失败，原词库保留。');return;}
      words = next;
      $('word-names-text').value = '';
      renderWords();
      wordStatus('已导入 ' + additions.length + ' 个人名，略过 ' + (names.length-additions.length) + ' 个已保存人名。');
    }

    function importCalls(text) {
      var parsed = parseCalls(text);
      function key(call) {return JSON.stringify([call.when,call.name,call.channel,call.result]);}
      var merged = new Map(directory.imported.map(function(call) {return [key(call),call];}));
      parsed.calls.forEach(function(call) {merged.set(key(call),call);});
      var added = merged.size-directory.imported.length;
      if (merged.size > 2000) {wordStatus('最多保存 2000 条外部通话记录，本次未导入。');return;}
      if (!parsed.calls.length) {wordStatus('未找到有效通话记录，请核对日期和 Tab 分隔格式。');return;}
      var next = {contacts:directory.contacts, launches:directory.launches, imported:Array.from(merged.values())};
      if (!api.store.write(directoryKey(),next)) {wordStatus('保存失败，原记录保留。');return;}
      directory = next;
      renderWords();
      wordStatus('新增 ' + added + ' 条通话记录，略过 ' + (parsed.calls.length-added) + ' 条重复和 ' + parsed.rejected + ' 行无效记录。');
    }

    function bindImport(id, receive) {
      $(id).addEventListener('change', function(event) {
        var file = event.target.files[0];
        event.target.value = '';
        if (!file || !account()) return;
        if (file.size > 262144) {wordStatus('文件过大，请拆成 256 KB 以内的文本。');return;}
        var accountAtRead = owner, reader = new global.FileReader();
        reader.onerror = function() {if (api.userKey() === accountAtRead) wordStatus('读取文本失败。');};
        reader.onload = function() {
          if (api.userKey() !== accountAtRead) return;
          var text = String(reader.result);
          if (text.indexOf('\ufffd') >= 0) {wordStatus('文本编码有误，请保存为 UTF-8。');return;}
          receive(text);
        };
        reader.readAsText(file, 'UTF-8');
      });
    }

    function selectPage(library) {
      $('word-library').hidden = !library;
      $('message-pane').hidden = library;
      $('workbench-library-tab').setAttribute('aria-pressed', String(library));
      $('workbench-messages-tab').setAttribute('aria-pressed', String(!library));
      dialog.scrollTop = 0;
    }

    function open() {
      if (!account()) return;
      if (!dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
      if (!dialog.open) dialog.setAttribute('open','');
      selectPage(false);
      renderQueue();
      renderWords();
    }
    function close() {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      else dialog.removeAttribute('open');
      global.clearTimeout(timer);
    }
    function draft() {
      return cleanPlan({platform:$('message-platform').value,recipient:draftRecipient.value,
        text:draftText.value,audio:audio});
    }

    function endCapture() {
      if (!capture) return;
      if (capture.finish) capture.finish();
      else if (capture.rec.state === 'recording') capture.rec.stop();
    }
    function recordNative(host) {
      var started = false;
      try { started = host.startMessageVoice(); } catch (error) {}
      if (!started) {status('无法开启系统录音，请检查麦克风权限。'); return;}
      var recordingOwner = owner, readyToShare = false;
      var timeout = global.setTimeout(endCapture, 15000);
      capture = {
        share: function(){readyToShare=true;endCapture();},
        finish: function(){
          global.clearTimeout(timeout);
          capture = null;
          var result = '';
          try { result = host.stopMessageVoice(); } catch (error) {}
          $('message-record').textContent = '录制语音';
          $('message-record-share').hidden = true;
          if (api.userKey() !== recordingOwner || owner !== recordingOwner) return;
          if (!/^data:audio\/wav;base64,/i.test(result)) {status('没有录到声音，请重试。'); return;}
          var saved = updateAudio(result);
          status(saved ? '录音已就绪，可以试听或排队发送。' : '录音已就绪，请在关闭应用前提交。');
          if (readyToShare && dialog.open) share(draft());
        },
      };
      $('message-record').textContent = '停止录音';
      $('message-record-share').hidden = false;
      status('正在录音，最长 15 秒。');
    }
    function record() {
      if (capture) { endCapture(); return; }
      if (requesting || !account()) return;
      var media = global.navigator.mediaDevices;
      if (!api.canRecord()) { status('麦克风已在使用，请先结束其他录音。'); return; }
      var host = global.AndroidHost;
      if (typeof host?.startMessageVoice === 'function' && typeof host.stopMessageVoice === 'function') {
        recordNative(host); return;
      }
      if (!media || !media.getUserMedia || !global.MediaRecorder) {status('当前环境不支持录音。'); return;}
      var recordingOwner = owner;
      requesting = true;
      media.getUserMedia({audio:true}).then(function(stream) {
        requesting = false;
        if (!dialog.open || api.userKey() !== recordingOwner) {
          stream.getTracks().forEach(function(track){track.stop();});
          return;
        }
        var rec;
        try {
          var types = ['audio/mp4','audio/webm','audio/ogg'];
          var mime = types.find(function(type){return global.MediaRecorder.isTypeSupported(type);});
          rec = mime ? new global.MediaRecorder(stream,{mimeType:mime}) : new global.MediaRecorder(stream);
        } catch(error) {
          stream.getTracks().forEach(function(track){track.stop();});
          status('录音格式不可用。');
          return;
        }
        var chunks = [], size = 0, limit = false, timeout, shareAfter = false;
        function release() {
          global.clearTimeout(timeout);
          stream.getTracks().forEach(function(track){track.stop();});
          capture = null;
          $('message-record').textContent = '录制语音';
          $('message-record-share').hidden = true;
        }
        rec.ondataavailable = function(e) {
          size += e.data.size;
          if (size > AUDIO_LIMIT) { limit = true; endCapture(); }
          else if (e.data.size) chunks.push(e.data);
        };
        rec.onerror = function() { release(); status('录音失败，请重试。'); };
        rec.onstop = function() {
          release();
          if (api.userKey() !== recordingOwner) return;
          if (limit || !size) { status(limit ? '录音超过 512 KB，请缩短后重试。' : '没有录到声音。'); return; }
          var reader = new global.FileReader();
          requesting = true;
          reader.onerror = function(){requesting=false;status('读取录音失败。');};
          reader.onload = function() {
            Promise.resolve().then(function(){return api.encodeRecording(reader.result);}).then(function(result){
              if (api.userKey() !== recordingOwner) return;
              if (!/^data:audio\/wav;base64,/i.test(result)) throw new Error('录音转换结果不是 WAV');
              var saved = updateAudio(result);
              status(saved ? '录音已就绪，可以试听或排队发送。' : '录音已就绪，请在关闭应用前提交。');
              if (shareAfter && dialog.open) share(draft());
            }).catch(function(){status('无法转换这段录音，请重新录制。');})
              .then(function(){requesting=false;});
          };
          reader.readAsArrayBuffer(new global.Blob(chunks,{type:rec.mimeType || mime || 'audio/webm'}));
        };
        capture = {rec:rec, share:function(){shareAfter=true;endCapture();}};
        try { rec.start(200); }
        catch(error) { release(); status('无法开始录音。'); return; }
        $('message-record').textContent = '停止录音';
        $('message-record-share').hidden = false;
        status('正在录音，最长 15 秒。');
        timeout = global.setTimeout(endCapture, 15000);
      }).catch(function(){ requesting = false; status('无法使用麦克风，请检查权限。'); });
    }

    $('open-message-workbench').addEventListener('click', open);
    $('workbench-messages-tab').addEventListener('click', function(){selectPage(false);});
    $('workbench-library-tab').addEventListener('click', function(){selectPage(true);});
    $('close-message-workbench').addEventListener('click', function(){ close(); endCapture(); });
    dialog.addEventListener('close', function(){global.clearTimeout(timer); endCapture();});
    $('voice-to-message').addEventListener('click', function() {
      var text = api.fromVoice();
      if (text && account()) { open(); draftText.value = text.slice(0,4000); status('已填入转写文字，请先核对。'); }
    });
    $('message-dictate').addEventListener('click', function() {
      if (capture || requesting) {status('请先结束当前录音。'); return;}
      close(); api.startDictation();
    });
    $('message-record').addEventListener('click', record);
    $('message-record-share').addEventListener('click', function() {
      if (!draftRecipient.value.trim()) {status('请先填写好友备注。');return;}
      if (capture) capture.share();
    });
    $('message-drop-audio').addEventListener('click', function(){if (account()) updateAudio('');});
    $('message-share').addEventListener('click', function(){if (account() && !capture && !requesting) share(draft());});
    var relayHost = global.AndroidHost;
    var relayId, relayPayload;
    var relayCode = $('message-desktop-code');
    if (typeof relayHost?.enqueueDesktopMessage === 'function') {
      $('message-desktop').hidden = false;
      $('message-desktop-audio').hidden = false;
      $('message-desktop-pairing').hidden = false;
    }
    $('message-desktop-self').addEventListener('click', function(){
      if (account()) draftRecipient.value = $('message-platform').value === 'qq' ? '我的手机' : '文件传输助手';
    });
    function enqueueDesktop(needsAudio) {
      if (!account() || capture || requesting) return;
      if (needsAudio && !audio) { status('请先完成录音，看到 WAV 录音已就绪后再排队。'); return; }
      var plan = draft(), dueAt = new global.Date($('message-when').value).getTime();
      if (!plan || !Number.isFinite(dueAt) || dueAt <= global.Date.now()) {
        status('请选择未来时间并填写文字，或先录一段语音。'); return;
      }
      if (!/^[0-9a-f]{32}$/i.test(relayCode.value.trim())) {
        status('请输入电脑显示的 32 位配对码。'); return;
      }
      var payload = JSON.stringify({plan:plan, dueAt:dueAt});
      if (payload !== relayPayload) {
        relayPayload = payload;
        relayId = Array.from(global.crypto.getRandomValues(new Uint8Array(16)), function(n) {
          return n.toString(16).padStart(2,'0');
        }).join('');
      }
      var result;
      try {
        result = relayHost.enqueueDesktopMessage(relayCode.value.trim(), JSON.stringify({id:relayId, plan:plan, dueAt:dueAt}));
      } catch (e) { result = 0; }
      if (result === 201 || result === 200) {
        draftText.value = ''; updateAudio(''); $('message-when').value = '';
        status(plan.audio ? '电脑已接单，包含 WAV 录音。' : '电脑已接单，文字待发送。');
      } else if (result === 401) status('电脑配对码不匹配，草稿已保留。');
      else if (result >= 400 && result < 500) status('电脑未接受任务，请核对时间、收件人和附件。草稿已保留。');
      else status('未收到电脑回执，可用同一草稿重试。');
    }
    $('message-desktop').addEventListener('click', function(){enqueueDesktop(false);});
    $('message-desktop-audio').addEventListener('click', function(){enqueueDesktop(true);});
    $('message-schedule').addEventListener('click', function() {
      if (!account() || capture || requesting) return;
      var plan = draft(), due = new global.Date($('message-when').value).getTime();
      if (!plan) {status('请输入好友备注和文字，或先录一段语音。'); return;}
      if (!Number.isFinite(due) || due <= global.Date.now()) {status('请选择未来的提醒时间。'); return;}
      if (api.schedule(plan,due)) {
        draftText.value = ''; updateAudio(''); $('message-when').value = '';
        renderQueue(); status('已保存到点提醒。');
      } else status('保存失败，草稿已保留。请检查可用存储。');
    });
    function resetSearch() {resultLimit=100; renderWords();}
    $('word-search').addEventListener('input', resetSearch);
    $('word-filter').addEventListener('change', resetSearch);
    $('word-more-results').addEventListener('click', function() {resultLimit+=100; renderWords();});
    $('word-sync-directory').addEventListener('click', syncDirectory);
    $('word-open-contacts').addEventListener('click', function() {
      var host = global.AndroidHost;
      if (host && typeof host.openContactDirectory === 'function') host.openContactDirectory();
      else wordStatus('当前环境没有手机联系人入口。');
    });
    $('word-import-names').addEventListener('click', function() {
      if (account()) importNames($('word-names-text').value);
    });
    bindImport('word-names-file', importNames);
    bindImport('word-calls-file', importCalls);
    $('word-save').addEventListener('click', function() {
      if (!account()) return;
      var standard = field($('word-standard').value,500);
      if (!standard) {wordStatus('请填写标准写法或句子。'); return;}
      if (words.length >= WORD_LIMIT) {wordStatus('词库已满，请先清理。'); return;}
      var next = words.concat([newWord($('word-kind').value,standard,
        field($('word-spoken').value,500),field($('word-example').value,500))]);
      if (api.store.write(wordKey(),next)) {
        words = next; renderWords();
        ['word-standard','word-spoken','word-example'].forEach(function(id){$(id).value='';});
        wordStatus('已保存到本地词汇库。');
      } else wordStatus('词条保存失败，输入已保留。');
    });
  }
  global.MessageWorkbench = {bind:bind,cleanPlan:cleanPlan,names:function(store,owner) {
    return readWords(store,owner).filter(function(w) {return w.kind === '人名';})
      .map(function(w) {return w.standard;}).join('、');
  }};
}(window));
