/* ==========================================================================
   voice-archive.js — 常用词与语音纠错档案库
   --------------------------------------------------------------------------
   把原来的「常用人名」（一个 textarea，只收 2–4 汉字）升成一份本机档案库：
   每条记录 正确写法 / 常见误识别 / 使用场景 / 个人口音差异 / 使用频率 / 备注，
   存档后可检索、可编辑、可删除；识别结果按档案做确定性纠错，用户手改过的
   地方再确认一次就回写档案，于是越用越准。

   为什么能这么挂
   --------------
   app.js 整体在 (function (global) { … })(window) 里，本补丁拼接在其后，
   拿不到闭包内的 toast / prefs / normalizeVoiceNames。但有三处公开接缝够用：
   · global.VoiceHost.result —— 三条识别来路（系统内嵌、网页版 SpeechRecognition、
     录音转写）最终都从这里进 App，包一层就能在文本进入页面之前纠错；
   · #voice-edit —— review 态的输入框，读它即「用户最终认可的文字」；
   · #voice-names —— 旧入口的文本框，只在用户点「导入」时才读，绝不回写。
   所以不碰 orig/、不碰 index.html、不碰 dex：设置页按钮、档案库弹层、
   review 小条、沉淀提示全部由本文件生成。

   边界（写在这里，免得以后误期待）
   --------------------------------
   1. 纠错是客户端后处理，不是给识别引擎加热词或语言模型偏置——系统的识别器
      不开放这个接口。完全不像的音仍需用户把「误识别」登记进档案。
   2. 全本机，不联网、不上传、不走大模型。
   3. 旧的 #voice-names 文本框与 normalizeVoiceNames 规则原样保留，档案库对它
      只做单向导入：外部补丁改写 prefs 会让 App 内存态与磁盘打架，不值得。
   ========================================================================== */
(function (global) {
  'use strict';

  var doc = global.document;
  var KEY = 'voiceArchive';
  var BTN_ID = 'open-voice-archive';
  var DLG_ID = 'va-dialog';
  var STYLE_ID = 'va-style';
  var BAR_ID = 'va-bar';
  var LEARN_ID = 'va-learn';

  /* 存储上限：localStorage 与待办共用约 5 MB，超限只拒绝写入、不清旧数据 */
  var MAX_ENTRIES = 500;
  var LIMITS = { correct: 40, wrongItem: 40, wrongCount: 8, scene: 30, accent: 60, note: 120 };
  /* 拼音匹配的窗口长度范围：单字误伤太大，太长（整句）容易乱配 */
  var MIN_FUZZY = 2;
  var MAX_FUZZY = 8;

  var KINDS = [
    { key: 'person', label: '人名' },
    { key: 'place', label: '地点' },
    { key: 'time', label: '时间' },
    { key: 'term', label: '专业名词' },
    { key: 'phrase', label: '短语句子' },
    { key: 'other', label: '其他' }
  ];
  var KIND_LABEL = {};
  for (var ki = 0; ki < KINDS.length; ki++) KIND_LABEL[KINDS[ki].key] = KINDS[ki].label;

  var CJK = /[\u3400-\u9fff]/;
  var CJK_ONLY = /^[\u3400-\u9fff]+$/;

  /* ======================================================================
     一、存储
     ====================================================================== */

  var memory = null;   /* 没有 AppStorage 时（单测、极端降级）退回内存 */

  function storageApi() {
    var s = global.AppStorage;
    return s && typeof s.read === 'function' && typeof s.write === 'function' ? s : null;
  }

  function emptyData() {
    return { v: 1, seeded: false, settings: { auto: true }, entries: [], updatedAt: 0 };
  }

  function str(value, cap) {
    var text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return cap ? text.slice(0, cap) : text;
  }

  function newId() {
    return 'va' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* 磁盘上的东西可能是旧版、半截或手改的，一律夹到已知形状，不认识的就丢 */
  function normalizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var correct = str(raw.correct, LIMITS.correct);
    if (!correct) return null;
    var wrong = [];
    var list = raw.wrong;
    if (list && typeof list.length === 'number') {
      for (var i = 0; i < list.length && wrong.length < LIMITS.wrongCount; i++) {
        var item = str(list[i], LIMITS.wrongItem);
        if (item && item !== correct && wrong.indexOf(item) < 0) wrong.push(item);
      }
    }
    var kind = KIND_LABEL[raw.kind] ? raw.kind : 'other';
    return {
      id: str(raw.id) || newId(),
      kind: kind,
      correct: correct,
      wrong: wrong,
      scene: str(raw.scene, LIMITS.scene),
      accent: str(raw.accent, LIMITS.accent),
      note: str(raw.note, LIMITS.note),
      enabled: raw.enabled !== false,
      hits: Math.max(0, Math.min(99999, Number(raw.hits) || 0)),
      lastHitAt: Number(raw.lastHitAt) || 0,
      source: raw.source === 'import' || raw.source === 'learn' ? raw.source : 'manual',
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now()
    };
  }

  function normalizeData(raw) {
    var out = emptyData();
    if (!raw || typeof raw !== 'object') return out;
    out.seeded = raw.seeded === true;
    out.settings.auto = !(raw.settings && raw.settings.auto === false);
    var list = raw.entries;
    if (list && typeof list.length === 'number') {
      for (var i = 0; i < list.length && out.entries.length < MAX_ENTRIES; i++) {
        var entry = normalizeEntry(list[i]);
        if (entry) out.entries.push(entry);
      }
    }
    out.updatedAt = Number(raw.updatedAt) || 0;
    return out;
  }

  function load() {
    var api = storageApi();
    var raw = api ? api.read(KEY, null) : memory;
    return normalizeData(raw);
  }

  function persist(data) {
    data.updatedAt = Date.now();
    var api = storageApi();
    if (!api) {
      memory = data;
      return true;
    }
    return api.write(KEY, data) === true;
  }

  var saveTimer = 0;
  var saveData = null;
  function saveSoon(data) {
    saveData = data;
    if (saveTimer) global.clearTimeout(saveTimer);
    saveTimer = global.setTimeout(function () {
      saveTimer = 0;
      persist(saveData);
      saveData = null;
    }, 400);
  }

  /* 防抖期间页面被切后台 / 关掉，不能把最后 400ms 的改动弄丢 */
  function flushPendingSave() {
    if (!saveTimer) return;
    global.clearTimeout(saveTimer);
    saveTimer = 0;
    if (saveData) persist(saveData);
    saveData = null;
  }

  function byId(data, id) {
    for (var i = 0; i < data.entries.length; i++) {
      if (data.entries[i].id === id) return data.entries[i];
    }
    return null;
  }

  /* ======================================================================
     二、纠错引擎（纯函数，不碰 DOM，单测直接调）
     ====================================================================== */

  function pinyinTable() {
    var table = global.TodoNamePinyin;
    return table && typeof table === 'object' ? table : null;
  }

  /* 整串汉字 → 无声调音节数组；有一个字没拼音就整条不参与（避免半截瞎配） */
  function syllables(text) {
    var table = pinyinTable();
    if (!table) return null;
    var chars = Array.from(String(text));
    var out = [];
    for (var i = 0; i < chars.length; i++) {
      var syl = table[chars[i]];
      if (!syl) return null;
      out.push(syl);
    }
    return out;
  }

  /* 口音归并：只在条目带 accent 时启用。zh/z、ch/c、sh/s、n/l、f/h、r/l，
     以及 ang/an、eng/en、ing/in、iang/ian、uang/uan 这几组是中文识别最常见的混淆。 */
  function looseSyllable(syl) {
    var text = String(syl || '');
    var ini = '';
    var fin = text;
    var m = /^(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])/.exec(text);
    if (m) {
      ini = m[1];
      fin = text.slice(ini.length);
    }
    if (ini === 'zh') ini = 'z';
    else if (ini === 'ch') ini = 'c';
    else if (ini === 'sh') ini = 's';
    else if (ini === 'n') ini = 'l';
    else if (ini === 'f') ini = 'h';
    else if (ini === 'r') ini = 'l';
    fin = fin.replace(/iang$/, 'ian').replace(/uang$/, 'uan')
             .replace(/ang$/, 'an').replace(/eng$/, 'en').replace(/ing$/, 'in');
    return ini + fin;
  }

  function looseKey(key) {
    return key.split('/').map(looseSyllable).join('/');
  }

  /* 索引：按音节串查条目；顺便记下「哪些写法是某条档案的正确答案」，
     这样两条档案互相打架时不会把 A 的正确写法改成 B 的。 */
  function buildIndex(entries) {
    var idx = { lens: [], exact: Object.create(null), fuzzy: Object.create(null), corrects: Object.create(null) };
    var seenLen = Object.create(null);
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || !e.enabled) continue;
      idx.corrects[e.correct] = true;
      var sig = syllables(e.correct);
      if (!sig || sig.length < MIN_FUZZY || sig.length > MAX_FUZZY) continue;
      var key = sig.join('/');
      if (!idx.exact[key]) idx.exact[key] = [];
      idx.exact[key].push(e);
      if (e.accent) {
        var fkey = looseKey(key);
        if (!idx.fuzzy[fkey]) idx.fuzzy[fkey] = [];
        idx.fuzzy[fkey].push(e);
      }
      if (!seenLen[sig.length]) {
        seenLen[sig.length] = true;
        idx.lens.push(sig.length);
      }
    }
    idx.lens.sort(function (a, b) { return b - a; });   /* 长条目优先 */
    return idx;
  }

  function pick(idx, list, window) {
    if (!list) return null;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.correct === window) continue;          /* 已经是正确答案，不重复计数 */
      if (idx.corrects[window]) continue;           /* 是别的档案的正确答案，放过 */
      return e;
    }
    return null;
  }

  function wrongPairs(entries) {
    var pairs = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || !e.enabled) continue;
      for (var j = 0; j < e.wrong.length; j++) {
        var from = String(e.wrong[j] || '');
        if (from.length < 2 || from === e.correct) continue;   /* 单字替换误伤太大 */
        pairs.push({ from: from, to: e.correct, entry: e });
      }
    }
    pairs.sort(function (a, b) { return b.from.length - a.from.length; });
    return pairs;
  }

  function pinyinPass(text, idx, note) {
    if (!idx.lens.length || !pinyinTable()) return text;
    var table = pinyinTable();
    var chars = Array.from(text);
    var sigs = [];
    for (var i = 0; i < chars.length; i++) sigs.push(table[chars[i]] || null);
    var out = [];
    var pos = 0;
    while (pos < chars.length) {
      var done = false;
      for (var li = 0; li < idx.lens.length; li++) {
        var len = idx.lens[li];
        if (pos + len > chars.length) continue;
        var key = '';
        var ok = true;
        for (var k = pos; k < pos + len; k++) {
          if (!sigs[k]) { ok = false; break; }
          key += (k > pos ? '/' : '') + sigs[k];
        }
        if (!ok) continue;
        var window = chars.slice(pos, pos + len).join('');
        var entry = pick(idx, idx.exact[key], window);
        if (!entry) entry = pick(idx, idx.fuzzy[looseKey(key)], window);
        if (!entry) continue;
        out.push(entry.correct);
        note(entry, window, entry.correct);
        pos += len;
        done = true;
        break;
      }
      if (!done) {
        out.push(chars[pos]);
        pos++;
      }
    }
    return out.join('');
  }

  /**
   * 对一段识别文字做纠错。
   * @param {string} text 识别原文
   * @param {Array} entries 档案条目（默认取已存的全部）
   * @param {Object} [options] { auto:false } 表示总开关关着，原样返回
   * @returns {{text:string, applied:Array, off:boolean}}
   *          applied 里每项 {id, correct, from, to}，用于撤销与计数
   */
  function correct(text, entries, options) {
    var input = String(text == null ? '' : text);
    var applied = [];
    var result = { text: input, applied: applied, off: false };
    /* 显式传入 auto 用传入值；没传（公开 API 直调）就按持久化的开关来 */
    var auto = options && typeof options.auto !== 'undefined'
      ? options.auto !== false
      : load().settings.auto !== false;
    if (!auto) {
      result.off = true;
      return result;
    }
    var list = entries || load().entries;
    var hitIds = Object.create(null);
    function note(entry, from, to) {
      if (hitIds[entry.id]) return;
      hitIds[entry.id] = true;
      applied.push({ id: entry.id, correct: entry.correct, from: from, to: to });
    }

    var out = input;
    var pairs = wrongPairs(list);
    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i];
      if (out.indexOf(pair.from) < 0) continue;
      out = out.split(pair.from).join(pair.to);
      note(pair.entry, pair.from, pair.to);
    }
    out = pinyinPass(out, buildIndex(list), note);
    result.text = out;
    return result;
  }

  /** 把这次命中的条目计数 +1（识别路径调用；纯函数 correct() 不动数据） */
  function countHits(applied) {
    if (!applied || !applied.length) return;
    var data = load();
    var changed = false;
    for (var i = 0; i < applied.length; i++) {
      var entry = byId(data, applied[i].id);
      if (!entry) continue;
      entry.hits = Math.min(99999, entry.hits + 1);
      entry.lastHitAt = Date.now();
      changed = true;
    }
    if (changed) saveSoon(data);
  }

  function uncountHits(applied) {
    if (!applied || !applied.length) return;
    var data = load();
    var changed = false;
    for (var i = 0; i < applied.length; i++) {
      var entry = byId(data, applied[i].id);
      if (!entry || entry.hits <= 0) continue;
      entry.hits -= 1;
      changed = true;
    }
    if (changed) saveSoon(data);
  }

  /* ======================================================================
     三、纠正沉淀：只认「单点替换」
     ====================================================================== */

  /** 公共前后缀裁剪，得到一个替换区间；两侧都要非空，且至少一侧含汉字 */
  function diffPair(before, after) {
    var A = Array.from(String(before == null ? '' : before));
    var B = Array.from(String(after == null ? '' : after));
    if (A.join('') === B.join('')) return null;
    var max = Math.min(A.length, B.length);
    var p = 0;
    while (p < max && A[p] === B[p]) p++;
    var s = 0;
    while (s < max - p && A[A.length - 1 - s] === B[B.length - 1 - s]) s++;
    var from = A.slice(p, A.length - s).join('').trim();
    var to = B.slice(p, B.length - s).join('').trim();
    if (!from || !to || from === to) return null;
    /* 只差一个字时（「张山」→「张珊」的公共前缀是「张」）把窗口向左带一个字：
       档案里 1 个字的条目既不参与拼音匹配、也不做精确替换，等于白记。 */
    if ((from.length < 2 || to.length < 2) && p > 0) {
      from = A[p - 1] + from;
      to = B[p - 1] + to;
    }
    if (from.length > 12 || to.length > 12) return null;   /* 大段重写不学 */
    if (!CJK.test(from) && !CJK.test(to)) return null;
    return { from: from, to: to };
  }

  function guessKind(text) {
    return CJK_ONLY.test(text) && text.length >= 2 && text.length <= 4 ? 'person' : 'phrase';
  }

  /** 把一次人工纠正写进档案：同答案就补误识别，没有就新建 */
  function learn(pair) {
    if (!pair || !pair.to) return null;
    var data = load();
    var target = null;
    for (var i = 0; i < data.entries.length; i++) {
      if (data.entries[i].correct === pair.to) { target = data.entries[i]; break; }
    }
    if (target) {
      if (pair.from !== target.correct && target.wrong.indexOf(pair.from) < 0
          && target.wrong.length < LIMITS.wrongCount) {
        target.wrong.push(pair.from);
      }
      target.enabled = true;
      target.updatedAt = Date.now();
    } else {
      if (data.entries.length >= MAX_ENTRIES) return null;
      target = {
        id: newId(),
        kind: guessKind(pair.to),
        correct: pair.to,
        wrong: [pair.from],
        scene: '',
        accent: '',
        note: '来自语音纠正',
        enabled: true,
        hits: 0,
        lastHitAt: 0,
        source: 'learn',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      data.entries.push(target);
    }
    persist(data);
    renderList();
    syncCount();
    return target;
  }

  /* ======================================================================
     四、批量导入解析
     ====================================================================== */

  /* 一行一条：`正确写法 | 误识别1、误识别2`，竖线可省。
     行首序号必须先剥再切分隔符——粘贴导入那边踩过：`3、张丙、张丁` 先按顿号
     切会切出孤立的「3」，序号正则匹配不到它。 */
  function splitBulk(text) {
    var lines = String(text == null ? '' : text).split(/\r?\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/^\s*\d+\s*[.、)．]\s*/, '').trim();
      if (!line) continue;
      var parts = line.split(/[|｜]/);
      var correct = str(parts[0], LIMITS.correct);
      if (!correct || /^\d+$/.test(correct)) continue;
      var wrong = [];
      if (parts.length > 1) {
        var rest = parts.slice(1).join('|').split(/[、，,；;]/);
        for (var j = 0; j < rest.length; j++) {
          var item = str(rest[j], LIMITS.wrongItem);
          if (item && item !== correct && wrong.indexOf(item) < 0) wrong.push(item);
        }
      }
      out.push({ correct: correct, wrong: wrong, kind: guessKind(correct), source: 'import' });
    }
    return out;
  }

  /* 合并导入：同 correct 的跳过（不覆盖用户已改过的误识别） */
  function mergeEntries(items) {
    var data = load();
    var added = 0;
    var skipped = 0;
    var exists = Object.create(null);
    for (var i = 0; i < data.entries.length; i++) exists[data.entries[i].correct] = true;
    for (var j = 0; j < items.length; j++) {
      var item = items[j];
      if (!item || !item.correct) continue;
      if (exists[item.correct]) { skipped++; continue; }
      if (data.entries.length >= MAX_ENTRIES) break;
      data.entries.push({
        id: newId(),
        kind: KIND_LABEL[item.kind] ? item.kind : guessKind(item.correct),
        correct: item.correct,
        wrong: (item.wrong || []).slice(0, LIMITS.wrongCount),
        scene: '',
        accent: '',
        note: '',
        enabled: true,
        hits: 0,
        lastHitAt: 0,
        source: item.source === 'import' ? 'import' : 'manual',
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      exists[item.correct] = true;
      added++;
    }
    persist(data);
    return { added: added, skipped: skipped };
  }

  /* 导出：一行一条，和批量粘贴同一个格式，便于换机或备份 */
  function exportText() {
    var data = load();
    var lines = [];
    for (var i = 0; i < data.entries.length; i++) {
      var e = data.entries[i];
      var bits = [e.correct];
      if (e.wrong.length) bits.push(e.wrong.join('、'));
      if (e.scene) bits.push('场景：' + e.scene);
      if (e.accent) bits.push('口音：' + e.accent);
      if (e.note) bits.push('备注：' + e.note);
      lines.push(bits.join(' | '));
    }
    return lines.join('\n');
  }

  /* ======================================================================
     五、界面
     ====================================================================== */

  var CSS = [
    '#' + DLG_ID + '{width:min(94vw,40rem);max-height:88vh;overflow:auto;padding:16px;',
    '  display:flex;flex-direction:column;',
    '  max-height:min(88vh, calc(100dvh - 16px));',
    '  border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);color:var(--text);}',
    '#' + DLG_ID + '::backdrop{background:rgba(20,26,44,.5);}',
    '#' + DLG_ID + ' h2{margin:0;font-size:16px;}',
    '#' + DLG_ID + ' header{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:0 0 8px;flex:none;}',
    '#' + DLG_ID + ' button{min-height:38px;padding:0 12px;border:1px solid var(--line);',
    '  border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font:inherit;font-size:13px;}',
    '#' + DLG_ID + ' button[data-primary]{background:var(--primary);border-color:var(--primary);color:#fff;}',
    '#' + DLG_ID + ' input,#' + DLG_ID + ' select,#' + DLG_ID + ' textarea{width:100%;padding:8px 10px;',
    '  border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--bg);color:var(--text);',
    '  font:inherit;font-size:13px;}',
    '#' + DLG_ID + ' textarea{min-height:3.4em;resize:vertical;}',
    '#' + DLG_ID + ' .va-hint{margin:0 0 10px;color:var(--text-2);font-size:12px;line-height:1.6;}',
    '#' + DLG_ID + ' .va-tools{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;}',
    '#' + DLG_ID + ' .va-tools input{flex:2 1 12rem;}',
    '#' + DLG_ID + ' .va-tools select{flex:1 1 7rem;}',
    '#' + DLG_ID + ' .va-meta{margin:0 0 8px;color:var(--text-2);font-size:12px;}',
    '#' + DLG_ID + ' .va-list{display:flex;flex-direction:column;gap:8px;max-height:38vh;overflow:auto;',
    '  min-height:0;flex:0 1 auto;}',
    /* 表单/批量面板展开时压缩列表，保证整弹层始终装得进视口（真机小屏实测过的问题） */
    '#' + DLG_ID + '.is-editing .va-list{max-height:20vh;}',
    '#' + DLG_ID + ' .va-item{border:1px solid var(--line);border-radius:var(--radius-sm);padding:8px 10px;',
    '  display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;}',
    '#' + DLG_ID + ' .va-item.is-off{opacity:.55;}',
    '#' + DLG_ID + ' .va-main{flex:1 1 12rem;min-width:0;}',
    '#' + DLG_ID + ' .va-word{font-size:14px;font-weight:600;word-break:break-all;}',
    '#' + DLG_ID + ' .va-sub{color:var(--text-2);font-size:12px;line-height:1.55;word-break:break-all;margin-top:2px;}',
    '#' + DLG_ID + ' .va-tag{display:inline-block;padding:0 6px;margin-right:6px;border-radius:99px;',
    '  background:var(--bg);border:1px solid var(--line);color:var(--text-2);font-size:11px;}',
    '#' + DLG_ID + ' .va-item button{padding:0 8px;min-height:32px;font-size:12px;}',
    '#' + DLG_ID + ' .va-item button[data-danger]{color:#c0392b;border-color:rgba(192,57,43,.5);}',
    '#' + DLG_ID + ' .va-empty{color:var(--text-2);font-size:13px;padding:14px 0;text-align:center;}',
    '#' + DLG_ID + ' .va-form{border:1px dashed var(--line);border-radius:var(--radius-sm);padding:10px;margin:10px 0 0;',
    '  max-height:54vh;min-height:0;overflow:auto;flex:0 1 auto;}',
    '#' + DLG_ID + ' .va-form.is-hidden,#' + DLG_ID + ' .va-bulk.is-hidden{display:none;}',
    '#' + DLG_ID + ' .va-field{margin-bottom:8px;}',
    '#' + DLG_ID + ' .va-field label{display:block;font-size:12px;color:var(--text-2);margin-bottom:4px;}',
    '#' + DLG_ID + ' .va-kinds{display:flex;gap:6px;flex-wrap:wrap;}',
    '#' + DLG_ID + ' .va-kinds button.is-active{background:var(--primary);border-color:var(--primary);color:#fff;}',
    '#' + DLG_ID + ' .va-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;}',
    '#' + DLG_ID + ' .va-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}',
    '#' + DLG_ID + ' .va-bulk{border:1px solid var(--line);border-radius:var(--radius-sm);padding:10px;margin-top:10px;',
    '  max-height:48vh;min-height:0;overflow:auto;flex:0 1 auto;}',
    '#' + DLG_ID + ' .va-try-out{margin:6px 0 0;white-space:pre-wrap;word-break:break-all;font-size:13px;',
    '  color:var(--text);background:var(--bg);border-radius:var(--radius-sm);padding:8px;min-height:1.6em;}',
    '#' + BTN_ID + '{margin-left:4px;}',
    /* review 态那条「已按档案纠正」小条 */
    '#' + BAR_ID + '{display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap;',
    '  margin:6px 0 0;font-size:12px;color:var(--text-2);}',
    '#' + BAR_ID + '.is-hidden{display:none;}',
    '#' + BAR_ID + ' button{min-height:28px;padding:0 10px;font-size:12px;border:1px solid var(--line);',
    '  border-radius:99px;background:transparent;color:var(--text);}',
    /* 发送后的「记住这次纠正」浮卡 */
    '#' + LEARN_ID + '{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom, 0px) + 18px);',
    '  transform:translateX(-50%);z-index:60;width:min(92vw,26rem);padding:10px 12px;',
    '  border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);',
    '  color:var(--text);box-shadow:0 10px 30px rgba(0,0,0,.22);}',
    '#' + LEARN_ID + '.is-hidden{display:none;}',
    '#' + LEARN_ID + ' p{margin:0 0 8px;font-size:13px;line-height:1.55;word-break:break-all;}',
    '#' + LEARN_ID + ' b{color:var(--primary);}',
    '#' + LEARN_ID + ' .va-learn-row{display:flex;gap:8px;}',
    '#' + LEARN_ID + ' button{flex:1;min-height:36px;border:1px solid var(--line);border-radius:var(--radius-sm);',
    '  background:var(--surface);color:var(--text);font:inherit;font-size:13px;}',
    '#' + LEARN_ID + ' button[data-keep]{background:var(--primary);border-color:var(--primary);color:#fff;}'
  ].join('\n');

  function $(id) {
    return doc ? doc.getElementById(id) : null;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* 复用页面自带的 #toast，样式与 App 内部提示一致 */
  function tip(message) {
    var el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('is-show');
    if (tip.timer) global.clearTimeout(tip.timer);
    tip.timer = global.setTimeout(function () {
      el.classList.remove('is-show');
    }, 2600);
  }

  var state = { kind: 'person', editingId: '' };

  function kindLabel(kind) {
    return KIND_LABEL[kind] || '其他';
  }

  function syncCount() {
    var btn = $(BTN_ID);
    if (!btn) return;
    var n = load().entries.length;
    btn.textContent = n ? '常用词档案（' + n + '）' : '常用词档案';
  }

  function renderList() {
    var list = $(DLG_ID + '-list');
    var meta = $(DLG_ID + '-meta');
    if (!list) return;
    var data = load();
    var q = str(($(DLG_ID + '-search') || {}).value).toLowerCase();
    var kindSel = ($(DLG_ID + '-kind') || {}).value || 'all';
    var sort = ($(DLG_ID + '-sort') || {}).value || 'hits';
    var rows = data.entries.filter(function (e) {
      if (kindSel !== 'all' && e.kind !== kindSel) return false;
      if (!q) return true;
      var hay = [e.correct, e.wrong.join(' '), e.scene, e.accent, e.note].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    rows.sort(function (a, b) {
      if (sort === 'recent') return (b.lastHitAt || b.updatedAt) - (a.lastHitAt || a.updatedAt);
      if (sort === 'new') return b.createdAt - a.createdAt;
      return b.hits - a.hits;
    });
    var total = data.entries.length;
    if (meta) {
      var hits = 0;
      for (var i = 0; i < data.entries.length; i++) hits += data.entries[i].hits;
      meta.textContent = '共 ' + total + ' 条 · 累计命中 ' + hits + ' 次'
        + (rows.length !== total ? '（筛选出 ' + rows.length + ' 条）' : '');
    }
    if (!rows.length) {
      list.innerHTML = '<p class="va-empty">' + (total ? '没有匹配的条目' : '还没有条目，点下面「新建一条」或用「从常用人名导入」') + '</p>';
      return;
    }
    list.innerHTML = rows.map(function (e) {
      var sub = [];
      if (e.wrong.length) sub.push('误识别：' + e.wrong.join('、'));
      if (e.scene) sub.push('场景：' + e.scene);
      if (e.accent) sub.push('口音：' + e.accent);
      if (e.note) sub.push('备注：' + e.note);
      return [
        '<div class="va-item' + (e.enabled ? '' : ' is-off') + '" data-id="' + esc(e.id) + '">',
        '  <div class="va-main">',
        '    <div class="va-word">' + esc(e.correct) + '</div>',
        '    <div class="va-sub"><span class="va-tag">' + esc(kindLabel(e.kind)) + '</span>',
        '      <span class="va-tag">命中 ' + e.hits + '</span>' + esc(sub.join('　')) + '</div>',
        '  </div>',
        '  <button type="button" data-act="toggle">' + (e.enabled ? '停用' : '启用') + '</button>',
        '  <button type="button" data-act="edit">编辑</button>',
        '  <button type="button" data-act="del" data-danger>删除</button>',
        '</div>'
      ].join('');
    }).join('');
  }

  /* 任一子面板（表单/批量/试跑）展开时给弹层挂 is-editing，让列表让出高度 */
  function syncEditClass() {
    var dlg = $(DLG_ID);
    if (!dlg) return;
    var ids = [DLG_ID + '-form', DLG_ID + '-bulk', DLG_ID + '-try'];
    var open = false;
    for (var i = 0; i < ids.length; i++) {
      var panel = $(ids[i]);
      if (panel && !panel.classList.contains('is-hidden')) { open = true; break; }
    }
    dlg.classList.toggle('is-editing', open);
  }

  function openForm(entry) {
    var form = $(DLG_ID + '-form');
    if (!form) return;
    state.editingId = entry ? entry.id : '';
    state.kind = entry ? entry.kind : 'person';
    $(DLG_ID + '-correct').value = entry ? entry.correct : '';
    $(DLG_ID + '-wrong').value = entry ? entry.wrong.join('\n') : '';
    $(DLG_ID + '-scene').value = entry ? entry.scene : '';
    $(DLG_ID + '-accent').value = entry ? entry.accent : '';
    $(DLG_ID + '-note').value = entry ? entry.note : '';
    $(DLG_ID + '-form-title').textContent = entry ? '编辑条目' : '新建条目';
    syncKindButtons();
    form.classList.remove('is-hidden');
    syncEditClass();
    var box = $(DLG_ID + '-correct');
    if (box) {
      try { box.focus(); } catch (err) { /* 忽略 */ }
    }
  }

  function closeForm() {
    var form = $(DLG_ID + '-form');
    if (form) form.classList.add('is-hidden');
    state.editingId = '';
    syncEditClass();
  }

  function syncKindButtons() {
    var wrap = $(DLG_ID + '-kinds');
    if (!wrap) return;
    var buttons = wrap.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i].getAttribute('data-kind') === state.kind;
      buttons[i].classList.toggle('is-active', on);
      buttons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function submitForm() {
    var correct = str(($(DLG_ID + '-correct') || {}).value, LIMITS.correct);
    if (!correct) {
      tip('先填正确写法');
      return;
    }
    if (/^\d+$/.test(correct)) {
      tip('正确写法不能只有数字');
      return;
    }
    var wrong = [];
    String(($(DLG_ID + '-wrong') || {}).value || '').split(/[\r\n、，,；;|]+/).forEach(function (item) {
      var text = str(item, LIMITS.wrongItem);
      if (text && text !== correct && wrong.indexOf(text) < 0 && wrong.length < LIMITS.wrongCount) wrong.push(text);
    });
    var data = load();
    var entry = state.editingId ? byId(data, state.editingId) : null;
    if (!entry) {
      if (data.entries.length >= MAX_ENTRIES) {
        tip('档案已满（' + MAX_ENTRIES + ' 条），先删掉一些再加');
        return;
      }
      entry = {
        id: newId(), correct: correct, wrong: [], scene: '', accent: '', note: '',
        kind: state.kind, enabled: true, hits: 0, lastHitAt: 0, source: 'manual',
        createdAt: Date.now(), updatedAt: Date.now()
      };
      data.entries.push(entry);
    } else {
      entry.kind = state.kind;
      entry.correct = correct;
      entry.updatedAt = Date.now();
    }
    entry.wrong = wrong;
    entry.scene = str(($(DLG_ID + '-scene') || {}).value, LIMITS.scene);
    entry.accent = str(($(DLG_ID + '-accent') || {}).value, LIMITS.accent);
    entry.note = str(($(DLG_ID + '-note') || {}).value, LIMITS.note);
    if (!persist(data)) {
      tip('保存失败：本机存储已满');
      return;
    }
    closeForm();
    renderList();
    syncCount();
    tip('已保存「' + correct + '」');
  }

  function removeEntry(id) {
    var data = load();
    for (var i = 0; i < data.entries.length; i++) {
      if (data.entries[i].id !== id) continue;
      var name = data.entries[i].correct;
      data.entries.splice(i, 1);
      persist(data);
      renderList();
      syncCount();
      tip('已删除「' + name + '」');
      return;
    }
  }

  function toggleEntry(id) {
    var data = load();
    var entry = byId(data, id);
    if (!entry) return;
    entry.enabled = !entry.enabled;
    entry.updatedAt = Date.now();
    persist(data);
    renderList();
    tip(entry.enabled ? '已启用「' + entry.correct + '」' : '已停用「' + entry.correct + '」');
  }

  /* 删除要防误触：第一次点变成「确认删除」，3 秒后复原 */
  var pendingDelete = { id: '', timer: 0 };
  function askDelete(btn, id) {
    if (pendingDelete.id === id) {
      global.clearTimeout(pendingDelete.timer);
      pendingDelete.id = '';
      removeEntry(id);
      return;
    }
    if (pendingDelete.timer) global.clearTimeout(pendingDelete.timer);
    var previous = pendingDelete.id && doc
      ? doc.querySelector('.va-item[data-id="' + pendingDelete.id + '"] button[data-act="del"]')
      : null;
    if (previous) previous.textContent = '删除';
    pendingDelete.id = id;
    btn.textContent = '确认删除';
    pendingDelete.timer = global.setTimeout(function () {
      pendingDelete.id = '';
      if (btn.isConnected) btn.textContent = '删除';
    }, 3000);
  }

  /* ---------------- 导出 / 试跑 ---------------- */

  function runBulk() {
    var box = $(DLG_ID + '-bulk-text');
    if (!box) return;
    var items = splitBulk(box.value);
    if (!items.length) {
      tip('没解析出条目，一行一条：正确写法 | 误识别1、误识别2');
      return;
    }
    var res = mergeEntries(items);
    box.value = '';
    var panel = $(DLG_ID + '-bulk');
    if (panel) panel.classList.add('is-hidden');
    syncEditClass();
    renderList();
    syncCount();
    tip('批量加入 ' + res.added + ' 条' + (res.skipped ? '，已存在 ' + res.skipped + ' 条' : ''));
  }

  function runExport() {
    var text = exportText();
    if (!text) {
      tip('档案是空的，没有可导出的内容');
      return;
    }
    var clip = global.navigator && global.navigator.clipboard;
    var panel = $(DLG_ID + '-bulk');
    var box = $(DLG_ID + '-bulk-text');
    if (panel) panel.classList.remove('is-hidden');
    syncEditClass();
    if (box) {
      box.value = text;
      try { box.focus(); box.select(); } catch (err) { /* 忽略 */ }
    }
    if (clip && typeof clip.writeText === 'function') {
      clip.writeText(text).then(function () {
        tip('已复制 ' + load().entries.length + ' 条到剪贴板');
      }).catch(function () {
        tip('已放到下方文本框，长按全选复制');
      });
      return;
    }
    tip('已放到下方文本框，长按全选复制');
  }

  function runTry() {
    var input = $(DLG_ID + '-try-input');
    var out = $(DLG_ID + '-try-out');
    var text = str(input ? input.value : '');
    if (!text) {
      tip('先写一句要试的文字');
      return;
    }
    var data = load();
    var res = correct(text, data.entries, { auto: data.settings.auto });
    if (!out) return;
    if (res.off) {
      out.textContent = '自动纠错已关闭，原样返回：\n' + text;
      return;
    }
    if (!res.applied.length) {
      out.textContent = '没有命中任何档案，原样返回：\n' + res.text;
      return;
    }
    var names = res.applied.map(function (a) {
      return a.from + ' → ' + a.to;
    });
    out.textContent = '命中 ' + res.applied.length + ' 处（' + names.join('；') + '）：\n' + res.text;
  }

  /* ---------------- review 小条 ---------------- */

  var pending = { applied: [], base: '' };

  function bar() {
    var el = $(BAR_ID);
    if (el || !doc) return el;
    var layer = doc.querySelector('.vox');
    if (!layer) return null;
    el = doc.createElement('p');
    el.id = BAR_ID;
    el.className = 'is-hidden';
    el.innerHTML = '<span id="' + BAR_ID + '-text"></span>'
      + '<button type="button" id="' + BAR_ID + '-undo">撤销</button>';
    var sub = layer.querySelector('#voice-sub');
    if (sub && sub.parentNode) sub.parentNode.insertBefore(el, sub.nextSibling);
    else layer.insertBefore(el, layer.firstChild);
    var undo = el.querySelector('button');
    if (undo) undo.addEventListener('click', undoCorrection);
    return el;
  }

  function showBar(applied) {
    var el = bar();
    if (!el) return;
    var text = el.querySelector('#' + BAR_ID + '-text');
    if (text) text.textContent = '已按档案纠正 ' + applied.length + ' 处（' + applied[0].from + ' → ' + applied[0].to + '）';
    el.classList.remove('is-hidden');
  }

  function hideBar() {
    var el = $(BAR_ID);
    if (el) el.classList.add('is-hidden');
  }

  function editBox() {
    return $('voice-edit');
  }

  function undoCorrection() {
    var box = editBox();
    if (!box || !pending.applied.length) return;
    var value = box.value;
    pending.applied.slice().reverse().forEach(function (item) {
      var at = value.lastIndexOf(item.to);
      if (at >= 0) value = value.slice(0, at) + item.from + value.slice(at + item.to.length);
    });
    box.value = value;
    try { box.dispatchEvent(new global.Event('input', { bubbles: true })); } catch (err) { /* 忽略 */ }
    uncountHits(pending.applied);
    pending.applied = [];
    pending.base = value;
    hideBar();
    tip('已还原为原始识别结果');
  }

  /* ---------------- 纠正沉淀浮卡 ---------------- */

  var learnCard = { pair: null, timer: 0 };

  function ensureLearnCard() {
    var el = $(LEARN_ID);
    if (el || !doc) return el;
    el = doc.createElement('div');
    el.id = LEARN_ID;
    el.className = 'is-hidden';
    el.innerHTML = [
      '<p>记住这次纠正？<b id="' + LEARN_ID + '-pair"></b></p>',
      '<div class="va-learn-row">',
      '  <button type="button" data-keep>记住</button>',
      '  <button type="button" data-skip>忽略</button>',
      '</div>'
    ].join('');
    doc.body.appendChild(el);
    el.addEventListener('click', function (event) {
      var btn = event.target && event.target.closest ? event.target.closest('button') : null;
      if (!btn) return;
      if (btn.hasAttribute('data-keep')) {
        var entry = learn(learnCard.pair);
        tip(entry ? '已记入档案「' + entry.correct + '」' : '档案已满，没能记住');
      }
      hideLearnCard();
    });
    return el;
  }

  function showLearnCard(pair) {
    var el = ensureLearnCard();
    if (!el) return;
    learnCard.pair = pair;
    var text = el.querySelector('#' + LEARN_ID + '-pair');
    if (text) text.textContent = pair.from + ' → ' + pair.to;
    el.classList.remove('is-hidden');
    if (learnCard.timer) global.clearTimeout(learnCard.timer);
    learnCard.timer = global.setTimeout(hideLearnCard, 8000);
  }

  function hideLearnCard() {
    var el = $(LEARN_ID);
    if (el) el.classList.add('is-hidden');
    learnCard.pair = null;
    if (learnCard.timer) {
      global.clearTimeout(learnCard.timer);
      learnCard.timer = 0;
    }
  }

  /* ---------------- 识别路径挂钩 ---------------- */

  function applyToVoice(raw) {
    var data = load();
    var res = correct(raw, data.entries, { auto: data.settings.auto });
    if (!res.off && res.applied.length) {
      countHits(res.applied);
      pending.applied = res.applied;
      showBar(res.applied);
    } else if (!res.off) {
      pending.applied = [];
      hideBar();
    }
    return res;
  }

  function hookVoiceHost() {
    var host = global.VoiceHost;
    if (!host || host.__vaHooked || typeof host.result !== 'function') return false;
    var original = host.result;
    host.result = function (text) {
      var res = applyToVoice(text);
      var ret = original.call(this, res.off ? text : res.text);
      /* App 自己还会做数字/时间整理，review 框才是用户真正看到的文字，
         沉淀比对以它为准，避免把「三点→3:00」这种规范化当成用户纠正。 */
      var box = editBox();
      pending.base = box ? box.value : res.text;
      return ret;
    };
    host.__vaHooked = true;
    return true;
  }

  /* 发送前的兜底：录音转写（dictate）那条链路不经过 VoiceHost.result，
     在 capture 阶段先改一遍，App 的 sendVoiceText 读到的就已经是纠正后的文字。 */
  function correctBeforeSend() {
    var box = editBox();
    if (!box) return;
    var data = load();
    if (!data.settings.auto) return;
    var before = String(box.value || '');
    if (!before) return;
    var res = correct(before, data.entries);
    if (res.applied.length) {
      box.value = res.text;
      try { box.dispatchEvent(new global.Event('input', { bubbles: true })); } catch (err) { /* 忽略 */ }
      countHits(res.applied);
      pending.applied = res.applied;
      showBar(res.applied);
    }
  }

  function maybeLearn() {
    var box = editBox();
    if (!box) return;
    var finalText = String(box.value || '');
    /* 已经点过发送，App 会关层、清空输入框，所以这行必须在 capture 阶段取 */
    if (!finalText) return;
    var pair = diffPair(pending.base, finalText);
    pending.base = finalText;
    /* 总开关只管「自动纠正」；用户亲手改的地方照样可以问他记不记 */
    if (!pair) return;
    showLearnCard(pair);
  }

  function voiceLayerOpen() {
    var layer = $('voice-layer');
    return !!layer && !layer.classList.contains('is-hidden');
  }

  /* capture 阶段先于 App 自己的处理器执行：先纠错、先取最终文字 */
  function onCapture(event) {
    if (!doc) return;
    var target = event.target;
    if (!target || !voiceLayerOpen()) return;
    var sendLike = false;
    if (event.type === 'keydown') {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      if (!target.id || target.id !== 'voice-edit') return;
      sendLike = true;
    } else {
      var btn = target.closest ? target.closest('#voice-stop, #voice-to-todo, #voice-to-message') : null;
      if (!btn) return;
      /* #voice-stop 在聆听/转写中是「结束录音」，只有 review/typing 才是发送 */
      if (btn.id === 'voice-stop' && !btn.classList.contains('is-send')) return;
      sendLike = true;
    }
    if (!sendLike) return;
    correctBeforeSend();
    maybeLearn();
  }

  /* ======================================================================
     六、档案库弹层
     ====================================================================== */

  function kindOptions() {
    var out = ['<option value="all">全部类型</option>'];
    for (var i = 0; i < KINDS.length; i++) {
      out.push('<option value="' + KINDS[i].key + '">' + KINDS[i].label + '</option>');
    }
    return out.join('');
  }

  function kindButtons() {
    return KINDS.map(function (item) {
      return '<button type="button" data-kind="' + item.key + '">' + item.label + '</button>';
    }).join('');
  }

  function buildDialog() {
    var dlg = doc.createElement('dialog');
    dlg.id = DLG_ID;
    dlg.setAttribute('aria-labelledby', DLG_ID + '-title');
    /* 键盘弹出时不让 kb-stable 锁尺寸：本弹层限高随视口走（flex + 内部滚动），
       锁「弹出前高度」的旧值会把底部按钮顶出视口（真机实测过） */
    dlg.setAttribute('data-kb-skip', '');
    dlg.innerHTML = [
      '<header>',
      '  <h2 id="' + DLG_ID + '-title">常用词与纠错档案</h2>',
      '  <button type="button" data-close>关闭</button>',
      '</header>',
      '<p class="va-hint">存下容易被语音识别错的词：正确写法必填，误识别与口音差异可选。<br>',
      '  识别后会先按档案改一遍，改不动的地方你手改一次，点发送时问你要不要记住。</p>',
      '<div class="va-tools">',
      '  <input type="search" id="' + DLG_ID + '-search" placeholder="搜正确写法 / 误识别 / 场景 / 备注">',
      '  <select id="' + DLG_ID + '-kind">' + kindOptions() + '</select>',
      '  <select id="' + DLG_ID + '-sort">',
      '    <option value="hits">按命中次数</option>',
      '    <option value="recent">按最近使用</option>',
      '    <option value="new">按新增</option>',
      '  </select>',
      '</div>',
      '<p class="va-meta" id="' + DLG_ID + '-meta"></p>',
      '<div class="va-list" id="' + DLG_ID + '-list"></div>',
      '<div class="va-form is-hidden" id="' + DLG_ID + '-form">',
      '  <p class="va-meta" id="' + DLG_ID + '-form-title">新建条目</p>',
      '  <div class="va-field"><label for="' + DLG_ID + '-correct">正确写法（必填）</label>',
      '    <input id="' + DLG_ID + '-correct" maxlength="' + LIMITS.correct + '" placeholder="欧阳明宇"></div>',
      '  <div class="va-field"><label>类型</label><div class="va-kinds" id="' + DLG_ID + '-kinds">',
      kindButtons(), '  </div></div>',
      '  <div class="va-field"><label for="' + DLG_ID + '-wrong">常见误识别（一行一个，可空）</label>',
      '    <textarea id="' + DLG_ID + '-wrong" maxlength="' + (LIMITS.wrongItem * LIMITS.wrongCount) + '"',
      '      placeholder="欧阳明雨&#10;欧阳明语"></textarea></div>',
      '  <div class="va-field"><label for="' + DLG_ID + '-scene">使用场景</label>',
      '    <input id="' + DLG_ID + '-scene" maxlength="' + LIMITS.scene + '" placeholder="开会通知 / 客户名单"></div>',
      '  <div class="va-field"><label for="' + DLG_ID + '-accent">个人口音与普通话的差异</label>',
      '    <input id="' + DLG_ID + '-accent" maxlength="' + LIMITS.accent + '"',
      '      placeholder="n/l 不分、前后鼻音不分（填了就启用近音匹配）"></div>',
      '  <div class="va-field"><label for="' + DLG_ID + '-note">备注</label>',
      '    <input id="' + DLG_ID + '-note" maxlength="' + LIMITS.note + '" placeholder="实验室的师兄，别写成明雨"></div>',
      '  <div class="va-row">',
      '    <button type="button" data-primary data-save>保存条目</button>',
      '    <button type="button" data-cancel>取消</button>',
      '  </div>',
      '</div>',
      '<div class="va-actions">',
      '  <button type="button" data-primary data-new>新建一条</button>',
      '  <button type="button" data-bulk>批量粘贴</button>',
      '  <button type="button" data-try>试跑一句</button>',
      '  <button type="button" data-export>导出文本</button>',
      '</div>',
      '<div class="va-bulk is-hidden" id="' + DLG_ID + '-bulk">',
      '  <p class="va-meta">一行一条：正确写法 | 误识别1、误识别2（竖线可省，行首序号自动去掉）</p>',
      '  <textarea id="' + DLG_ID + '-bulk-text" rows="5" placeholder="欧阳明宇 | 欧阳明雨、欧阳明语&#10;毕设实物"></textarea>',
      '  <div class="va-row">',
      '    <button type="button" data-primary data-bulk-run>解析并导入</button>',
      '    <button type="button" data-bulk-close>收起</button>',
      '  </div>',
      '</div>',
      '<div class="va-bulk is-hidden" id="' + DLG_ID + '-try">',
      '  <input id="' + DLG_ID + '-try-input" placeholder="例如：明天带避设实物去实验室">',
      '  <div class="va-row"><button type="button" data-primary data-try-run>试跑</button></div>',
      '  <pre class="va-try-out" id="' + DLG_ID + '-try-out"></pre>',
      '</div>',
      '<p class="va-meta"><label><input type="checkbox" id="' + DLG_ID + '-auto" style="width:auto;margin-right:6px">',
      '  识别后自动纠错</label></p>'
    ].join('\n');
    return dlg;
  }

  function bindDialog(dlg) {
    dlg.addEventListener('click', function (event) {
      var node = event.target;
      if (!node || !node.closest) return;
      if (event.target === dlg) { dlg.close(); return; }
      var kindBtn = node.closest('.va-kinds button');
      if (kindBtn) {
        state.kind = kindBtn.getAttribute('data-kind');
        syncKindButtons();
        return;
      }
      var itemBtn = node.closest('.va-item button');
      if (itemBtn) {
        var item = node.closest('.va-item');
        var id = item ? item.getAttribute('data-id') : '';
        var act = itemBtn.getAttribute('data-act');
        if (act === 'del') askDelete(itemBtn, id);
        else if (act === 'edit') {
          var data = load();
          var entry = byId(data, id);
          if (entry) openForm(entry);
        } else if (act === 'toggle') toggleEntry(id);
        return;
      }
      var btn = node.closest('button');
      if (!btn) return;
      if (btn.hasAttribute('data-close')) dlg.close();
      else if (btn.hasAttribute('data-new')) openForm(null);
      else if (btn.hasAttribute('data-save')) submitForm();
      else if (btn.hasAttribute('data-cancel')) closeForm();
      else if (btn.hasAttribute('data-bulk')) {
        var panel = $(DLG_ID + '-bulk');
        if (panel) panel.classList.toggle('is-hidden');
        syncEditClass();
      } else if (btn.hasAttribute('data-bulk-run')) runBulk();
      else if (btn.hasAttribute('data-bulk-close')) {
        var closePanel = $(DLG_ID + '-bulk');
        if (closePanel) closePanel.classList.add('is-hidden');
        syncEditClass();
      } else if (btn.hasAttribute('data-export')) runExport();
      else if (btn.hasAttribute('data-try')) {
        var tryPanel = $(DLG_ID + '-try');
        if (tryPanel) tryPanel.classList.toggle('is-hidden');
        syncEditClass();
      } else if (btn.hasAttribute('data-try-run')) runTry();
    });

    var search = $(DLG_ID + '-search');
    if (search) search.addEventListener('input', renderList);
    var kindSel = $(DLG_ID + '-kind');
    if (kindSel) kindSel.addEventListener('change', renderList);
    var sortSel = $(DLG_ID + '-sort');
    if (sortSel) sortSel.addEventListener('change', renderList);
    var auto = $(DLG_ID + '-auto');
    if (auto) {
      auto.addEventListener('change', function () {
        var data = load();
        data.settings.auto = !!auto.checked;
        persist(data);
        tip(auto.checked ? '识别后会自动按档案纠错' : '已关闭自动纠错，档案仍保留');
      });
    }
  }

  function openDialog() {
    var dlg = $(DLG_ID);
    if (!dlg) return;
    closeForm();
    var auto = $(DLG_ID + '-auto');
    if (auto) auto.checked = load().settings.auto !== false;
    var bulk = $(DLG_ID + '-bulk');
    if (bulk) bulk.classList.add('is-hidden');
    var tryPanel = $(DLG_ID + '-try');
    if (tryPanel) tryPanel.classList.add('is-hidden');
    syncEditClass();
    renderList();
    syncCount();
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  function mount() {
    if (!doc) return;
    if ($(BTN_ID)) return;
    var anchor = $('save-voice-names') || $('import-voice-names');
    if (!anchor || !anchor.parentNode) return;

    if (!$(STYLE_ID)) {
      var style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      doc.head.appendChild(style);
    }

    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.id = BTN_ID;
    btn.className = anchor.className;
    btn.textContent = '常用词档案';
    anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    btn.addEventListener('click', openDialog);

    var dlg = buildDialog();
    doc.body.appendChild(dlg);
    bindDialog(dlg);
    syncCount();

    /* 语音层是页面里常驻的（默认 is-hidden），小条一次性挂进去 */
    bar();
    ensureLearnCard();
    hookVoiceHost();
    /* VoiceHost 由 app.js 在启动时挂到 window 上；极端情况下比本补丁晚，
       重试几次直到挂上（最多约 2 秒，之后放弃，不影响其它功能） */
    var tries = 0;
    (function retryHook() {
      if (global.VoiceHost && global.VoiceHost.__vaHooked) return;
      if (hookVoiceHost()) return;
      if (++tries > 10) return;
      global.setTimeout(retryHook, 200);
    })();
    doc.addEventListener('click', onCapture, true);
    doc.addEventListener('keydown', onCapture, true);
    global.addEventListener('pagehide', flushPendingSave);
    doc.addEventListener('visibilitychange', function () {
      if (doc.visibilityState === 'hidden') flushPendingSave();
    });
    watchVoiceLayer();
  }

  /* 语音层关掉就清掉本轮状态：否则下一轮还挂着上一轮的「撤销」 */
  function watchVoiceLayer() {
    var layer = $('voice-layer');
    if (!layer || typeof global.MutationObserver !== 'function') return;
    var last = layer.classList.contains('is-hidden');
    new global.MutationObserver(function () {
      var now = layer.classList.contains('is-hidden');
      if (now === last) return;
      last = now;
      if (!now) return;
      pending.applied = [];
      pending.base = '';
      hideBar();
    }).observe(layer, { attributes: true, attributeFilter: ['class'] });
  }

  /* 测试与调试用的公开接口：引擎是纯函数，单测直接调，不必起 DOM */
  global.VoiceArchive = {
    key: KEY,
    kinds: KINDS,
    load: load,
    correct: correct,
    diffPair: diffPair,
    splitBulk: splitBulk,
    guessKind: guessKind,
    loosen: looseSyllable,
    learn: learn,
    mergeEntries: mergeEntries,
    exportText: exportText
  };

  if (!doc) return;   /* 无 DOM 环境（Node 单测）就只导出引擎 */

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})(window);
