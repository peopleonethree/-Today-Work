/* ==========================================================================
   native.js — 手机版（Android 容器）与原生之间的适配层

   - 网页版不会加载这个文件；app.js 里对 TodoNative 的调用在没有它时安静跳过。
   - 这里只做「补齐手机端才有意义的能力」，不参与业务逻辑：
       · 把提醒计划交给原生闹钟（应用退到后台或被杀也能准时提醒）
       · 接收原生推来的主题 / 安全区 / 前后台切换
       · 补齐 WebView 里缺失的震动能力
       · 「测试提醒」这条一次性引导：新设备第一次安装时出现一次，
         测过（或用户主动收起来）就永久消失，不再占地方
   ========================================================================== */

(function (global) {
  'use strict';

  var doc = global.document;
  var host = global.AndroidHost || null;
  var ua = (global.navigator && global.navigator.userAgent) || '';
  var isNative = !!host || ua.indexOf('TodayTodoApp') !== -1;

  var state = {
    notificationsAllowed: false,
    exactAlarmsAllowed: true,
    insets: { top: 0, bottom: 0 },
    info: null,
    /* 测试引导的三种临时反馈：'' 正常 / 'done' 刚发送成功 / 'fail' 发不出去 */
    phase: '',
    /* 本次会话里被手动收起的状态（权限/设置类的问题只是这一会儿不想看） */
    hidden: {},
    /* 当前按钮动作的替换口（系统不再弹权限窗时改成「去设置」） */
    redirectAction: null
  };

  var HIDDEN_KEY = 'todo.nativebar.hidden';
  /* 「测试通知已发送」这条反馈停留多久后自己收起来 */
  var FEEDBACK_MS = 12000;

  var lastSyncedPayload = null;
  var lastBarKey = '';
  var feedbackTimer = 0;

  /* ------------------------------------------------------------ 调用原生 */

  function invoke(method) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (!isNative || !host || typeof host[method] !== 'function') return null;
    try {
      return host[method].apply(host, args);
    } catch (error) {
      return null;
    }
  }

  function canInvoke(method) {
    return isNative && !!host && typeof host[method] === 'function';
  }

  /* --------------------------------------------------- 暴露给 app.js 的接口 */

  global.TodoNative = {
    isNative: function () {
      return isNative;
    },

    /**
     * 把当前待办整表交给原生。只送「未完成 + 有提醒时间」的条目，
     * 原生据此重挂闹钟；内容没变就不重复调用，省掉没必要的系统调用。
     * extraTimes 是语音识别写入的额外提醒时间点，只有「到点」一档。
     */
    sync: function (todos) {
      if (!isNative) return;

      var payload = [];
      var list = todos || [];
      for (var i = 0; i < list.length; i++) {
        var todo = list[i];
        if (!todo || todo.done) continue;
        var hasDue = !!todo.dueAt;
        var extras = [];
        if (todo.extraTimes && todo.extraTimes.length) {
          for (var x = 0; x < todo.extraTimes.length; x++) {
            var at = Number(todo.extraTimes[x]);
            if (at > 0) extras.push(at);
          }
        }
        if (!hasDue && extras.length === 0) continue;
        payload.push({
          id: todo.id,
          text: todo.text,
          dueAt: hasDue ? todo.dueAt : 0,
          done: false,
          reminded: todo.reminded || [],
          extraTimes: extras
        });
      }

      var json;
      try {
        json = JSON.stringify(payload);
      } catch (error) {
        return;
      }
      if (json === lastSyncedPayload) return;
      lastSyncedPayload = json;

      invoke('syncReminders', json);
    },

    /** 后台提醒是否真的送得到（通知权限开着才算） */
    backgroundReady: function () {
      return isNative && state.notificationsAllowed;
    },

    /** 这条一次性测试引导是不是已经用完了 */
    tested: function () {
      return hasTested();
    },

    /** 立刻发一条通知，用于状态条上的「测试」 */
    notifyTest: function () {
      return testNotification();
    },

    /** 倒计时归零：用系统默认闹钟铃声响铃（跟着系统铃声设置走） */
    ring: function () {
      return invoke('playAlert') !== null;
    },

    stopRing: function () {
      invoke('stopAlert');
    },

    /** 从相册挑一张图当头像；结果通过 window.AvatarHost.picked(dataUrl) 回来 */
    pickAvatar: function () {
      if (!canInvoke('pickAvatar')) return false;
      invoke('pickAvatar');
      return true;
    },

    /**
     * 挑一个附件来源：'camera' 拍照 / 'gallery' 相册 / 'file' 文件。
     * 结果通过 window.AttachmentHost.picked({kind, name, dataUrl}) 回来。
     */
    pickAttachment: function (kind) {
      if (!canInvoke('pickAttachment')) return false;
      invoke('pickAttachment', kind || 'gallery');
      return true;
    },

    /* ------------------------------------------------ 文件扫描 */

    /** 起原生取景界面拍照，成品回 window.ScanHost.captured */
    startScan: function () {
      if (!canInvoke('startScan')) return false;
      invoke('startScan');
      return true;
    },

    /** 同一张原图换增强档（color / gray / bw），回 window.ScanHost.processed */
    processScan: function (rawPath, mode) {
      if (!canInvoke('processScan')) return false;
      invoke('processScan', String(rawPath || ''), String(mode || 'color'));
      return true;
    },

    /** 一次扫描结束，清掉原图与中间产物 */
    cleanupScan: function (rawPath) {
      if (!canInvoke('cleanupScan')) return false;
      invoke('cleanupScan', String(rawPath || ''));
      return true;
    },

    /** 对最近一次扫描成品做 OCR，结果异步走 window.ScanHost.ocrDone({ok,text,error}) */
    ocrScan: function () {
      if (!canInvoke('ocrScan')) return false;
      invoke('ocrScan');
      return true;
    },

    /** 系统自带铃声清单：[{ name, uri, type }]，没有原生能力时是空数组 */
    ringtones: function () {
      var raw = invoke('listRingtones');
      if (typeof raw !== 'string' || !raw) return [];
      try {
        var list = JSON.parse(raw);
        return Object.prototype.toString.call(list) === '[object Array]' ? list : [];
      } catch (error) {
        return [];
      }
    },

    /** 当前选的铃声地址；空串表示跟随系统默认 */
    ringtone: function () {
      var uri = invoke('getRingtone');
      return typeof uri === 'string' ? uri : '';
    },

    /** 当前铃声在系统里的名字（用于设置项副标题） */
    ringtoneName: function () {
      var name = invoke('getRingtoneName');
      return typeof name === 'string' ? name : '';
    },

    setRingtone: function (uri, name) {
      invoke('setRingtone', uri || '', name || '');
    },

    /** 试听 3 秒，用于铃声列表里点了立刻听到 */
    previewRingtone: function (uri) {
      invoke('previewRingtone', uri || '');
    },

    /** 这台手机有没有设锁屏密码/指纹（没有的话验证不了身份） */
    deviceAuthAvailable: function () {
      return invoke('deviceAuthAvailable') === true;
    },

    /** 弹系统验证（指纹 / 面容 / 锁屏 PIN），结果走 window.AuthHost.result(ok) */
    requestDeviceAuth: function (title, subtitle) {
      invoke('requestDeviceAuth', title || '', subtitle || '');
    },

    /** 这台机器有没有系统语音识别可用 */
    voiceAvailable: function () {
      return invoke('canRecognizeSpeech') === true;
    },

    /** 开始语音输入；识别结果走 window.VoiceHost.result(text) */
    startVoiceInput: function () {
      if (!canInvoke('startVoiceInput')) return false;
      return invoke('startVoiceInput') !== false;
    },

    /** 页面自绘浮层版：内嵌识别器，中间结果走 window.VoiceHost.partial(text) */
    startVoiceListening: function () {
      if (!canInvoke('startVoiceListening')) return false;
      return invoke('startVoiceListening') !== false;
    },

    /** 「结束录音」：停麦但等最终结果；页面那一屏的停止键用它 */
    stopVoiceListening: function () {
      if (!canInvoke('stopVoiceListening')) return false;
      invoke('stopVoiceListening');
      return true;
    },

    /** 停掉正在进行的语音输入，页面上的「取消」按钮用它 */
    cancelVoiceListening: function () {
      if (!canInvoke('cancelVoiceListening')) return false;
      invoke('cancelVoiceListening');
      return true;
    },

    /* ------------------------- 录音转写（大模型分段转写） ---------------- */

    /** 开录音：段经 window.DictationHost.segment(seq, seconds) 逐段送达 */
    startDictation: function () {
      if (!canInvoke('startDictation')) return false;
      return invoke('startDictation') !== false;
    },
    /** 「结束录音」：最后一段交出后 DictationHost.stopped() */
    stopDictation: function () {
      if (!canInvoke('stopDictation')) return false;
      invoke('stopDictation');
      return true;
    },
    /** 取消：整段作废 */
    cancelDictation: function () {
      if (!canInvoke('cancelDictation')) return false;
      invoke('cancelDictation');
      return true;
    },
    /** 按序号取段 WAV 的 base64（转写请求体用） */
    dictationSegmentBase64: function (seq) {
      if (!canInvoke('dictationSegmentBase64')) return '';
      return invoke('dictationSegmentBase64', seq | 0) || '';
    },
    /** 转写完成后清段文件 */
    cleanupDictation: function () {
      if (!canInvoke('cleanupDictation')) return false;
      invoke('cleanupDictation');
      return true;
    },
    /** 离线转写引擎（whisper.cpp）可用：模型随包 + 本地库就绪 */
    whisperAvailable: function () {
      return canInvoke('whisperAvailable') ? invoke('whisperAvailable') === true : false;
    },
    /** 附件录音提取文字：传 base64 WAV，结果走 window.AttStt */
    whisperTranscribeWav: function (reqId, base64Wav) {
      if (!canInvoke('whisperTranscribeWav')) return false;
      invoke('whisperTranscribeWav', String(reqId || ''), String(base64Wav || ''));
      return true;
    },
    /** 离线转写一段（后台线程）；结果同样走 window.DictationNet */
    transcribeSegmentLocal: function (rid, seq) {
      if (!canInvoke('transcribeSegmentLocal')) return false;
      invoke('transcribeSegmentLocal', String(rid || ''), seq | 0);
      return true;
    },

    /** 段 WAV 用 multipart 直传识别服务（二进制在 Java 侧，不过 WebView）；
        结果走 window.DictationNet.done(id, code, respJson) / .error(id, msg) */
    llmUploadAudio: function (reqId, url, headersJson, seq, formJson) {
      if (!canInvoke('llmUploadAudio')) return false;
      invoke('llmUploadAudio', String(reqId || ''), String(url || ''),
        String(headersJson || '{}'), seq | 0, String(formJson || '{}'));
      return true;
    },

    /**
     * 在线大模型抽时间：WebView 直连第三方接口会被 CORS 挡，交给原生发请求。
     * 结果异步走 window.LlmHost.result(reqId, content) / error(reqId, msg)。
     */
    llmParseTime: function (reqId, text, endpoint, model, key) {
      if (!canInvoke('llmParseTime')) return false;
      invoke('llmParseTime', String(reqId || ''), String(text || ''),
        String(endpoint || ''), String(model || ''), String(key || ''));
      return true;
    },

    /**
     * 通用 HTTP 代理：模型探测 / 任务请求 / 多模型对比共用。
     * 结果异步走 window.LlmNet.done(reqId, status, body) / error(reqId, msg)。
     */
    llmHttp: function (reqId, method, url, headers, body, timeoutMs) {
      if (!canInvoke('llmHttp')) return false;
      invoke('llmHttp', String(reqId || ''), String(method || 'POST'), String(url || ''),
        JSON.stringify(headers || {}), body ? JSON.stringify(body) : '',
        Number(timeoutMs) || 20000);
      return true;
    },

    /* ---------------------------------------------------------- 密钥仓库
       页面只递 ref，明文由原生用 Keystore 加密后落盘；读出来的是明文，
       但只在内存里停留到这次请求结束。 */

    vaultReady: function () {
      return !!invoke('vaultReady');
    },

    vaultPut: function (ref, secret) {
      if (!canInvoke('vaultPut')) return false;
      return !!invoke('vaultPut', String(ref || ''), String(secret || ''));
    },

    vaultGet: function (ref) {
      var value = invoke('vaultGet', String(ref || ''));
      return value == null ? '' : String(value);
    },

    vaultRemove: function (ref) {
      if (!canInvoke('vaultRemove')) return false;
      return !!invoke('vaultRemove', String(ref || ''));
    },

    /** 把用户选的界面色调同步给原生（状态栏 / 导航栏配色跟它走） */
    setThemeMode: function (mode) {
      invoke('setTheme', mode || '');
    },

    /** 应用是否已被系统「电池优化」豁免（不在省电黑名单里） */
    batteryIgnored: function () {
      return invoke('isIgnoringBatteryOptimizations') === true;
    },

    /** 打开「电池优化」授权页，让用户把本应用设为不优化 */
    openBatteryOptimization: function () {
      invoke('openBatteryOptimizationSettings');
    },

    /** 打开厂商的「自启动管理」页 */
    openAutoStart: function () {
      invoke('openAutoStartSettings');
    },

    /** 让点击立即生效的轻震动 */
    vibrate: function (ms) {
      invoke('vibrate', ms || 120);
    },

    info: function () {
      return state.info;
    }
  };

  /* ------------------------------------------------- 原生 → 页面的回调入口 */

  global.TodoNativeHost = {
    /** 原生推来的设备与权限概况 */
    receive: function (payload) {
      if (!payload || typeof payload !== 'object') return;
      state.info = payload;

      if (typeof payload.notificationsAllowed === 'boolean') {
        state.notificationsAllowed = payload.notificationsAllowed;
      }
      if (typeof payload.exactAlarmsAllowed === 'boolean') {
        state.exactAlarmsAllowed = payload.exactAlarmsAllowed;
      }
      if (typeof payload.dark === 'boolean') applyTheme(payload.dark ? 'dark' : 'light');
      if (typeof payload.fontScale === 'number') applyFontScale(payload.fontScale);

      if (host) {
        /* 设备信息挂到根节点上，方便排查问题，也方便将来做机型微调 */
        doc.documentElement.setAttribute('data-device',
          (payload.manufacturer || '') + ' ' + (payload.model || ''));
        doc.documentElement.setAttribute('data-android', String(payload.sdkInt || ''));
      }

      renderBar();
    },

    /** 原生的安全区内边距（dp）。原生已经用内边距避让过了，这里只做记录 */
    receiveInsets: function (topDp, bottomDp) {
      state.insets.top = Number(topDp) || 0;
      state.insets.bottom = Number(bottomDp) || 0;
      var root = doc.documentElement;
      root.style.setProperty('--inset-top', state.insets.top + 'px');
      root.style.setProperty('--inset-bottom', state.insets.bottom + 'px');
    },

    receiveTheme: function (theme) {
      applyTheme(theme === 'dark' ? 'dark' : 'light');
    },

    /** 从后台回到前台：让页面把错过的档位静默补账并校准倒计时 */
    receiveResume: function () {
      if (typeof global.__onNativeResume === 'function') global.__onNativeResume();
    },

    receiveNotificationPermission: function (granted) {
      state.notificationsAllowed = !!granted;
      renderBar();
      if (granted && lastSyncedPayload !== null) {
        /* 权限刚开，重挂一遍，保证后面的档位都能送达 */
        var again = lastSyncedPayload;
        lastSyncedPayload = null;
        invoke('syncReminders', again);
      }
    }
  };

  /* ------------------------------------------------------------ 主题与字号 */

  function applyTheme(theme) {
    /* 用户在设置里手选过主题，系统深浅色就不再接管 */
    if (global.__themeLocked) return;
    var root = doc.documentElement;
    if (root.getAttribute('data-theme') === theme) return;
    root.setAttribute('data-theme', theme);
    var meta = doc.getElementById('theme-color-meta');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#12141a' : '#f4f6fb');
  }

  /** 系统字号放大跟着走，但再放大一档就把控件挤变形了，这里只做提示性微调 */
  function applyFontScale(scale) {
    if (!scale || scale <= 1) return;
    doc.documentElement.setAttribute('data-font-scale', scale.toFixed(2));
  }

  /* -------------------------------------------------------- 后台提醒状态条

     四种形态，按优先级：
       off   通知被关掉        —— 必须处理，处理完就没了
       warn  精确闹钟没放行    —— 同上
       done  刚发完测试通知    —— 停一会儿自己收起来
       ok    一次性测试引导    —— 测过 / 收起后永久不再出现
     ========================================================================== */

  function renderBar() {
    var bar = doc.getElementById('native-bar');
    if (!bar) return;

    if (!isNative) {
      bar.hidden = true;
      return;
    }

    /* 原生还没把权限概况推过来之前先不显示，免得闪一条结论不准的红条 */
    if (!state.info && !state.phase) {
      bar.hidden = true;
      bar.textContent = '';
      return;
    }

    var view = barView();
    if (!view) {
      bar.hidden = true;
      bar.textContent = '';
      bar.removeAttribute('data-state');
      lastBarKey = '';
      state.redirectAction = null;
      return;
    }

    bar.hidden = false;
    bar.setAttribute('data-state', view.mode);

    /* 结构没变就别重建：点完按钮整行跳一下会让人以为点错了 */
    var key = view.mode + '|' + view.text;
    if (key === lastBarKey) return;
    lastBarKey = key;

    bar.textContent = '';

    var dot = doc.createElement('span');
    dot.className = 'nativebar__dot';

    var textEl = doc.createElement('span');
    textEl.className = 'nativebar__text';
    textEl.textContent = view.text;

    var acts = doc.createElement('span');
    acts.className = 'nativebar__acts';

    /* 动作放在一个可替换的壳里：系统不再弹权限窗时，同一个按钮要改成「去设置」 */
    var current = view.action;
    state.redirectAction = function (next) {
      current = next;
    };

    var button = doc.createElement('button');
    button.type = 'button';
    button.className = 'nativebar__act';
    if (view.primary) button.setAttribute('data-tone', 'primary');
    button.textContent = view.action.label;
    button.addEventListener('click', function () {
      current.run();
    });
    acts.appendChild(button);

    if (view.closable) {
      var close = doc.createElement('button');
      close.type = 'button';
      close.className = 'nativebar__close';
      close.setAttribute('aria-label', '不再显示这一行');
      close.textContent = '×';
      close.addEventListener('click', function () {
        hideBar(view.mode);
      });
      acts.appendChild(close);
    }

    bar.appendChild(dot);
    bar.appendChild(textEl);
    bar.appendChild(acts);
  }

  /** 当前该显示什么；返回 null 表示这一行不该出现 */
  function barView() {
    if (!state.notificationsAllowed) {
      if (state.hidden.off) return null;
      return {
        mode: 'off',
        text: '后台提醒未开启：通知被系统关掉时，退出应用就收不到提醒。',
        action: { label: '去开启', run: requestNotifications },
        primary: true,
        closable: true
      };
    }

    if (!state.exactAlarmsAllowed) {
      if (state.hidden.warn) return null;
      return {
        mode: 'warn',
        text: '提醒可能晚几分钟：系统还没允许本应用使用「闹钟和提醒」。',
        action: { label: '去设置', run: openExactAlarmSettings },
        primary: true,
        closable: true
      };
    }

    if (state.phase === 'fail') {
      if (state.hidden.fail) return null;
      return {
        mode: 'fail',
        text: '测试通知没发出去：系统把「今日待办」的通知拦住了。',
        action: { label: '去设置', run: openNotificationSettings },
        primary: true,
        closable: true
      };
    }

    if (state.phase === 'done') {
      return {
        mode: 'done',
        text: '测试通知已发送，下拉通知栏看看。看不到就说明系统在拦通知，可以去设置里放行。',
        action: { label: '知道了', run: finishTest },
        primary: false,
        closable: false
      };
    }

    /* 装完测过一次就收工，这一行不再出现；测试失败被用户收起来后也不再纠缠 */
    if (hasTested() || state.hidden.ok || state.hidden.fail) return null;

    return {
      mode: 'ok',
      text: '后台提醒已开启。点「测试」确认能收到通知，测过之后这一行就不再出现。',
      action: { label: '测试', run: testNotification },
      primary: true,
      closable: true
    };
  }

  /* ---------------------------------------------------------------- 引导标记 */

  function hasTested() {
    if (state.info && typeof state.info.reminderTested === 'boolean') {
      return state.info.reminderTested;
    }
    return invoke('reminderTested') === true;
  }

  function markTested() {
    if (state.info) state.info.reminderTested = true;
    invoke('markReminderTested');
  }

  function readHidden() {
    try {
      var raw = global.sessionStorage && global.sessionStorage.getItem(HIDDEN_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function writeHidden() {
    try {
      if (global.sessionStorage) {
        global.sessionStorage.setItem(HIDDEN_KEY, JSON.stringify(state.hidden));
      }
    } catch (error) {
      /* 写不进去就算了，最多下次打开又看到一次 */
    }
  }

  /** 收起这一行；只有「测试引导」才是彻底不再出现，其它只是这次不想看 */
  function hideBar(mode) {
    if (mode === 'ok') {
      markTested();
    } else if (mode !== 'done') {
      state.hidden[mode] = true;
      writeHidden();
    }
    state.phase = '';
    clearFeedbackTimer();
    renderBar();
  }

  /* ---------------------------------------------------------------- 三种动作 */

  function requestNotifications() {
    if (state.notificationsAllowed) {
      openNotificationSettings();
      return;
    }
    invoke('requestNotificationPermission');
    /* 系统弹窗的答案由原生回调 receiveNotificationPermission 带回来；
       已经拒绝过两次时系统不会再弹，这时直接把用户送到设置页 */
    global.setTimeout(function () {
      if (!state.notificationsAllowed) showManualHint();
    }, 1200);
  }

  function openNotificationSettings() {
    invoke('openNotificationSettings');
  }

  function openExactAlarmSettings() {
    invoke('openExactAlarmSettings');
  }

  /**
   * 「测试」：发一条系统通知，并把结果如实告诉用户。
   * 发得出去就记下「已测试」——这条引导的使命就完成了。
   */
  function testNotification() {
    if (!canInvoke('notifyNow')) {
      state.phase = 'fail';
      renderBar();
      return false;
    }

    var sent = invoke('notifyNow', '今日待办 · 提醒测试',
      '这条来自系统通知，说明退出应用后也能收到提醒。');

    if (sent === false) {
      /* 权限被系统拦住：原生已经弹了 toast，这里换成「去设置」的入口 */
      state.phase = 'fail';
      renderBar();
      return false;
    }

    markTested();
    state.phase = 'done';
    renderBar();

    clearFeedbackTimer();
    feedbackTimer = global.setTimeout(function () {
      state.phase = '';
      renderBar();
    }, FEEDBACK_MS);
    return true;
  }

  function finishTest() {
    state.phase = '';
    clearFeedbackTimer();
    renderBar();
  }

  function clearFeedbackTimer() {
    if (feedbackTimer) {
      global.clearTimeout(feedbackTimer);
      feedbackTimer = 0;
    }
  }

  function showManualHint() {
    if (state.notificationsAllowed) return;
    var bar = doc.getElementById('native-bar');
    if (!bar) return;
    var button = bar.querySelector('.nativebar__act');
    if (!button || button.textContent === '去设置') return;
    button.textContent = '去设置';
    if (typeof state.redirectAction === 'function') {
      state.redirectAction({ label: '去设置', run: openNotificationSettings });
    }
  }

  /* -------------------------------------------------------------- 小修补 */

  /* WebView 里 navigator.vibrate 不生效，接管过来交给原生震动 */
  if (isNative) {
    try {
      Object.defineProperty(global.navigator, 'vibrate', {
        configurable: true,
        writable: true,
        value: function (pattern) {
          var ms = 120;
          if (typeof pattern === 'number') ms = pattern;
          else if (pattern && pattern.length) ms = pattern[pattern.length - 1] || 120;
          invoke('vibrate', ms);
          return true;
        }
      });
    } catch (error) {
      /* 个别 WebView 不让改，忽略 */
    }
  }

  /* 前后台切换时同步一次：原生闹钟在后台负责提醒，回到前台要立刻校准 */
  doc.addEventListener('visibilitychange', function () {
    if (doc.hidden) return;
    if (typeof global.__onNativeResume === 'function') global.__onNativeResume();
    renderBar();
  });

  /* 按钮上的长按菜单没有意义，禁掉；正文仍然可以长按复制 */
  doc.addEventListener('contextmenu', function (event) {
    var target = event.target;
    if (target && typeof target.closest === 'function'
      && target.closest('button, .todo__check, .arc__box, .segbar__btn')) {
      event.preventDefault();
    }
  });

  /* 双指缩放已经在 viewport 里禁用了，这里再兜一层，防止某些 ROM 忽略 meta */
  doc.addEventListener('touchmove', function (event) {
    if (event.touches && event.touches.length > 1 && event.cancelable) {
      event.preventDefault();
    }
  }, { passive: false });

  /* ------------------------------------------------------------ 首次同步 */

  if (isNative) {
    state.hidden = readHidden();
    renderBar();
    /* 如果 app.js 已经跑完启动流程（本地壳里几乎不会走到），补一次同步；
       否则等 boot() 自己调 syncNative，避免拿空列表把已挂的闹钟清掉。 */
    if (doc.readyState !== 'loading') {
      if (typeof global.__onNativeResume === 'function') global.__onNativeResume();
    }
  }
})(window);
