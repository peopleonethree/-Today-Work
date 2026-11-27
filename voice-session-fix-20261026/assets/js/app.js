/* ==========================================================================
   app.js — 界面逻辑
   功能：新增、勾选、删除、剩余计数；可为任务设置提醒时间并显示倒计时；
        在提醒时间前 10 / 5 / 1 分钟各弹窗提醒一次，弹窗停留 30 秒后自动消失；
        「已办」沉淀手动确认完成的任务与完成时间，支持单条 / 多选 / 全选删除。
        勾选只是表达「做完了」，必须再确认一次才归档；到点或超时都不算完成。
   空白任务不添加；数据按账号隔离。
   ========================================================================== */

(function (global) {
  'use strict';

  var Store = global.AppStorage;
  var Auth = global.AppAuth;
  var document = global.document;

  var TOAST_DURATION = 2400;
  var TICK_INTERVAL = 1000;

  /* 提前提醒的档位（秒） */
  var REMIND_OFFSETS = [600, 300, 60];
  var REMIND_LABEL = { 600: '10 分钟', 300: '5 分钟', 60: '1 分钟' };
  var REMIND_TONE = { 600: 'info', 300: 'warn', 60: 'urgent' };
  /* 倒计时归零（到点）用 reminded 里的 0 标记：它不属于「提前 N 分钟」，单独一档 */
  var DUE_OFFSET = 0;
  var REMINDER_DURATION = 30000; /* 弹窗停留 30 秒 */
  /* 到点铃声最长响多久。卡片还在就继续，用户关掉卡片立刻停 */
  var RING_DURATION = 10000;
  var MAX_VISIBLE_REMINDERS = 3;

  var ICON_CLOCK =
    '<svg class="timechip__icon" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.9"/>' +
    '<path d="M12 7.4V12l3.1 1.9" fill="none" stroke="currentColor" stroke-width="1.9" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var ICON_CLOSE =
    '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">' +
    '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" ' +
    'stroke-width="2.8" stroke-linecap="round"/></svg>';

  var ICON_TRASH =
    '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">' +
    '<path d="M4.6 7h14.8M9.8 7V5.6c0-.6.5-1.1 1.1-1.1h2.2c.6 0 1.1.5 1.1 1.1V7" ' +
    'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
    'stroke-linejoin="round"/>' +
    '<path d="M6.8 7l.76 11.3c.06.94.84 1.7 1.8 1.7h5.28c.96 0 1.74-.76 1.8-1.7L17.2 7" ' +
    'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
    'stroke-linejoin="round"/>' +
    '<path d="M10.5 10.6v6M13.5 10.6v6" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round"/></svg>';

  /* 退回待办：完成项只在已办里，误点了从这里撤回 */
  var ICON_UNDO =
    '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">' +
    '<path d="M8.4 8.2H5.2V5" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M5.4 8c1.5-2.6 4.1-4.2 7-4.2 4.4 0 8 3.4 8 7.7 0 4.3-3.6 7.7-8 7.7-3.1 0-5.9-1.7-7.3-4.4" ' +
    'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
    'stroke-linejoin="round"/></svg>';

  var el = {};
  var state = { user: null, todos: [], avatar: '' };
  var prefs = { ring: true, theme: '', sort: { active: 'createdDesc', archive: 'createdDesc' },
    guideSeen: false, voiceEngine: 'local', voiceTodoMode: 'dict', voiceMemoMode: 'realtime',
    llmModels: [], llmActiveId: '', llmRoute: 'auto',
    /* 模型目录的在线版本：llmCatalog 是当前用的，llmCatalogPrev 是上一版，用来回滚 */
    llmCatalog: null, llmCatalogPrev: null,
    /* 录音转写的识别服务（OpenAI 兼容 /v1/audio/transcriptions，multipart 直传）。
       默认硅基流动的 SenseVoiceSmall：中文准、有免费额度、国内直连。 */
    dictate: {
      endpoint: 'https://api.siliconflow.cn/v1/audio/transcriptions',
      model: 'FunAudioLLM/SenseVoiceSmall',
      key: ''
    },
    /* 发送给模型前是否先给手机号/身份证/银行卡/邮箱打码，默认开 */
    aiMaskPii: true };
  /* 设备级设置：到点响铃 / 界面主题 / 两套列表排序 / 是否看过功能指引 /
     语音时间识别引擎 / 大模型档案库（可多份）与路由方式 */
  var addDueAt = null;       /* 新增栏里待设置的提醒时间 */
  var addDueFuzzy = null;    /* 模糊时段：morning/noon/…/allday，null 表示精确到分钟 */
  var toastTimer = null;
  var tickTimer = null;
  var currentPanel = 'todos'; /* 'todos' | 'archive' */
  var archiveSelection = {}; /* 已办里被勾选的记录 id，仅存活于当前会话 */
  var confirmResolve = null;

  /* ------------------------------------------------------------ 基础工具 */

  function $(id) {
    return document.getElementById(id);
  }

  function show(node, visible) {
    if (!node) return;
    node.classList.toggle('is-hidden', !visible);
  }

  function pad2(value) {
    return value < 10 ? '0' + value : '' + value;
  }

  function truncate(text, max) {
    var value = String(text == null ? '' : text);
    return value.length > max ? value.slice(0, max) + '…' : value;
  }

  function toast(message) {
    if (!el.toast) return;
    var text = String(message == null ? '' : message);
    /* 报错信息可能带一长串服务端原文，长到把整屏糊住就失去意义了 */
    if (text.length > 60) text = text.slice(0, 58) + '…';
    el.toast.textContent = text;
    el.toast.classList.add('is-show');
    if (toastTimer) global.clearTimeout(toastTimer);
    toastTimer = global.setTimeout(function () {
      el.toast.classList.remove('is-show');
    }, TOAST_DURATION);
  }

  /* ------------------------------------------------------------ 时间格式化 */

  function formatClockDate(date) {
    return pad2(date.getHours()) + ':' + pad2(date.getMinutes());
  }

  function sameDay(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  /** 例：今天 15:30 / 明天 09:00 / 10月20日 08:00 */
  function formatDateTime(timestamp) {
    var target = new Date(timestamp);
    var now = new Date();
    var tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    var clock = formatClockDate(target);

    if (sameDay(target, now)) return '今天 ' + clock;
    if (sameDay(target, tomorrow)) return '明天 ' + clock;
    return target.getMonth() + 1 + '月' + target.getDate() + '日 ' + clock;
  }

  /**
   * 已办里的时间要经得起回看，所以要带上「昨天」和年份，
   * 例：今天 15:30 / 昨天 09:12 / 10月8日 21:40 / 2025年12月31日 23:50
   */
  function formatArchiveTime(timestamp) {
    if (!timestamp) return '未知时间';
    var target = new Date(timestamp);
    var now = new Date();
    var yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    var clock = formatClockDate(target);
    var monthDay = target.getMonth() + 1 + '月' + target.getDate() + '日';

    if (sameDay(target, now)) return '今天 ' + clock;
    if (sameDay(target, yesterday)) return '昨天 ' + clock;
    if (target.getFullYear() === now.getFullYear()) return monthDay + ' ' + clock;
    return target.getFullYear() + '年' + monthDay + ' ' + clock;
  }

  /** 秒数 → 「1 小时 20 分」/「12 分 30 秒」/「45 秒」 */
  function humanDuration(seconds) {
    var total = Math.max(0, Math.round(seconds));
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var secs = total % 60;
    if (hours > 0) return hours + ' 小时 ' + minutes + ' 分';
    if (minutes > 0) return minutes + ' 分 ' + secs + ' 秒';
    return secs + ' 秒';
  }

  /* ------------------------------------------------------------ 模糊时段
     很多人只知道「下午要办」，并不想挑到分钟。这里给六个档：
     上午/中午/下午/傍晚/晚上/全天。选了以后：
       · 列表里显示「今天 下午」而不是「今天 15:00」
       · dueAt 仍然落在一个具体时刻（该时段的代表点），排序、闹钟、导出都不用改
       · 逾期的判定放宽到「该时段结束」，不会刚到 15:00 就标红
     全天 = 这一整天都算数，只在当天上午提醒一次。 */
  var FUZZY_SLOTS = [
    { key: 'morning',   label: '上午', hour: 9,  endHour: 12 },
    { key: 'noon',      label: '中午', hour: 12, endHour: 14 },
    { key: 'afternoon', label: '下午', hour: 15, endHour: 18 },
    { key: 'evening',   label: '傍晚', hour: 18, endHour: 20 },
    { key: 'night',     label: '晚上', hour: 20, endHour: 24 },
    { key: 'allday',    label: '全天', hour: 9,  endHour: 24 }
  ];

  function fuzzySlot(key) {
    for (var i = 0; i < FUZZY_SLOTS.length; i++) {
      if (FUZZY_SLOTS[i].key === key) return FUZZY_SLOTS[i];
    }
    return null;
  }

  /** 只到日、不到时的日期前缀：今天 / 明天 / 后天 / 10月26日 */
  function dayPrefixOf(timestamp) {
    var target = new Date(timestamp);
    var now = new Date();
    var diff = Math.round((startOfDay(target) - startOfDay(now)) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === 2) return '后天';
    return target.getMonth() + 1 + '月' + target.getDate() + '日';
  }

  /** 这条任务该怎么念它自己的时间（模糊时段优先） */
  function dueTextOf(todo) {
    if (!todo || !todo.dueAt) return '';
    var slot = fuzzySlot(todo.dueFuzzy);
    if (!slot) return formatDateTime(todo.dueAt);
    return dayPrefixOf(todo.dueAt) + ' ' + slot.label;
  }

  /** 模糊时段的结束时刻：逾期与否按这个算，不按代表时刻 */
  function fuzzyEndAt(todo) {
    var slot = fuzzySlot(todo && todo.dueFuzzy);
    if (!slot || !todo.dueAt) return 0;
    var day = new Date(todo.dueAt);
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), slot.endHour, 0, 0, 0).getTime();
  }

  /** 倒计时文案与配色档位 */
  function describeCountdown(todo, now) {
    if (!todo.dueAt) return { text: '添加提醒', tone: 'idle' };
    /* 模糊时段只报「今天 下午」这种粒度，精确到分的倒计时反而误导 */
    if (todo.dueFuzzy) {
      var label = dueTextOf(todo);
      if (todo.done) return { text: label, tone: 'done' };
      if (now >= fuzzyEndAt(todo)) return { text: label, tone: 'overdue' };
      var sameDay = startOfDay(new Date(todo.dueAt)) === startOfDay(new Date(now));
      return { text: label, tone: sameDay ? 'warn' : 'normal' };
    }
    if (todo.done) return { text: formatDateTime(todo.dueAt), tone: 'done' };

    var remaining = Math.round((todo.dueAt - now) / 1000);
    if (remaining <= 0) return { text: '已超时 ' + humanDuration(-remaining), tone: 'overdue' };

    var tone = 'normal';
    if (remaining <= 60) tone = 'urgent';
    else if (remaining <= 300) tone = 'warn';
    else if (remaining <= 600) tone = 'info';

    return { text: '还有 ' + humanDuration(remaining), tone: tone };
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  /* ------------------------------------------------- 提醒时间选择面板（自绘）
     刻意不使用浏览器原生的日期时间选择器：
     原生 <select> 在部分 WebView（尤其是国产 ROM 自带的浏览器内核）上点下去
     根本不弹列表；即使弹出来也是全屏 RadioGroup，和 App 视觉完全两张皮。
     这里三个下拉全部自绘：按钮 + 覆盖在面板内的列表，任何内核都点得开。 */

  var DATE_OPTION_COUNT = 21; /* 可选日期：今天起 21 天 */
  var MINUTE_STEP = 5;

  var timePop = {
    target: null, /* { kind: 'add' } 或 { kind: 'item', id } */
    anchor: null,
    dateIdx: 0, /* 距今天的天数偏移 */
    hour: 0,
    minute: 0,
    fuzzy: null, /* 选中的模糊时段 key；null 表示精确到分钟 */
    open: null /* 当前展开的下拉：'date' | 'hour' | 'minute' | null */
  };

  /** 向上取整到整分钟 */
  function ceilToMinute(timestamp) {
    return Math.ceil(timestamp / 60000) * 60000;
  }

  /** 默认建议时间：半小时后，并对齐到 5 分钟刻度 */
  function defaultDueTime(now) {
    var step = MINUTE_STEP * 60000;
    return Math.ceil((now + 30 * 60000) / step) * step;
  }

  /** 日期下拉项文案：今天（周五） */
  function dayLabel(date, today) {
    var week = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
    var diff = Math.round((startOfDay(date) - startOfDay(today)) / 86400000);
    if (diff === 0) return '今天（周' + week + '）';
    if (diff === 1) return '明天（周' + week + '）';
    if (diff === 2) return '后天（周' + week + '）';
    return date.getMonth() + 1 + '月' + date.getDate() + '日（周' + week + '）';
  }

  /** 第 offset 天的文案（每次现算，"今天"往前滚也不会错位） */
  function dateOffsetLabel(offset) {
    var now = new Date();
    var day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    return dayLabel(day, now);
  }

  /** 面板里三个按钮显示的值，顺带把「模糊时段」那排按钮的状态画对 */
  function syncTimePopoverText() {
    if (el.timePopDateText) el.timePopDateText.textContent = dateOffsetLabel(timePop.dateIdx);
    if (el.timePopHourText) el.timePopHourText.textContent = pad2(timePop.hour);
    if (el.timePopMinuteText) el.timePopMinuteText.textContent = pad2(timePop.minute);

    var slot = fuzzySlot(timePop.fuzzy);
    /* 选了时段就把「时/分」收起来：再让人挑分钟，等于没模糊 */
    show(el.timePopClock, !slot);
    if (el.timePopSlots) {
      var btns = el.timePopSlots.querySelectorAll('.timeslot__btn');
      for (var i = 0; i < btns.length; i++) {
        var on = !!slot && btns[i].getAttribute('data-slot') === slot.key;
        btns[i].classList.toggle('is-active', on);
        btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    if (el.timePopSlotNote) {
      show(el.timePopSlotNote, !!slot);
      if (slot) {
        el.timePopSlotNote.textContent = slot.key === 'allday'
          ? '全天：这一天都算数，只在上午 09:00 提醒一次'
          : slot.label + '：' + slot.hour + ':00 提醒，具体几点不用挑';
      }
    }
  }

  /** 把三个下拉设到指定时刻；fuzzy 不为空时同时点亮对应时段 */
  function setPopoverValue(timestamp, fuzzy) {
    var target = new Date(timestamp);
    var now = new Date();
    var offset = Math.round((startOfDay(target) - startOfDay(now)) / 86400000);
    timePop.dateIdx = Math.max(0, Math.min(DATE_OPTION_COUNT - 1, offset));
    timePop.hour = target.getHours();
    timePop.minute = Math.floor(target.getMinutes() / MINUTE_STEP) * MINUTE_STEP;
    timePop.fuzzy = fuzzySlot(fuzzy) ? fuzzy : null;
    syncTimePopoverText();
  }

  /** 读出选择面板表示的时刻 */
  function popoverTimestamp() {
    var now = new Date();
    return new Date(
      now.getFullYear(), now.getMonth(), now.getDate() + timePop.dateIdx,
      timePop.hour, timePop.minute, 0, 0
    ).getTime();
  }

  /** 当前下拉的可选项：[{ value, label }] */
  function timePickItems(kind) {
    var items = [];
    var i;
    if (kind === 'date') {
      for (i = 0; i < DATE_OPTION_COUNT; i++) {
        items.push({ value: i, label: dateOffsetLabel(i) });
      }
    } else if (kind === 'hour') {
      for (i = 0; i < 24; i++) items.push({ value: i, label: pad2(i) + ' 时' });
    } else {
      for (i = 0; i < 60; i += MINUTE_STEP) items.push({ value: i, label: pad2(i) + ' 分' });
    }
    return items;
  }

  function timePickButton(kind) {
    if (kind === 'date') return el.timePopDateBtn;
    if (kind === 'hour') return el.timePopHourBtn;
    return el.timePopMinuteBtn;
  }

  function timePickCurrent(kind) {
    if (kind === 'date') return timePop.dateIdx;
    if (kind === 'hour') return timePop.hour;
    return timePop.minute;
  }

  function closeTimePick() {
    if (!timePop.open) return;
    var btn = timePickButton(timePop.open);
    if (btn) btn.setAttribute('aria-expanded', 'false');
    timePop.open = null;
    if (el.timePopList) {
      el.timePopList.classList.add('is-hidden');
      el.timePopList.textContent = '';
    }
    /* 面板缩回去以后，宽屏要重新贴一次锚点 */
    if (el.timePopLayer && !el.timePopLayer.classList.contains('is-hidden')) {
      positionTimePopover();
    }
  }

  /** 展开某个下拉：贴着按钮放，面板下方放不下就翻到上面 */
  function openTimePick(kind) {
    if (!el.timePopList || !el.timePop) return;
    if (timePop.open === kind) {
      closeTimePick();
      return;
    }
    closeTimePick();

    var btn = timePickButton(kind);
    if (!btn) return;

    var list = el.timePopList;
    var current = timePickCurrent(kind);
    var items = timePickItems(kind);
    var frag = document.createDocumentFragment();

    for (var i = 0; i < items.length; i++) {
      var opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'timepick__opt' + (items[i].value === current ? ' is-active' : '');
      opt.setAttribute('role', 'option');
      opt.setAttribute('aria-selected', items[i].value === current ? 'true' : 'false');
      opt.setAttribute('data-value', String(items[i].value));
      opt.textContent = items[i].label;
      frag.appendChild(opt);
    }

    list.textContent = '';
    list.appendChild(frag);
    list.classList.remove('is-hidden');
    list.scrollTop = 0;

    timePop.open = kind;
    btn.setAttribute('aria-expanded', 'true');

    /* 列表占位后面板高度会变，宽屏要重新贴一次锚点（窄屏是贴底部，自动向上长） */
    positionTimePopover();

    /* 让选中项直接出现在视野里，不用用户自己翻半天 */
    var active = list.querySelector('.timepick__opt.is-active');
    if (active) {
      list.scrollTop = Math.max(0, active.offsetTop - list.clientHeight / 2 + active.offsetHeight / 2);
    }
  }

  /** 选中某一项 */
  function pickTimeOption(kind, value) {
    if (kind === 'date') timePop.dateIdx = value;
    else if (kind === 'hour') { timePop.hour = value; timePop.fuzzy = null; }
    else { timePop.minute = value; timePop.fuzzy = null; }
    syncTimePopoverText();
    if (el.timePopError) el.timePopError.textContent = '';
    closeTimePick();
  }

  /** 只有窄屏才需要底部抽屉，宽屏按触发按钮定位 */
  function isNarrowScreen() {
    return (global.innerWidth || 1024) <= 560;
  }

  function positionTimePopover() {
    if (!el.timePop) return;
    if (isNarrowScreen() || !timePop.anchor) {
      el.timePop.style.left = '';
      el.timePop.style.top = '';
      return;
    }

    var rect = timePop.anchor.getBoundingClientRect();
    var width = el.timePop.offsetWidth || 320;
    var height = el.timePop.offsetHeight || 300;
    var margin = 10;
    var maxLeft = Math.max(margin, (global.innerWidth || 1024) - width - margin);
    var left = Math.min(Math.max(margin, rect.left), maxLeft);

    var top = rect.bottom + 8;
    if (top + height > (global.innerHeight || 768) - margin) {
      var above = rect.top - height - 8;
      top = above >= margin ? above : Math.max(margin, (global.innerHeight || 768) - height - margin);
    }

    el.timePop.style.left = Math.round(left) + 'px';
    el.timePop.style.top = Math.round(top) + 'px';
  }

  function openTimePopover(target, anchor, initialTimestamp, fuzzy) {
    if (!el.timePop || !el.timePopLayer) return;

    timePop.target = target;
    timePop.anchor = anchor || null;

    closeTimePick();
    setPopoverValue(initialTimestamp || defaultDueTime(Date.now()), fuzzy);

    el.timePopError.textContent = '';
    show(el.timePopLayer, true);
    positionTimePopover();

    if (!isNarrowScreen() && el.timePopOk && typeof el.timePopOk.focus === 'function') {
      try {
        el.timePopOk.focus();
      } catch (err) {
        /* 忽略：聚焦失败不影响使用 */
      }
    }
  }

  function closeTimePopover(restoreFocus) {
    if (!el.timePopLayer || el.timePopLayer.classList.contains('is-hidden')) return;

    closeTimePick();
    show(el.timePopLayer, false);
    el.timePopError.textContent = '';

    var anchor = timePop.anchor;
    timePop.target = null;
    timePop.anchor = null;

    if (restoreFocus && anchor && typeof anchor.focus === 'function') {
      try {
        anchor.focus();
      } catch (err) {
        /* 忽略 */
      }
    }
  }

  /** 面板选定了时刻：应用到新增栏或某条任务 */
  function applyPickedTime(timestamp, fuzzy) {
    var target = timePop.target;
    if (!target) return;

    closeTimePopover(false);

    if (target.kind === 'add') {
      setAddTime(timestamp, fuzzy);
      if (el.newTodo) el.newTodo.focus();
      return;
    }
    setDueAt(target.id, timestamp, fuzzy);
  }

  function confirmTimePopover() {
    var slot = fuzzySlot(timePop.fuzzy);
    var timestamp = popoverTimestamp();
    if (slot) {
      /* 模糊时段只需要那一天还没完全过去 */
      if (timestamp + 24 * 3600000 <= Date.now()) {
        el.timePopError.textContent = '这一天已经过完了，换一天吧';
        return;
      }
      applyPickedTime(timestamp, slot.key);
      return;
    }
    if (timestamp <= Date.now()) {
      el.timePopError.textContent = '这个时间已经过去了，请选择之后的时间';
      return;
    }
    applyPickedTime(timestamp, null);
  }

  function useTimePreset(minutes) {
    if (!minutes || minutes < 1) minutes = 30;
    applyPickedTime(ceilToMinute(Date.now() + minutes * 60000), null);
  }

  /* ------------------------------------------------------------ 数据 */

  function todoKey() {
    return 'todos:' + state.user.key;
  }

  function normalizeTodo(row) {
    if (!row || typeof row !== 'object') return null;
    var text = String(row.text == null ? '' : row.text).trim();
    if (!text) return null;

    var dueAt = Number(row.dueAt);
    var done = !!row.done;
    var completedAt = Number(row.completedAt);
    if (!isFinite(completedAt) || completedAt <= 0) completedAt = null;
    /* 旧数据里已完成的任务没有完成时间，用最后更新时间兜底，避免已办缺时间 */
    if (done && completedAt === null) {
      completedAt = Number(row.updatedAt) || Number(row.createdAt) || Date.now();
    }
    if (!done) completedAt = null;

    return {
      id: String(row.id || ''),
      text: text,
      done: done,
      completedAt: completedAt,
      dueAt: isFinite(dueAt) && dueAt > 0 ? dueAt : null,
      /* 模糊时段（上午/下午/全天…）；老数据没有这个字段就是 null */
      dueFuzzy: fuzzySlot(row.dueFuzzy) ? row.dueFuzzy : null,
      reminded: Array.isArray(row.reminded)
        ? row.reminded.filter(function (v) { return typeof v === 'number'; })
        : [],
      /* 语音识别出来的额外提醒时间点（到点单发一次，没有提前档位） */
      extraTimes: Array.isArray(row.extraTimes)
        ? row.extraTimes.filter(function (v) { return typeof v === 'number' && v > 0; })
        : [],
      remindedExtra: Array.isArray(row.remindedExtra)
        ? row.remindedExtra.filter(function (v) { return typeof v === 'number'; })
        : [],
      /* 附件：手绘/拍照/录音/文件等，结构 { id, kind, name, dataUrl?, libId? } */
      attachments: Array.isArray(row.attachments) ? row.attachments : [],
      messagePlan: global.MessageWorkbench ? global.MessageWorkbench.cleanPlan(row.messagePlan) : null,
      createdAt: Number(row.createdAt) || Date.now(),
      updatedAt: Number(row.updatedAt) || Number(row.createdAt) || Date.now()
    };
  }

  /* 上次成功落盘的内容指纹：整表 JSON.stringify + 全量重写是这里最贵的动作，
     内容没变就不做（比如每秒的提醒检查里 markPastOffsets 没改动任何字段时）。 */
  var lastTodoJson = '';

  function loadTodos() {
    var raw = Store.read(todoKey(), []);
    var list = Array.isArray(raw) ? raw : [];
    state.todos = list.map(normalizeTodo).filter(Boolean);
    try {
      lastTodoJson = JSON.stringify(state.todos);
    } catch (error) {
      lastTodoJson = '';
    }
  }

  function saveTodos() {
    var json = '';
    try {
      json = JSON.stringify(state.todos);
    } catch (error) {
      json = '';   /* 序列化不了就走老路，让 Store.write 去报失败 */
    }
    if (json && json === lastTodoJson) {
      syncNative();
      return true;
    }
    var ok = Store.write(todoKey(), state.todos);
    /* 数据落盘后同步一次提醒排期：手机版靠它把闹钟挂到系统上 */
    if (ok) {
      lastTodoJson = json;
      syncNative();
    }
    return ok;
  }

  function findTodo(id) {
    for (var i = 0; i < state.todos.length; i++) {
      if (state.todos[i].id === id) return state.todos[i];
    }
    return null;
  }

  function newId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function hasReminded(todo, offset) {
    return todo.reminded.indexOf(offset) !== -1;
  }

  /**
   * 把「已经错过」的提醒档位标记为已提醒，避免刚打开页面时被多条弹窗刷屏。
   * 返回是否发生了改动。
   */
  function markPastOffsets(todo, now) {
    if (!todo.dueAt) return false;
    /* 模糊时段只提醒一次：提早档位全记成已提醒，别在「大概下午」里连环弹窗 */
    if (todo.dueFuzzy) {
      var marked = false;
      for (var m = 0; m < REMIND_OFFSETS.length; m++) {
        if (!hasReminded(todo, REMIND_OFFSETS[m])) {
          todo.reminded.push(REMIND_OFFSETS[m]);
          marked = true;
        }
      }
      return marked;
    }
    var remaining = Math.round((todo.dueAt - now) / 1000);
    var changed = false;
    for (var i = 0; i < REMIND_OFFSETS.length; i++) {
      var offset = REMIND_OFFSETS[i];
      if (!hasReminded(todo, offset) && remaining <= offset) {
        todo.reminded.push(offset);
        changed = true;
      }
    }
    /* 到点那一档也一并记掉：已经过去的事不再响铃（响过的那次由原生通知负责） */
    if (!hasReminded(todo, DUE_OFFSET) && remaining <= 0) {
      todo.reminded.push(DUE_OFFSET);
      changed = true;
    }
    return changed;
  }

  /* ------------------------------------------------------------ 渲染 */

  function renderDate() {
    var now = new Date();
    var week = ['日', '一', '二', '三', '四', '五', '六'];
    var label=now.getMonth() + 1 + '月' + now.getDate() + '日 星期' + week[now.getDay()];
    if (el.todayDate.textContent!==label) el.todayDate.textContent=label;
  }

  /** 构建一条任务里的提醒时间控件 */
  function buildTimeField(todo) {
    var field = document.createElement('span');
    field.className = 'timefield timefield--item';
    field.setAttribute('data-tone', 'idle');

    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'timechip';
    chip.setAttribute('aria-haspopup', 'dialog');
    chip.setAttribute('aria-label', '设置提醒时间');
    chip.innerHTML = ICON_CLOCK;
    var label = document.createElement('span');
    label.className = 'timechip__text';
    chip.appendChild(label);

    var initial = describeCountdown(todo, Date.now());
    label.textContent = initial.text;
    field.setAttribute('data-tone', initial.tone);

    chip.addEventListener('click', function () {
      openTimePopover({ kind: 'item', id: todo.id }, chip, todo.dueAt || null, todo.dueFuzzy || null);
    });

    var clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'timefield__clear';
    clear.setAttribute('aria-label', '清除提醒时间');
    clear.innerHTML =
      '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">' +
      '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" ' +
      'stroke-width="2.8" stroke-linecap="round"/></svg>';
    clear.addEventListener('click', function () { setDueAt(todo.id, null); });

    show(clear, !!todo.dueAt);

    field.appendChild(chip);
    field.appendChild(clear);
    return field;
  }

  function createItemElement(todo) {
    var li = document.createElement('li');
    li.className = 'todo' + (todo.done ? ' is-done' : '');
    li.setAttribute('data-id', todo.id);

    var check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'todo__check';
    check.checked = todo.done;
    check.setAttribute('aria-label', todo.done ? '退回待办' : '确认完成');
    check.addEventListener('change', function () { toggleTodo(todo.id); });

    var body = document.createElement('div');
    body.className = 'todo__body';

    var row = document.createElement('div');
    row.className = 'todo__row';

    var text = document.createElement('span');
    text.className = 'todo__text';
    text.textContent = todo.text;
    /* 长内容默认折叠三行，点一下展开/收起 */
    text.addEventListener('click', function (event) {
      event.stopPropagation();
      text.classList.toggle('is-expanded');
    });

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'todo__delete';
    remove.setAttribute('aria-label', '删除「' + truncate(todo.text, 20) + '」');
    remove.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
      '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round"/></svg>';
    remove.addEventListener('click', function () { deleteTodo(todo.id); });

    row.appendChild(text);
    row.appendChild(remove);

    var meta = document.createElement('div');
    meta.className = 'todo__meta';
    meta.appendChild(buildTimeField(todo));

    body.appendChild(row);
    body.appendChild(meta);

    /* 附件：有就铺一排缩略图，点开预览，点 × 删除 */
    if (todo.attachments && todo.attachments.length) {
      var attachRow = document.createElement('div');
      attachRow.className = 'todo__attach';
      for (var ai = 0; ai < todo.attachments.length; ai++) {
        (function (att) {
          var chip = buildAttachmentChip(att, ai, true);
          chip.addEventListener('click', function (event) {
            /* closest 而不是精确比对 target：× 内部/边缘落点、字节点等都能命中 */
            var x = event.target.closest ? event.target.closest('.attach__x') : null;
            if (x && chip.contains(x)) {
              event.stopPropagation();
              removeAttachment(todo.id, att.id);
              return;
            }
            openAttachmentPreview(att);
          });
          attachRow.appendChild(chip);
        })(todo.attachments[ai]);
      }
      body.appendChild(attachRow);
    }

    li.appendChild(check);
    li.appendChild(body);
    return li;
  }

  /** 视图切换按钮上的数量徽标，为 0 时收起 */
  function setBadge(node, count) {
    if (!node) return;
    node.textContent = String(count);
    show(node, count > 0);
  }

  function renderSummary() {
    var remaining = 0;
    var done = 0;
    for (var i = 0; i < state.todos.length; i++) {
      if (state.todos[i].done) done++;
      else remaining++;
    }
    el.summaryText.textContent =
      '剩余 ' + remaining + ' 项' + (done > 0 ? ' · 已完成 ' + done + ' 项' : '');
    show(el.clearDone, done > 0);
    setBadge(el.badgeTodos, remaining);
    setBadge(el.badgeArchive, done);
  }

  function renderList() {
    el.todoList.textContent = '';
    resetCountdownCache();

    /* 已确认完成的只归「已办」，待办这边不再保留副本 */
    var pending = [];
    for (var i = 0; i < state.todos.length; i++) {
      if (!state.todos[i].done) pending.push(state.todos[i]);
    }
    applySort(pending, prefs.sort.active);

    if (pending.length === 0) {
      var doneCount = state.todos.length;
      if (el.emptyTitle) {
        el.emptyTitle.textContent = doneCount > 0 ? '待办都完成了' : '今天还没有待办';
      }
      if (el.emptyText) {
        /* 网页版在下方/上方输入框的措辞不同，默认文案就近取一次记住 */
        if (!el.emptyText.dataset.home) {
          el.emptyText.dataset.home = el.emptyText.textContent;
        }
        el.emptyText.textContent = doneCount > 0
          ? '已完成的 ' + doneCount + ' 项都收在「已办」里'
          : el.emptyText.dataset.home;
      }
      show(el.emptyState, true);
    } else {
      show(el.emptyState, false);
      var fragment = document.createDocumentFragment();
      for (var k = 0; k < pending.length; k++) {
        fragment.appendChild(createItemElement(pending[k]));
      }
      el.todoList.appendChild(fragment);
    }

    renderSummary();
    updateCountdowns(Date.now());
  }

  function itemNode(todo) {
    return el.todoList.querySelector('[data-id="' + todo.id + '"]');
  }

  /* ------------------------------------------------------------ 排序 */

  var SORT_OPTIONS = [
    { key: 'createdDesc', label: '创建时间 · 最近在前' },
    { key: 'createdAsc', label: '创建时间 · 最早在前' },
    { key: 'titleAsc', label: '标题 · A → Z' },
    { key: 'titleDesc', label: '标题 · Z → A' }
  ];

  /** 按标题排序（中文按拼音，数字按数值，忽略大小写） */
  function titleCompare(a, b) {
    return String(a.text || '').localeCompare(String(b.text || ''), 'zh-Hans-CN', {
      sensitivity: 'base', numeric: true
    });
  }

  /** 就地排序传入的数组副本 */
  function applySort(items, key) {
    var field = key === 'createdDesc' || key === 'createdAsc' ? 'createdAt' : 'text';
    var desc = key === 'createdDesc' || key === 'titleDesc';
    items.sort(function (a, b) {
      var cmp;
      if (field === 'createdAt') {
        cmp = (a.createdAt || 0) - (b.createdAt || 0);
      } else {
        cmp = titleCompare(a, b);
      }
      return desc ? -cmp : cmp;
    });
  }

  var sortTarget = 'active'; /* 当前排序弹层作用于哪个列表 */

  function openSortSheet(target) {
    sortTarget = target;
    var list = el.sortList;
    list.textContent = '';
    var current = prefs.sort[target];
    var frag = document.createDocumentFragment();
    for (var i = 0; i < SORT_OPTIONS.length; i++) {
      (function (opt) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sort-option' + (opt.key === current ? ' is-active' : '');
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-checked', opt.key === current ? 'true' : 'false');
        btn.innerHTML =
          '<span>' + opt.label + '</span>' +
          '<svg class="sort-option__tick" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
          '<path d="M5.5 12.5l4.2 4.2 8.8-9" fill="none" stroke="currentColor" stroke-width="2.4" ' +
          'stroke-linecap="round" stroke-linejoin="round"/></svg>';
        btn.addEventListener('click', function () {
          if (prefs.sort[sortTarget] === opt.key) {
            show(el.sortLayer, false);
            return;
          }
          prefs.sort[sortTarget] = opt.key;
          savePrefs();
          show(el.sortLayer, false);
          if (sortTarget === 'active') renderList();
          else renderArchive();
          toast(opt.label);
        });
        frag.appendChild(btn);
      })(SORT_OPTIONS[i]);
    }
    list.appendChild(frag);
    show(el.sortLayer, true);
  }

  function closeSortSheet() {
    show(el.sortLayer, false);
  }

  /* ------------------------------------------------------------ 功能指引 */

  var GUIDE_ITEMS = global.GuideV2 ? global.GuideV2.items : [
    { img: 'guide/01.png', title: '欢迎使用今日待办', text: '把今天要做的事，一件一件变少。' },
    { img: 'guide/02.png', title: '添加待办', text: '在输入框写下要做的，点 + 加入列表。' },
    { img: 'guide/03.png', title: '设置提醒时间', text: '给任务加上时间，到点自动弹窗提醒。' },
    { img: 'guide/04.png', title: '完成与已办', text: '打勾并确认完成，任务收进「已办」存档，可随时退回。' },
    { img: 'guide/05.png', title: '附件与手绘', text: '拍照、录音、选文件，还能随手画一张。' },
    { img: 'guide/06.png', title: '语音助手', text: '点麦克风说一句话，助手直接帮你建待办、标完成、查清单。' },
    { img: 'guide/07.png', title: '主题与头像', text: '浅色 / 深色 / 马卡龙三套主题，头像支持艺术字。' }
  ];

  /* 网页版在根目录（资源在 assets/ 下），APP 里页面就在 assets 根（资源直接相对） */
  var GUIDE_BASE = (global.TodoNative && typeof global.TodoNative.isNative === 'function' &&
    global.TodoNative.isNative()) ? '' : 'assets/';

  var guide = { index: 0, open: false };

  function renderGuide() {
    var item = GUIDE_ITEMS[guide.index];
    el.guidePager.textContent = '';
    if (global.GuideV2) {
      el.guideLayer.classList.add('guide-layer--v2');
      global.GuideV2.render(el.guidePager, item, guide.index);
    } else {
    var slide = document.createElement('div');
    slide.className = 'guide__slide';

    var img = document.createElement('img');
    img.className = 'guide__img';
    /* 网页版资源在 assets/ 下；APP 里页面就在 assets 根。加载失败自动去前缀重试 */
    img.src = GUIDE_BASE + item.img;
    img.onerror = function () {
      img.onerror = null;
      img.src = item.img;
    };
    img.alt = item.title;

    var h = document.createElement('h2');
    h.className = 'guide__title';
    h.textContent = item.title;

    var p = document.createElement('p');
    p.className = 'guide__text';
    p.textContent = item.text;

    slide.appendChild(img);
    slide.appendChild(h);
    slide.appendChild(p);
    el.guidePager.appendChild(slide);
    }

    /* 圆点 */
    el.guideDots.textContent = '';
    for (var i = 0; i < GUIDE_ITEMS.length; i++) {
      var dot = document.createElement('span');
      dot.className = 'guide__dot' + (i === guide.index ? ' is-active' : '');
      el.guideDots.appendChild(dot);
    }

    el.guideNext.textContent = guide.index === GUIDE_ITEMS.length - 1 ? '开始使用' : '下一步';
    if (el.guidePrev) el.guidePrev.disabled = guide.index === 0;
    el.guidePager.tabIndex = -1;
    el.guidePager.setAttribute('aria-label', '第 ' + (guide.index + 1) + ' 页，共 ' + GUIDE_ITEMS.length + ' 页：' + item.title);
    el.guidePager.scrollTop = 0;
    if (guide.open) el.guidePager.focus();
  }

  function openGuide(fromStart) {
    guide.returnFocus = document.activeElement;
    guide.index = fromStart ? 0 : guide.index;
    guide.open = true;
    renderGuide();
    show(el.guideLayer, true);
    el.guidePager.focus();
  }

  function finishGuide(seen) {
    guide.open = false;
    show(el.guideLayer, false);
    if (seen) {
      prefs.guideSeen = true;
      savePrefs();
    }
    var target = guide.returnFocus;
    if (!target || target === document.body || target.closest('.is-hidden')) target = el.userBtn;
    if (target && typeof target.focus === 'function') target.focus();
  }

  function guideNext() {
    if (guide.index < GUIDE_ITEMS.length - 1) {
      guide.index += 1;
      renderGuide();
    } else {
      finishGuide(true);
    }
  }

  /* 首启检查：闪屏淡出后弹出（仅手机端第一次进入主界面时） */
  function maybeShowGuideOnBoot() {
    if (!prefs.guideSeen) openGuide(true);
  }

  /** 更新某条任务的倒计时文案、配色与超时标记（每秒调用，不做结构变更） */
  /* 倒计时每秒刷新一次。以前每次都对整个列表做 querySelector（N 条 × 每秒 ×
     好几次查询，几百条时就是每秒上千次 DOM 查询），现在把节点引用缓存下来，
     并且只在文字/色调真的变了才写 DOM。列表重建时清空缓存。 */
  var countdownNodes = {};

  function resetCountdownCache() {
    countdownNodes = {};
  }

  function countdownNodeOf(todo) {
    var hit = countdownNodes[todo.id];
    /* 列表重建后旧节点会脱离容器，靠 parentNode 判断一次就够 */
    if (hit && hit.li && hit.li.parentNode === el.todoList) return hit;
    var li = itemNode(todo);
    if (!li) return null;
    var entry = {
      li: li,
      field: li.querySelector('.timefield'),
      label: li.querySelector('.timechip__text'),
      text: '',
      tone: ''
    };
    if (!entry.field || !entry.label) return null;
    countdownNodes[todo.id] = entry;
    return entry;
  }

  function paintCountdown(todo, now) {
    var entry = countdownNodeOf(todo);
    if (!entry) return;

    var info = describeCountdown(todo, now);
    if (entry.text !== info.text) {
      entry.text = info.text;
      entry.label.textContent = info.text;
    }
    if (entry.tone !== info.tone) {
      entry.tone = info.tone;
      entry.field.setAttribute('data-tone', info.tone);
      entry.li.classList.toggle('is-overdue', info.tone === 'overdue');
    }
  }

  function updateCountdowns(now) {
    for (var i = 0; i < state.todos.length; i++) {
      var todo = state.todos[i];
      /* 已完成的那条只剩一个固定时间，不需要每秒重画 */
      if (todo.dueAt && !todo.done) paintCountdown(todo, now);
    }
  }

  /** 提醒时间发生结构性变化后，同步该条任务的控件 */
  function syncItemTime(todo) {
    var li = itemNode(todo);
    if (!li) return;
    var clear = li.querySelector('.timefield__clear');
    if (clear) show(clear, !!todo.dueAt);
    paintCountdown(todo, Date.now());
  }

  function refreshItem(todo) {
    var li = itemNode(todo);
    if (!li) return;
    li.classList.toggle('is-done', todo.done);
    var check = li.querySelector('.todo__check');
    if (check) {
      check.checked = todo.done;
      check.setAttribute('aria-label', todo.done ? '退回待办' : '确认完成');
    }
    paintCountdown(todo, Date.now());
  }

  /* ------------------------------------------------------------ 已办
     手动确认完成后（勾选 + 二次确认）的任务连同完成时间一起沉淀在这里，按完成时间倒序。
     仅时间到点或超时、仅仅勾选而未确认，都不会进入这里。
     数据与待办列表同源：退回待办会从已办消失，在这里删除也会从列表移除。 */

  /** 已完成的任务，按当前排序设置排序 */
  function archiveTodos() {
    var items = state.todos.filter(function (item) { return item.done; });
    applySort(items, prefs.sort.archive);
    return items;
  }

  function selectedArchiveIds(items) {
    var ids = [];
    for (var i = 0; i < items.length; i++) {
      if (archiveSelection[items[i].id]) ids.push(items[i].id);
    }
    return ids;
  }

  function createArchiveItem(todo) {
    var li = document.createElement('li');
    li.className = 'arc' + (archiveSelection[todo.id] ? ' is-selected' : '');
    li.setAttribute('data-id', todo.id);

    var box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'arc__box';
    box.checked = !!archiveSelection[todo.id];
    box.setAttribute('aria-label', '选择「' + truncate(todo.text, 20) + '」');
    box.addEventListener('change', function () {
      setArchiveSelected(todo.id, box.checked);
    });

    var body = document.createElement('div');
    body.className = 'arc__body';

    var text = document.createElement('p');
    text.className = 'arc__text';
    text.textContent = todo.text;

    var meta = document.createElement('p');
    meta.className = 'arc__meta';

    var doneAt = document.createElement('span');
    doneAt.className = 'arc__time';
    doneAt.textContent = '完成于 ' + formatArchiveTime(todo.completedAt);
    meta.appendChild(doneAt);

    if (todo.dueAt) {
      var dueAt = document.createElement('span');
      dueAt.className = 'arc__due';
      dueAt.textContent = '原提醒 ' + (todo.dueFuzzy ? dueTextOf(todo) : formatArchiveTime(todo.dueAt));
      meta.appendChild(dueAt);
    }

    body.appendChild(text);
    body.appendChild(meta);

    var restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'arc__restore';
    restore.setAttribute('aria-label', '把「' + truncate(todo.text, 20) + '」退回待办');
    restore.innerHTML = ICON_UNDO;
    restore.addEventListener('click', function () { undoArchiveItem(todo.id); });

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'arc__delete';
    remove.setAttribute('aria-label', '删除「' + truncate(todo.text, 20) + '」');
    remove.innerHTML = ICON_TRASH;
    remove.addEventListener('click', function () { deleteArchiveItem(todo.id); });

    li.appendChild(box);
    li.appendChild(body);
    li.appendChild(restore);
    li.appendChild(remove);
    return li;
  }

  /** 把已完成的那条退回待办：从已办消失，重新出现在待办列表 */
  function undoArchiveItem(id) {
    var todo = findTodo(id);
    if (!todo || !todo.done) return;
    delete archiveSelection[id];
    if (setDone(todo, false)) {
      renderArchive();
      toast('已退回待办');
    }
  }

  /** 工具条：总数、已选数、全选三态、按钮可用状态 */
  function paintArchiveBar(items) {
    var selectedCount = selectedArchiveIds(items).length;

    el.archiveCount.textContent =
      '共 ' + items.length + ' 项' + (selectedCount > 0 ? ' · 已选 ' + selectedCount + ' 项' : '');

    el.archiveAll.checked = items.length > 0 && selectedCount === items.length;
    el.archiveAll.indeterminate = selectedCount > 0 && selectedCount < items.length;
    el.archiveAll.disabled = items.length === 0;

    el.archiveDelete.disabled = selectedCount === 0;
    el.archiveClear.disabled = items.length === 0;
    el.archiveDelete.textContent = selectedCount > 0 ? '删除所选(' + selectedCount + ')' : '删除所选';
  }

  function renderArchive() {
    if (!el.archiveList) return;

    var items = archiveTodos();

    /* 丢掉已经不在列表里的选中项，避免「删除所选」误伤 */
    var alive = {};
    for (var i = 0; i < items.length; i++) alive[items[i].id] = true;
    for (var key in archiveSelection) {
      if (Object.prototype.hasOwnProperty.call(archiveSelection, key) && !alive[key]) {
        delete archiveSelection[key];
      }
    }

    el.archiveList.textContent = '';
    var fragment = document.createDocumentFragment();
    for (var j = 0; j < items.length; j++) {
      fragment.appendChild(createArchiveItem(items[j]));
    }
    el.archiveList.appendChild(fragment);

    show(el.archiveEmpty, items.length === 0);
    paintArchiveBar(items);
    setBadge(el.badgeArchive, items.length);
  }

  /** 已办可见时才重绘，否则等切入时统一渲染 */
  function refreshArchiveIfVisible() {
    if (currentPanel === 'archive') renderArchive();
  }

  function setArchiveSelected(id, selected) {
    if (selected) archiveSelection[id] = true;
    else delete archiveSelection[id];

    var li = el.archiveList.querySelector('[data-id="' + id + '"]');
    if (li) li.classList.toggle('is-selected', !!selected);
    paintArchiveBar(archiveTodos());
  }

  function toggleArchiveAll(checked) {
    var items = archiveTodos();
    archiveSelection = {};
    if (checked) {
      for (var i = 0; i < items.length; i++) archiveSelection[items[i].id] = true;
    }
    renderArchive();
  }

  /* ------------------------------------------------------------ 删除 */

  /** 批量删除的底层操作，主列表与已办共用 */
  function removeTodosByIds(ids, message) {
    if (!ids || ids.length === 0) return false;

    var doomed = {};
    for (var i = 0; i < ids.length; i++) doomed[ids[i]] = true;

    var previous = state.todos.slice();
    state.todos = state.todos.filter(function (item) { return !doomed[item.id]; });

    if (!saveTodos()) {
      state.todos = previous;
      renderList();
      renderArchive();
      toast('删除失败，请重试');
      return false;
    }

    for (var j = 0; j < ids.length; j++) delete archiveSelection[ids[j]];
    renderList();
    renderArchive();
    if (message) toast(message);
    return true;
  }

  /** 单条删除：与主列表一致，不做二次确认，删完给一次轻提示 */
  function deleteArchiveItem(id) {
    var todo = findTodo(id);
    if (!todo || !todo.done) return;
    removeTodosByIds([id], '已删除「' + truncate(todo.text, 14) + '」');
  }

  function deleteSelectedArchive() {
    var items = archiveTodos();
    var ids = selectedArchiveIds(items);
    if (ids.length === 0) return;

    askConfirm({
      title: '删除所选记录',
      text: '将从已办中永久删除 ' + ids.length + ' 条已完成记录，删除后无法恢复。',
      okText: '删除 ' + ids.length + ' 条'
    }).then(function (choice) {
      if (choice !== 'ok') return;
      removeTodosByIds(ids, '已删除 ' + ids.length + ' 条记录');
    });
  }

  function clearArchive() {
    var items = archiveTodos();
    if (items.length === 0) return;

    var ids = items.map(function (item) { return item.id; });

    askConfirm({
      title: '清空已办',
      text: '将永久删除全部 ' + ids.length + ' 条已完成记录，删除后无法恢复。',
      okText: '全部删除'
    }).then(function (choice) {
      if (choice !== 'ok') return;
      removeTodosByIds(ids, '已办记录已清空');
    });
  }

  /* ------------------------------------------------------------ 确认弹层
     原生 confirm 在手机上样式割裂、还会阻塞页面，改成自绘弹层。 */

  /**
   * 通用确认弹层。resolve 的取值：'ok'（主按钮）、'extra'（第三个动作）、'cancel'（取消 / Esc / 点遮罩）。
   * options.tone = 'primary' 时主按钮用主色（例如「确认完成」），默认红色（删除类）。
   * options.extraText 传入文案时才会显示下方那个附加动作按钮。
   */
  function askConfirm(options) {
    return new Promise(function (resolve) {
      /* 同一时刻只允许一个确认框，旧的按「取消」处理 */
      if (confirmResolve) {
        var pending = confirmResolve;
        confirmResolve = null;
        pending('cancel');
      }
      confirmResolve = resolve;

      el.confirmTitle.textContent = options.title || '确认操作';
      el.confirmText.textContent = options.text || '';
      el.confirmOk.textContent = options.okText || '确定';
      el.confirmOk.className = 'btn ' + (options.tone === 'primary' ? 'btn--primary' : 'btn--danger');

      /* 附加动作，例如勾选待办时顺手把这条删掉 */
      el.confirmExtra.textContent = options.extraText || '';
      show(el.confirmExtra, !!options.extraText);

      show(el.confirmLayer, true);
      try {
        el.confirmOk.focus();
      } catch (error) {
        /* 忽略：聚焦失败不影响点按 */
      }
    });
  }

  function settleConfirm(result) {
    var resolve = confirmResolve;
    confirmResolve = null;
    show(el.confirmLayer, false);
    if (resolve) resolve(result);
  }

  function bindConfirmEvents() {
    el.confirmOk.addEventListener('click', function () { settleConfirm('ok'); });
    el.confirmCancel.addEventListener('click', function () { settleConfirm('cancel'); });
    el.confirmExtra.addEventListener('click', function () { settleConfirm('extra'); });
    el.confirmLayer.addEventListener('click', function (event) {
      if (event.target === el.confirmLayer) settleConfirm('cancel');
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !el.confirmLayer.classList.contains('is-hidden')) {
        settleConfirm('cancel');
      }
    });
  }

  /* ------------------------------------------------------------ 到点铃声

     手机版：交给原生用系统「闹钟」铃声播放，跟着系统铃声设置走
     （用户在系统里换铃声，这里跟着变）。
     网页版：没有系统铃声可用，用 WebAudio 合成一串短促的提示音顶上。
     ========================================================================== */

  var ringTimer = null;
  var ringCtx = null;

  function nativeRing() {
    if (!global.TodoNative || typeof global.TodoNative.ring !== 'function') return false;
    try {
      global.TodoNative.ring();
      return true;
    } catch (error) {
      return false;
    }
  }

  function nativeStopRing() {
    if (!global.TodoNative || typeof global.TodoNative.stopRing !== 'function') return;
    try {
      global.TodoNative.stopRing();
    } catch (error) {
      /* 原生不在时忽略 */
    }
  }

  /** 网页版的铃声：三声「叮—咚—叮」，不刺耳但足够听见 */
  function webChime() {
    var Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) return false;
    try {
      if (!ringCtx) ringCtx = new Ctx();
      if (ringCtx.state === 'suspended' && typeof ringCtx.resume === 'function') {
        ringCtx.resume();
      }
      var notes = [784, 1046.5, 784];
      var start = ringCtx.currentTime + 0.01;
      for (var i = 0; i < notes.length; i++) {
        var at = start + i * 0.42;
        var osc = ringCtx.createOscillator();
        var gain = ringCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(notes[i], at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);
        osc.connect(gain);
        gain.connect(ringCtx.destination);
        osc.start(at);
        osc.stop(at + 0.36);
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  function startRing() {
    if (!prefs.ring) return; /* 设置里关掉了到点响铃 */
    stopRing();
    if (nativeRing()) {
      ringTimer = global.setTimeout(nativeStopRing, RING_DURATION);
      return;
    }
    webChime();
  }

  function stopRing() {
    if (ringTimer) {
      global.clearTimeout(ringTimer);
      ringTimer = null;
    }
    nativeStopRing();
  }

  /* ------------------------------------------------------------ 提醒弹窗 */

  function showReminder(todo, offset, atOverride) {
    if (!el.reminderLayer) return;
    var remindAt = typeof atOverride === 'number' && atOverride > 0 ? atOverride : todo.dueAt;

    var card = document.createElement('div');
    var tone = REMIND_TONE[offset] || 'info';
    if (offset === DUE_OFFSET) tone = 'due';
    card.className = 'reminder reminder--' + tone;
    card.setAttribute('role', 'alert');

    var head = document.createElement('div');
    head.className = 'reminder__head';

    var badge = document.createElement('span');
    badge.className = 'reminder__badge';
    badge.textContent = offset === DUE_OFFSET
      ? '到点了'
      : '还有 ' + (REMIND_LABEL[offset] || '');

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'reminder__close';
    close.setAttribute('aria-label', '关闭提醒');
    close.innerHTML = ICON_CLOSE;

    head.appendChild(badge);
    head.appendChild(close);

    var text = document.createElement('p');
    text.className = 'reminder__text';
    text.textContent = todo.text;

    var sub = document.createElement('p');
    sub.className = 'reminder__sub';
    sub.textContent = '提醒时间 ' + formatDateTime(remindAt);

    var bar = document.createElement('div');
    bar.className = 'reminder__bar';
    bar.appendChild(document.createElement('i'));

    card.appendChild(head);
    card.appendChild(text);
    card.appendChild(sub);
    if (offset === DUE_OFFSET && todo.messagePlan) {
      var openMessage = document.createElement('button');
      openMessage.type = 'button';
      openMessage.className = 'btn btn--ghost btn--sm';
      openMessage.textContent = '查看待发消息';
      openMessage.addEventListener('click', function () {
        dismiss();
        $('open-message-workbench').click();
      });
      card.appendChild(openMessage);
    }
    card.appendChild(bar);

    var timer = null;
    function dismiss() {
      if (timer) {
        global.clearTimeout(timer);
        timer = null;
      }
      /* 卡片一关，铃声立刻停，不用等它响满 */
      if (offset === DUE_OFFSET) stopRing();
      if (!card.parentNode) return;
      card.classList.add('is-leaving');
      global.setTimeout(function () {
        if (card.parentNode) card.parentNode.removeChild(card);
      }, 200);
    }

    close.addEventListener('click', dismiss);

    el.reminderLayer.appendChild(card);

    /* 超出上限时先移除最早的一条，避免遮挡整屏 */
    while (el.reminderLayer.children.length > MAX_VISIBLE_REMINDERS) {
      el.reminderLayer.removeChild(el.reminderLayer.firstChild);
    }

    timer = global.setTimeout(dismiss, REMINDER_DURATION);

    /* 到点这一档要响铃：手机版走系统铃声，网页版走合成提示音 */
    if (offset === DUE_OFFSET) startRing();

    try {
      if (global.navigator && typeof global.navigator.vibrate === 'function') {
        global.navigator.vibrate(160);
      }
    } catch (err) {
      /* 设备不支持震动时忽略 */
    }
  }

  /* ------------------------------------------------------------ 定时检查 */

  function checkReminders(now) {
    for (var i = 0; i < state.todos.length; i++) {
      var todo = state.todos[i];
      if (todo.done) continue;

      if (todo.dueAt) {
        var remaining = Math.round((todo.dueAt - now) / 1000);
        if (remaining <= 0) {
          /* 已经到点：提前档位直接记掉不再补弹，但「到点」这一下要响一次 */
          var announceDue = !hasReminded(todo, DUE_OFFSET);
          for (var k = 0; k < REMIND_OFFSETS.length; k++) {
            if (!hasReminded(todo, REMIND_OFFSETS[k])) todo.reminded.push(REMIND_OFFSETS[k]);
          }
          if (announceDue) {
            todo.reminded.push(DUE_OFFSET);
            saveTodos();
            showReminder(todo, DUE_OFFSET);
          }
        } else {
          var hit = null;
          for (var j = 0; j < REMIND_OFFSETS.length; j++) {
            var offset = REMIND_OFFSETS[j];
            if (!hasReminded(todo, offset) && remaining <= offset) {
              todo.reminded.push(offset);
              /* 若一次跨过多个档位，只提醒最近的那一档 */
              hit = hit === null ? offset : Math.min(hit, offset);
            }
          }

          if (hit !== null) {
            saveTodos();
            showReminder(todo, hit);
          }
        }
      }

      /* 语音识别写入的额外提醒时间点：没有提前档位，到点单发一次 */
      if (todo.extraTimes && todo.extraTimes.length) {
        var firedExtra = false;
        for (var x = 0; x < todo.extraTimes.length; x++) {
          var extraAt = todo.extraTimes[x];
          if (extraAt > now) continue;
          if (todo.remindedExtra.indexOf(extraAt) !== -1) continue;
          todo.remindedExtra.push(extraAt);
          firedExtra = true;
          showReminder(todo, DUE_OFFSET, extraAt);
        }
        if (firedExtra) saveTodos();
      }
    }
  }

  function tick() {
    if (document.hidden) return;
    renderDate();
    var now = Date.now();
    updateCountdowns(now);
    checkReminders(now);
  }

  function startTicking() {
    if (tickTimer) return;
    tickTimer = global.setInterval(tick, TICK_INTERVAL);
  }

  /* ------------------------------------------------------------ 任务操作 */

  function setAddHint(message) {
    el.addHint.textContent = message || '';
  }

  function readAddTime() {
    return addDueAt;
  }

  /** 同步新增栏那个时间胶囊的文字与配色 */
  function renderAddTime() {
    if (addDueAt === null) {
      el.addTimeField.setAttribute('data-tone', 'idle');
      el.timeChipText.textContent = '设置提醒时间';
      show(el.timeClear, false);
      return;
    }
    el.addTimeField.setAttribute('data-tone', 'info');
    el.timeChipText.textContent = dueTextOf({ dueAt: addDueAt, dueFuzzy: addDueFuzzy });
    show(el.timeClear, true);
  }

  function setAddTime(timestamp, fuzzy) {
    addDueAt = timestamp === null ? null : timestamp;
    addDueFuzzy = addDueAt === null ? null : (fuzzySlot(fuzzy) ? fuzzy : null);
    renderAddTime();
    if (el.addTimeOptions) el.addTimeOptions.querySelectorAll('button[data-at]').forEach(function(b){
      b.setAttribute('aria-pressed',String(Number(b.getAttribute('data-at')) === addDueAt));
    });
  }

  function resetAddTime(keepDigits) {
    setAddTime(null, null);
    clearAddTimeSuggestions();
    if (!keepDigits) clearAddDigits();
    /* 新增栏里那个下拉还开着的话一并收起，免得清空后残留在屏幕上 */
    if (timePop.open) closeTimePick();
  }

  /**
   * 新增一条待办。
   * opts 只有语音助手会用：{ dueAt, extras, fromAssistant }
   *   dueAt / extras  助手已经解析好的时间，不再走新增栏那个手动胶囊
   *   fromAssistant   跳过「清空新增栏」这一步，别把用户正在打的草稿冲掉
   * 不传 opts 时行为和手输完全一致。
   */
  function addTodo(rawText, opts) {
    var text = String(rawText == null ? '' : rawText).trim();
    var o = opts || {};

    if (!text) {
      setAddHint('任务内容不能为空，请输入后再添加');
      if (el.newTodo) el.newTodo.focus();
      return false;
    }

    var dueAt = o.dueAt !== undefined ? (o.dueAt === null ? null : Number(o.dueAt)) : readAddTime();
    var dueFuzzy = o.dueAt !== undefined
      ? (fuzzySlot(o.fuzzy) ? o.fuzzy : null)
      : addDueFuzzy;
    /* 精确时间必须晚于此刻；模糊时段只看「这一天过完没有」——
       上午 10 点选「今天 全天」是合理的，不能因为代表时刻 09:00 已过就拒绝 */
    if (dueAt !== null) {
      if (dueFuzzy) {
        if (fuzzyEndAt({ dueAt: dueAt, dueFuzzy: dueFuzzy }) <= Date.now()) {
          setAddHint('这个时段已经过去了，换一个时间吧');
          return false;
        }
      } else if (dueAt <= Date.now()) {
        setAddHint('提醒时间需要晚于当前时间，请重新选择');
        return false;
      }
    }

    var now = Date.now();
    /* 额外提醒：助手解析出的第 2..n 个时间点，随这条任务一起存 */
    var extras = [];
    var wanted = o.extras || [];
    for (var xi = 0; xi < wanted.length; xi++) {
      var extraAt = Number(wanted[xi]);
      if (extraAt > now && extraAt !== dueAt && extras.indexOf(extraAt) === -1) {
        extras.push(extraAt);
      }
    }

    var todo = {
      id: newId(),
      text: text,
      done: false,
      dueAt: dueAt,
      dueFuzzy: dueAt === null ? null : dueFuzzy,
      reminded: [],
      extraTimes: extras,
      remindedExtra: [],
      attachments: editingAttachments.slice(),
      messagePlan: global.MessageWorkbench ? global.MessageWorkbench.cleanPlan(o.messagePlan) : null,
      createdAt: now,
      updatedAt: now
    };
    if (dueAt !== null) markPastOffsets(todo, now);

    var previous = state.todos.slice();
    state.todos.push(todo);

    if (!saveTodos()) {
      state.todos = previous;
      setAddHint('保存失败，请检查浏览器存储设置后重试');
      return false;
    }

    setAddHint('');
    /* 助手代劳的这条不是从新增栏提交的，草稿和暂存附件都留着 */
    if (!o.fromAssistant) {
      resetAddTime();
      resetEditingAttachments();
    }
    renderList();
    tick();
    return true;
  }

  /**
   * 写入 / 撤销「已完成」。这是唯一会改动 done 的入口，
   * 且只在用户手动确认之后才会以 done = true 调用。
   */
  function setDone(todo, done) {
    var previous = {
      done: todo.done,
      completedAt: todo.completedAt,
      updatedAt: todo.updatedAt
    };

    todo.done = !!done;
    /* 确认完成的当下记下完成时间，退回待办就一并撤销 */
    todo.completedAt = todo.done ? Date.now() : null;
    todo.updatedAt = Date.now();

    if (!saveTodos()) {
      todo.done = previous.done;
      todo.completedAt = previous.completedAt;
      todo.updatedAt = previous.updatedAt;
      refreshItem(todo);
      toast('保存失败，请重试');
      return false;
    }

    if (todo.done) {
      /* 收进已办：待办这边滑出消失，列表里不再留这一条 */
      var li = itemNode(todo);
      if (li) {
        li.classList.add('is-removing');
        global.setTimeout(renderList, 170);
        renderSummary();
      } else {
        renderList();
      }
    } else {
      /* 从已办退回待办，要重新出现在列表里 */
      renderList();
    }
    refreshArchiveIfVisible();
    tick();
    return true;
  }

  /**
   * 勾选复选框只表示「这件事我觉得做完了」，必须再经一次手动确认才写入已办。
   * 提醒到点、超时都只是时间到了，不代表事情办成，只有这里的确认才算数。
   */
  function toggleTodo(id) {
    var todo = findTodo(id);
    if (!todo) return;

    /* 退回待办属于撤销，不再二次确认 */
    if (todo.done) {
      if (setDone(todo, false)) toast('已退回待办');
      return;
    }

    askConfirm({
      title: '确认这件事已完成？',
      text: '确认后「' + truncate(todo.text, 24) + '」会移入已办，并记录完成时间。',
      okText: '确认完成',
      tone: 'primary',
      extraText: '删除这条待办'
    }).then(function (choice) {
      var current = findTodo(id);
      if (!current) return;

      /* 勾选的当下发现这件事不用做了，直接删掉 */
      if (choice === 'extra') {
        deleteTodo(id);
        return;
      }

      /* 弹窗还开着时这条已被确认过，只把复选框拨回真实状态 */
      if (current.done) {
        refreshItem(current);
        return;
      }

      if (choice === 'ok') {
        if (setDone(current, true)) {
          toast('「' + truncate(current.text, 14) + '」已移入已办');
        }
        return;
      }

      /* 取消（含 Esc / 点遮罩）就把勾选退回未完成 */
      refreshItem(current);
    });
  }

  function deleteTodo(id) {
    var todo = findTodo(id);
    if (!todo) return;

    var previous = state.todos.slice();
    state.todos = state.todos.filter(function (item) {
      return item.id !== id;
    });

    if (!saveTodos()) {
      state.todos = previous;
      renderList();
      toast('删除失败，请重试');
      return;
    }

    var li = itemNode(todo);
    if (li) {
      li.classList.add('is-removing');
      global.setTimeout(renderList, 170);
      renderSummary();
    } else {
      renderList();
    }
    toast('已删除「' + truncate(todo.text, 14) + '」');
  }

  function setDueAt(id, dueAt, fuzzy) {
    var todo = findTodo(id);
    if (!todo) return;

    var slot = fuzzySlot(fuzzy);
    if (dueAt !== null && !slot && dueAt <= Date.now()) {
      syncItemTime(todo);
      toast('提醒时间需要晚于当前时间');
      return;
    }
    if (slot && dueAt !== null && fuzzyEndAt({ dueAt: dueAt, dueFuzzy: slot.key }) <= Date.now()) {
      syncItemTime(todo);
      toast('这一段时间已经过完了，换一个时段吧');
      return;
    }

    var previous = { dueAt: todo.dueAt, dueFuzzy: todo.dueFuzzy, reminded: todo.reminded.slice(),
      extraTimes:todo.extraTimes.slice(), remindedExtra:todo.remindedExtra.slice(), updatedAt:todo.updatedAt };
    todo.dueAt = dueAt;
    todo.dueFuzzy = dueAt === null ? null : (slot ? slot.key : null);
    todo.reminded = [];
    if (dueAt === null) {todo.extraTimes=[];todo.remindedExtra=[];}
    todo.updatedAt = Date.now();
    if (dueAt !== null) markPastOffsets(todo, Date.now());

    if (!saveTodos()) {
      todo.dueAt = previous.dueAt;
      todo.dueFuzzy = previous.dueFuzzy;
      todo.reminded = previous.reminded;
      todo.extraTimes=previous.extraTimes;todo.remindedExtra=previous.remindedExtra;todo.updatedAt=previous.updatedAt;
      syncItemTime(todo);
      toast('保存失败，请重试');
      return;
    }

    syncItemTime(todo);
    toast(dueAt === null
      ? '已清除提醒时间'
      : '提醒时间已设为 ' + dueTextOf({ dueAt: dueAt, dueFuzzy: todo.dueFuzzy }));
  }

  function clearCompleted() {
    var doneCount = state.todos.filter(function (item) { return item.done; }).length;
    if (doneCount === 0) return;

    askConfirm({
      title: '清除已完成',
      text: '将删除 ' + doneCount + ' 项已完成任务（已办里的记录也会一并移除），删除后无法恢复。',
      okText: '清除 ' + doneCount + ' 项'
    }).then(function (choice) {
      if (choice !== 'ok') return;
      var ids = state.todos
        .filter(function (item) { return item.done; })
        .map(function (item) { return item.id; });
      removeTodosByIds(ids, '已清除 ' + ids.length + ' 项已完成任务');
    });
  }

  /* ------------------------------------------------------------ 视图切换 */

  function switchPanel(which) {
    var view = which === 'archive' ? 'archive' : (which === 'memos' ? 'memos' : 'todos');
    currentPanel = view;
    var toArchive = view === 'archive';
    var toMemos = view === 'memos';

    el.tabTodos.classList.toggle('is-active', view === 'todos');
    el.tabTodos.setAttribute('aria-selected', String(view === 'todos'));
    if (el.tabArchive) {
      el.tabArchive.classList.toggle('is-active', toArchive);
      el.tabArchive.setAttribute('aria-selected', String(toArchive));
    }
    if (el.tabMemos) {
      el.tabMemos.classList.toggle('is-active', toMemos);
      el.tabMemos.setAttribute('aria-selected', String(toMemos));
    }

    show(el.panelTodos, view === 'todos');
    show(el.panelArchive, toArchive);
    if (el.panelMemos) show(el.panelMemos, toMemos);

    if (toArchive) renderArchive();
    if (toMemos) renderMemoList();
  }

  /** 退出登录 / 换账号时把已办的选中状态清干净 */
  function resetArchiveView() {
    archiveSelection = {};
    if (confirmResolve) settleConfirm('cancel');
    if (el.archiveList) el.archiveList.textContent = '';
    switchPanel('todos');
  }

  function closeUserMenu() {
    show(el.userMenu, false);
    el.userBtn.setAttribute('aria-expanded', 'false');
  }

  function showAuthView() {
    closeUserMenu();
    /* 换账号时把上一个人的笔记从屏幕上清掉 */
    resetMemoView();
    show(el.viewTodo, false);
    show(el.viewAuth, true);
    document.title = '今日待办 · 登录';
  }

  function clearReminders() {
    stopRing();
    if (el.reminderLayer) el.reminderLayer.textContent = '';
  }

  function enterApp(user) {
    state.user = user;
    loadTodos();

    /* 打开页面时先把已经错过的提醒档位标记掉，避免弹窗刷屏 */
    var now = Date.now();
    var changed = false;
    for (var i = 0; i < state.todos.length; i++) {
      if (markPastOffsets(state.todos[i], now)) changed = true;
    }
    if (changed) saveTodos();

    el.userName.textContent = user.name;
    loadAvatar();
    paintAvatar();

    setAddHint('');
    el.newTodo.value = '';
    resetAddTime();
    renderDate();
    renderList();
    resetArchiveView();
    renderMemoList();

    show(el.viewAuth, false);
    show(el.viewTodo, true);
    document.title = '今日待办';

    startTicking();
    tick();
    syncNative();

    /* 首次使用：进入主界面后弹一次功能指引 */
    global.setTimeout(maybeShowGuideOnBoot, 350);
  }

  /* ------------------------------------------------------------ 头像

     点头像就能换：可以从手机相册选，也可以直接用内置的 70 张
     （人物 / 彩色动物 / 自然风景，来自资料库 本地资料库）。
     存的是图片地址而不是整张原图：内置的用相对路径，相册选的压到 256px 再存。
     ========================================================================== */

  var AVATAR_EDGE = 256;
  var avatarInput = null; /* 网页版选文件用的隐藏 input，用时才建 */

  function avatarKey() {
    return 'avatar:' + (state.user ? state.user.key : 'anon');
  }

  function loadAvatar() {
    var raw = Store.read(avatarKey(), '');
    state.avatar = typeof raw === 'string' ? raw : '';
  }

  function paintAvatar() {
    var node = el.userAvatar;
    var src = state.avatar;
    var initial = state.user ? String(state.user.name || '').slice(0, 1) : '·';

    if (node) {
      if (src) {
        node.classList.add('has-image');
        node.style.backgroundImage = 'url("' + src + '")';
        node.textContent = '';
      } else {
        node.classList.remove('has-image');
        node.style.backgroundImage = '';
        node.textContent = initial;
      }
    }
    paintAvatarPreview();
  }

  function paintAvatarPreview() {
    var node = el.avatarPreview;
    if (!node) return;
    var initial = state.user ? String(state.user.name || '').slice(0, 1) : '·';
    if (state.avatar) {
      node.classList.add('has-image');
      node.style.backgroundImage = 'url("' + state.avatar + '")';
      node.textContent = '';
    } else {
      node.classList.remove('has-image');
      node.style.backgroundImage = '';
      node.textContent = initial;
    }
  }

  function applyAvatar(src) {
    state.avatar = src || '';
    if (state.avatar) Store.write(avatarKey(), state.avatar);
    else Store.remove(avatarKey());
    paintAvatar();
    markActiveAvatar();
  }

  /** 把内置头像里的当前选中那张描个边 */
  function markActiveAvatar() {
    if (el.avatarGroups) {
      var cells = el.avatarGroups.querySelectorAll('.avatar-cell');
      for (var i = 0; i < cells.length; i++) {
        var same = !!state.avatar && cells[i].getAttribute('data-src') === state.avatar;
        cells[i].classList.toggle('is-active', same);
      }
    }
    show(el.avatarRemove, !!state.avatar);
  }

  function openAvatarSheet() {
    if (!el.avatarLayer) return;
    closeUserMenu();
    renderAvatarGroups();
    paintAvatarPreview();
    markActiveAvatar();
    show(el.avatarLayer, true);
  }

  function closeAvatarSheet() {
    show(el.avatarLayer, false);
  }

  /** 内置头像按分类铺开，只建一次，之后只改选中态 */
  function renderAvatarGroups() {
    var box = el.avatarGroups;
    if (!box || box.getAttribute('data-built') === '1') return;

    var groups = global.AVATAR_PRESETS || [];
    for (var g = 0; g < groups.length; g++) {
      var group = groups[g] || {};

      var title = document.createElement('p');
      title.className = 'avatar-group__name';
      title.textContent = group.group || '';
      box.appendChild(title);

      var grid = document.createElement('div');
      grid.className = 'avatar-grid';

      var items = group.items || [];
      for (var i = 0; i < items.length; i++) {
        grid.appendChild(buildAvatarCell(items[i]));
      }
      box.appendChild(grid);
    }

    box.setAttribute('data-built', '1');
  }

  function buildAvatarCell(item) {
    var cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'avatar-cell';
    cell.setAttribute('data-src', item.src);
    cell.setAttribute('aria-label', '使用头像：' + (item.label || ''));
    cell.title = item.label || '';
    cell.style.backgroundImage = 'url("' + item.src + '")';
    cell.addEventListener('click', function () {
      applyAvatar(item.src);
      toast('头像已更新');
    });
    return cell;
  }

  /** 相册选图：手机版走原生相册（拿回一张原图），网页版用 file input；回来都进裁切界面 */
  function pickAvatarFromGallery() {
    if (global.TodoNative && typeof global.TodoNative.pickAvatar === 'function') {
      try {
        if (global.TodoNative.pickAvatar()) return;
      } catch (error) {
        /* 落到下面的网页版路径 */
      }
    }

    if (!avatarInput) {
      avatarInput = document.createElement('input');
      avatarInput.type = 'file';
      avatarInput.accept = 'image/*';
      avatarInput.style.position = 'fixed';
      avatarInput.style.left = '-9999px';
      avatarInput.addEventListener('change', function () {
        var file = avatarInput.files && avatarInput.files[0];
        avatarInput.value = '';
        if (file) fileToAvatar(file);
      });
      document.body.appendChild(avatarInput);
    }
    avatarInput.click();
  }

  function fileToAvatar(file) {
    var reader = new FileReader();
    reader.onload = function () {
      openCropper(String(reader.result || ''));
    };
    reader.onerror = function () {
      toast('读取图片失败');
    };
    reader.readAsDataURL(file);
  }

  /* ---------------------------------------------------------- 圆形裁切

     选完图不直接截中间一刀，而是给一个可拖可缩的圆框：
     圆形遮罩里看到的就是头像最终的样子（正方形裁出来，圆形容器本来就只露内切圆）。
     ========================================================================== */

  var crop = { base: 1, zoom: 1, tx: 0, ty: 0, ready: false, pointers: {}, pinch: 0, pinchZoom: 1 };
  var CROP_ZOOM_MAX = 3.2;

  function openCropper(src) {
    if (!el.cropLayer || !el.cropImg) return;
    if (typeof src !== 'string' || src.indexOf('data:image/') !== 0) {
      toast('这张图片用不了，换一张试试');
      return;
    }

    crop.ready = false;
    crop.pointers = {};
    el.cropImg.onload = function () {
      crop.ready = true;
      resetCropLayout();
    };
    el.cropImg.onerror = function () {
      toast('这张图片打不开，换一张试试');
      closeCropper();
    };
    el.cropImg.src = src;
    if (el.cropZoom) el.cropZoom.value = '100';
    show(el.cropLayer, true);
  }

  function closeCropper() {
    show(el.cropLayer, false);
    crop.ready = false;
    crop.pointers = {};
    if (el.cropImg) el.cropImg.removeAttribute('src');
  }

  function stageSize() {
    if (!el.cropStage) return 280;
    var rect = el.cropStage.getBoundingClientRect();
    return rect.width || 280;
  }

  function resetCropLayout() {
    var img = el.cropImg;
    var nw = img.naturalWidth;
    var nh = img.naturalHeight;
    if (!nw || !nh) return;

    var stage = stageSize();
    /* cover：先让图把整个方形舞台铺满，用户再往里推 */
    crop.base = Math.max(stage / nw, stage / nh);
    crop.zoom = 1;
    crop.tx = (stage - nw * crop.base) / 2;
    crop.ty = (stage - nh * crop.base) / 2;
    paintCrop();
  }

  function paintCrop() {
    var img = el.cropImg;
    if (!img || !crop.ready) return;

    var stage = stageSize();
    var w = img.naturalWidth * crop.base * crop.zoom;
    var h = img.naturalHeight * crop.base * crop.zoom;

    /* 图不能比舞台小，否则会露出黑边 */
    crop.tx = Math.min(0, Math.max(stage - w, crop.tx));
    crop.ty = Math.min(0, Math.max(stage - h, crop.ty));

    img.style.width = w + 'px';
    img.style.height = h + 'px';
    img.style.transform = 'translate(' + crop.tx + 'px,' + crop.ty + 'px)';
  }

  /** 以舞台中心为锚点缩放 */
  function setCropZoom(next) {
    if (!crop.ready) return;
    var zoom = Math.max(1, Math.min(CROP_ZOOM_MAX, next));
    var stage = stageSize();
    var center = stage / 2;
    var k = zoom / crop.zoom;

    crop.tx = center - (center - crop.tx) * k;
    crop.ty = center - (center - crop.ty) * k;
    crop.zoom = zoom;
    paintCrop();
    trimCropStage();
  }

  /** 逻辑舞台尺寸和 CSS 尺寸可能被 max-width 收窄，这里只做一次对齐 */
  function trimCropStage() {
    if (!el.cropStage) return;
    var stage = stageSize();
    el.cropStage.setAttribute('data-size', String(Math.round(stage)));
  }

  /** 拖动 / 双指捏合 / 滚轮缩放，都作用在裁切舞台上 */
  function bindCropGestures() {
    var stage = el.cropStage;
    if (!stage) return;

    var dragging = false;
    var startX = 0;
    var startY = 0;
    var startTx = 0;
    var startTy = 0;

    function count() {
      var n = 0;
      for (var key in crop.pointers) {
        if (Object.prototype.hasOwnProperty.call(crop.pointers, key)) n++;
      }
      return n;
    }

    function spread() {
      var list = [];
      for (var key in crop.pointers) {
        if (Object.prototype.hasOwnProperty.call(crop.pointers, key)) list.push(crop.pointers[key]);
      }
      if (list.length < 2) return 0;
      var dx = list[0].x - list[1].x;
      var dy = list[0].y - list[1].y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function syncSlider() {
      if (el.cropZoom) el.cropZoom.value = String(Math.round(crop.zoom * 100));
    }

    stage.addEventListener('pointerdown', function (event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (!crop.ready) return;

      crop.pointers[event.pointerId] = { x: event.clientX, y: event.clientY };

      if (count() >= 2) {
        dragging = false;
        crop.pinch = spread();
        crop.pinchZoom = crop.zoom;
      } else {
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        startTx = crop.tx;
        startTy = crop.ty;
      }

      if (typeof stage.setPointerCapture === 'function') {
        try { stage.setPointerCapture(event.pointerId); } catch (error) { /* 忽略 */ }
      }
      event.preventDefault();
    });

    stage.addEventListener('pointermove', function (event) {
      if (!crop.pointers[event.pointerId]) return;
      crop.pointers[event.pointerId] = { x: event.clientX, y: event.clientY };

      if (count() >= 2) {
        var dist = spread();
        if (crop.pinch > 0 && dist > 0) {
          setCropZoom(crop.pinchZoom * (dist / crop.pinch));
          syncSlider();
        }
        event.preventDefault();
        return;
      }

      if (!dragging) return;
      crop.tx = startTx + (event.clientX - startX);
      crop.ty = startTy + (event.clientY - startY);
      paintCrop();
      event.preventDefault();
    });

    function endPointer(event) {
      delete crop.pointers[event.pointerId];
      if (count() < 2) crop.pinch = 0;
      if (count() === 0) dragging = false;
    }

    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', endPointer);
    stage.addEventListener('pointerleave', endPointer);

    stage.addEventListener('wheel', function (event) {
      if (!crop.ready) return;
      event.preventDefault();
      setCropZoom(crop.zoom * (event.deltaY < 0 ? 1.08 : 0.92));
      syncSlider();
    }, { passive: false });
  }

  function confirmCrop() {
    var img = el.cropImg;
    if (!img || !crop.ready || !img.naturalWidth) return;

    var stage = stageSize();
    var k = crop.base * crop.zoom;
    var source = stage / k;
    var sx = (0 - crop.tx) / k;
    var sy = (0 - crop.ty) / k;

    var canvas = document.createElement('canvas');
    canvas.width = AVATAR_EDGE;
    canvas.height = AVATAR_EDGE;
    var ctx = canvas.getContext('2d');
    if (!ctx) {
      toast('裁切失败，换一张试试');
      return;
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, AVATAR_EDGE, AVATAR_EDGE);

    var dataUrl = '';
    try {
      ctx.drawImage(img, sx, sy, source, source, 0, 0, AVATAR_EDGE, AVATAR_EDGE);
      dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    } catch (error) {
      dataUrl = '';
    }
    if (!dataUrl) {
      toast('裁切失败，换一张试试');
      return;
    }

    applyAvatar(dataUrl);
    closeCropper();
    closeAvatarSheet();
    toast('头像已更新');
  }

  /* 原生选完图从这里回调（data:image/jpeg;base64,... 的原图） */
  global.AvatarHost = {
    picked: function (dataUrl) {
      if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:image/') !== 0) {
        toast('这张图片用不了，换一张试试');
        return;
      }
      openCropper(dataUrl);
    },
    cancelled: function () {
      /* 用户取消了，什么也不用做 */
    }
  };

  /* ---------------------------------------------------------- 文字头像
     用户输入文字 → 用内置艺术字体（霞鹜文楷）渲染成圆形头像。
     支持单字 / 多字自适应，多彩渐变底 / 纯色底可切换。
     ========================================================================== */

  var ART_FONT = 'lxgw-wenkai'; /* 对应 @font-face 的 family，缺字时浏览器自动回退系统字体 */
  var ART_FONT_URL = 'fonts/lxgw-wenkai.woff2';
  var ART_FONT_ORACLE = 'FZJiaGuWen'; /* 方正甲骨文（unicode-range 分片按需加载） */
  var artFontLoaded = false;
  var oracleFontLoaded = false;

  /* 字体族栈：甲骨文缺字时自动回退楷体（canvas 的 font 栈同样逐字 fallback） */
  function artFontFamily(mode) {
    if (mode === 'oracle') {
      return '"' + ART_FONT_ORACLE + '", "' + ART_FONT + '", "STKaiti", "KaiTi", sans-serif';
    }
    return '"' + ART_FONT + '", "STKaiti", "KaiTi", "PingFang SC", "Microsoft YaHei", sans-serif';
  }

  /* 多彩渐变底（每组 [起色, 止色, 文字色]） */
  var ART_GRADIENTS = [
    ['#ff9a9e', '#fecfef', '#ffffff'],
    ['#a18cd1', '#fbc2eb', '#ffffff'],
    ['#fbc2eb', '#a6c1ee', '#ffffff'],
    ['#84fab0', '#8fd3f4', '#1c3a4a'],
    ['#f6d365', '#fda085', '#ffffff'],
    ['#667eea', '#764ba2', '#ffffff'],
    ['#ffecd2', '#fcb69f', '#7a4a3a'],
    ['#5ee7df', '#b490ca', '#ffffff']
  ];

  /* 纯色底（每组 [背景色, 文字色]） */
  var ART_SOLIDS = [
    ['#f55b23', '#ffffff'],
    ['#e74c3c', '#ffffff'],
    ['#2ecc71', '#ffffff'],
    ['#f39c12', '#ffffff'],
    ['#9b59b6', '#ffffff'],
    ['#34495e', '#ffffff'],
    ['#fdf6f2', '#dd7f86'],
    ['#1abc9c', '#ffffff']
  ];

  var textAvatar = { text: '', font: 'kai', bgType: 'gradient', bgIndex: 0, fontLoaded: false };

  /* 预加载艺术字体（WebView 里异步，首次渲染时可能还没好，用系统字体先顶着） */
  function preloadArtFont() {
    if (document.fonts && typeof document.fonts.load === 'function') {
      if (!artFontLoaded) {
        try {
          document.fonts.load('28px "' + ART_FONT + '"', '你好世界').then(function () {
            artFontLoaded = true;
          }).catch(function () { /* 忽略，fallback 系统字体 */ });
        } catch (error) { /* 忽略 */ }
      }
      if (!oracleFontLoaded) {
        try {
          document.fonts.load('28px "' + ART_FONT_ORACLE + '"', '你好世界').then(function () {
            oracleFontLoaded = true;
          }).catch(function () { /* 忽略，缺字回退楷体 */ });
        } catch (error) { /* 忽略 */ }
      }
    }
  }

  /** 把文字渲染成 256px 圆形头像 dataURL */
  function renderTextAvatar(text, bgType, bgIndex) {
    var canvas = document.createElement('canvas');
    canvas.width = AVATAR_EDGE;
    canvas.height = AVATAR_EDGE;
    var ctx = canvas.getContext('2d');
    if (!ctx) return '';

    /* 圆形裁剪 */
    ctx.save();
    ctx.beginPath();
    ctx.arc(AVATAR_EDGE / 2, AVATAR_EDGE / 2, AVATAR_EDGE / 2, 0, Math.PI * 2);
    ctx.clip();

    var textColor = '#ffffff';
    if (bgType === 'solid') {
      var s = ART_SOLIDS[bgIndex % ART_SOLIDS.length] || ART_SOLIDS[0];
      ctx.fillStyle = s[0];
      ctx.fillRect(0, 0, AVATAR_EDGE, AVATAR_EDGE);
      textColor = s[1];
    } else {
      var g = ART_GRADIENTS[bgIndex % ART_GRADIENTS.length] || ART_GRADIENTS[0];
      var grad = ctx.createLinearGradient(0, 0, AVATAR_EDGE, AVATAR_EDGE);
      grad.addColorStop(0, g[0]);
      grad.addColorStop(1, g[1]);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, AVATAR_EDGE, AVATAR_EDGE);
      textColor = g[2];
    }

    /* 文字：单字放大，多字按字数缩放，保证居中且不溢出 */
    var t = String(text || '').trim();
    var chars = Array.from(t); /* 正确处理 emoji / 生僻字 */
    if (chars.length === 0) {
      ctx.restore();
      return '';
    }

    var fontSize;
    if (chars.length === 1) {
      fontSize = AVATAR_EDGE * 0.62;
    } else if (chars.length === 2) {
      fontSize = AVATAR_EDGE * 0.46;
    } else if (chars.length === 3) {
      fontSize = AVATAR_EDGE * 0.38;
    } else {
      fontSize = AVATAR_EDGE * 0.30;
      if (chars.length > 6) chars.length = 6; /* 最多取前 6 个字 */
      t = chars.join('');
    }

    var family = artFontFamily(textAvatar.font);
    ctx.font = fontSize + 'px ' + family;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    /* 轻微投影让字更立体（艺术感） */
    ctx.shadowColor = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = textColor;
    ctx.fillText(t, AVATAR_EDGE / 2, AVATAR_EDGE / 2 + 2);

    ctx.restore();

    /* 必须用 PNG：圆形裁剪之外是透明区，存成 JPEG 会被填成黑色，
       戴到 28px 的小圆头像上就是一块黑边 / 看着像没设置成功 */
    try {
      return canvas.toDataURL('image/png');
    } catch (error) {
      return '';
    }
  }

  /** 字体是异步加载的：等这份字体的目标文字就绪后再重绘一次，避免首帧回落成系统字体 */
  function repaintTextAvatarAfterFont() {
    var text = textAvatar.text;
    if (!text) return;
    if (!document.fonts || typeof document.fonts.load !== 'function') return;
    var family = textAvatar.font === 'oracle' ? ART_FONT_ORACLE : ART_FONT;
    try {
      document.fonts.load('32px "' + family + '"', text).then(function () {
        /* 期间用户可能又改了字，只有没变才重绘 */
        if (textAvatar.text === text) paintTextAvatarPreview();
      }).catch(function () { /* 缺字回退系统字体，忽略 */ });
    } catch (error) { /* 忽略 */ }
  }

  /** 打开文字头像弹层 */
  function openTextAvatar() {
    if (!el.textAvatarLayer) return;
    preloadArtFont();
    renderTextBgOptions();
    markTextBgActive();
    if (el.textAvatarInput) {
      el.textAvatarInput.value = '';
      el.textAvatarInput.focus();
    }
    textAvatar.text = '';
    paintTextAvatarPreview();
    show(el.textAvatarLayer, true);
  }

  function closeTextAvatar() {
    show(el.textAvatarLayer, false);
  }

  /** 实时预览：读当前输入 + 选中的字体/背景，重绘预览 */
  function paintTextAvatarPreview() {
    var preview = el.textAvatarPreview;
    if (!preview) return;
    var dataUrl = renderTextAvatar(textAvatar.text, textAvatar.bgType, textAvatar.bgIndex);
    if (dataUrl) {
      preview.classList.add('has-image');
      preview.style.backgroundImage = 'url("' + dataUrl + '")';
      preview.textContent = '';
    } else {
      preview.classList.remove('has-image');
      preview.style.backgroundImage = '';
      preview.textContent = '字';
    }
  }

  /** 确认：把当前预览作为头像写入 */
  function confirmTextAvatar() {
    var t = textAvatar.text.trim();
    if (!t) {
      toast('先输入一两个字吧');
      return;
    }
    var dataUrl = renderTextAvatar(t, textAvatar.bgType, textAvatar.bgIndex);
    if (!dataUrl) {
      toast('生成失败，换个字试试');
      return;
    }
    applyAvatar(dataUrl);
    closeTextAvatar();
    closeAvatarSheet();
    toast('头像已更新');
  }

  /** 背景选择器：铺渐变/纯色两组小圆点 */
  function renderTextBgOptions() {
    var gradBox = el.textAvatarGradients;
    var solidBox = el.textAvatarSolids;
    if (!gradBox || gradBox.getAttribute('data-built') === '1') return;

    var i;
    for (i = 0; i < ART_GRADIENTS.length; i++) {
      gradBox.appendChild(buildTextBgSwatch('gradient', i));
    }
    for (i = 0; i < ART_SOLIDS.length; i++) {
      solidBox.appendChild(buildTextBgSwatch('solid', i));
    }
    gradBox.setAttribute('data-built', '1');
  }

  function buildTextBgSwatch(type, index) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'txtav__swatch';
    b.setAttribute('data-type', type);
    b.setAttribute('data-index', String(index));
    if (type === 'gradient') {
      var g = ART_GRADIENTS[index];
      b.style.background = 'linear-gradient(135deg, ' + g[0] + ', ' + g[1] + ')';
    } else {
      b.style.background = ART_SOLIDS[index][0];
    }
    b.setAttribute('aria-label', (type === 'gradient' ? '渐变底' : '纯色底') + (index + 1));
    return b;
  }

  function setTextAvatarBg(type, index) {
    textAvatar.bgType = type;
    textAvatar.bgIndex = index;
    markTextBgActive();
    paintTextAvatarPreview();
  }

  function markTextBgActive() {
    var boxes = [el.textAvatarGradients, el.textAvatarSolids];
    for (var b = 0; b < boxes.length; b++) {
      var swatches = boxes[b] ? boxes[b].querySelectorAll('.txtav__swatch') : [];
      for (var i = 0; i < swatches.length; i++) {
        var active = swatches[i].getAttribute('data-type') === textAvatar.bgType &&
          Number(swatches[i].getAttribute('data-index')) === textAvatar.bgIndex;
        swatches[i].classList.toggle('is-active', active);
      }
    }
  }

  /* ------------------------------------------------------------ 设置（铃声） */

  var PREFS_KEY = 'prefs';

  function loadPrefs() {
    var raw = Store.read(PREFS_KEY, null);
    if (raw && typeof raw === 'object') {
      if (typeof raw.ring === 'boolean') prefs.ring = raw.ring;
      if (raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'macaron') {
        prefs.theme = raw.theme;
      }
      if (raw.sort && typeof raw.sort === 'object') {
        if (raw.sort.active) prefs.sort.active = raw.sort.active;
        if (raw.sort.archive) prefs.sort.archive = raw.sort.archive;
      }
      if (typeof raw.guideSeen === 'boolean') prefs.guideSeen = raw.guideSeen;
      if (raw.dictate && typeof raw.dictate === 'object') {
        if (typeof raw.dictate.endpoint === 'string' && raw.dictate.endpoint) {
          prefs.dictate.endpoint = raw.dictate.endpoint;
        }
        if (typeof raw.dictate.model === 'string' && raw.dictate.model) {
          prefs.dictate.model = raw.dictate.model;
        }
        if (typeof raw.dictate.key === 'string') prefs.dictate.key = raw.dictate.key;
      }
      if (['local', 'llm', 'ollama'].indexOf(raw.voiceEngine) >= 0) {
        prefs.voiceEngine = raw.voiceEngine;
      }
      prefs.voiceTodoMode = raw.voiceTodoMode === 'realtime' ? 'realtime' : 'dict';
      prefs.voiceMemoMode = raw.voiceMemoMode === 'dict' ? 'dict' : 'realtime';
      prefs.voiceNames = normalizeVoiceNames(raw.voiceNames);
      if (raw.llmModels && Object.prototype.toString.call(raw.llmModels) === '[object Array]') {
        for (var mi = 0; mi < raw.llmModels.length; mi++) {
          var stored = normalizeStoredModel(raw.llmModels[mi]);
          if (stored) prefs.llmModels.push(stored);
        }
      }
      if (typeof raw.llmActiveId === 'string') prefs.llmActiveId = raw.llmActiveId;
      if (raw.llmRoute === 'manual' || raw.llmRoute === 'auto') prefs.llmRoute = raw.llmRoute;
      if (raw.llmCatalog && raw.llmCatalog.providers) prefs.llmCatalog = raw.llmCatalog;
      if (raw.llmCatalogPrev && raw.llmCatalogPrev.providers) prefs.llmCatalogPrev = raw.llmCatalogPrev;
      if (typeof raw.aiMaskPii === 'boolean') prefs.aiMaskPii = raw.aiMaskPii;

      /* 旧版只有一份配置：搬过来当第一份档案，用户不用重填 */
      if (!prefs.llmModels.length && raw.llm && typeof raw.llm === 'object' && raw.llm.endpoint) {
        var legacy = normalizeStoredModel({
          name: raw.llm.model || '默认模型',
          endpoint: raw.llm.endpoint,
          model: raw.llm.model,
          key: raw.llm.key
        });
        if (legacy) {
          prefs.llmModels.push(legacy);
          if (!prefs.llmActiveId) prefs.llmActiveId = legacy.id;
        }
      }
    }
  }

  /**
   * 密钥搬家：把老的明文密钥挪进安全仓库，页面只剩引用。
   *
   * 顺序上必须先搬到再删：`vault.put` 成功才清掉明文，任何一步失败都保留原样
   * （宁可维持旧状态，也不能让用户存过的密钥凭空消失）。
   */
  function secureKeys() {
    var vault = global.KeyVault;
    if (!vault || typeof vault.put !== 'function' || !vault.available()) return 0;

    var moved = 0;
    for (var i = 0; i < prefs.llmModels.length; i++) {
      var m = prefs.llmModels[i];
      if (!m) continue;

      /* 已有引用但内存里没明文：读回来，保证本次会话能直接发请求 */
      if (!m.key && m.keyRef) {
        var loaded = vault.get(m.keyRef);
        if (loaded) m.key = loaded;
        continue;
      }
      /* 有明文没引用：加密存一份，拿到引用后清掉明文 */
      if (m.key && !m.keyRef && vault.looksLikeSecret(m.key)) {
        var ref = vault.newRef();
        if (vault.put(ref, m.key)) {
          m.keyRef = ref;
          m.key = '';   /* 内存里也不留，取用时再向仓库要 */
          moved += 1;
        }
      }
    }
    if (moved > 0) savePrefs();
    return moved;
  }

  /** 密钥现在到底放在哪：给设置页说人话用 */
  function keyStorageMode() {
    var vault = global.KeyVault;
    if (!vault) return 'unknown';
    return vault.mode ? vault.mode() : 'plain';
  }

  function savePrefs() {
    syncNativeRingPreference();
    var models = [];
    var secure = keyStorageMode() === 'keystore';
    for (var i = 0; i < prefs.llmModels.length; i++) {
      var m = prefs.llmModels[i];
      models.push({
        id: m.id, name: m.name, endpoint: m.endpoint, model: m.model,
        /* 有安全仓库就只写引用；网页版没有 Keystore，只能照旧把明文放进去 */
        key: secure ? '' : m.key,
        keyRef: m.keyRef || '',
        tempFixed: m.tempFixed === true,
        caps: copyCaps(m.caps), probe: m.probe || null
      });
    }
    Store.write(PREFS_KEY, {
      ring: !!prefs.ring,
      theme: prefs.theme || '',
      sort: { active: prefs.sort.active, archive: prefs.sort.archive },
      guideSeen: !!prefs.guideSeen,
      voiceEngine: ['local', 'llm', 'ollama'].indexOf(prefs.voiceEngine) >= 0 ? prefs.voiceEngine : 'local',
      voiceTodoMode: prefs.voiceTodoMode === 'realtime' ? 'realtime' : 'dict',
      voiceMemoMode: prefs.voiceMemoMode === 'dict' ? 'dict' : 'realtime',
      voiceNames: prefs.voiceNames || '',
      llmModels: models,
      llmActiveId: prefs.llmActiveId || '',
      llmRoute: prefs.llmRoute === 'manual' ? 'manual' : 'auto',
      llmCatalog: prefs.llmCatalog || null,
      llmCatalogPrev: prefs.llmCatalogPrev || null,
      aiMaskPii: prefs.aiMaskPii !== false,
      dictate: {
        endpoint: prefs.dictate.endpoint || '',
        model: prefs.dictate.model || '',
        key: prefs.dictate.key || ''
      }
    });
  }

  function nativeRingApi() {
    var api = global.TodoNative;
    return api && typeof api.ringtones === 'function' ? api : null;
  }

  function currentRingtoneName() {
    var api = nativeRingApi();
    if (!api) return '';
    try {
      return String(api.ringtoneName() || '');
    } catch (error) {
      return '';
    }
  }

  function syncSettingsRows() {
    syncNativeRingPreference();
    if (el.ringToggle) {
      el.ringToggle.setAttribute('aria-checked', prefs.ring ? 'true' : 'false');
    }
    syncThemePicker();
    syncVoiceEnginePick();
    if (el.voiceNames) el.voiceNames.value = prefs.voiceNames || '';
    syncBatteryRow();
    syncAutoStartRow();
    renderAiUsage();
    if (!el.ringValue) return;

    if (!nativeRingApi()) {
      el.ringValue.textContent = '网页版使用内置提示音';
      if (el.ringRow) {
        el.ringRow.disabled = true;
        el.ringRow.classList.add('is-disabled');
      }
      if (el.settingsFoot) {
        el.settingsFoot.textContent =
          '网页版的提示音是内置合成的，手机版才能选系统自带铃声。';
      }
      return;
    }

    if (el.ringRow) {
      el.ringRow.disabled = false;
      el.ringRow.classList.remove('is-disabled');
    }
    el.ringValue.textContent = currentRingtoneName() || '跟随系统默认';
  }

  function openSettings() {
    closeUserMenu();
    syncSettingsRows();
    show(el.settingsLayer, true);
  }

  function closeSettings() {
    show(el.settingsLayer, false);
  }

  /** 电池优化行：只在手机版显示，未豁免时给出「去设置」入口 */
  function syncBatteryRow() {
    var row = el.batteryRow;
    if (!row) return;

    var api = global.TodoNative;
    var isNativeShell = !!api && typeof api.isNative === 'function' && api.isNative();
    if (!isNativeShell) {
      row.hidden = true;
      return;
    }

    var info = (typeof api.info === 'function') ? api.info() : null;
    var ignored = info && typeof info.batteryOptimizationIgnored === 'boolean'
      ? info.batteryOptimizationIgnored : null;
    if (ignored === null) {
      row.hidden = true;
      return;
    }

    row.hidden = false;
    if (el.batteryDesc) {
      el.batteryDesc.textContent = ignored
        ? '已放行，后台提醒不会被省电模式拦截'
        : '系统可能为省电拦截后台提醒，建议设为不优化';
    }
    if (el.batteryBtn) el.batteryBtn.hidden = !!ignored;
  }

  /** 自启动行：只在省电策略激进的国产 ROM 上显示（小米/华为/三星/OPPO/vivo 等） */
  function syncAutoStartRow() {
    var row = el.autoStartRow;
    if (!row) return;

    var api = global.TodoNative;
    var isNativeShell = !!api && typeof api.isNative === 'function' && api.isNative();
    if (!isNativeShell) {
      row.hidden = true;
      return;
    }

    var info = (typeof api.info === 'function') ? api.info() : null;
    var aggressive = info && info.aggressiveBattery === true;
    row.hidden = !aggressive;

    /* 华为把自启动页用系统权限保护了，应用只能落到「应用信息」页，
       文案直接告诉用户从哪里进去，省得在设置里翻 */
    if (!row.hidden && info && el.autoStartDesc) {
      var maker = String(info.manufacturer || '').toLowerCase();
      if (maker.indexOf('huawei') !== -1 || maker.indexOf('honor') !== -1) {
        el.autoStartDesc.textContent =
          '将打开应用信息页，请从「耗电详情 → 应用启动管理」允许后台运行';
      }
    }
  }

  function openRingSheet() {
    if (!nativeRingApi()) {
      toast('网页版没有系统铃声可选');
      return;
    }
    renderRingList();
    show(el.settingsLayer, false);
    show(el.ringLayer, true);
  }

  function renderRingList() {
    var box = el.ringList;
    if (!box) return;
    box.textContent = '';

    var current = '';
    try {
      current = String(nativeRingApi().ringtone() || '');
    } catch (error) {
      current = '';
    }

    var rows = [{ name: '跟随系统默认', uri: '', hint: '用系统当前的默认闹钟铃声' }];
    var list = [];
    try {
      list = nativeRingApi().ringtones() || [];
    } catch (error) {
      list = [];
    }
    for (var i = 0; i < list.length; i++) {
      rows.push({
        name: String(list[i].name || '未命名铃声'),
        uri: String(list[i].uri || ''),
        hint: String(list[i].type || '')
      });
    }

    for (var r = 0; r < rows.length; r++) {
      box.appendChild(buildRingRow(rows[r], current));
    }
  }

  function buildRingRow(row, current) {
    var active = row.uri === current;

    var item = document.createElement('button');
    item.type = 'button';
    item.className = 'ring-item' + (active ? ' is-active' : '');
    item.setAttribute('role', 'radio');
    item.setAttribute('aria-checked', active ? 'true' : 'false');
    item.setAttribute('data-uri', row.uri);

    var name = document.createElement('span');
    name.className = 'ring-item__name';
    name.textContent = row.name;
    if (row.hint) {
      var hint = document.createElement('small');
      hint.textContent = row.hint;
      name.appendChild(hint);
    }

    var dot = document.createElement('span');
    dot.className = 'ring-item__dot';

    item.appendChild(name);
    item.appendChild(dot);
    item.addEventListener('click', function () {
      chooseRingtone(row);
    });
    return item;
  }

  function chooseRingtone(row) {
    var api = nativeRingApi();
    if (!api) return;
    try {
      api.setRingtone(row.uri || '', row.name || '');
      if (row.uri) api.previewRingtone(row.uri);
    } catch (error) {
      /* 桥接失败就当没选 */
    }

    if (el.ringList) {
      var items = el.ringList.querySelectorAll('.ring-item');
      for (var i = 0; i < items.length; i++) {
        var active = items[i].getAttribute('data-uri') === (row.uri || '');
        items[i].classList.toggle('is-active', active);
        items[i].setAttribute('aria-checked', active ? 'true' : 'false');
      }
    }
    syncSettingsRows();
    toast(row.uri ? '铃声已改为「' + row.name + '」' : '已跟随系统默认铃声');
  }

  function syncNativeRingPreference() {
    if (global.TodoNative && typeof global.TodoNative.setRingEnabled === 'function') {
      try { global.TodoNative.setRingEnabled(!!prefs.ring); } catch (error) { /* 网页仍可使用 */ }
    }
  }
  function toggleRing() {
    prefs.ring = !prefs.ring;
    savePrefs();
    if (el.ringToggle) {
      el.ringToggle.setAttribute('aria-checked', prefs.ring ? 'true' : 'false');
    }
    if (!prefs.ring) stopRing();
    toast(prefs.ring ? '到点会响铃' : '到点不再响铃');
  }

  /** 弹层是否都关着；返回键/返回手势先关弹层 */
  function closeSheets() {
    var closed = false;
    /* 语音那一屏优先级最高：不管在听、在识别还是在改字，返回键都先关它 */
    if (el.voiceLayer && !el.voiceLayer.classList.contains('is-hidden')) {
      cancelVoice(true);
      return true;
    }
    /* 语音助手是从待办页弹出来的，返回键先收它，别一下退回桌面 */
    if (el.assistantLayer && !el.assistantLayer.classList.contains('is-hidden')) {
      closeAssistant();
      return true;
    }
    /* 模型对比 / 档案编辑是叠在设置上面的，返回键先收这两层，设置留在原地 */
    if (el.compareLayer && !el.compareLayer.classList.contains('is-hidden')) {
      if (!compare.running) show(el.compareLayer, false);
      return true;
    }
    if (el.modelLayer && !el.modelLayer.classList.contains('is-hidden')) {
      show(el.modelLayer, false);
      return true;
    }
    if (el.cropLayer && !el.cropLayer.classList.contains('is-hidden')) {
      closeCropper();
      closed = true;
    }
    if (el.textAvatarLayer && !el.textAvatarLayer.classList.contains('is-hidden')) {
      show(el.textAvatarLayer, false);
      closed = true;
    }
    if (el.authLayer && !el.authLayer.classList.contains('is-hidden')) {
      show(el.authLayer, false);
      authSheet.kind = '';
      closed = true;
    }
    if (el.ringLayer && !el.ringLayer.classList.contains('is-hidden')) {
      show(el.ringLayer, false);
      show(el.settingsLayer, true);
      closed = true;
    } else if (el.settingsLayer && !el.settingsLayer.classList.contains('is-hidden')) {
      show(el.settingsLayer, false);
      closed = true;
    }
    if (el.avatarLayer && !el.avatarLayer.classList.contains('is-hidden')) {
      show(el.avatarLayer, false);
      closed = true;
    }
    if (el.sortLayer && !el.sortLayer.classList.contains('is-hidden')) {
      show(el.sortLayer, false);
      closed = true;
    }
    if (el.attachPreviewLayer && !el.attachPreviewLayer.classList.contains('is-hidden')) {
      show(el.attachPreviewLayer, false);
      closed = true;
    }
    if (el.attachSrcLayer && !el.attachSrcLayer.classList.contains('is-hidden')) {
      show(el.attachSrcLayer, false);
      closed = true;
    }
    if (el.scanLayer && !el.scanLayer.classList.contains('is-hidden')) {
      closeScanReview();
      closed = true;
    }
    if (el.drawLayer && !el.drawLayer.classList.contains('is-hidden')) {
      closeDrawPad(true);
      closed = true;
    }
    /* 笔记系弹层（M3 起补齐）：之前只有关闭按钮和点遮罩，开着它们按返回
       会一路落空数到「再按一次退出」。从上往下：回顾 / 问一问 / 草稿 / 笔记 */
    if (el.reviewLayer && !el.reviewLayer.classList.contains('is-hidden')) {
      show(el.reviewLayer, false);
      closed = true;
    }
    if (el.qaLayer && !el.qaLayer.classList.contains('is-hidden')) {
      show(el.qaLayer, false);
      closed = true;
    }
    if (el.draftLayer && !el.draftLayer.classList.contains('is-hidden')) {
      show(el.draftLayer, false);
      closed = true;
    }
    if (el.memoLayer && !el.memoLayer.classList.contains('is-hidden')) {
      closeMemoSheet();
      closed = true;
    }
    if (el.guideLayer && !el.guideLayer.classList.contains('is-hidden')) {
      finishGuide(true); /* 中途退出也算看过，不再自动弹 */
      closed = true;
    }
    return closed;
  }

  /* ------------------------------------------------------------ 主题

     三套界面色调，选完就锁住（不再跟系统深浅色走）：
       light   白色为主、冷色调（默认）
       dark    夜间主题，黑色为主
       macaron 马卡龙糖果色：奶油底 + 草莓粉 + 薄荷
     手机版还会把选择同步给原生，状态栏和导航栏跟着变。
     ========================================================================== */

  var THEME_DESC = {
    light: '白色为主，冷色调',
    dark: '夜间主题，黑色为主',
    macaron: '马卡龙糖果色，奶油底＋草莓粉'
  };

  function currentTheme() {
    var mode = document.documentElement.getAttribute('data-theme');
    return mode === 'dark' || mode === 'macaron' ? mode : 'light';
  }

  function applyThemeMode(mode) {
    var next = (mode === 'dark' || mode === 'macaron') ? mode : 'light';

    /* 手选过就不再让系统深浅色覆盖 */
    global.__themeLocked = true;
    document.documentElement.setAttribute('data-theme', next);

    var meta = document.getElementById('theme-color-meta');
    if (meta) {
      meta.setAttribute('content',
        next === 'dark' ? '#12141a' : next === 'macaron' ? '#fdf6f2' : '#f4f6fb');
    }

    prefs.theme = next;
    savePrefs();

    if (global.TodoNative && typeof global.TodoNative.setThemeMode === 'function') {
      try {
        global.TodoNative.setThemeMode(next);
      } catch (error) {
        /* 状态栏没跟上不影响页面 */
      }
    }
    syncThemePicker();
  }

  function syncThemePicker() {
    if (!el.themePick) return;
    var active = currentTheme();
    var buttons = el.themePick.querySelectorAll('[data-mode]');
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i].getAttribute('data-mode') === active;
      buttons[i].classList.toggle('is-active', on);
      buttons[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
    if (el.themeDesc) el.themeDesc.textContent = THEME_DESC[active];
  }

  /* ------------------------------------------------------------ 语音三处独立设置 */

  var VOICE_TODO_DESC = {
    dict: '本地模型转写，带热词、同音纠错和标点；原生另尝试本机或局域网 AI 纠错',
    realtime: '小米系统实时识别，出字快，需联网'
  };
  var VOICE_MEMO_DESC = {
    realtime: '系统实时识别，边说边插到光标处',
    dict: '本地模型按段转写插入；原生纠错可能连接本机或局域网服务'
  };

  function syncVoiceModePicks() {
    var todoMode = prefs.voiceTodoMode === 'realtime' ? 'realtime' : 'dict';
    var memoMode = prefs.voiceMemoMode === 'dict' ? 'dict' : 'realtime';
    if (el.voiceTodoPick) {
      var tb = el.voiceTodoPick.querySelectorAll('[data-vt]');
      for (var i = 0; i < tb.length; i++) {
        var on = tb[i].getAttribute('data-vt') === todoMode;
        tb[i].classList.toggle('is-active', on);
        tb[i].setAttribute('aria-checked', on ? 'true' : 'false');
      }
    }
    if (el.voiceTodoDesc) el.voiceTodoDesc.textContent = VOICE_TODO_DESC[todoMode];
    if (el.voiceMemoPick) {
      var mb = el.voiceMemoPick.querySelectorAll('[data-vm]');
      for (var j = 0; j < mb.length; j++) {
        var on2 = mb[j].getAttribute('data-vm') === memoMode;
        mb[j].classList.toggle('is-active', on2);
        mb[j].setAttribute('aria-checked', on2 ? 'true' : 'false');
      }
    }
    if (el.voiceMemoDesc) el.voiceMemoDesc.textContent = VOICE_MEMO_DESC[memoMode];
  }

  function bindModePick(rootEl, attr, allowed, apply) {
    if (!rootEl) return;
    rootEl.addEventListener('click', function (event) {
      var node = event.target;
      var btn = node && typeof node.closest === 'function' ? node.closest('[' + attr + ']') : null;
      if (!btn) return;
      var val = btn.getAttribute(attr);
      if (allowed.indexOf(val) < 0 || val === prefs[apply]) return;
      prefs[apply] = val;
      savePrefs();
      syncVoiceModePicks();
      /* 待办那项立即影响本会话的开麦默认 */
      if (apply === 'voiceTodoMode') {
        dict.mode = val === 'dict';
        syncDictationToggle();
      }
    });
  }

  /* ------------------------------------------------------------ 语音助手引擎 */

  var VOICE_ENGINE_DESC = {
    local: '本地规则理解，反应快、不联网',
    llm: '在线大模型更懂口语和多轮追问；连不上时自动用本地规则',
    ollama: '电脑上的本地大模型（Ollama），不走云不耗流量；电脑不在身边时自动退回本地规则'
  };

  function syncVoiceEnginePick() {
    if (!el.voiceEnginePick) return;
    var engine = ['local', 'llm', 'ollama'].indexOf(prefs.voiceEngine) >= 0 ? prefs.voiceEngine : 'local';
    var buttons = el.voiceEnginePick.querySelectorAll('[data-engine]');
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i].getAttribute('data-engine') === engine;
      buttons[i].classList.toggle('is-active', on);
      buttons[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
    if (el.voiceEngineDesc) el.voiceEngineDesc.textContent = VOICE_ENGINE_DESC[engine];
    /* 模型库只在选了「在线大模型」时展开，避免设置页一屏全是配置 */
    if (el.llmConfig) show(el.llmConfig, engine === 'llm');
    if (engine === 'llm') {
      renderModelLibrary();
      renderCatalog();
    }
  }

  /* ==================================================== 在线大模型：模型库

     一份配置 = 一份「模型档案」：接口地址 + 密钥 + 模型名 + 能力画像。
     档案可以有多份，用途有三：
       · 语音时间识别按任务类型自动挑最合适的一份，也能手动锁定其中一份
       · 设置里逐份探测，拿到接口真正返回的模型标识、版本、上下文与延迟
       · 对比页把同一段输入同时发给多个模型，并排看输出、耗时与规则评分

     所有请求统一走原生代理 —— WebView 里直接 fetch 第三方接口会被 CORS 挡。 */

  /* 各家当前（2026-10 核对）的模型名。
     这些名字会过期，所以每个服务商都带一句 hint 说明「哪些旧名已经不能用了」；
     设置里还有「检查更新」可以按各家 /v1/models 拉一份最新的。 */
  var MODEL_PRESETS = [
    {
      key: 'deepseek', name: 'DeepSeek',
      endpoint: 'https://api.deepseek.com/v1/chat/completions',
      models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4.1-flash-1017'],
      hint: 'deepseek-chat / deepseek-reasoner 已于 2026-07-24 停用（旧名等于 v4-flash 的非思考 / 思考模式），新接入请用 v4 系列；上下文 1M。'
    },
    {
      key: 'dashscope', name: '通义千问',
      endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      models: ['qwen3.8-max', 'qwen3.7-plus', 'qwen3.8-flash'],
      hint: 'qwen-max / qwen-plus 是不带版本的老别名，qwen-turbo 属停止迭代的 Turbo 系列；模型名在接口里一律小写。'
    },
    {
      key: 'moonshot', name: 'Kimi',
      endpoint: 'https://api.moonshot.cn/v1/chat/completions',
      models: ['kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed', 'kimi-k3', 'kimi-k2.7-code'],
      hint: 'k3.1-pro 于 2026-10-24 开卖：1M 上下文，$2/$10（缓存 $0.20），高速版同智能 2~3 倍速、$4/$20。' +
            '只能调 reasoning_effort（low/high/max，默认 max），传「关闭思考」会直接报错。' +
            'moonshot-v1-* 与 kimi-k2-* 预览版已下线（404）。'
    },
    {
      key: 'minimax', name: 'MiniMax',
      /* 官方 OpenAI 兼容端点：POST /v1/chat/completions，Bearer 鉴权
         （另有 /v1/text/chatcompletion_v2 原生端点，字段不同，这里不用） */
      endpoint: 'https://api.minimaxi.com/v1/chat/completions',
      models: ['MiniMax-M3.1-Flash', 'MiniMax-M3'],
      hint: 'M3.1 Flash（2026-10-19）1M 上下文，可入文本/图片/视频，$0.15/$0.60、缓存 $0.015，' +
            '日常 200+ TPS；强制思考（low~max 五档，不传按最贵的 max 跑，关不掉）。' +
            'M2.5 / M2.7 的请求自 2026-10-19 起已被自动路由到它，旧端点 2026-11-18 下线。'
    },
    {
      key: 'mimo', name: '小米 MiMo',
      /* 官方 OpenAI 兼容端点。同一份模型既可走 Authorization: Bearer，
         也有集群只认 api-key 头，见 authHeadersOf 里的兼容处理 */
      endpoint: 'https://api.xiaomimimo.com/v1/chat/completions',
      models: ['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2-pro', 'mimo-v2-flash']
    },
    {
      key: 'openai', name: 'OpenAI',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      models: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna'],
      hint: 'gpt-6 系列（2026-09）：6.1-sol 是主力（$2/$10，缓存 $0.10，1.05M 上下文），astra 最强（$10/$50），' +
            'luna 最省（$0.10/$0.50）。gpt-4o 已于 2026-02 关停，gpt-5.6 三档已被取代。'
    },
    {
      key: 'zhipu', name: '智谱 GLM',
      endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      models: ['glm-5.3', 'glm-5.3-flash', 'glm-4.7'],
      hint: 'glm-4-plus 已不在模型矩阵、glm-4-flash 已移出主表；GLM-5.3 起思考不可关闭' +
            '（low/high/max，默认 max），thinking.type=disabled 会直接报错。$1.40/$4.40，缓存 $0.26。'
    },
    {
      key: 'custom', name: '自定义 / 自建网关',
      endpoint: '',
      models: []
    }
  ];

  /**
   * 所有服务商共用一套请求头：OpenAI 兼容协议只认 Authorization: Bearer。
   * 小米 MiMo 的部分集群同时/只接受 api-key 头，按域名补一个，别的服务商不受影响。
   */
  /** 把模型档案里那把钥匙取出来：优先内存里的明文，其次安全仓库里的引用 */
  function keyOf(model) {
    if (!model) return '';
    if (model.key) return String(model.key);
    if (model.keyRef) {
      var vault = global.KeyVault;
      return vault && typeof vault.get === 'function' ? vault.get(model.keyRef) : '';
    }
    return '';
  }

  /** 出门前脱敏：默认开着，用户可以在设置里关掉 */
  function maskOutgoing(messages) {
    var mask = prefs.aiMaskPii;
    var safety = global.AiSafety;
    if (mask === false || !safety || typeof safety.maskMessages !== 'function') return messages;
    try {
      return safety.maskMessages(messages).messages;
    } catch (error) {
      return messages;
    }
  }

  function authHeadersOf(model, withBody) {
    var headers = {};
    if (withBody) headers['Content-Type'] = 'application/json';
    var key = keyOf(model);
    if (!key) return headers;
    headers.Authorization = 'Bearer ' + key;
    if (/xiaomimimo\.com/i.test(String((model && model.endpoint) || ''))) {
      headers['api-key'] = key;
    }
    return headers;
  }

  /* 模型名的能力画像：1 弱 / 2 中 / 3 强，只用来做「按任务挑模型」的初值，
     用户可以在模型档案里逐项改。上下文一律标「约」，因为同名模型各版本会变。 */
  var MODEL_TRAITS = [
    /* DeepSeek V4：pro 是推理档，flash 是速度快的那支，两者都 1M 上下文 */
    { re: /deepseek-v4-pro|deepseek-reasoner|deepseek-r1|(^|[-_/])r1([-_/]|$)/i,
      t: { json: 2, speed: 2, zh: 3, reason: 3, ctx: '1M' } },
    { re: /deepseek/i, t: { json: 3, speed: 3, zh: 3, reason: 2, ctx: '1M' } },
    /* 通义：max 偏推理，flash/turbo 偏速度 */
    { re: /qwen.*max/i, t: { json: 3, speed: 2, zh: 3, reason: 3, ctx: '128K' } },
    { re: /qwen.*(flash|turbo)/i, t: { json: 3, speed: 3, zh: 3, reason: 2, ctx: '128K' } },
    { re: /qwen/i, t: { json: 3, speed: 3, zh: 3, reason: 2, ctx: '128K' } },
    /* MiniMax M3.x：1M 上下文、200+ TPS，结构化输出比 M2 稳 */
    { re: /minimax.*m3\.1/i, t: { json: 3, speed: 3, zh: 3, reason: 3, ctx: '1M' } },
    /* MiniMax M2 系列：中文口语理解强、带思考，highspeed 变体只快不弱 */
    { re: /minimax.*highspeed|abab.*highspeed/i,
      t: { json: 2, speed: 3, zh: 3, reason: 3, ctx: '200K' } },
    { re: /minimax|abab/i, t: { json: 2, speed: 2, zh: 3, reason: 3, ctx: '200K' } },
    /* 小米 MiMo：flash 速度优先，pro 推理更足 */
    { re: /mimo.*flash/i, t: { json: 3, speed: 3, zh: 3, reason: 2, ctx: '128K' } },
    { re: /mimo/i, t: { json: 3, speed: 2, zh: 3, reason: 3, ctx: '128K' } },
    /* OpenAI GPT-6 三档：astra 最强最慢、6.1-sol 主力、luna 最省，均 1.05M 上下文 */
    { re: /gpt-6-astra|gpt-6\.1-sol-pro|o1-pro|o3-pro/i,
      t: { json: 3, speed: 1, zh: 2, reason: 3, ctx: '1M' } },
    { re: /gpt-6\.1-sol|gpt-6-sol|gpt-5\.6-sol|gpt-6\.1|gpt-6(?![.-]luna)/i,
      t: { json: 3, speed: 2, zh: 2, reason: 3, ctx: '1M' } },
    { re: /gpt-6-luna|gpt-5\.6-luna|gpt-5-mini|gpt-4o-mini|gpt-4\.1-mini/i,
      t: { json: 3, speed: 3, zh: 2, reason: 2, ctx: '1M' } },
    /* 旧版：5.6 terra / 5.x / 4.x 只出现在已存的档案里，留个画像别掉到兜底 */
    { re: /gpt-5\.6|gpt-5|gpt-4o|gpt-4\.1/i, t: { json: 3, speed: 2, zh: 2, reason: 3, ctx: '128K' } },
    { re: /o1|o3|o4/i, t: { json: 2, speed: 1, zh: 2, reason: 3, ctx: '200K' } },
    /* Kimi：k3.1 全系 1M（highspeed 同智能、2~3 倍速），k3 1M，k2.x 256K，code 系列偏工程 */
    { re: /kimi-k3\.1.*highspeed/i, t: { json: 3, speed: 3, zh: 3, reason: 3, ctx: '1M' } },
    { re: /kimi-k3\.1/i, t: { json: 3, speed: 2, zh: 3, reason: 3, ctx: '1M' } },
    { re: /kimi-k3/i, t: { json: 3, speed: 2, zh: 3, reason: 3, ctx: '1M' } },
    { re: /kimi.*code/i, t: { json: 3, speed: 2, zh: 3, reason: 2, ctx: '256K' } },
    { re: /moonshot|kimi/i, t: { json: 2, speed: 2, zh: 3, reason: 2, ctx: '256K' } },
    /* 智谱：5.3 旗舰 1M，flash 更快 */
    { re: /glm-5\.3-flash|glm-.*flash/i,
      t: { json: 3, speed: 3, zh: 3, reason: 2, ctx: '1M' } },
    { re: /glm-5|glm-4\.7|glm-4\.6/i, t: { json: 3, speed: 2, zh: 3, reason: 3, ctx: '1M' } },
    { re: /glm-4/i, t: { json: 3, speed: 3, zh: 3, reason: 2, ctx: '128K' } },
    { re: /ernie|hunyuan|doubao|spark/i, t: { json: 2, speed: 2, zh: 3, reason: 2, ctx: '32K' } }
  ];

  var CAP_KEYS = ['json', 'speed', 'zh', 'reason'];
  var CAP_NAMES = { json: '结构化', speed: '速度', zh: '中文', reason: '推理' };
  var CAP_LEVELS = ['弱', '中', '强'];

  /** 兜底画像：不认识的模型一律给「中」 */
  function defaultCaps() {
    return { json: 2, speed: 2, zh: 2, reason: 2 };
  }

  /** 按模型名猜能力画像（猜不到就返回 null） */
  function traitsOf(modelId) {
    var id = String(modelId || '');
    if (!id) return null;
    for (var i = 0; i < MODEL_TRAITS.length; i++) {
      if (MODEL_TRAITS[i].re.test(id)) {
        var t = MODEL_TRAITS[i].t;
        return { caps: { json: t.json, speed: t.speed, zh: t.zh, reason: t.reason }, ctx: t.ctx };
      }
    }
    return null;
  }

  function contextOf(modelId) {
    var t = traitsOf(modelId);
    return t ? t.ctx : '';
  }

  function newModelId() {
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  }

  /** 从本地存储里读回来的档案：字段逐项洗一遍，坏数据不至于把整个设置页带崩 */
  function normalizeStoredModel(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var model = typeof raw.model === 'string' ? raw.model.trim() : '';
    var endpoint = typeof raw.endpoint === 'string' ? raw.endpoint : '';
    if (!endpoint && !model) return null;
    var traits = traitsOf(model);
    var probe = raw.probe && typeof raw.probe === 'object' ? raw.probe : null;
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : newModelId(),
      name: typeof raw.name === 'string' && raw.name ? raw.name : (model || '未命名模型'),
      endpoint: endpoint,
      model: model,
      key: typeof raw.key === 'string' ? raw.key : '',
      /* 安全仓库里的引用：有它就不该再有明文 key 落盘 */
      keyRef: typeof raw.keyRef === 'string' ? raw.keyRef : '',
      /* 有些模型只认固定 temperature（如 Kimi K3 系列只收 1）：被接口 400
         教育过一次就记住，之后请求一律不带 temperature 字段 */
      tempFixed: raw.tempFixed === true,
      caps: copyCaps(raw.caps && typeof raw.caps === 'object' ? raw.caps : (traits ? traits.caps : null)),
      probe: probe ? {
        ok: !!probe.ok,
        realModel: String(probe.realModel || ''),
        version: String(probe.version || ''),
        ctx: String(probe.ctx || ''),
        latency: Number(probe.latency) || 0,
        models: Number(probe.models) || 0,
        note: String(probe.note || ''),
        at: Number(probe.at) || 0,
        fingerprint: String(probe.fingerprint || ''),
        reasoning: !!probe.reasoning
      } : null
    };
  }

  function findModel(id) {
    for (var i = 0; i < prefs.llmModels.length; i++) {
      if (prefs.llmModels[i].id === id) return prefs.llmModels[i];
    }
    return null;
  }

  /** 地址 + 密钥都填了才算能用（密钥可能在安全仓库里，只看引用存在） */
  function modelReady(m) {
    return !!(m && m.endpoint && (m.key || m.keyRef));
  }

  /** 能真正发请求的档案（语音识别、对比页都只认这份列表） */
  function usableModels() {
    var out = [];
    for (var i = 0; i < prefs.llmModels.length; i++) {
      if (modelReady(prefs.llmModels[i])) out.push(prefs.llmModels[i]);
    }
    return out;
  }

  function activeModel() {
    var m = findModel(prefs.llmActiveId);
    if (m && modelReady(m)) return m;
    var list = usableModels();
    return list.length ? list[0] : null;
  }

  function modelTitle(m) {
    if (!m) return '未配置';
    return m.name || m.model || '未命名模型';
  }

  /* ------------------------------------------------ 任务类型与路由

     每个任务声明自己最看重哪几项能力（权重越高越在乎）。
     路由 = 在可用档案里按「能力加权分 - 延迟惩罚」排序取第一名。 */

  var LLM_TASKS = {
    parse: {
      name: '时间解析',
      desc: '把口述里的时间抽成 JSON，要求严格按格式输出、响应快',
      need: { json: 3, speed: 2, zh: 1, reason: 1 },
      sample: '明天上午十点开周会，下午三点半提醒我回访客户，周五晚上八点健身',
      temperature: 0,
      build: function (text) { return llmPrompt(text); },
      grade: gradeParse
    },
    assistant: {
      name: '语音助手',
      desc: '听懂一句话要办什么，按 JSON 协议给出动作；吃中文口语，也吃多轮上下文',
      need: { json: 3, speed: 2, zh: 3, reason: 2 },
      sample: '明天下午三点开会，顺便提醒我带上电脑；另外今天还有几件事？',
      temperature: 0.1,
      /* 单轮版：系统提示词 + 这句话。多轮由助手自己拼 messages 数组 */
      build: function (text) {
        return asstSystemPrompt() + '\n\n用户这句话：' + text;
      },
      grade: gradeAssistant
    },
    polish: {
      name: '文本整理',
      desc: '把口语整理成一句干净的待办标题，要中文自然、不啰嗦',
      need: { json: 1, speed: 2, zh: 3, reason: 1 },
      sample: '呃提醒我那个明天下午的会吧把材料准备一下记得带上电脑',
      temperature: 0.3,
      build: function (text) {
        return '把下面这句话整理成一条中文待办事项标题。\n' +
          '要求：去掉口头语和「提醒我」这类说法，保留人物、动作、对象与时间；' +
          '不超过 30 个字；只输出这一句话，不要引号、不要解释。\n' +
          '原句：' + text;
      },
      grade: gradePolish
    },
    reason: {
      name: '逻辑推理',
      desc: '多条件排序、权衡取舍，看重推理深度与上下文容量',
      need: { json: 1, speed: 1, zh: 2, reason: 3 },
      sample: '我周四要交季度报告，周三下午有个两小时的评审会，还答应同事周一帮他看方案。帮我排个先后，说明理由。',
      temperature: 0.4,
      build: function (text) {
        return '你是待办规划助手。请针对下面的情况给出安排建议：先给结论顺序，再逐条说明理由，' +
          '最后指出最大的风险点。不要客套话。\n\n' + text;
      },
      grade: gradeFreeform
    },
    chat: {
      name: '自由问答',
      desc: '开放式提问，看表达与结构',
      need: { json: 1, speed: 2, zh: 2, reason: 2 },
      sample: '用三句话说明为什么待办事项要排优先级。',
      temperature: 0.6,
      build: function (text) { return text; },
      grade: gradeFreeform
    }
  };

  var TASK_KEYS = ['parse', 'assistant', 'polish', 'reason', 'chat'];

  /** 某个档案在某个任务上的得分（越高越合适） */
  function taskScore(m, taskKey) {
    var task = LLM_TASKS[taskKey];
    if (!task || !modelReady(m)) return -1;
    var caps = m.caps || defaultCaps();
    var weights = task.need;
    var score = 0;
    for (var i = 0; i < CAP_KEYS.length; i++) {
      var key = CAP_KEYS[i];
      score += (Number(caps[key]) || 2) * (weights[key] || 0);
    }
    /* 探测到的真实延迟超过 3 秒的，扣一点分，免得每次都让人干等 */
    if (m.probe && m.probe.latency > 3000) score -= 2;
    return score;
  }

  /**
   * 为某个任务挑一份档案。返回 { model, score, reason, manual }
   * 手动模式下只认用户锁定的那份（锁定的不可用才退回自动）。
   */
  function pickModel(taskKey) {
    var pinned = activeModel();
    if (prefs.llmRoute === 'manual' && pinned) {
      return {
        model: pinned, score: taskScore(pinned, taskKey), manual: true,
        reason: '手动指定 ' + modelTitle(pinned)
      };
    }
    var list = usableModels();
    if (!list.length) return { model: null, score: -1, manual: false, reason: '还没有可用的模型档案' };

    var best = null;
    var bestScore = -1;
    for (var i = 0; i < list.length; i++) {
      var s = taskScore(list[i], taskKey);
      if (s > bestScore) { bestScore = s; best = list[i]; }
    }
    var task = LLM_TASKS[taskKey];
    var caps = (best && best.caps) || defaultCaps();
    var why = [];
    for (var c = 0; c < CAP_KEYS.length; c++) {
      var k = CAP_KEYS[c];
      if ((task.need[k] || 0) >= 2) why.push(CAP_NAMES[k] + CAP_LEVELS[caps[k] - 1]);
    }
    return {
      model: best, score: bestScore, manual: false,
      reason: '按「' + (task ? task.name : taskKey) + '」自动选择：' + why.join(' · ')
    };
  }

  /* ------------------------------------------------ 网络：原生代理 + fetch 兜底 */

  var llmNetSeq = 0;
  var llmNetPending = {};

  /** req = {method, url, headers, body, timeout}；cb(err, status, bodyText) */
  /**
   * 所有出网请求的唯一入口。
   *
   * 真正的实现已经搬到 js/ai/gateway.js（https 校验、超时分级、退避重试、
   * 熔断、计量、预算都在那里）。这里保留同名同签名的薄壳，一是页面里几十处
   * 调用点不用动，二是框架层没加载时（例如只跑某个单文件的测试）还能退回
   * 原来的直连实现。
   */
  function netRequest(req, cb) {
    var hub = global.AiGateway;
    if (hub && typeof hub.send === 'function') {
      hub.send(req, cb);
      return;
    }
    legacyNetRequest(req, cb);
  }

  function legacyNetRequest(req, cb) {
    var id = 'n' + (++llmNetSeq);
    llmNetPending[id] = cb;
    var api = global.TodoNative;
    if (api && typeof api.llmHttp === 'function') {
      try {
        if (api.llmHttp(id, req.method || 'POST', req.url, req.headers || {},
          req.body || null, req.timeout || 20000)) return;
      } catch (error) {
        /* 落到 fetch */
      }
    }
    fetchRequest(id, req);
  }

  function fetchRequest(id, req) {
    function finish(err, status, body) {
      var cb = llmNetPending[id];
      if (!cb) return;
      delete llmNetPending[id];
      cb(err, status, body);
    }
    if (typeof global.fetch !== 'function') {
      finish('这个环境不支持联网请求', 0, '');
      return;
    }
    var timer = global.setTimeout(function () {
      finish('请求超时，检查网络或接口地址', 0, '');
    }, req.timeout || 20000);
    try {
      var init = { method: req.method || 'POST', headers: req.headers || {} };
      if (req.body) init.body = JSON.stringify(req.body);
      global.fetch(req.url, init).then(function (res) {
        return res.text().then(function (text) {
          return { status: res.status, body: text };
        });
      }).then(function (r) {
        global.clearTimeout(timer);
        finish(null, r.status, r.body);
      }).catch(function () {
        global.clearTimeout(timer);
        finish('连不上这个地址，检查网络和 API 地址', 0, '');
      });
    } catch (error) {
      global.clearTimeout(timer);
      finish('请求发不出去，检查 API 地址', 0, '');
    }
  }

  /** 原生与 fetch 两条路的回调都汇到这里 */
  global.LlmNet = {
    done: function (id, status, body) {
      /* 走网关发出的请求有自己的待办表，先问它 */
      var hub = global.AiGateway;
      if (hub && typeof hub.onDone === 'function' && hub.onDone(id, status, body)) return;
      var cb = llmNetPending[id];
      if (!cb) return;
      delete llmNetPending[id];
      cb(null, Number(status) || 0, String(body == null ? '' : body));
    },
    error: function (id, message) {
      var hub = global.AiGateway;
      if (hub && typeof hub.onError === 'function' && hub.onError(id, message)) return;
      var cb = llmNetPending[id];
      if (!cb) return;
      delete llmNetPending[id];
      cb(message || '网络请求失败', 0, '');
    }
  };

  /* ------------------------------------------------ 地址、响应与错误文案 */

  function normalizeEndpoint(raw) {
    var url = String(raw || '').trim();
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    /* 只填了域名或 /v1 的，补全成 chat/completions，省得用户自己拼 */
    if (/\/v\d+$/i.test(url)) url += '/chat/completions';
    else if (!/\/chat\/completions\/?$/i.test(url) && !/\/completions\/?$/i.test(url)) {
      if (!/\/v\d+\//i.test(url)) url = url.replace(/\/+$/, '') + '/v1/chat/completions';
    }
    return url;
  }

  /** 由对话地址推出服务根地址，用来取模型列表 */
  function apiBaseOf(endpoint) {
    var url = normalizeEndpoint(endpoint);
    return url
      .replace(/\/chat\/completions\/?$/i, '')
      .replace(/\/completions\/?$/i, '')
      .replace(/\/+$/, '');
  }

  function modelsUrlOf(endpoint) {
    var base = apiBaseOf(endpoint);
    return base ? base + '/models' : '';
  }

  /** 从模型名里拆版本号：gpt-4o-2024-08-06 / qwen-plus-2025-01-25 / kimi-0905 */
  function versionOf(modelId) {
    var id = String(modelId || '');
    var m = id.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = id.match(/(\d{4})(\d{2})(\d{2})(?!\d)/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = id.match(/[-_.]v?(\d+(?:\.\d+)+)$/i);
    if (m) return 'v' + m[1];
    /* 中段系列版本：kimi-k3.1-pro → 3.1、glm-4.6 → 4.6、qwen2.5-72b → 2.5。
       必须带小数点（免得把 gpt-4o、kimi-k3 这类无小数点的代数吞了），
       前面要贴着字母，后面必须是分隔符或结尾。 */
    m = id.match(/[a-z][-_.]?v?(\d+\.\d+(?:\.\d+)?)(?=[-_.]|$)/i);
    if (m) return 'v' + m[1];
    return '';
  }

  function formatCtx(value) {
    var n = Number(value);
    if (!n || isNaN(n)) return '';
    if (n >= 1048576) {
      var mb = Math.round(n / 1048576 * 10) / 10;
      return mb + 'M';
    }
    if (n >= 1024) return Math.round(n / 1024) + 'K';
    if (n >= 1000) return Math.round(n / 1000) + 'K';
    return String(n);
  }

  /**
   * 有的模型（MiniMax M2、小米 MiMo 的思考模式）会把思考过程直接塞进正文，
   * 手里拿着 think / thinking 标签包一段。展示和解析前先剥掉，
   * 不然 JSON 前面挂着一大段思考就废了。
   */
  function stripThinking(text) {
    return String(text || '')
      .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
      .replace(/<\|?think\|?>[\s\S]*?<\/\|?think\|?>/gi, '')
      .trim();
  }

  /** 兼容 OpenAI 的 choices[0].message.content，返回 {text, model, usage} */
  function parseChatResponse(bodyText) {
    var out = { text: '', model: '', usage: null, fingerprint: '', finishReason: '', reasoningTokens: 0 };
    try {
      var data = JSON.parse(bodyText);
      if (data && data.model) out.model = String(data.model);
      if (data && data.system_fingerprint) out.fingerprint = String(data.system_fingerprint);
      if (data && data.usage) {
        out.usage = data.usage;
        var details = data.usage.completion_tokens_details;
        if (details && Number(details.reasoning_tokens) > 0) {
          out.reasoningTokens = Number(details.reasoning_tokens);
        }
      }
      if (data && data.choices && data.choices[0]) {
        if (data.choices[0].finish_reason) {
          out.finishReason = String(data.choices[0].finish_reason);
        }
        var msg = data.choices[0].message;
        if (msg && typeof msg.content === 'string') {
          out.text = msg.content;
        } else if (msg && Object.prototype.toString.call(msg.content) === '[object Array]') {
          var parts = msg.content;
          var sb = '';
          for (var i = 0; i < parts.length; i++) {
            if (parts[i] && typeof parts[i].text === 'string') sb += parts[i].text;
          }
          out.text = sb;
        } else if (typeof data.choices[0].text === 'string') {
          out.text = data.choices[0].text;
        }
        /* 单独返回 reasoning_content 的（MiMo / MiniMax），也算「有思考」 */
        if (msg && typeof msg.reasoning_content === 'string' && msg.reasoning_content.trim()) {
          if (!out.reasoningTokens) out.reasoningTokens = 1;
        }
        out.text = stripThinking(out.text);
      }
    } catch (error) {
      /* 非 JSON 就让调用方按「没返回内容」处理 */
    }
    return out;
  }

  /** 兼容 OpenAI 的 /models 列表，也兼容 {"models":[...]} 的网关 */
  function parseModelList(bodyText, want) {
    var data = null;
    try { data = JSON.parse(bodyText); } catch (error) { return null; }
    var arr = null;
    if (data && Object.prototype.toString.call(data.data) === '[object Array]') arr = data.data;
    else if (data && Object.prototype.toString.call(data.models) === '[object Array]') arr = data.models;
    if (!arr) return null;

    var ids = [];
    var hit = null;
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i];
      var id = typeof item === 'string'
        ? item
        : (item && (item.id || item.name || item.model)) || '';
      if (!id) continue;
      ids.push(String(id));
      if (want && String(id) === want) hit = item;
    }
    var ctx = '';
    if (hit && typeof hit === 'object') {
      /* OpenRouter 形态把上下文塞在 top_provider 里，一并兼容 */
      var tp = hit.top_provider && typeof hit.top_provider === 'object' ? hit.top_provider : null;
      ctx = hit.context_length || hit.max_model_len || hit.context_window
        || (tp && tp.context_length) || '';
    }
    return {
      count: ids.length,
      ids: ids,
      ctx: ctx ? formatCtx(ctx) : '',
      suggest: ids.length ? ids[0] : ''
    };
  }

  function llmHttpError(status, body) {
    var detail = '';
    try {
      var data = JSON.parse(body);
      var err = data && data.error;
      detail = (err && (err.message || err)) || (data && data.message) || '';
      if (typeof detail !== 'string') detail = '';
    } catch (error) { detail = ''; }
    var head;
    if (status === 401 || status === 403) head = '密钥不对或没有权限（' + status + '）';
    else if (status === 404) head = '地址不对，返回 404，检查是不是漏了 /v1/chat/completions';
    else if (status === 429) head = '请求太频繁或额度用完（429）';
    else if (status === 400) head = '请求被拒绝（400），多半是模型名写错了';
    else if (status >= 500) head = '服务端出错（' + status + '）';
    else head = '接口返回 ' + status;
    return detail ? head + '：' + detail.slice(0, 80) : head;
  }

  /* ------------------------------------------------ 模型信息探测

     两步走：
       1) GET /models —— 拿到这个服务提供的模型清单（不是所有网关都给）
       2) 一次 1 token 的 ping —— 确认真能对话，并读回响应里的 model 字段
     响应里的 model 才是「真正的模型标识」，用户填的名字经常是别名。 */

  function probeModel(cfg, cb) {
    var info = {
      ok: false, realModel: '', version: '', ctx: '', latency: 0,
      models: 0, note: '', at: Date.now(), fingerprint: '', reasoning: false
    };
    var started = Date.now();
    var url = modelsUrlOf(cfg.endpoint);

    function ping(modelId) {
      if (!modelId) {
        info.note = '接口没给模型列表，模型名也是空的';
        info.latency = Date.now() - started;
        cb(info);
        return;
      }
      var payload = {
        model: modelId,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false
      };
      netRequest({
        method: 'POST', url: cfg.endpoint,
        headers: authHeadersOf(cfg, true),
        body: payload, timeout: 15000,
        task: 'probe', modelId: modelId
      }, function (err, status, body) {
        info.latency = Date.now() - started;
        if (err) { info.note = err; cb(info); return; }
        if (status < 200 || status >= 300) { info.note = llmHttpError(status, body); cb(info); return; }
        var res = parseChatResponse(body);
        info.ok = true;
        info.realModel = res.model || modelId;
        info.fingerprint = res.fingerprint || '';
        /* 只给 1 个 token 却能读出「思考了多少 token」，就说明它是推理型模型 */
        info.reasoning = res.reasoningTokens > 0;
        info.version = versionOf(info.realModel) || '';
        if (!info.ctx) info.ctx = contextOf(info.realModel);
        cb(info);
      });
    }

    if (!url) {
      info.note = '地址还不完整';
      cb(info);
      return;
    }
    netRequest({
      method: 'GET', url: url,
      headers: authHeadersOf(cfg, false),
      timeout: 12000, task: 'catalog'
    }, function (err, status, body) {
      var listed = null;
      if (!err && status >= 200 && status < 300) listed = parseModelList(body, cfg.model);
      if (listed) {
        info.models = listed.count;
        if (listed.ctx) info.ctx = listed.ctx;
      }
      ping(cfg.model || (listed && listed.suggest) || '');
    });
  }

  /** 探测结果压成一行，给设置页的档案卡片用 */
  function probeLine(m) {
    var p = m && m.probe;
    if (!p) return '还没检测过';
    if (!p.ok) {
      var short = String(p.note || '未知原因');
      if (short.length > 42) short = short.slice(0, 40) + '…';
      return '检测失败：' + short;
    }
    var bits = [];
    if (p.reasoning) bits.push('推理型');
    if (p.realModel) bits.push('接口返回 ' + p.realModel);
    if (p.version) bits.push('版本 ' + p.version);
    if (p.ctx) bits.push('上下文约 ' + p.ctx);
    if (p.latency) bits.push('延迟 ' + (p.latency / 1000).toFixed(1) + 's');
    return bits.join(' · ') || '接口未返回模型标识';
  }

  /** 多久之前测的，用来提示信息是否过期 */
  function probeAge(p) {
    if (!p || !p.at) return '';
    var diff = Date.now() - p.at;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.round(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.round(diff / 3600000) + ' 小时前';
    return Math.round(diff / 86400000) + ' 天前';
  }

  /* ------------------------------------------------ 任务请求 */

  /**
   * 发一组 messages 给某个档案：cb(err, {text, ms, realModel, usage, finishReason})
   * 单轮任务（runTask）和多轮助手（asstAskModel）都从这里出去，请求头、
   * 错误文案、空正文归因只有一份实现。
   */
  function runMessages(model, opts, cb) {
    var o = opts || {};
    if (!modelReady(model)) {
      cb('这份模型档案还没填完整（地址 + 密钥）', null);
      return;
    }

    var started = Date.now();

    /** withTemp=false 时不带 temperature：有些模型只认固定值，传了就 400 */
    function sendRequest(withTemp) {
      var payload = {
        model: model.model || 'gpt-6.1-sol',
        messages: maskOutgoing(o.messages || []),
        stream: false
      };
      if (withTemp && typeof o.temperature === 'number') payload.temperature = o.temperature;
      /* 刻意不设 max_tokens：推理型模型（deepseek-flash / *-reasoner / MiMo 的
         thinking 模式）会先思考再回答，给得太小额度全花在思考上，正文是空字符串。 */

      netRequest({
        method: 'POST', url: model.endpoint,
        headers: authHeadersOf(model, true),
        body: payload, timeout: o.timeout || 25000,
        task: o.task || 'chat', modelId: model.model || ''
      }, function (err, status, body) {
        var ms = Date.now() - started;
        if (err) { cb(err, { ms: ms }); return; }
        /* Kimi K3 系列只收 temperature=1，收到别的值直接 400 invalid temperature。
           教育一次就记住（持久化到档案），以后请求不再带温度参数。 */
        if (status === 400 && withTemp && /invalid temperature/i.test(String(body || ''))) {
          model.tempFixed = true;
          savePrefs();
          sendRequest(false);
          return;
        }
        if (status < 200 || status >= 300) {
          cb(llmHttpError(status, body), { ms: ms, status: status });
          return;
        }
        var res = parseChatResponse(body);
        if (!res.text || !res.text.trim()) {
          var why = '接口没返回内容，检查模型名是否正确';
          if (res.finishReason === 'length') {
            why = '输出被长度上限截断，正文是空的（推理型模型容易这样），换个模型或调大输出上限';
          } else if (res.reasoningTokens > 0) {
            why = '模型把额度都用在思考上了，没留下正文，换非推理模型更稳';
          }
          cb(why, { ms: ms, raw: body, finishReason: res.finishReason });
          return;
        }
        cb(null, {
          text: res.text, ms: ms,
          realModel: res.model || model.model || '',
          usage: res.usage,
          finishReason: res.finishReason
        });
      });
    }

    sendRequest(!model.tempFixed);
  }

  /** 发一次单轮任务请求：cb(err, {text, ms, realModel, usage, grade}) */
  function runTask(model, taskKey, input, cb) {
    var task = LLM_TASKS[taskKey];
    if (!task) { cb('未知的任务类型', null); return; }
    runMessages(model, {
      messages: [{ role: 'user', content: task.build(String(input || '')) }],
      temperature: task.temperature,
      timeout: 25000
    }, function (err, res) {
      if (err) { cb(err, res); return; }
      cb(null, {
        text: res.text, ms: res.ms, realModel: res.realModel, usage: res.usage,
        grade: task.grade(res.text, input)
      });
    });
  }

  /* ------------------------------------------------ 规则评分（对比页用）

     只是把「能不能直接用」量出来，不评判文采：评分规则全部写在界面上，
     免得让人误以为这是模型评测分。 */

  function gradeParse(text, input) {
    var hits = parseLlmPayload(text, Date.now());
    var raw = String(text || '').replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    var isJson = false;
    try {
      var data = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      isJson = !!(data && Object.prototype.toString.call(data.times) === '[object Array]');
    } catch (error) { isJson = false; }

    if (!isJson) return { score: 20, tag: '不合格', note: '没能输出合法 JSON，程序无法直接使用' };
    if (!hits.length) return { score: 55, tag: '部分可用', note: 'JSON 合法，但没抽出未来的时间点' };
    return {
      score: 100, tag: '可直接用',
      note: 'JSON 合法，抽出 ' + hits.length + ' 个时间点：' + hits.map(function (h) {
        return formatDateTime(h.at);
      }).join('、'),
      hits: hits
    };
  }

  /** 助手指令评分：只看模型给的动作能不能直接拿去执行 */
  function gradeAssistant(text, input) {
    var intent = parseIntentPayload(text);
    if (!intent) return { score: 20, tag: '不合格', note: '没能输出约定的 JSON 动作，程序接不住' };

    if (intent.action === 'create') {
      if (!intent.text) return { score: 55, tag: '部分可用', note: '认出了「建待办」，但没给标题' };
      var when = intent.times.length
        ? '，' + intent.times.map(function (t) { return formatDateTime(t); }).join('、')
        : '（没说时间）';
      return { score: 100, tag: '可直接用', note: 'create「' + intent.text + '」' + when };
    }
    if (intent.action === 'query') {
      return { score: 100, tag: '可直接用', note: 'query，范围 ' + intent.filter };
    }
    if (intent.action === 'complete' || intent.action === 'delete') {
      if (!intent.targets.length) {
        return { score: 55, tag: '部分可用', note: intent.action + ' 没给关键词，匹配不到待办' };
      }
      return { score: 95, tag: '可直接用', note: intent.action + ' 关键词：' + intent.targets.join('、') };
    }
    if (!intent.reply) return { score: 50, tag: '偏简略', note: 'reply 但没给回答内容' };
    return { score: 90, tag: '可直接用', note: 'reply：' + truncate(intent.reply, 24) };
  }

  function gradePolish(text, input) {
    var t = String(text || '').trim().replace(/^["'「]|["'」]$/g, '');
    var len = t.length;
    var filler = /那个|然后|呃|嗯|提醒我一下|帮我一下/;
    var hasFiller = filler.test(t);
    if (!len) return { score: 10, tag: '不合格', note: '没有输出内容' };
    if (len > 40) return { score: 55, tag: '偏长', note: '整理后仍有 ' + len + ' 个字，超过了 30 字的要求' };
    if (hasFiller) return { score: 70, tag: '基本可用', note: '仍有 ' + len + ' 个字，但口头语没去干净' };
    return { score: 95, tag: '可直接用', note: '压缩到 ' + len + ' 个字，口头语已清理' };
  }

  function gradeFreeform(text) {
    var t = String(text || '').trim();
    if (!t) return { score: 10, tag: '不合格', note: '没有输出内容' };
    var lines = t.split(/\n+/).filter(function (x) { return x.trim(); });
    var hasStructure = lines.length >= 2 || /[1-9][.、)]/.test(t);
    var hasReason = /因为|所以|理由|原因|建议|风险/.test(t);
    if (t.length < 30) return { score: 55, tag: '偏简略', note: '只有 ' + t.length + ' 个字，信息量偏少' };
    if (hasStructure && hasReason) {
      return { score: 95, tag: '结构清晰', note: '分 ' + lines.length + ' 段，含理由与结论' };
    }
    if (hasStructure || hasReason) {
      return { score: 80, tag: '基本可用', note: hasStructure ? '有分段，但结论/理由不够明确' : '有理由，但没有分点' };
    }
    return { score: 65, tag: '一段话', note: '没分段也没给出理由，可读性一般' };
  }

  /* ------------------------------------ 时间解析任务（语音助手 / 对比页共用）

     llmPrompt + parseLlmPayload 既是「时间解析」任务的提示词与解析器，
     也是助手在 create 意图上用的同一套时间格式约定。 */

  /** 组装「把句子里的时间抽成 JSON」的提示词 */
  function llmPrompt(text) {
    var now = new Date();
    function p2(n) { return n < 10 ? '0' + n : String(n); }
    var stamp = now.getFullYear() + '-' + p2(now.getMonth() + 1) + '-' + p2(now.getDate()) +
      ' ' + p2(now.getHours()) + ':' + p2(now.getMinutes());
    return '现在是 ' + stamp + '（星期' + '日一二三四五六'.charAt(now.getDay()) + '）。\n' +
      '请从下面这句话里抽出所有「要做某件事」的时间点，换算成 24 小时制的本地时间。\n' +
      '规则：只抽明确的绝对时间；「半小时后」「明天」这类相对说法请基于现在换算；' +
      '同一件事说了一个日期加一个时刻就算一个时间点。\n' +
      '只输出 JSON，不要解释、不要代码块，格式：{"times":[{"text":"原句里的时间片段","at":"YYYY-MM-DDTHH:mm"}]}；' +
      '没有时间就输出 {"times":[]}。\n' +
      '句子：' + text;
  }

  /** 把模型返回的 JSON 文本整理成确认条能用的结构 */
  function parseLlmPayload(payload, now) {
    var data = payload;
    if (typeof data === 'string') {
      var raw = data.trim();
      /* 模型偶尔会套一层 ```json */
      raw = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
      var start = raw.indexOf('{');
      var end = raw.lastIndexOf('}');
      if (start === -1 || end === -1 || end <= start) return [];
      try {
        data = JSON.parse(raw.slice(start, end + 1));
      } catch (error) {
        return [];
      }
    }
    if (!data || Object.prototype.toString.call(data.times) !== '[object Array]') return [];

    var out = [];
    var seen = {};
    for (var i = 0; i < data.times.length; i++) {
      var item = data.times[i] || {};
      var at = parseIsoLocal(item.at);
      if (!at || at <= now) continue;
      if (seen[at]) continue;
      seen[at] = true;
      out.push({ at: at, s: 0, e: 0, span: String(item.text || '') });
    }
    out.sort(function (a, b) { return a.at - b.at; });
    return out.slice(0, 4);
  }

  /** "2026-10-25T15:00" / "2026-10-25 15:00" 都按本地时间理解 */
  function parseIsoLocal(value) {
    var s = String(value || '').trim();
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T\s](\d{1,2}):(\d{2})/);
    if (!m) return 0;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0);
    var t = d.getTime();
    return isNaN(t) ? 0 : t;
  }

  /** 有没有可用模型（助手链路据此决定走在线还是本地） */
  function llmReady() {
    return !!pickModel('assistant').model;
  }

  /* ------------------------------------------------ 模型目录在线更新

     只更新「可选模型名」这一层，不动已经配好的档案：
       · 拉取：对每家已配置的服务商发 GET {base}/models
       · 展示：版本号 + 拉取时间 + 模型数 + 逐家进度
       · 安装：先备份上一版再整体替换，写完立刻读回来自检
       · 回滚：任何一步不对就回到上一版；也可以手动回滚
     更新期间照常发消息、照常跑任务：请求各用各的对象，档案一个字段都不改。 */

  var catalogJob = { running: false, fetched: [], failed: [], done: 0, total: 0 };

  /** https://x/v1/chat/completions → https://x/v1 */
  function endpointBaseOf(endpoint) {
    var url = String(endpoint || '').trim().replace(/\/+$/, '');
    url = url.replace(/\/chat\/completions$/i, '');
    return url;
  }

  function modelsUrlOf(endpoint) {
    var base = endpointBaseOf(endpoint);
    if (!base) return '';
    if (/\/models$/i.test(base)) return base;
    return base + '/models';
  }

  /** 各家的 /models 返回无非 data[] 或 models[] 两种形状 */
  function parseModelIds(body) {
    var out = [];
    try {
      var data = typeof body === 'string' ? JSON.parse(body) : body;
      var list = (data && data.data) || (data && data.models) || [];
      for (var i = 0; i < list.length; i++) {
        var row = list[i];
        var id = row && (row.id || row.model || row.name);
        if (typeof id === 'string' && id.trim() && out.indexOf(id.trim()) === -1) {
          out.push(id.trim());
        }
      }
    } catch (error) { /* 非 JSON 就当没拉到 */ }
    return out;
  }

  function catalogOf() {
    var cat = prefs.llmCatalog;
    /* 空目录等于没有：别让界面上出现「v0 · 0 个模型」这种假状态 */
    if (!cat || !cat.providers || !catalogCount(cat)) return null;
    return cat;
  }

  function catalogCount(cat) {
    var n = 0;
    if (!cat || !cat.providers) return 0;
    for (var k in cat.providers) {
      if (Object.prototype.hasOwnProperty.call(cat.providers, k)) {
        n += (cat.providers[k].models || []).length;
      }
    }
    return n;
  }

  /** 这个地址在目录里有没有拉回来的名单 */
  function catalogModelsFor(endpoint) {
    var cat = catalogOf();
    if (!cat) return null;
    var hit = cat.providers[endpointBaseOf(endpoint)];
    return hit && hit.models && hit.models.length ? hit.models : null;
  }

  function presetOf(endpoint) {
    var norm = normalizeEndpoint(endpoint || '');
    for (var i = 0; i < MODEL_PRESETS.length; i++) {
      if (MODEL_PRESETS[i].endpoint && normalizeEndpoint(MODEL_PRESETS[i].endpoint) === norm) {
        return MODEL_PRESETS[i];
      }
    }
    return null;
  }

  function presetHintOf(endpoint) {
    var preset = presetOf(endpoint);
    return preset && preset.hint ? preset.hint : '';
  }

  function setCatalogLog(text) {
    if (el.catalogLog) el.catalogLog.textContent = text || '';
  }

  function setCatalogProgress() {
    if (!el.catalogFill) return;
    var pct = catalogJob.total
      ? Math.round(catalogJob.done / catalogJob.total * 100) : 0;
    el.catalogFill.style.width = pct + '%';
    if (el.catalogBar) el.catalogBar.setAttribute('data-pct', String(pct));
  }

  function renderCatalog() {
    var cat = catalogOf();
    var prev = prefs.llmCatalogPrev;
    if (el.catalogVer) el.catalogVer.textContent = 'v' + (cat ? cat.rev : 0);
    if (el.catalogMeta) {
      if (!cat) {
        el.catalogMeta.textContent = '还没拉过，点「检查更新」从各家 /v1/models 取一份最新的';
      } else {
        var hosts = 0;
        for (var k in cat.providers) {
          if (Object.prototype.hasOwnProperty.call(cat.providers, k)) hosts++;
        }
        el.catalogMeta.textContent = '当前 v' + cat.rev + ' · 更新于 ' + formatDateTime(cat.at) +
          ' · ' + catalogCount(cat) + ' 个模型名 · ' + hosts + ' 家';
      }
    }
    /* 只要动过一次就留回滚入口；prev 可能是 v0（第一次更新前什么都没有） */
    show(el.catalogRollback, !!prev);
    show(el.catalogInstall, catalogJob.fetched.length > 0 && !catalogJob.running);
    if (el.catalogCheck) el.catalogCheck.disabled = !!catalogJob.running;
  }

  /* ------------------------------------------------------------ AI 用量 */

  /* 每日上限的几个档位（token）。0 = 不限。 */
  var AI_BUDGET_STEPS = [100000, 200000, 500000, 0];

  function budgetText(n) {
    if (!n || n <= 0) return '不限';
    if (n >= 10000) return Math.round(n / 10000) + ' 万';
    return String(n);
  }

  function renderAiUsage() {
    var usage = global.AiUsage;
    if (!el.aiUsageMeta && !el.aiBudgetBtn) return;

    if (!usage) {
      if (el.aiUsageMeta) el.aiUsageMeta.textContent = '用量统计未加载';
      if (el.aiBudgetBtn) el.aiBudgetBtn.textContent = '每日上限 —';
      return;
    }

    var sum = usage.summary();
    var limit = sum.dailyLimit;
    if (el.aiUsageBadge) el.aiUsageBadge.textContent = sum.calls + ' 次';
    if (el.aiUsageMeta) {
      if (!sum.calls) {
        el.aiUsageMeta.textContent = '还没有调用记录。用语音助手、模型检测、多模型对比都会记在这里。';
      } else {
        var bits = [
          '今天 ' + sum.calls + ' 次调用',
          '约 ' + sum.tokens + ' tokens（入 ' + sum.tokensIn + ' / 出 ' + sum.tokensOut + '）',
          '平均 ' + (sum.avgMs ? (sum.avgMs / 1000).toFixed(1) + 's' : '0s')
        ];
        if (sum.fail) bits.push('失败 ' + sum.fail + ' 次（' + sum.failRate + '%）');
        el.aiUsageMeta.textContent = bits.join(' · ');
      }
    }
    if (el.aiUsageFill) {
      var pct = limit > 0 ? Math.min(100, Math.round(sum.tokens / limit * 100)) : 0;
      el.aiUsageFill.style.width = pct + '%';
      if (el.aiUsageBar) el.aiUsageBar.setAttribute('data-pct', String(pct));
    }
    if (el.aiBudgetBtn) {
      el.aiBudgetBtn.textContent = '每日上限 ' + budgetText(limit) +
        (limit > 0 ? '（已用 ' + (limit ? Math.round(sum.tokens / limit * 100) : 0) + '%）' : '');
    }
    if (el.aiUsageLog) {
      var mode = keyStorageMode();
      el.aiUsageLog.textContent = mode === 'keystore'
        ? '密钥：已由系统安全芯片加密保存，页面里只有一个引用。'
        : (mode === 'plain'
          ? '密钥：当前环境没有安全芯片（网页版），密钥只存在本机浏览器里，未加密。'
          : '密钥：状态未知');
    }
    if (el.aiMaskToggle) {
      el.aiMaskToggle.setAttribute('aria-checked', prefs.aiMaskPii !== false ? 'true' : 'false');
    }
  }

  function cycleAiBudget() {
    var usage = global.AiUsage;
    if (!usage) return;
    var current = usage.dailyLimit();
    var idx = AI_BUDGET_STEPS.indexOf(current);
    var next = AI_BUDGET_STEPS[(idx + 1) % AI_BUDGET_STEPS.length];
    usage.setDailyLimit(next);
    renderAiUsage();
    toast(next > 0 ? '每日上限设为 ' + budgetText(next) + ' tokens' : '不再限制每日用量');
  }

  function clearAiUsage() {
    var usage = global.AiUsage;
    if (!usage) return;
    askConfirm({
      title: '清空用量统计',
      text: '只清掉调用次数与 token 记录，模型档案和提醒都不受影响。',
      okText: '清空',
      tone: 'danger'
    }).then(function (result) {
      if (result !== 'ok') return;
      usage.clear();
      renderAiUsage();
      toast('统计已清空');
    });
  }

  function toggleAiMask() {
    prefs.aiMaskPii = prefs.aiMaskPii === false;
    savePrefs();
    if (el.aiMaskToggle) {
      el.aiMaskToggle.setAttribute('aria-checked', prefs.aiMaskPii ? 'true' : 'false');
    }
    toast(prefs.aiMaskPii ? '发送前会先给敏感信息打码' : '原文照发，不再打码');
  }

  /** 一家一家拉，进度条按「已完成家数 / 总家数」走 */
  function checkModelCatalog() {
    if (catalogJob.running) return;
    var list = usableModels();
    var hosts = [];
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var base = endpointBaseOf(list[i].endpoint);
      if (!base || seen[base]) continue;
      seen[base] = 1;
      hosts.push({
        base: base, endpoint: list[i].endpoint,
        key: list[i].key, keyRef: list[i].keyRef,
        name: modelTitle(list[i])
      });
    }
    if (!hosts.length) {
      setCatalogLog('先添加一份填好密钥的模型档案，有密钥才查得到各家的模型清单');
      return;
    }

    catalogJob = { running: true, fetched: [], failed: [], done: 0, total: hosts.length };
    show(el.catalogBar, true);
    setCatalogProgress();
    setCatalogLog('正在检查 ' + hosts.length + ' 家服务商…');
    renderCatalog();

    var queue = hosts.slice();
    var lines = [];

    /* 每家给两次机会：移动网络下 12 秒太紧（实测桌面拉个 401 都要 4~5 秒），
       超时又不在网关重试范围里，第一版经常「一家都没拉到」。
       现在拉清单用 25 秒超时，失败自动重试一次再记账。 */
    var CATALOG_TIMEOUT = 25000;

    function recordFailure(host, name, reason, triesLeft) {
      catalogJob.failed.push(host.base);
      lines.push('· ' + name + '：' + reason +
        (triesLeft > 0 ? '，重试一次…' : ''));
    }

    function step() {
      var host = queue.shift();
      if (!host) { finishCheck(lines); return; }
      var url = modelsUrlOf(host.endpoint);
      var name = host.name || host.base;
      var triesLeft = 1;   /* 首次 + 重试 1 次 */

      function attempt() {
        netRequest({
          method: 'GET', url: url,
          headers: authHeadersOf({
            key: host.key, keyRef: host.keyRef, endpoint: host.endpoint
          }, false),
          timeout: CATALOG_TIMEOUT
        }, function (err, status, body) {
          if (err) {
            if (triesLeft > 0) { triesLeft--; attempt(); return; }
            recordFailure(host, name, '没连上（' + err + '）', 0);
          } else if (status < 200 || status >= 300) {
            if (status >= 500 || status === 429) {
              /* 服务端抖动值得再试；401/404 这类重试也不会好 */
              if (triesLeft > 0) { triesLeft--; attempt(); return; }
            }
            recordFailure(host, name, 'HTTP ' + status, 0);
          } else {
            var ids = parseModelIds(body);
            if (!ids.length) {
              if (triesLeft > 0) { triesLeft--; attempt(); return; }
              recordFailure(host, name, '返回里没有模型名', 0);
            } else {
              catalogJob.fetched.push({
                base: host.base, endpoint: host.endpoint, name: name, models: ids
              });
              lines.push('· ' + name + '：' + ids.length + ' 个模型');
            }
          }
          catalogJob.done++;
          setCatalogProgress();
          setCatalogLog(lines.join('\n'));
          step();
        });
      }

      attempt();
    }

    step();
  }

  function finishCheck(lines) {
    catalogJob.running = false;
    if (el.catalogBar) {
      el.catalogFill.style.width = '100%';
      global.setTimeout(function () { show(el.catalogBar, false); }, 400);
    }
    if (!catalogJob.fetched.length) {
      setCatalogLog((lines || []).join('\n') + '\n一家都没拉到，保留当前版本不变');
      renderCatalog();
      return;
    }

    /* 和当前目录比一比，说清「新在哪」 */
    var old = catalogOf();
    var fresh = [];
    for (var i = 0; i < catalogJob.fetched.length; i++) {
      var f = catalogJob.fetched[i];
      var had = old && old.providers && old.providers[f.base]
        ? old.providers[f.base].models || [] : [];
      for (var j = 0; j < f.models.length; j++) {
        if (had.indexOf(f.models[j]) === -1 && fresh.indexOf(f.models[j]) === -1) {
          fresh.push(f.models[j]);
        }
      }
    }
    var tail = fresh.length
      ? '\n新增 ' + fresh.length + ' 个：' + fresh.slice(0, 6).join('、') + (fresh.length > 6 ? ' 等' : '')
      : '\n和当前目录一致，没有新模型';
    if (catalogJob.failed.length) tail += '\n有 ' + catalogJob.failed.length + ' 家没拉到，安装时会保留它们原来的名单';
    setCatalogLog(lines.join('\n') + tail + '\n点「安装更新」生效（不影响正在用的模型）');
    renderCatalog();
  }

  /** 安装：备份 → 整体替换 → 读回自检；任何一步不对就自动回滚 */
  function installCatalogUpdate() {
    if (catalogJob.running || !catalogJob.fetched.length) return;

    var prev = catalogOf();
    var next = { rev: (prev ? prev.rev : 0) + 1, at: Date.now(), providers: {} };
    /* 先继承上一版：这次没拉到的服务商沿用旧名单，不是「删掉」 */
    if (prev) {
      for (var k in prev.providers) {
        if (Object.prototype.hasOwnProperty.call(prev.providers, k)) {
          next.providers[k] = prev.providers[k];
        }
      }
    }
    for (var i = 0; i < catalogJob.fetched.length; i++) {
      var f = catalogJob.fetched[i];
      next.providers[f.base] = { name: f.name, models: f.models, at: next.at };
    }

    if (!catalogCount(next)) {
      setCatalogLog('拉回来的名单是空的，不覆盖当前版本');
      return;
    }

    /* 第一次更新时 prev 是 null，用一个空目录占位，保证「装坏了还能退回去」 */
    prefs.llmCatalogPrev = prev || { rev: 0, at: 0, providers: {} };
    prefs.llmCatalog = next;
    savePrefs();

    /* 写后自检：读回来的必须能解析、版本号对得上、至少还有模型 */
    var back = (Store.read(PREFS_KEY, {}) || {}).llmCatalog;
    if (!back || back.rev !== next.rev || catalogCount(back) < 1) {
      rollbackCatalog(true);
      return;
    }

    catalogJob.fetched = [];
    setCatalogLog('已更新到 v' + next.rev + '，共 ' + catalogCount(next) +
      ' 个模型名。已配好的档案、正在用的模型都没动过。');
    renderCatalog();
    refreshModelChipsIfOpen();
    toast('模型目录已更新到 v' + next.rev);
  }

  /** 回滚：手动点，或写后自检失败时自动调用 */
  function rollbackCatalog(auto) {
    var prev = prefs.llmCatalogPrev;
    if (!prev) {
      setCatalogLog('没有可回滚的上一版');
      return;
    }
    var rev = prev.rev || 0;
    prefs.llmCatalog = rev ? prev : null;
    prefs.llmCatalogPrev = null;
    savePrefs();
    catalogJob.fetched = [];
    setCatalogLog(auto
      ? '新版本没通过自检，已自动回到 v' + rev
      : '已回滚到 v' + rev + '，模型档案和待办都没受影响');
    renderCatalog();
    refreshModelChipsIfOpen();
    toast(auto ? '更新失败，已回到 v' + rev : '已回滚到 v' + rev);
  }

  /** 目录变了就把模型名下面的芯片刷新一遍（编辑弹层开着才有意义） */
  function refreshModelChipsIfOpen() {
    if (!el.modelLayer || el.modelLayer.classList.contains('is-hidden')) return;
    var endpoint = el.modelEndpoint ? el.modelEndpoint.value : '';
    renderModelChips(presetModelsOf(endpoint), el.modelId ? el.modelId.value : '',
      presetHintOf(endpoint));
  }

  /* ==================================================== 模型库界面 */

  var modelSheet = { id: '', probe: null, caps: null };

  function copyCaps(src) {
    var base = defaultCaps();
    if (src && typeof src === 'object') {
      for (var i = 0; i < CAP_KEYS.length; i++) {
        var k = CAP_KEYS[i];
        var n = Number(src[k]);
        if (n >= 1 && n <= 3) base[k] = n;
      }
    }
    return base;
  }

  function renderModelLibrary() {
    if (!el.llmModelList) return;
    var list = prefs.llmModels;
    el.llmModelList.textContent = '';

    if (!list.length) {
      var empty = document.createElement('p');
      empty.className = 'mdl__empty';
      empty.textContent = '还没有配置模型。点「添加模型」，把地址、模型名和密钥填上就能用。';
      el.llmModelList.appendChild(empty);
    }
    for (var i = 0; i < list.length; i++) {
      el.llmModelList.appendChild(buildModelCard(list[i]));
    }
    renderRouteState();
    renderCompareModels();
  }

  function capText(m, key) {
    var level = (m && m.caps && m.caps[key]) || 2;
    return CAP_LEVELS[level - 1];
  }

  function buildModelCard(m) {
    var card = document.createElement('div');
    card.className = 'mdl' + (m.id === prefs.llmActiveId ? ' is-active' : '');
    card.setAttribute('data-id', m.id);

    var head = '<div class="mdl__head">' +
      '<span class="mdl__dot" aria-hidden="true"></span>' +
      '<span class="mdl__name">' + escapeHtml(modelTitle(m)) + '</span>' +
      (m.id === prefs.llmActiveId && prefs.llmRoute === 'manual'
        ? '<span class="mdl__badge">手动指定中</span>' : '') +
      (modelReady(m) ? '' : '<span class="mdl__badge mdl__badge--warn">未填完</span>') +
      '</div>';

    var idLine = escapeHtml(m.model || '（未填模型名）');
    if (m.probe && m.probe.ok && m.probe.realModel && m.probe.realModel !== m.model) {
      idLine += ' <b>→ 实际 ' + escapeHtml(m.probe.realModel) + '</b>';
    }
    var info = '<p class="mdl__info' + (m.probe && m.probe.ok ? ' is-ok' : '') + '">' +
      escapeHtml(probeLine(m)) +
      (m.probe && m.probe.at ? ' · ' + probeAge(m.probe) : '') + '</p>';

    var caps = [];
    for (var c = 0; c < CAP_KEYS.length; c++) {
      var k = CAP_KEYS[c];
      caps.push('<span class="mdl__cap">' + CAP_NAMES[k] + ' ' + capText(m, k) + '</span>');
    }

    card.innerHTML = head +
      '<p class="mdl__id">' + idLine + '</p>' +
      info +
      '<div class="mdl__caps">' + caps.join('') + '</div>' +
      '<div class="mdl__acts">' +
      '<button type="button" class="mdl__btn" data-act="probe">检测信息</button>' +
      '<button type="button" class="mdl__btn" data-act="use">指定使用</button>' +
      '<button type="button" class="mdl__btn" data-act="edit">编辑</button>' +
      '<button type="button" class="mdl__btn mdl__btn--danger" data-act="del">删除</button>' +
      '</div>';
    return card;
  }

  function setLlmStatus(text, tone) {
    var node = el.llmStatus;
    if (!node) return;
    node.textContent = text || '';
    node.classList.toggle('is-ok', tone === 'ok');
    node.classList.toggle('is-bad', tone === 'bad');
  }

  function renderRouteState() {
    var route = prefs.llmRoute === 'manual' ? 'manual' : 'auto';
    if (el.llmRoutePick) {
      var btns = el.llmRoutePick.querySelectorAll('[data-route]');
      for (var i = 0; i < btns.length; i++) {
        var on = btns[i].getAttribute('data-route') === route;
        btns[i].classList.toggle('is-active', on);
        btns[i].setAttribute('aria-checked', on ? 'true' : 'false');
      }
    }
    if (!el.llmRouteDesc) return;
    if (!usableModels().length) {
      el.llmRouteDesc.textContent = '还没有可用模型，语音助手会自动退回本地规则';
      return;
    }
    var pick = pickModel('parse');
    if (!pick.model) { el.llmRouteDesc.textContent = ''; return; }
    var tail = '语音助手会用「' + modelTitle(pick.model) + '」';
    if (pick.model.model) tail += '（' + pick.model.model + '）';
    el.llmRouteDesc.textContent =
      (route === 'manual' ? '固定用指定模型，不做自动挑选。' : '按任务自动挑最合适的模型。') + tail;
  }

  /* ------------------------------------------------ 模型档案编辑弹层 */

  function renderModelPresets(endpoint) {
    if (!el.modelPresets) return;
    var norm = normalizeEndpoint(endpoint || '');
    el.modelPresets.textContent = '';
    for (var i = 0; i < MODEL_PRESETS.length; i++) {
      var preset = MODEL_PRESETS[i];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mdlpreset__btn';
      btn.setAttribute('data-preset', preset.key);
      btn.textContent = preset.name;
      var on = preset.key === 'custom'
        ? (!norm || !MODEL_PRESETS.some(function (p) {
          return p.endpoint && normalizeEndpoint(p.endpoint) === norm;
        }))
        : (!!preset.endpoint && normalizeEndpoint(preset.endpoint) === norm);
      if (on) btn.classList.add('is-active');
      el.modelPresets.appendChild(btn);
    }
  }

  function applyPreset(key) {
    var preset = null;
    for (var i = 0; i < MODEL_PRESETS.length; i++) {
      if (MODEL_PRESETS[i].key === key) preset = MODEL_PRESETS[i];
    }
    if (!preset) return;
    if (el.modelEndpoint) el.modelEndpoint.value = preset.endpoint;
    if (el.modelId) el.modelId.value = preset.models.length ? preset.models[0] : '';
    /* 名字是自动填的就跟着换服务商；用户自己起过名的就别改 */
    var curName = String((el.modelName && el.modelName.value) || '').trim();
    var autoNamed = !curName || MODEL_PRESETS.some(function (p) { return p.name === curName; });
    if (el.modelName && autoNamed) el.modelName.value = preset.name;
    renderModelPresets(preset.endpoint);
    renderModelChips(presetModelsOf(preset.endpoint), el.modelId ? el.modelId.value : '',
      preset.hint || '');
    /* 换服务商就顺手换一套画像，用户点过就不动 */
    if (!modelSheet.capsTouched && preset.models.length) {
      var traits = traitsOf(preset.models[0]);
      if (traits) {
        modelSheet.caps = copyCaps(traits.caps);
        renderCapsEditor();
      }
    }
  }

  /** 预设模型名做成小芯片，点一下就填进模型名输入框 */
  function renderModelChips(models, current, hint) {
    if (!el.modelChips) return;
    el.modelChips.textContent = '';
    if (el.modelHint) {
      show(el.modelHint, !!hint);
      el.modelHint.textContent = hint || '';
    }
    if (!models || !models.length) {
      show(el.modelChips, false);
      return;
    }
    show(el.modelChips, true);
    for (var i = 0; i < models.length; i++) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mdlchip' + (models[i] === current ? ' is-active' : '');
      btn.setAttribute('data-model', models[i]);
      btn.textContent = models[i];
      el.modelChips.appendChild(btn);
    }
  }

  function renderCapsEditor() {
    if (!el.modelCaps) return;
    var caps = modelSheet.caps || defaultCaps();
    var html = '';
    for (var i = 0; i < CAP_KEYS.length; i++) {
      var key = CAP_KEYS[i];
      html += '<div class="caprow"><span class="caprow__name">' + CAP_NAMES[key] + '</span>' +
        '<span class="caprow__opts">';
      for (var lv = 1; lv <= 3; lv++) {
        html += '<button type="button" class="caprow__btn' +
          (caps[key] === lv ? ' is-active' : '') +
          '" data-cap="' + key + '" data-level="' + lv + '" role="radio" aria-checked="' +
          (caps[key] === lv ? 'true' : 'false') + '">' + CAP_LEVELS[lv - 1] + '</button>';
      }
      html += '</span></div>';
    }
    el.modelCaps.innerHTML = html;
  }

  function setModelProbeText(text, tone) {
    if (!el.modelProbeResult) return;
    el.modelProbeResult.textContent = text || '';
    el.modelProbeResult.classList.toggle('is-ok', tone === 'ok');
    el.modelProbeResult.classList.toggle('is-bad', tone === 'bad');
  }

  function renderModelProbeResult() {
    var p = modelSheet.probe;
    if (!p) {
      setModelProbeText('点「检测信息」可以读到接口返回的真实模型标识、版本和延迟', '');
      return;
    }
    if (!p.ok) {
      setModelProbeText('检测失败：' + (p.note || '未知原因'), 'bad');
      return;
    }
    var lines = [];
    lines.push('模型标识：' + (p.realModel || '接口未返回'));
    /* 版本号在 OpenAI 兼容接口里根本没有对应字段（各家 /models 与
       chat/completions 都不返回 version），只能从接口回传的模型标识里推断 */
    lines.push('版本：' + (p.version
      ? p.version + '（按模型标识推断）'
      : '接口不提供版本字段，模型标识里也推不出来'));
    lines.push('上下文：' + (p.ctx ? '约 ' + p.ctx : '接口未返回，按模型名估算'));
    lines.push('首包延迟：' + (p.latency ? (p.latency / 1000).toFixed(1) + ' 秒' : '未测到'));
    if (p.models) lines.push('可用模型数：' + p.models);
    lines.push('输出特点：' + (p.reasoning ? '推理型（先思考再回答，慢一些）' : '直出型（拿到就回答）'));
    setModelProbeText(lines.join('\n'), 'ok');
  }

  function openModelSheet(id) {
    var m = id ? findModel(id) : null;
    modelSheet.id = m ? m.id : '';
    modelSheet.probe = m && m.probe ? m.probe : null;
    modelSheet.caps = copyCaps(m ? m.caps : null);
    modelSheet.capsTouched = false;

    if (el.modelSheetTitle) el.modelSheetTitle.textContent = m ? '编辑模型' : '添加模型';
    if (el.modelName) el.modelName.value = m ? (m.name || '') : '';
    if (el.modelEndpoint) el.modelEndpoint.value = m ? (m.endpoint || '') : '';
    if (el.modelId) el.modelId.value = m ? (m.model || '') : '';
    if (el.modelKey) {
      /* 密钥已经进安全仓库时不回填明文：留空表示「沿用原来那把」 */
      el.modelKey.value = m ? (m.key || '') : '';
      el.modelKey.placeholder = m && m.keyRef && !m.key
        ? '已保存在安全芯片里，留空表示不修改'
        : 'sk-...';
      el.modelKey.setAttribute('type', 'password');
    }
    if (el.modelKeyEye) {
      el.modelKeyEye.setAttribute('aria-pressed', 'false');
      el.modelKeyEye.setAttribute('aria-label', '显示密钥');
    }

    /* 新档案先给一套默认值，省得从零敲地址和模型名 */
    if (!m) {
      if (el.modelEndpoint) el.modelEndpoint.value = MODEL_PRESETS[0].endpoint;
      if (el.modelId) el.modelId.value = MODEL_PRESETS[0].models[0];
      if (el.modelName) el.modelName.value = MODEL_PRESETS[0].name;
      /* 能力画像跟着默认模型名走，省得用户再点四行 */
      var presetTraits = traitsOf(MODEL_PRESETS[0].models[0]);
      if (presetTraits) modelSheet.caps = copyCaps(presetTraits.caps);
    }

    var current = el.modelEndpoint ? el.modelEndpoint.value : '';
    renderModelPresets(current);
    renderModelChips(presetModelsOf(current), el.modelId ? el.modelId.value : '',
      presetHintOf(current));
    renderCapsEditor();
    renderModelProbeResult();
    show(el.modelLayer, true);
  }

  /** 当前地址属于哪个预设，就给出那套常用模型名 */
  /** 可选模型名：在线目录优先（那是刚从各家拉回来的真名单），没有就用内置预设 */
  function presetModelsOf(endpoint) {
    var online = catalogModelsFor(endpoint);
    if (online) return online;
    var preset = presetOf(endpoint);
    return preset ? preset.models : [];
  }

  function closeModelSheet() {
    show(el.modelLayer, false);
  }

  function readModelForm() {
    var endpoint = normalizeEndpoint(el.modelEndpoint ? el.modelEndpoint.value : '');
    var model = el.modelId ? String(el.modelId.value || '').trim() : '';
    var name = el.modelName ? String(el.modelName.value || '').trim() : '';
    if (!name) name = model || '未命名模型';
    /* 密钥已经在仓库里时，输入框是空的：「留空 = 不改」 */
    var existing = modelSheet.id ? findModel(modelSheet.id) : null;
    return {
      name: name,
      endpoint: endpoint,
      model: model,
      key: el.modelKey ? String(el.modelKey.value || '').trim() : '',
      keyRef: existing && existing.keyRef ? existing.keyRef : '',
      caps: copyCaps(modelSheet.caps)
    };
  }

  /**
   * 把表单里的明文密钥交给安全仓库，返回引用。
   * 仓库不可用（网页版）就返回空串，明文照旧留在档案里，设置页会如实说明。
   */
  function storeSecret(existing, plainKey) {
    var vault = global.KeyVault;
    if (!vault || typeof vault.put !== 'function' || !vault.available()) return '';
    var ref = (existing && existing.keyRef) || vault.newRef();
    return vault.put(ref, plainKey) ? ref : '';
  }

  function saveModelForm() {
    var cfg = readModelForm();
    if (!cfg.endpoint || (!cfg.key && !cfg.keyRef)) {
      setModelProbeText('地址和 API Key 都要填', 'bad');
      return false;
    }
    if (!/^https?:\/\/[^\s]+$/i.test(cfg.endpoint)) {
      setModelProbeText('地址格式不对，应该像 https://api.xxx.com/v1/chat/completions', 'bad');
      return false;
    }

    var existing = modelSheet.id ? findModel(modelSheet.id) : null;
    /* 先加密落库再决定内存里留不留明文；留空表示沿用仓库里那把 */
    var ref = cfg.key ? storeSecret(existing, cfg.key) : cfg.keyRef;
    if (existing) {
      existing.name = cfg.name;
      existing.endpoint = cfg.endpoint;
      existing.model = cfg.model;
      existing.key = ref ? '' : cfg.key;
      existing.keyRef = ref || '';
      existing.caps = cfg.caps;
      if (modelSheet.probe) existing.probe = modelSheet.probe;
    } else {
      var created = {
        id: newModelId(), name: cfg.name, endpoint: cfg.endpoint, model: cfg.model,
        key: ref ? '' : cfg.key, keyRef: ref,
        caps: cfg.caps, probe: modelSheet.probe || null
      };
      prefs.llmModels.push(created);
      if (!prefs.llmActiveId) prefs.llmActiveId = created.id;
    }
    if (el.modelEndpoint) el.modelEndpoint.value = cfg.endpoint;
    if (el.modelId) el.modelId.value = cfg.model;
    savePrefs();
    renderModelLibrary();
    closeModelSheet();
    toast(existing ? '模型已更新' : '模型已添加');
    return true;
  }

  /** 检测当前表单里的配置（还没保存也能测） */
  function probeDraft() {
    var cfg = readModelForm();
    if (!cfg.endpoint || (!cfg.key && !cfg.keyRef)) {
      setModelProbeText('先把地址和 API Key 填上', 'bad');
      return;
    }
    setModelProbeText('正在连接并读取模型信息…', '');
    if (el.modelProbeBtn) el.modelProbeBtn.disabled = true;
    probeModel(cfg, function (info) {
      if (el.modelProbeBtn) el.modelProbeBtn.disabled = false;
      modelSheet.probe = info;
      /* 用户没填模型名，但接口给了列表，就顺手补上第一个 */
      if (info.ok && el.modelId && !String(el.modelId.value || '').trim() && info.realModel) {
        el.modelId.value = info.realModel;
      }
      if (info.ok && !modelSheet.capsTouched) {
        var traits = traitsOf(info.realModel || (el.modelId ? el.modelId.value : ''));
        if (traits) {
          modelSheet.caps = copyCaps(traits.caps);
          renderCapsEditor();
        }
      }
      renderModelProbeResult();
      if (info.ok) toast('检测通过：' + (info.realModel || '已连接'));
    });
  }

  function deleteModel(id) {
    var m = findModel(id);
    if (!m) return;
    askConfirm({
      title: '删除模型',
      text: '「' + modelTitle(m) + '」的地址和密钥会一起删掉，删除后不能恢复。',
      okText: '删除',
      tone: 'danger'
    }).then(function (result) {
      if (result !== 'ok') return;
      /* 删档案就连仓库里的那把钥匙一起删，别留孤立的密文 */
      var vault = global.KeyVault;
      if (m.keyRef && vault && typeof vault.remove === 'function') vault.remove(m.keyRef);
      prefs.llmModels = prefs.llmModels.filter(function (x) { return x.id !== id; });
      if (prefs.llmActiveId === id) {
        prefs.llmActiveId = prefs.llmModels.length ? prefs.llmModels[0].id : '';
      }
      savePrefs();
      renderModelLibrary();
      toast('已删除');
    });
  }

  function useModel(id) {
    var m = findModel(id);
    if (!m) return;
    if (!modelReady(m)) { toast('这份档案还没填完地址和密钥'); return; }
    prefs.llmActiveId = id;
    if (prefs.llmRoute !== 'manual') prefs.llmRoute = 'manual';
    savePrefs();
    renderModelLibrary();
    toast('已指定使用「' + modelTitle(m) + '」');
  }

  /** 画像还是四项「中」= 从没设过，按真实模型名补一套更贴近的 */
  function refineCaps(m, realModel) {
    var caps = m.caps || null;
    var blank = true;
    for (var i = 0; i < CAP_KEYS.length; i++) {
      if ((caps && caps[CAP_KEYS[i]]) !== 2) blank = false;
    }
    if (!blank) return false;
    if (m.probe && m.probe.reasoning) {
      m.caps = { json: 2, speed: 1, zh: 3, reason: 3 };
      return true;
    }
    var traits = traitsOf(realModel || m.model);
    if (!traits) return false;
    m.caps = copyCaps(traits.caps);
    return true;
  }

  /** 用实测结果校正「速度」这一项：推理型、或实测很慢的，别再标成快 */
  function adjustCapsByProbe(m) {
    var p = m.probe;
    if (!p || !p.ok) return false;
    var caps = copyCaps(m.caps);
    var speed = caps.speed;
    if (p.reasoning) speed = 1;
    if (p.latency) {
      var measured = p.latency > 6000 ? 1 : (p.latency > 2500 ? 2 : 3);
      if (measured < speed) speed = measured;
    }
    if (speed === caps.speed) return false;
    caps.speed = speed;
    m.caps = caps;
    return true;
  }

  /** 卡片上的「检测信息」 */
  function probeModelCard(id) {
    var m = findModel(id);
    if (!m) return;
    if (!modelReady(m)) { toast('这份档案还没填完地址和密钥'); return; }
    toast('正在检测「' + modelTitle(m) + '」…');
    probeModel(m, function (info) {
      m.probe = info;
      if (info.ok) {
        refineCaps(m, info.realModel);
        adjustCapsByProbe(m);
      }
      savePrefs();
      renderModelLibrary();
      toast(info.ok ? '检测通过：' + (info.realModel || '已连接') : '检测失败：' + (info.note || ''));
    });
  }

  /* ------------------------------------------------ 模型对比 */

  var compare = { task: 'parse', picked: {}, running: false };

  function renderCompareTasks() {
    if (!el.compareTasks) return;
    el.compareTasks.textContent = '';
    for (var i = 0; i < TASK_KEYS.length; i++) {
      var key = TASK_KEYS[i];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cmp__task' + (compare.task === key ? ' is-active' : '');
      btn.setAttribute('data-task', key);
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', compare.task === key ? 'true' : 'false');
      btn.textContent = LLM_TASKS[key].name;
      el.compareTasks.appendChild(btn);
    }
    if (el.compareTaskDesc) el.compareTaskDesc.textContent = LLM_TASKS[compare.task].desc;
    if (el.compareAutoHint) el.compareAutoHint.textContent = '';
  }

  function renderCompareModels() {
    if (!el.compareModels) return;
    var list = prefs.llmModels;
    el.compareModels.textContent = '';
    if (!list.length) {
      var empty = document.createElement('p');
      empty.className = 'mdl__empty';
      empty.textContent = '先添加模型，才能拿来对比。';
      el.compareModels.appendChild(empty);
      return;
    }
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      var id = 'cmp-' + m.id;
      var row = document.createElement('label');
      row.className = 'cmp__pick' + (modelReady(m) ? '' : ' is-off');
      row.setAttribute('for', id);
      row.innerHTML = '<input type="checkbox" id="' + id + '" data-id="' + m.id + '"' +
        (compare.picked[m.id] ? ' checked' : '') + (modelReady(m) ? '' : ' disabled') + ' />' +
        '<span class="cmp__pickname">' + escapeHtml(modelTitle(m)) + '</span>' +
        '<span class="cmp__pickmodel">' + escapeHtml(m.model || '未填模型名') + '</span>';
      el.compareModels.appendChild(row);
    }
  }

  function setCompareStatus(text, tone) {
    if (!el.compareStatus) return;
    el.compareStatus.textContent = text || '';
    el.compareStatus.classList.toggle('is-ok', tone === 'ok');
    el.compareStatus.classList.toggle('is-bad', tone === 'bad');
  }

  function openCompare() {
    compare.running = false;
    var pickedCount = 0;
    for (var k in compare.picked) if (compare.picked[k]) pickedCount++;
    if (!pickedCount) {
      /* 默认勾前两个能用的，直接点「开始对比」就有结果 */
      var usable = usableModels();
      for (var i = 0; i < usable.length && i < 2; i++) compare.picked[usable[i].id] = true;
    }
    if (el.compareInput) el.compareInput.value = LLM_TASKS[compare.task].sample;
    if (el.compareResults) el.compareResults.textContent = '';
    setCompareStatus('', '');
    renderCompareTasks();
    renderCompareModels();
    show(el.compareLayer, true);
  }

  function closeCompare() {
    if (compare.running) return;
    show(el.compareLayer, false);
  }

  function buildCompareCard(model) {
    var card = document.createElement('div');
    card.className = 'cmp__card';
    card.setAttribute('data-cid', model.id);
    card.innerHTML = '<div class="cmp__head">' +
      '<span class="cmp__name">' + escapeHtml(modelTitle(model)) + '</span>' +
      '<span class="cmp__meta">请求中…</span>' +
      '</div><div class="cmp__body"><span class="cmp__wait">正在等这个模型回答…</span></div>';
    return card;
  }

  function updateCompareCard(model, err, res) {
    if (!el.compareResults) return;
    var card = el.compareResults.querySelector('[data-cid="' + model.id + '"]');
    if (!card) return;
    var meta = card.querySelector('.cmp__meta');
    var body = card.querySelector('.cmp__body');

    if (err) {
      meta.textContent = res && res.ms ? (res.ms / 1000).toFixed(1) + 's · 失败' : '失败';
      meta.classList.add('is-bad');
      body.innerHTML = '<span class="cmp__err">' + escapeHtml(err) + '</span>';
      return;
    }

    var real = res.realModel || model.model || '';
    var ver = versionOf(real);
    var bits = [(res.ms / 1000).toFixed(1) + 's'];
    if (real) bits.push(real + (ver && real.indexOf(ver) === -1 ? '（' + ver + '）' : ''));
    if (res.usage && res.usage.total_tokens) bits.push(res.usage.total_tokens + ' tokens');
    meta.textContent = bits.join(' · ');

    var grade = res.grade || { score: 0, tag: '', note: '' };
    var html = '<div class="cmp__grade">' +
      '<span class="cmp__score" data-score="' + (grade.score >= 80 ? 'good' : grade.score >= 55 ? 'mid' : 'bad') + '">' +
      grade.score + '</span>' +
      '<span class="cmp__tag">' + escapeHtml(grade.tag || '') + '</span>' +
      '<span class="cmp__note">' + escapeHtml(grade.note || '') + '</span>' +
      '</div>' +
      '<pre class="cmp__out">' + escapeHtml(res.text) + '</pre>';
    body.innerHTML = html;
  }

  function runCompare() {
    if (compare.running) return;
    var picked = [];
    for (var i = 0; i < prefs.llmModels.length; i++) {
      var m = prefs.llmModels[i];
      if (compare.picked[m.id] && modelReady(m)) picked.push(m);
    }
    if (!picked.length) {
      setCompareStatus('至少勾选一个填好地址和密钥的模型', 'bad');
      return;
    }
    var task = LLM_TASKS[compare.task];
    var input = String((el.compareInput && el.compareInput.value) || '').trim() || task.sample;

    compare.running = true;
    if (el.compareRun) {
      el.compareRun.disabled = true;
      el.compareRun.textContent = '对比中…';
    }
    setCompareStatus('正在同时请求 ' + picked.length + ' 个模型，同一段输入、同一套提示词…', '');
    if (el.compareResults) el.compareResults.textContent = '';

    var left = picked.length;
    for (var j = 0; j < picked.length; j++) {
      (function (model) {
        if (el.compareResults) el.compareResults.appendChild(buildCompareCard(model));
        runTask(model, compare.task, input, function (err, res) {
          updateCompareCard(model, err, res);
          left--;
          if (left === 0) {
            compare.running = false;
            if (el.compareRun) {
              el.compareRun.disabled = false;
              el.compareRun.textContent = '开始对比';
            }
            setCompareStatus('完成，共 ' + picked.length + ' 个模型。分数只看「能不能直接用」，不是模型评测。', 'ok');
          }
        });
      })(picked[j]);
    }
  }

  /** 「看看自动会选谁」：把路由决策摊开给用户看 */
  function showAutoPick() {
    var pick = pickModel(compare.task);
    if (!pick.model) {
      setCompareStatus('还没有可用模型，先回上一页添加', 'bad');
      return;
    }
    setCompareStatus('自动选择：' + modelTitle(pick.model) + '（' + pick.reason + '）', 'ok');
  }

  /* ------------------------------------------------------------ 账号操作

     登录页上的四件事共用一个弹层，内容按流程现渲染：
       change  修改密码 —— 必须给对原密码
       forgot  忘记密码 —— 先用指纹 / 面容 / 锁屏密码验证身份，再设新密码
       delete  注销账号 —— 三步确认，连数据一起删
     ========================================================================== */

  var authSheet = { kind: '', step: 1, name: '', verified: false, busy: false };

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function lastUserName() {
    if (state.user && state.user.name) return state.user.name;
    if (el.loginUsername && el.loginUsername.value) return el.loginUsername.value.trim();
    var saved = Store.read('lastName', '');
    return typeof saved === 'string' ? saved : '';
  }

  function openAuthSheet(kind) {
    if (!el.authLayer) return;
    authSheet = { kind: kind, step: 1, name: lastUserName(), verified: false, busy: false };
    renderAuthSheet();
    show(el.authLayer, true);
  }

  function closeAuthSheet() {
    show(el.authLayer, false);
    authSheet.kind = '';
  }

  function renderAuthSheet() {
    if (!el.authSheetBody) return;
    el.authSheetBody.textContent = '';
    el.authSheetActions.textContent = '';
    el.authSheetSub.className = 'sheet__sub';

    if (authSheet.kind === 'change') renderChangeForm();
    else if (authSheet.kind === 'forgot') renderForgotForm();
    else if (authSheet.kind === 'delete') renderDeleteStep();
  }

  /* ---------------------------------------------------------- 弹层小零件 */

  function buildField(labelText, id, type, placeholder, value) {
    var wrap = document.createElement('label');
    wrap.className = 'field';
    wrap.setAttribute('for', id);

    var label = document.createElement('span');
    label.className = 'field__label';
    label.textContent = labelText;

    var input = document.createElement('input');
    input.className = 'field__input';
    input.id = id;
    input.type = type || 'text';
    input.autocomplete = 'off';
    if (placeholder) input.placeholder = placeholder;
    if (value) input.value = value;

    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  function buildError() {
    var p = document.createElement('p');
    p.className = 'form__error';
    p.id = 'auth-sheet-error';
    p.setAttribute('role', 'alert');
    return p;
  }

  function setSheetError(text) {
    var node = document.getElementById('auth-sheet-error');
    if (node) node.textContent = text || '';
  }

  function buildTip(html, danger) {
    var box = document.createElement('div');
    box.className = 'tipbox' + (danger ? ' tipbox--danger' : '');
    box.innerHTML = html;
    return box;
  }

  function buildSteps(current, total) {
    var wrap = document.createElement('div');
    wrap.className = 'stepdots';
    for (var i = 1; i <= total; i++) {
      var dot = document.createElement('i');
      if (i <= current) dot.className = 'is-on';
      wrap.appendChild(dot);
    }
    return wrap;
  }

  function buildAction(label, kind, onClick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn ' + (kind === 'primary' ? 'btn--primary'
      : kind === 'danger' ? 'btn--danger' : 'btn--ghost');
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function inputValue(id) {
    var node = document.getElementById(id);
    return node ? String(node.value || '') : '';
  }

  /* ------------------------------------------------------------ 修改密码 */

  function renderChangeForm() {
    el.authSheetTitle.textContent = '修改密码';
    el.authSheetSub.textContent = '需要先确认原密码，改完之后用新密码登录。';

    var body = el.authSheetBody;
    body.appendChild(buildField('用户名', 'cp-name', 'text', '请输入用户名', authSheet.name));
    body.appendChild(buildField('原密码', 'cp-old', 'password', '现在正在用的密码'));
    body.appendChild(buildField('新密码', 'cp-new', 'password', '至少 6 位'));
    body.appendChild(buildField('确认新密码', 'cp-new2', 'password', '再输一次'));
    body.appendChild(buildError());

    el.authSheetActions.appendChild(buildAction('取消', 'ghost', closeAuthSheet));
    el.authSheetActions.appendChild(buildAction('保存新密码', 'primary', submitChangeForm));
  }

  function submitChangeForm() {
    if (authSheet.busy) return;

    var name = inputValue('cp-name').trim();
    var oldPass = inputValue('cp-old');
    var next = inputValue('cp-new');
    var again = inputValue('cp-new2');

    if (!name) return setSheetError('请输入用户名');
    if (!oldPass) return setSheetError('请输入原密码');
    if (next !== again) return setSheetError('两次输入的新密码不一致');

    authSheet.busy = true;
    setSheetError('');
    Auth.changePassword(name, oldPass, next).then(function (res) {
      authSheet.busy = false;
      if (!res.ok) return setSheetError(res.error);
      if (el.loginPassword) el.loginPassword.value = '';
      toast('密码已更新，下次用新密码登录');
      closeAuthSheet();
    });
  }

  /* ------------------------------------------------------------ 忘记密码 */

  function renderForgotForm() {
    el.authSheetTitle.textContent = '忘记密码';
    var body = el.authSheetBody;

    if (!authSheet.verified) {
      el.authSheetSub.textContent = '先用手机的指纹 / 面容 / 锁屏密码确认是你本人，再设置新密码。';
      body.appendChild(buildField('用户名', 'fp-name', 'text', '要找回的账号', authSheet.name));
      body.appendChild(buildTip(
        '验证由手机系统完成，应用看不到你的指纹或锁屏密码。'
        + '本机账号没有云端验证码，设备凭证是唯一的「本人证明」。'));
      body.appendChild(buildError());

      el.authSheetActions.appendChild(buildAction('取消', 'ghost', closeAuthSheet));
      el.authSheetActions.appendChild(buildAction('验证身份', 'primary', verifyForReset));
      return;
    }

    el.authSheetSub.textContent = '身份已验证，给「' + authSheet.name + '」设置新密码。';
    body.appendChild(buildField('新密码', 'fp-new', 'password', '至少 6 位'));
    body.appendChild(buildField('确认新密码', 'fp-new2', 'password', '再输一次'));
    body.appendChild(buildError());

    el.authSheetActions.appendChild(buildAction('取消', 'ghost', closeAuthSheet));
    el.authSheetActions.appendChild(buildAction('保存新密码', 'primary', submitResetForm));
  }

  function verifyForReset() {
    var name = inputValue('fp-name').trim();
    if (!name) return setSheetError('请输入用户名');
    if (!Auth.userExists(name)) return setSheetError('这台设备上没有这个账号');

    var api = global.TodoNative;
    if (!api || typeof api.requestDeviceAuth !== 'function') {
      setSheetError('网页版调不起手机验证，请改用「修改密码」');
      return;
    }
    if (typeof api.deviceAuthAvailable === 'function' && !api.deviceAuthAvailable()) {
      setSheetError('这台手机还没设置锁屏密码或指纹，先到系统设置里加一个');
      return;
    }

    authSheet.name = name;
    setSheetError('');
    try {
      api.requestDeviceAuth('验证身份', '用指纹、面容或锁屏密码确认是你本人');
    } catch (error) {
      setSheetError('调不起系统验证，请稍后再试');
    }
  }

  /* 系统验证结果从原生回调到这里 */
  global.AuthHost = {
    result: function (ok) {
      if (!authSheet.kind) return; /* 弹层已经关了就不管 */
      if (!ok) {
        setSheetError('验证没有通过，可以再试一次');
        return;
      }
      authSheet.verified = true;
      renderAuthSheet();
    }
  };

  function submitResetForm() {
    if (authSheet.busy) return;
    if (!authSheet.verified) return setSheetError('请先验证身份');

    var next = inputValue('fp-new');
    var again = inputValue('fp-new2');
    if (next !== again) return setSheetError('两次输入的新密码不一致');

    authSheet.busy = true;
    setSheetError('');
    Auth.resetPassword(authSheet.name, next).then(function (res) {
      authSheet.busy = false;
      if (!res.ok) return setSheetError(res.error);
      if (el.loginUsername) el.loginUsername.value = res.name || authSheet.name;
      if (el.loginPassword) el.loginPassword.value = '';
      toast('密码已重设，用新密码登录');
      closeAuthSheet();
    });
  }

  /* ------------------------------------------------------------ 注销账号 */

  function renderDeleteStep() {
    var body = el.authSheetBody;
    el.authSheetTitle.textContent = '注销账号';
    body.appendChild(buildSteps(authSheet.step, 3));

    if (authSheet.step === 1) {
      el.authSheetSub.textContent = '注销之前，先看清楚会发生什么。';
      body.appendChild(buildTip(
        '<strong>下面这些会全部删除，且无法恢复：</strong>'
        + '<ul><li>账号本身，以及它的密码</li>'
        + '<li>全部待办和已办记录</li>'
        + '<li>设置过的头像</li></ul>'
        + '本机账号没有云端备份，删掉就是真的没了。', true));
      body.appendChild(buildError());

      el.authSheetActions.appendChild(buildAction('取消', 'ghost', closeAuthSheet));
      el.authSheetActions.appendChild(buildAction('我了解，继续', 'primary', function () {
        authSheet.step = 2;
        renderAuthSheet();
      }));
      return;
    }

    if (authSheet.step === 2) {
      el.authSheetSub.textContent = '第 2 步：输入要注销的用户名，确认删的是对的那个。';
      body.appendChild(buildField('用户名', 'del-name', 'text', '完整输入用户名'));
      body.appendChild(buildTip('必须和注册时一致（不区分大小写）。'));
      body.appendChild(buildError());

      el.authSheetActions.appendChild(buildAction('上一步', 'ghost', function () {
        authSheet.step = 1;
        renderAuthSheet();
      }));
      el.authSheetActions.appendChild(buildAction('继续', 'primary', function () {
        var typed = inputValue('del-name').trim();
        if (!typed) return setSheetError('请输入要注销的用户名');
        if (!Auth.userExists(typed)) return setSheetError('这台设备上没有这个账号');
        authSheet.name = typed;
        authSheet.step = 3;
        renderAuthSheet();
      }));
      return;
    }

    el.authSheetSub.textContent = '第 3 步：最后确认一次。';
    body.appendChild(buildTip('将永久删除账号「<strong>' + escapeHtml(authSheet.name)
      + '</strong>」和它的全部待办、已办、头像。点下去没有回头路。', true));
    body.appendChild(buildError());

    el.authSheetActions.appendChild(buildAction('上一步', 'ghost', function () {
      authSheet.step = 2;
      renderAuthSheet();
    }));
    el.authSheetActions.appendChild(buildAction('确认注销', 'danger', doDeleteAccount));
  }

  function doDeleteAccount() {
    var res = Auth.deleteAccount(authSheet.name);
    if (!res.ok) return setSheetError(res.error);

    if (state.user && state.user.key === res.key) {
      state.user = null;
      state.todos = [];
      state.avatar = '';
      el.todoList.textContent = '';
      el.loginUsername.value = '';
      el.loginPassword.value = '';
      clearReminders();
      resetAddTime();
      resetArchiveView();
      syncNative();
      showAuthView();
    }
    closeAuthSheet();
    toast('账号「' + res.name + '」已注销');
  }

  /* -------------------------------------------------------- 游客 / 换账号 */

  function loginAsGuest() {
    var res = Auth.startGuest();
    if (!res.ok) {
      if (el.loginError) el.loginError.textContent = res.error;
      return;
    }
    enterApp(res.user);
    toast('游客身份进入：数据只在这台设备上');
  }

  function switchAccount() {
    closeUserMenu();
    Auth.logout();
    state.user = null;
    state.todos = [];
    state.avatar = '';
    el.todoList.textContent = '';
    el.loginUsername.value = '';
    el.loginPassword.value = '';
    clearReminders();
    resetAddTime();
    resetArchiveView();
    syncNative();
    showAuthView();
    switchTab('login');
    if (el.loginUsername) el.loginUsername.focus();
    toast('输入另一个账号登录');
  }

  /* ------------------------------------------------------------ 语音时间识别

     从语音识别出的整句话里抽出时间表达，支持：
       · 相对时长：半小时后 / 10分钟后 / 2小时后 / 3天后 / 一周后
       · 日期：今天 / 明天 / 后天 / 大后天 / 周五 / 下周三 / 12月8号
       · 时刻：下午3点 / 8点半 / 18:05 / 中午 / 傍晚
     日期与时刻相邻时合并成一个时间点。命中的候选以确认条交给用户，
     逐条点选「采用」后才写入提醒时间——识别错了不会污染数据。
     第一条采用的时间进主提醒（dueAt，带提前档位），
     其余的进 extraTimes（只发到点那一档，原生闹钟同步排期）。

     引擎二选一（设置里可切换）：
       local  本地规则解析（默认，离线可用、零延迟）
       llm    在线大模型理解，留给更灵活的口语表达；
              当前版本没有可用在线服务时自动回退本地解析。
     ========================================================================== */

  var CN_DIGITS = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9 };

  /** 中文 / 阿拉伯数字混排 → 数值（支持 十、十五、二十、二十三；「半」= 0.5） */
  function cnNumber(text) {
    var s = String(text || '');
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (s === '半') return 0.5;
    if (!s) return NaN;
    var ten = s.indexOf('十');
    if (ten !== -1) {
      var high = ten === 0 ? 1 : CN_DIGITS[s.charAt(0)];
      var low = ten === s.length - 1 ? 0 : CN_DIGITS[s.charAt(ten + 1)];
      if (high == null || low == null) return NaN;
      return high * 10 + low;
    }
    return CN_DIGITS[s] != null ? CN_DIGITS[s] : NaN;
  }

  /* 时段词单独出现时的默认时刻（小时） */
  var PERIOD_DEFAULT_HOUR = {
    '凌晨': 6, '早上': 8, '早晨': 8, '上午': 9, '中午': 12,
    '下午': 14, '傍晚': 18, '晚上': 20
  };

  /** 以 now 为基准的第 offsetDays 天 0 点 */
  function dayStart(now, offsetDays) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  }

  function parseScheduledTodo(text, now) {
    var input = text.trim();
    var match = /^在[ \t\u3000]*([0-9０-９]{4})[ \t\u3000]*时/.exec(input);
    if (!match) return null;

    var title = input.slice(match[0].length).trim().replace(/^[，,、：:]\s*/, '');
    if (!title || /^[\p{P}\s]+$/u.test(title)) return null;

    var digits = match[1].normalize('NFKC');
    var hour = Number(digits.slice(0, 2));
    var minute = Number(digits.slice(2));
    if (hour > 23 || minute > 59) return null;

    var today = new Date(now);
    var reminder = dayStart(today, 0);
    reminder.setHours(hour, minute, 0, 0);
    if (+reminder <= now || reminder.getHours() !== hour || reminder.getMinutes() !== minute) {
      reminder = dayStart(today, 1);
      reminder.setHours(hour, minute, 0, 0);
    }
    if (reminder.getHours() !== hour || reminder.getMinutes() !== minute) return null;
    return { text: title, dueAt: +reminder };
  }

  var CLOCK_DIGIT_GROUPS = ['零〇洞动動０0','一幺腰么１1','二两兩２2','三３3','四４4',
    '五５5','六６6','七拐７7','八８8','九勾沟溝钩鉤９9'];
  var CLOCK_DIGIT_CHARS = CLOCK_DIGIT_GROUPS.join('');
  function compactClocks(text) {
    var runs = new RegExp('[' + CLOCK_DIGIT_CHARS + ']+(?:[ \\t]+[' + CLOCK_DIGIT_CHARS + ']+)*', 'g');
    var clocks = [], match;
    while ((match = runs.exec(text)) !== null) {
      var chars = match[0].replace(/[ \t]/g, '');
      if (chars.length !== 3 && chars.length !== 4) continue;
      var before = text.slice(0, match.index);
      var after = text.slice(runs.lastIndex);
      if (/^\s*(?:点|時|时|[:：号]|年|月|日|分钟|元|块|个|位|米|楼|室|房间|车次|公里)/.test(after)) continue;
      var anchor = /(?:(?:提醒时间|时间|时刻)\s*(?:是|为|设为|定在)?|(?:明早|明晚|今早|今晚|凌晨|早上|早晨|上午|中午|下午|傍晚|晚上)|(?:大后天|后天|明天|今天|今日)|(?:周|星期)[一二三四五六日天]|\d{1,2}\s*月\s*\d{1,2}\s*[号日])\s*[：:，,]?\s*$/.exec(before);
      if (chars.length !== 4 && !anchor) continue;
      if (!anchor && (before.trim() || after.trim().replace(/[。！？.!?]+$/, ''))) continue;
      var digits = Array.from(chars, function(ch) {
        return CLOCK_DIGIT_GROUPS.findIndex(function(group) { return group.indexOf(ch) >= 0; });
      }).join('');
      var label = anchor && /^(?:提醒时间|时间|时刻)/.test(anchor[0]);
      var shorthand = anchor && /^(明早|明晚|今早|今晚)/.exec(anchor[0]);
      var hour = Number(digits.slice(0, 2)), minute = Number(digits.slice(2));
      var s = label ? anchor.index : match.index;
      var sourceS = anchor && !label ? anchor.index : s;
      clocks.push({ s:s, sourceS:sourceS, e:runs.lastIndex, digitStart:match.index,
        hour:hour, minute:minute, span:text.slice(sourceS,runs.lastIndex),
        explicitPeriod:true, invalid:chars.length !== 4 || hour > 23 || minute > 59,
        labelled:!!label, shorthand:shorthand ? shorthand[0] : '' });
    }
    return clocks;
  }

  /**
   * 解析一句中文里的时间表达。
   * 返回 [{ at: 毫秒时间戳, span: '原文片段' }]，按时间先后排序，最多 4 条，
   * 且全部晚于 now（已经过去的时间没有意义，直接丢弃）。
   */
  function parseTimeExpr(text, nowTs, includeDateOnlyPast) {
    var src = String(text || '');
    if (!src) return [];
    var now = new Date(typeof nowTs === 'number' ? nowTs : Date.now());
    var dates = []; /* { s, e, day: Date 0点, span } */
    var clocks = compactClocks(src);
    var hits = [];
    var m, i;
    clocks.forEach(function(c) {
      if (c.shorthand) dates.push({s:c.sourceS,e:c.sourceS+2,
        day:dayStart(now,c.shorthand.charAt(0)==='明'?1:0),span:c.shorthand});
    });

    /* 1) 相对时长：N 分钟 / 小时 / 天 / 周 后 */
    var reAfter = /(半|\d+|[一二两三四五六七八九]十[一二三四五六七八九]?|十[一二三四五六七八九]?|[一二两三四五六七八九])\s*(?:个)?\s*(分钟|小时|天|日|周|星期)后/g;
    while ((m = reAfter.exec(src)) !== null) {
      var n = cnNumber(m[1]);
      if (!isFinite(n) || n <= 0) continue;
      var unit = m[2];
      var ms;
      if (unit === '分钟') ms = n * 60000;
      else if (unit === '小时') ms = n * 3600000;
      else if (unit === '周' || unit === '星期') ms = n * 7 * 86400000;
      else ms = n * 86400000;
      hits.push({
        at: ceilToMinute(now.getTime() + ms),
        s: m.index, e: m.index + m[0].length, span: m[0]
      });
    }

    /* 2) 日期词：今天 / 明天 / 后天 / 大后天 */
    var reDay = /大后天|后天|明天|今天|今日/g;
    while ((m = reDay.exec(src)) !== null) {
      var off = m[0] === '明天' ? 1 : m[0] === '后天' ? 2 : m[0] === '大后天' ? 3 : 0;
      dates.push({ s: m.index, e: m.index + m[0].length, day: dayStart(now, off), span: m[0] });
    }

    /* 周几：周五 / 下周三 / 这周日（不带前缀时取未来最近的一次）
       注意「下周三」是「下一个自然周（周一起算）的周三」，
       不是「今天之后最近的周三再加 7 天」——周六说下周三应该是 4 天后。 */
    var reWeek = /(下下|下|这|本)?(?:周|星期)([一二三四五六日天])/g;
    while ((m = reWeek.exec(src)) !== null) {
      var wd = (m[2] === '日' || m[2] === '天') ? 0 : CN_DIGITS[m[2]];
      if (wd == null) continue;
      var weekdayFromMon = (wd + 6) % 7; /* 周一 = 0 … 周日 = 6 */
      var weekDay;
      if (m[1] === '下' || m[1] === '下下') {
        var toNextMon = (8 - now.getDay()) % 7;
        if (toNextMon === 0) toNextMon = 7; /* 今天就是周一：「下周一」是 7 天后 */
        if (m[1] === '下下') toNextMon += 7;
        weekDay = dayStart(now, toNextMon + weekdayFromMon);
      } else if (m[1] === '这' || m[1] === '本') {
        /* 「这周三」：本周的周三，可能已经过去，由上层决定要不要拒 */
        var toThisMon = (now.getDay() + 6) % 7;
        weekDay = dayStart(now, -toThisMon + weekdayFromMon);
      } else {
        var base = (wd - now.getDay() + 7) % 7;
        weekDay = dayStart(now, base);
      }
      dates.push({ s: m.index, e: m.index + m[0].length, day: weekDay, span: m[0], roll: m[1] ? '' : 'week' });
    }

    /* N 月 N 号 / 日（今年已过去就取明年） */
    var reMD = /(\d{1,2})\s*月\s*(\d{1,2})\s*[号日]/g;
    while ((m = reMD.exec(src)) !== null) {
      var mo = parseInt(m[1], 10);
      var da = parseInt(m[2], 10);
      if (mo < 1 || mo > 12 || da < 1 || da > 31) continue;
      var mdDay = new Date(now.getFullYear(), mo - 1, da);
      if (mdDay.getMonth() !== mo - 1 || mdDay.getDate() !== da) continue;
      dates.push({ s: m.index, e: m.index + m[0].length, day: mdDay, span: m[0], roll: 'year' });
    }

    /* 3) 时刻：下午3点 / 3点半 / 8点05分 / 15:20 */
    var reClock = /(明早|明晚|今早|今晚|凌晨|早上|早晨|上午|中午|下午|傍晚|晚上)?\s*(\d{1,2}|[一二两三四五六七八九]?十[一二三四五六七八九]?|[一二两三四五六七八九])\s*(?:点|:|：)\s*(\d{1,2}|半|[一二两三四五六七八九]?十[一二三四五六七八九]?|[一二两三四五六七八九])?\s*(分|整)?/g;
    while ((m = reClock.exec(src)) !== null) {
      if (/\d$/.test(src.slice(m.index-1,m.index)) && /^\d/.test(m[0])) continue;
      if (/\d$/.test(m[0]) && /^\d/.test(src.slice(reClock.lastIndex))) continue;
      var period = m[1] || '';
      var shorthand = /^(明早|明晚|今早|今晚)$/.test(period);
      if (shorthand) {
        dates.push({s:m.index,e:m.index+2,day:dayStart(now,period.charAt(0)==='明'?1:0),span:period});
        period = /晚/.test(period) ? '晚上' : '早上';
      }
      var hour = cnNumber(m[2]);
      if (!isFinite(hour)) continue;
      var minute = 0;
      if (m[3] != null && m[3] !== '') {
        minute = m[3] === '半' ? 30 : cnNumber(m[3]);
        if (!isFinite(minute)) continue;
      }
      if (m[4] === '整') minute = 0;
      /* 时段修正：下午 / 傍晚 / 晚上 / 中午 的小时进 12 小时制 */
      if (period === '下午' || period === '傍晚' || period === '晚上' || period === '中午') {
        if (hour < 12) hour += 12;
      } else if (period === '凌晨' && hour === 12) {
        hour = 0;
      }
      if (hour > 23 || minute > 59) continue;
      clocks.push({
        s: m.index + (shorthand ? 2 : 0), sourceS:m.index, e: m.index + m[0].length,
        hour: hour, minute: minute, span: m[0], explicitPeriod:!!period || /[:：]/.test(m[0])
      });
    }

    /* 4) 单独的时段词：明早 / 今晚 / 中午 / 傍晚……（后面紧跟时刻的已被上一条吃掉） */
    var rePeriod = /明早|明晚|今晚|凌晨|早上|早晨|上午|中午|下午|傍晚|晚上/g;
    while ((m = rePeriod.exec(src)) !== null) {
      var covered = false;
      for (i = 0; i < clocks.length; i++) {
        if (m.index >= (clocks[i].sourceS === undefined ? clocks[i].s : clocks[i].sourceS) && m.index < clocks[i].e) { covered = true; break; }
      }
      if (covered) continue;
      var word = m[0];
      if (word === '明早' || word === '明晚') {
        /* 明早 / 明晚 = 明天 + 默认时段，直接合成一条 */
        var d2 = dayStart(now, 1);
        hits.push({
          at: new Date(d2.getFullYear(), d2.getMonth(), d2.getDate(),
            word === '明早' ? 8 : 20, 0, 0, 0).getTime(),
          s: m.index, e: m.index + word.length, span: word
        });
        continue;
      }
      if (word === '今晚') {
        dates.push({ s: m.index, e: m.index, day: dayStart(now, 0), span: word });
        clocks.push({ s: m.index, e: m.index + 2, hour: 20, minute: 0, span: word, explicitPeriod:true });
        continue;
      }
      clocks.push({
        s: m.index, e: m.index + word.length,
        hour: PERIOD_DEFAULT_HOUR[word], minute: 0, span: word, explicitPeriod:true
      });
    }

    function datedTime(date, hour, minute, dateOnly) {
      var d=date.day;
      var at=new Date(d.getFullYear(),d.getMonth(),d.getDate(),hour,minute).getTime();
      var lastSuggested=new Date(d.getFullYear(),d.getMonth(),d.getDate(),20).getTime();
      if (at <= now.getTime() && !(dateOnly && includeDateOnlyPast && lastSuggested>now.getTime())) {
        if (date.roll==='week') at=new Date(d.getFullYear(),d.getMonth(),d.getDate()+7,hour,minute).getTime();
        if (date.roll==='year') {
          var nextYear=d.getFullYear()+1, future;
          do {future=new Date(nextYear++,d.getMonth(),d.getDate(),hour,minute);} while(future.getMonth()!==d.getMonth());
          at=future.getTime();
        }
      }
      return at;
    }
    /* Roll recurring dates only after combining their actual clock. */
    var usedClock = [];
    for (i = 0; i < dates.length; i++) {
      var best = -1;
      for (var j = 0; j < clocks.length; j++) {
        if (usedClock[j]) continue;
        var gap = clocks[j].s - dates[i].e;
        var intervening=dates.some(function(other){return other!==dates[i] && other.s>=dates[i].e && other.s<clocks[j].s;});
        if (!intervening && gap >= 0 && gap <= 6 && (best === -1 || clocks[j].s < clocks[best].s)) best = j;
      }
      if (best !== -1) {
        usedClock[best] = true;
        var ck = clocks[best];
        if (ck.invalid) continue;
        var at = datedTime(dates[i],ck.hour,ck.minute,false);
        hits.push({ at: at, s: dates[i].s, e: ck.e, span: src.slice(dates[i].s, ck.e) });
      } else {
        /* 只有日期：默认上午 9 点 */
        hits.push({
          at: datedTime(dates[i],9,0,true),
          s: dates[i].s, e: dates[i].e, span: dates[i].span, dateOnly: true
        });
      }
    }

    /* 6) 落单的时刻：取今天 / 明天的最近一次（没过 12 小时制的歧义先试 +12） */
    for (i = 0; i < clocks.length; i++) {
      if (usedClock[i] || clocks[i].invalid) continue;
      var c = clocks[i];
      var cand = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
        c.hour, c.minute, 0, 0).getTime();
      if (cand <= now.getTime() && c.hour < 12 && !c.explicitPeriod) {
        cand = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
          c.hour + 12, c.minute, 0, 0).getTime();
      }
      if (cand <= now.getTime()) {
        var tm = dayStart(now, 1);
        cand = new Date(tm.getFullYear(), tm.getMonth(), tm.getDate(),
          c.hour, c.minute, 0, 0).getTime();
      }
      hits.push({ at: cand, s: c.s, e: c.e, span: c.span });
    }

    /* 收尾：只要将来的时间，去重、排序、最多 4 条 */
    var seen = {};
    var out = [];
    for (i = 0; i < hits.length; i++) {
      var h = hits[i];
      if (h.at <= now.getTime() && !(includeDateOnlyPast && h.dateOnly)) continue;
      if (seen[h.at]) continue;
      seen[h.at] = true;
      out.push(h);
    }
    out.sort(function (a, b) { return a.at - b.at; });
    return out.slice(0, 4);
  }

  var addDigits = null, addDigitApplying = false;
  function clearAddDigits() {
    addDigits = null;
    show(el.addDigitFix,false);
  }
  function paintAddDigits() {
    if (!el.addDigitFix) return;
    show(el.addDigitFix,!!addDigits);
    if (!addDigits) return;
    el.addDigitRaw.textContent = '识别原文：' + addDigits.raw;
    el.addDigitAdopt.textContent = '按数字采用：' + addDigits.candidate;
    show(el.addDigitAdopt,!addDigits.applied);
    show(el.addDigitUndo,!!addDigits.applied);
  }
  function prepareAddVoiceDigits(raw) {
    clearAddDigits();
    var result = spokenDigitCandidate(raw);
    if (result.candidate) {
      addDigits = {owner:state.user && state.user.key,raw:raw,before:result.text,
        original:result.text,candidate:result.candidate,applied:false};
      paintAddDigits();
    }
    return result.text;
  }
  function adoptAddDigits(undo) {
    var d = addDigits;
    if (!d || !el.newTodo) return;
    if (d.owner !== (state.user && state.user.key) || el.newTodo.value !== d.before) {
      clearAddDigits(); return;
    }
    var next = undo ? d.original : d.candidate;
    el.newTodo.value = next; d.before = next; d.applied = !undo;
    // Only digits changed: retain the exact reminder choices anchored to the utterance.
    if (addTimeSuggestions) addTimeSuggestions.text = next.trim();
    addDigitApplying = true;
    try {el.newTodo.dispatchEvent(new global.Event('input',{bubbles:true}));}
    finally {addDigitApplying = false;}
    paintAddDigits();
    toast(undo ? '已恢复识别原文，提醒时间保持不变' : '数字已核对，点加号添加待办');
  }

  var addTimeSuggestions = null;
  function clearAddTimeSuggestions() {
    addTimeSuggestions = null;
    if (el.addTimeOptions) el.addTimeOptions.textContent = '';
    show(el.addTimeSuggestions, false);
  }
  function refreshAddTimeSuggestions() {
    clearAddTimeSuggestions();
    if (!el.newTodo || !el.addTimeOptions) return;
    var text = String(el.newTodo.value || '').trim(), now = Date.now();
    var hits = parseTimeExpr(text, now, true), choices = [], seen = {};
    function append(at, span, suggested) {
      if (at <= now || seen[at]) return;
      seen[at] = true; choices.push({at:at, span:span, suggested:suggested});
    }
    hits.forEach(function (h) {
      if (h.dateOnly) {
        var day = new Date(h.at);
        [9,14,20].forEach(function(hour) {
          append(new Date(day.getFullYear(),day.getMonth(),day.getDate(),hour).getTime(),h.span,true);
        });
      } else append(h.at,h.span, /^(明早|明晚|今晚|凌晨|早上|早晨|上午|中午|下午|傍晚|晚上)$/.test(h.span.trim()));
    });
    choices.sort(function(a,b){return a.at-b.at;}); choices = choices.slice(0,6);
    if (!choices.length) return;
    addTimeSuggestions = {owner:state.user && state.user.key, text:text, choices:choices};
    choices.forEach(function (choice) {
      var button = document.createElement('button');
      button.type = 'button'; button.className = 'btn btn--ghost btn--sm';
      button.setAttribute('data-at', String(choice.at));
      button.setAttribute('aria-pressed', String(addDueAt === choice.at));
      button.textContent = '「' + choice.span.trim() + '」→ ' + formatDateTime(choice.at) + (choice.suggested ? '（建议）' : '');
      button.addEventListener('click', function () {
        if (!addTimeSuggestions || addTimeSuggestions.owner !== (state.user && state.user.key)
            || addTimeSuggestions.text !== String(el.newTodo.value || '').trim()) {
          clearAddTimeSuggestions(); return;
        }
        if (choice.at <= Date.now()) {
          clearAddTimeSuggestions(); setAddHint('候选时间已经过去，请重新选择提醒时间'); return;
        }
        setAddTime(choice.at,null);
        el.addTimeOptions.querySelectorAll('button').forEach(function(b){b.setAttribute('aria-pressed',String(b === button));});
        setAddHint('已选提醒时间：' + formatDateTime(choice.at) + '，点加号添加待办');
      });
      el.addTimeOptions.appendChild(button);
    });
    show(el.addTimeSuggestions,true);
  }

  /* ============================================================ 语音助手

     一句语音 = 一轮对话。助手把「听懂 → 决定做什么 → 动手改数据 → 回执」一次走完，
     用户还能接着说下一句，上下文一直带着。取代了原来只抽时间、只弹确认条的做法。

     五种意图（同一套 JSON 协议，本地规则和在线模型都按它说）：
       create    建待办。第 1 个时间点进 dueAt，其余进 extraTimes
       complete  把某条待办标为已完成
       delete    删掉某条待办 —— 回执里点一下才真删
       query     查还有哪些事（today / tomorrow / overdue / done / open）
       reply     其它情况，一句话回答

     两条理解路径，设置里可切：
       local  关键词 + parseTimeExpr，离线零延迟（默认）
       llm    在线大模型，带最近几轮对话做多轮理解；失败自动退回本地
     用哪份模型由模型库的路由策略决定，跟模型对比页共用一套 pickModel。

     每一步都能撤销：建错了撤掉那条、标错了退回待办。
     ========================================================================== */

  var ASST_MAX_MSGS = 40;        /* 面板里最多留这么多条气泡 */
  var ASST_HISTORY_MSGS = 8;     /* 发给模型的上文条数（4 轮） */
  var ASST_TODO_IN_PROMPT = 12;  /* 提示词里带多少条待办 */

  var asst = {
    open: false,
    busy: false,
    msgs: [],        /* {role, text, at, kind, tag, items, undo, pending, model, err} */
    lastModel: null  /* 最近一轮实际用的模型，给面板右上角显示 */
  };

  function asstNormalize(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  }

  /* -------------------------------------------------------- 本地意图理解 */

  /* 这些词说明用户在「让我做一件事」，而不是随便聊两句 */
  var ASST_CREATE_RE = /(提醒我|记一下|记着|记住|添加|新建|加一条|安排|别忘|要做|得做|待办)/;
  var ASST_COMPLETE_RE = /(做完了|完成了|办完了|搞定了|弄完了|已经做|已办|勾掉|打勾|标记完成|标成做完|标记为完成)/;
  var ASST_DELETE_RE = /(删掉|删除|移除|去掉|不要了)/;
  var ASST_QUERY_RE = /(还有|剩下|剩几|多少|几件|几个|查看|看看|列出|列一下|清单|有什么|啥事)/;
  /* 打招呼和提问不该被当成待办建进列表 */
  var ASST_CHAT_RE = /^(你好|您好|hi|hello|在吗|在不在|谢谢|多谢|再见|你是谁|你叫什么|你能做什么|怎么样|讲个笑话|哈哈)/i;
  var ASST_ASK_RE = /[?？]\s*$|^(为什么|怎么|如何|能不能|可不可以|要不要|是不是)/;

  /* 前缀里的语气词和指令，剥掉之后才是待办标题 */
  var ASST_NOISE_RE = /^(提醒我|提醒一下|提醒|帮我|请|麻烦|那|那个|这个|一下|我要|我想|把|将|给|我|你|的|这条|那条|一条待办|待办|任务)+/;

  /** 去掉时间片段与口头语，剩下的就是待办标题 */
  function asstTitleOf(text, hits) {
    var body = String(text || '');
    /* 从后往前删，前面的下标不会被打乱 */
    var sorted = (hits || []).slice().sort(function (a, b) { return b.s - a.s; });
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i].s >= 0 && sorted[i].e > sorted[i].s) {
        body = body.slice(0, sorted[i].s) + ' ' + body.slice(sorted[i].e);
      }
    }
    body = body.replace(/\s+/g, ' ').trim();

    /* 「提醒我」「帮我」这类前缀可能叠着说，一层不够就多剥两次 */
    for (var k = 0; k < 3; k++) {
      var next = body.replace(ASST_NOISE_RE, '').trim();
      if (next === body) break;
      body = next;
    }
    body = body.replace(/[，,、；;。\s]*(吧|啊|呀|哦|呢|一下)$/, '').trim();
    body = body.replace(/^[，,、；;。：:\s]+/, '').replace(/[，,、；;。：:\s]+$/, '');
    return body.slice(0, 60);
  }

  /** 从「把买牛奶标成做完了」里取出用来匹配待办的关键词 */
  function asstTargetsOf(text) {
    var body = String(text || '')
      .replace(ASST_COMPLETE_RE, ' ')
      .replace(ASST_DELETE_RE, ' ')
      /* 长的放前面：「最后一条」要先于「一条」被吃掉 */
      .replace(/(最后一条|上一条|刚才|刚刚|最新|那个|这个|这条|那条|一条|帮我|请|麻烦|把|将|给|待办|任务|标记|标成|已经|都|也|就|一下|吧|啊|了|的|再)/g, ' ')
      .replace(/[，,、；;。：:！!？?]/g, ' ');

    var parts = body.split(/\s+/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p) out.push(p);
    }
    /* 用户常常把标题整句说出来，整体也留一个候选 */
    var whole = body.replace(/\s+/g, '');
    if (whole && out.indexOf(whole) === -1) out.push(whole);
    /* 全是「刚才那条」这类指代时给空数组：调用方据此取最近一条 */
    return out.slice(0, 6);
  }

  /** 问句里的筛选范围 */
  function asstFilterOf(text) {
    var t = String(text || '');
    if (/(已办|已完成|做完的)/.test(t)) return 'done';
    if (/明天|明日/.test(t)) return 'tomorrow';
    if (/(逾期|过期|超时|耽误)/.test(t)) return 'overdue';
    if (/(今天|今日|这会儿|目前|现在)/.test(t)) return 'today';
    return 'open';
  }

  /* 「下午提醒我」这类只说时段的说法：给出该时段的代表时刻，并记住是模糊的 */
  var ASST_SLOT_RE = /(上午|早上|一早|中午|下午|傍晚|晚上|夜里|今晚|全天|一整天)/;

  /**
   * 只在句子里说了时段（没点几点）时用：给出该时段的代表时刻。
   * dayTs 传了就把时段安在「那一天」上（「下周三上午」→ 下周三 09:00），
   * 不传则按今天 / 明天 / 后天算。
   */
  function asstSlotOf(text, now, dayTs) {
    var body = String(text || '');
    var m = ASST_SLOT_RE.exec(body);
    if (!m) return null;
    var word = m[1];
    var key = 'afternoon';
    if (/上午|早上|一早/.test(word)) key = 'morning';
    else if (/中午/.test(word)) key = 'noon';
    else if (/下午/.test(word)) key = 'afternoon';
    else if (/傍晚/.test(word)) key = 'evening';
    else if (/晚上|夜里|今晚/.test(word)) key = 'night';
    else if (/全天|一整天/.test(word)) key = 'allday';

    var slot = fuzzySlot(key);
    var base = new Date(now || Date.now());
    var dayOffset = /后天/.test(body) ? 2 : (/明天|明日/.test(body) ? 1 : 0);
    var day = typeof dayTs === 'number' && isFinite(dayTs)
      ? new Date(dayTs)
      : new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset);
    var at = new Date(day.getFullYear(), day.getMonth(), day.getDate(),
      slot.hour, 0, 0, 0).getTime();

    /* 命中范围往前吃掉「今天 / 明天 / 后天」，标题里就不会剩一个孤零零的「明天」 */
    var start = m.index;
    var before = body.slice(0, start);
    var dayWord = /(今天|今日|明天|明日|后天)\s*$/.exec(before);
    if (dayWord) start -= dayWord[0].length;
    return { key: key, at: at, s: start, e: m.index + word.length, word: word };
  }

  /**
   * 本地规则理解。够快、离线可用，覆盖大多数日常说法；
   * 说不清时返回 action=reply，交给在线模型或给一句引导。
   */
  function parseLocalIntent(raw, nowTs) {
    var text = asstNormalize(raw);
    var now = nowTs || Date.now();
    if (!text) return { action: 'reply', reply: '没听到内容，再说一次？', source: 'local' };

    /* 「下午三点」是精确时间；只说「下午」就是模糊时段。
       判断依据是句子里有没有钟点（三点、15:00、半点都算）。 */
    var explicitClock = /(\d{1,2}\s*[:：]\s*\d{1,2})|([零〇一二三四五六七八九十两\d]{1,3}\s*[点時时])|(半点|一刻|三刻|整)/.test(text)
      || compactClocks(text).length > 0;
    var slotWord = ASST_SLOT_RE.test(text);
    /* 带星期 / 日期 / 下个月这类更远的说法时，时段推断不了，干脆走精确解析 */
    var farDay = /(周[一二三四五六日天]|星期|下周|下个?月|\d{1,2}\s*[日号])/.test(text);
    /* 只说时段不说钟点时：
       · 有具体某天（「下周三上午」）→ 把时段安在那天上，仍然算模糊
       · 连天都没有（「下午提醒我」）→ 按今天/明天算 */
    var slot = null;
    var hits = [];
    if (!explicitClock && slotWord) {
      var bare = parseTimeExpr(text, now);
      if (bare.length) {
        var anchored = asstSlotOf(text, now, bare[0].at);
        hits = bare;
        if (anchored) {
          slot = anchored;
          /* 日期词与时段词一起从标题里抹掉，别剩下半截「下周三」 */
          bare[0] = {
            s: Math.min(bare[0].s, anchored.s),
            e: Math.max(bare[0].e, anchored.e),
            at: anchored.at,
            span: bare[0].span
          };
        }
      } else if (!farDay) {
        slot = asstSlotOf(text, now);
        hits = [];
      }
    } else {
      hits = parseTimeExpr(text, now);
    }
    var titleHits = hits.length ? hits : (slot ? [slot] : []);
    var times = hits.length
      ? hits.map(function (h) { return h.at; })
      : (slot ? [slot.at] : []);

    if (ASST_DELETE_RE.test(text)) {
      return { action: 'delete', targets: asstTargetsOf(text), source: 'local' };
    }
    if (ASST_COMPLETE_RE.test(text)) {
      return { action: 'complete', targets: asstTargetsOf(text), source: 'local' };
    }
    /* 「明天还有几件事」既是问句又带时间，问句优先 */
    if (ASST_QUERY_RE.test(text) && !ASST_CREATE_RE.test(text)) {
      return { action: 'query', filter: asstFilterOf(text), source: 'local' };
    }
    if (hits.length || slot || ASST_CREATE_RE.test(text)) {
      return {
        action: 'create',
        text: asstTitleOf(text, titleHits),
        times: times,
        fuzzy: slot ? slot.key : null,
        source: 'local'
      };
    }
    /* 口语里最常见的就是一句动宾短语（「买牛奶」）：规则认不出动词也当待办，
       保持「说一句就变成一条待办」的手感，只把打招呼和提问排除在外 */
    if (text.length <= 40 && !ASST_CHAT_RE.test(text) && !ASST_ASK_RE.test(text)) {
      return {
        action: 'create',
        text: asstTitleOf(text, titleHits),
        times: times,
        fuzzy: slot ? slot.key : null,
        source: 'local'
      };
    }
    return { action: 'reply', reply: '', source: 'local' };
  }

  /* -------------------------------------------------------- 待办匹配与查询 */

  function asstDayRange(offset) {
    var d = new Date();
    var start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset).getTime();
    return [start, start + 86400000];
  }

  function asstQueryList(filter) {
    var out = [];
    var today = asstDayRange(0);
    var tomorrow = asstDayRange(1);
    var now = Date.now();

    for (var i = 0; i < state.todos.length; i++) {
      var t = state.todos[i];
      var due = t.dueAt || 0;
      if (filter === 'done') {
        if (t.done) out.push(t);
        continue;
      }
      if (t.done) continue;
      if (filter === 'today' && !(due >= today[0] && due < today[1])) continue;
      if (filter === 'tomorrow' && !(due >= tomorrow[0] && due < tomorrow[1])) continue;
      if (filter === 'overdue' && !(due && due < now)) continue;
      out.push(t);
    }

    out.sort(function (a, b) {
      var ad = a.dueAt || 0, bd = b.dueAt || 0;
      if (ad && bd) return ad - bd;
      if (ad) return -1;
      if (bd) return 1;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
    return out;
  }

  /** 两字重合比例，兜住「买牛奶」和「牛奶要买」这种换序说法 */
  function asstOverlap(a, b) {
    var x = String(a || ''), y = String(b || '');
    if (!x || !y) return 0;
    var hit = 0;
    for (var i = 0; i < y.length - 1; i++) {
      if (x.indexOf(y.substr(i, 2)) !== -1) hit++;
    }
    return hit / Math.max(1, y.length - 1);
  }

  /** 在现有待办里找最像的一条（只返回一条，免得一句话误伤一片） */
  function asstMatchOne(targets) {
    if (!targets || !targets.length) {
      /* 没说是哪条：拿最近建的一条未完成，够用也可预期 */
      var latest = null;
      for (var i = 0; i < state.todos.length; i++) {
        var t = state.todos[i];
        if (t.done) continue;
        if (!latest || (t.createdAt || 0) > (latest.createdAt || 0)) latest = t;
      }
      return latest;
    }

    var best = null, bestScore = 0;
    for (var j = 0; j < state.todos.length; j++) {
      var todo = state.todos[j];
      var text = String(todo.text || '');
      for (var k = 0; k < targets.length; k++) {
        var key = targets[k];
        if (!key) continue;
        var score;
        if (text === key) score = 100;
        else if (text.indexOf(key) !== -1) score = 80 - Math.min(30, text.length - key.length);
        else if (key.indexOf(text) !== -1) score = 70;
        else score = asstOverlap(text, key) * 50;
        /* 已完成的往后排，除非用户就是想说它 */
        if (todo.done) score -= 20;
        if (score > bestScore) { bestScore = score; best = todo; }
      }
    }
    return bestScore >= 30 ? best : null;
  }

  /* -------------------------------------------------------- 意图执行 */

  function asstCreate(intent) {
    var title = String(intent.text || '').trim();
    if (!title) return { ok: false, tag: '没说清', text: '没听清要做什么事，再说一遍？' };

    var now = Date.now();
    var times = [];
    var raw = intent.times || [];
    for (var i = 0; i < raw.length; i++) {
      var at = Number(raw[i]);
      if (at > now && times.indexOf(at) === -1) times.push(at);
    }
    times.sort(function (a, b) { return a - b; });

    var dueAt = times.length ? times[0] : null;
    var extras = times.slice(1);

    if (!addTodo(title, {
      dueAt: dueAt, extras: extras, fuzzy: intent.fuzzy, fromAssistant: true
    })) {
      var why = (el.addHint && el.addHint.textContent) || '内容或时间不合法';
      return { ok: false, tag: '没加进去', text: '没能加进去：' + why };
    }

    var todo = state.todos[state.todos.length - 1];
    /* 标签已经写了「已添加」，正文就别再重复一遍 */
    var whenText = dueAt ? dueTextOf(todo) : '';
    var text = '「' + title + '」' + (dueAt ? '，' + whenText + ' 提醒你。' : '已加入待办。');
    if (extras.length) {
      text += '另外 ' + extras.length + ' 个时间点也排上了（' +
        extras.map(function (t) { return formatDateTime(t); }).join('、') + '）。';
    }
    return {
      ok: true, tag: '已添加', text: text,
      items: [{ text: title, dueAt: dueAt, dueFuzzy: todo.dueFuzzy }],
      undo: { kind: 'add', ids: [todo.id] }
    };
  }

  function asstComplete(intent) {
    var todo = asstMatchOne(intent.targets);
    if (!todo) {
      return { ok: false, tag: '没找到', text: '没找到对应的待办。说说它的名字，或者说「今天还有几件事」看看清单。' };
    }
    if (todo.done) return { ok: false, tag: '', text: '「' + todo.text + '」已经是完成状态了。' };
    if (!setDone(todo, true)) return { ok: false, tag: '', text: '保存失败，没改成。再试一次？' };
    return {
      ok: true, tag: '已完成', text: '「' + todo.text + '」已移入已办。',
      items: [{ text: todo.text, dueAt: todo.dueAt }],
      undo: { kind: 'done', ids: [todo.id] }
    };
  }

  /** 删除先问一句，回执里的按钮点了才真删 */
  function asstDeletePrompt(intent) {
    var todo = asstMatchOne(intent.targets);
    if (!todo) return { ok: false, tag: '没找到', text: '没找到要删的那条。说说它的名字？' };
    return {
      ok: true, tag: '要确认', text: '要删掉「' + todo.text + '」吗？删了就找不回来了。',
      pending: { kind: 'delete', id: todo.id }
    };
  }

  function asstDelete(id) {
    var todo = findTodo(id);
    if (!todo) return { ok: false, tag: '', text: '这条已经不在了。' };
    deleteTodo(id);
    return { ok: true, tag: '已删除', text: '「' + todo.text + '」已删除。' };
  }

  function asstQuery(intent) {
    var filter = intent.filter || 'open';
    var label = { today: '今天', tomorrow: '明天', overdue: '逾期', done: '已办', open: '未完成' }[filter] || '未完成';
    var list = asstQueryList(filter);
    if (!list.length) return { ok: true, tag: '查询', text: label + '没有待办，清爽。', items: [] };

    var shown = list.slice(0, 6);
    return {
      ok: true, tag: '查询',
      text: label + '有 ' + list.length + ' 件事：',
      items: shown.map(function (t) {
        return { text: t.text, dueAt: t.dueAt, done: t.done };
      }),
      more: list.length - shown.length
    };
  }

  /** 把一个意图执行掉，并把结果说回对话里 */
  function asstApply(intent, use) {
    var res;
    switch (intent.action) {
      case 'create': res = asstCreate(intent); break;
      case 'complete': res = asstComplete(intent); break;
      case 'delete': res = asstDeletePrompt(intent); break;
      case 'query': res = asstQuery(intent); break;
      default:
        res = {
          ok: true, tag: '',
          text: intent.reply ||
            '这句我没听出要做什么。可以说「明天下午三点开会」，或者说「今天还有几件事」。'
        };
    }
    asstSay(res.text, use, res);
    return res;
  }

  /* -------------------------------------------------------- 面板与气泡 */

  function asstPush(msg) {
    msg.at = msg.at || Date.now();
    asst.msgs.push(msg);
    if (asst.msgs.length > ASST_MAX_MSGS) {
      asst.msgs.splice(0, asst.msgs.length - ASST_MAX_MSGS);
    }
    renderAsstLog();
    return msg;
  }

  function asstSay(text, use, res) {
    var r = res || {};
    asstPush({
      role: 'assistant', kind: 'say', text: String(text || ''),
      tag: r.tag || '', items: r.items || null, more: r.more || 0,
      undo: r.undo || null, pending: r.pending || null,
      model: use || null, err: r.ok === false
    });
    /* 面板关着时也用 toast 报个结论，别让人以为没反应 */
    if (!asst.open) toast(truncate(text, 30));
  }

  /** 旁注：在线失败、退回本地这类解释，不掺进正式回执里 */
  function asstNote(text) {
    asstPush({ role: 'assistant', kind: 'note', text: String(text || '') });
  }

  function asstScrollBottom() {
    if (!el.assistantLog) return;
    el.assistantLog.scrollTop = el.assistantLog.scrollHeight;
  }

  function renderAsstLog() {
    if (!el.assistantLog) return;
    var box = el.assistantLog;
    box.textContent = '';
    for (var i = 0; i < asst.msgs.length; i++) {
      box.appendChild(buildAsstMsg(asst.msgs[i], i));
    }
    show(el.assistantQuick, asst.msgs.length === 0);
    asstScrollBottom();
  }

  function asstMetaText(m) {
    var bits = [];
    if (m.role === 'user') bits.push(m.kind === 'voice' ? '语音' : '打字');
    if (m.model) {
      var label = m.model.model || m.model.name;
      if (m.model.version && label.indexOf(m.model.version) === -1) {
        label += '（' + m.model.version + '）';
      }
      bits.push(label);
      if (m.model.ms) bits.push((m.model.ms / 1000).toFixed(1) + 's');
    } else if (m.role === 'assistant' && m.kind === 'say') {
      bits.push('本地规则');
    }
    var d = new Date(m.at || Date.now());
    bits.push(pad2(d.getHours()) + ':' + pad2(d.getMinutes()));
    return bits.join(' · ');
  }

  function buildAsstMsg(m, index) {
    var wrap = document.createElement('div');
    var mine = m.role === 'user';
    wrap.className = 'asstmsg asstmsg--' + (mine ? 'user' : 'bot') +
      (m.err ? ' is-bad' : '') +
      (m.kind === 'typing' ? ' is-typing' : '') +
      (m.kind === 'note' ? ' is-note' : '');
    wrap.setAttribute('data-index', String(index));

    var bubble = document.createElement('div');
    bubble.className = 'asstmsg__bubble';

    if (m.kind === 'typing') {
      bubble.innerHTML = '<span class="asstdots"><i></i><i></i><i></i></span>';
    } else if (m.kind === 'note') {
      bubble.textContent = m.text;
    } else {
      if (m.tag) {
        var tag = document.createElement('span');
        tag.className = 'asstmsg__tag';
        tag.textContent = m.tag;
        bubble.appendChild(tag);
      }
      var p = document.createElement('p');
      p.className = 'asstmsg__text';
      p.textContent = m.text || '';
      bubble.appendChild(p);

      if (m.items && m.items.length) {
        var ul = document.createElement('ul');
        ul.className = 'asstitems';
        for (var i = 0; i < m.items.length; i++) {
          var it = m.items[i];
          var li = document.createElement('li');
          var name = document.createElement('span');
          name.className = 'asstitems__name';
          name.textContent = it.text;
          li.appendChild(name);
          if (it.dueAt) {
            var when = document.createElement('em');
            when.className = 'asstitems__when';
            when.textContent = it.dueFuzzy
              ? dueTextOf(it) : formatDateTime(it.dueAt);
            li.appendChild(when);
          }
          ul.appendChild(li);
        }
        bubble.appendChild(ul);
        if (m.more) {
          var more = document.createElement('span');
          more.className = 'asstitems__more';
          more.textContent = '还有 ' + m.more + ' 条没列出来';
          bubble.appendChild(more);
        }
      }

      if (m.pending) {
        var acts = document.createElement('div');
        acts.className = 'asstacts';
        acts.innerHTML = '<button type="button" class="asstacts__btn asstacts__btn--danger" ' +
          'data-pending="yes">删除</button>' +
          '<button type="button" class="asstacts__btn" data-pending="no">算了</button>';
        bubble.appendChild(acts);
      } else if (m.undo && !m.undoUsed) {
        var undoRow = document.createElement('div');
        undoRow.className = 'asstacts';
        undoRow.innerHTML = '<button type="button" class="asstacts__btn" data-undo="1">撤销</button>';
        bubble.appendChild(undoRow);
      } else if (m.undoUsed && m.undoResult) {
        var doneRow = document.createElement('span');
        doneRow.className = 'asstmsg__undone';
        doneRow.textContent = m.undoResult;
        bubble.appendChild(doneRow);
      }
    }

    wrap.appendChild(bubble);

    if (m.kind !== 'typing') {
      var meta = document.createElement('span');
      meta.className = 'asstmsg__meta';
      meta.textContent = asstMetaText(m);
      wrap.appendChild(meta);
    }
    return wrap;
  }

  /* -------------------------------------------------------- 一轮对话 */

  function asstUseOf(model, res, pick) {
    var real = (res && res.realModel) || (model && model.model) || '';
    return {
      id: model ? model.id : '',
      name: model ? modelTitle(model) : '',
      model: real,
      version: versionOf(real),
      ms: (res && res.ms) || 0,
      manual: !!(pick && pick.manual),
      at: Date.now()
    };
  }

  function asstTurn(raw, kind) {
    var text = asstNormalize(raw);
    if (!text) { toast('没听到内容，再说一次试试'); return; }
    if (asst.busy) { toast('助手还在想上一句'); return; }
    asstPush({ role: 'user', kind: kind || 'text', text: text });
    asstThink(text);
  }

  function asstThink(text) {
    if (prefs.voiceEngine === 'ollama') {
      asstAskOllama(text);
      return;
    }
    if (prefs.voiceEngine === 'llm' && llmReady()) {
      asstAskModel(text);
      return;
    }
    asstApplyLocal(text, null);
  }

  function asstApplyLocal(text, why) {
    var intent = parseLocalIntent(text, Date.now());
    if (why && why.err) {
      asstNote('在线模型没成功（' + why.err + '），这次用本地规则处理。');
    }
    asstApply(intent, null);
  }

  /** 发给模型的上文：只取当前这句之前的，纯文本、限条数 */
  function asstHistoryFor(text) {
    var end = asst.msgs.length;
    while (end > 0 && asst.msgs[end - 1].role === 'user' && asst.msgs[end - 1].text === text) end--;
    var start = Math.max(0, end - ASST_HISTORY_MSGS);
    var out = [];
    for (var i = start; i < end; i++) {
      var m = asst.msgs[i];
      if (!m.text || m.kind === 'typing' || m.kind === 'note') continue;
      out.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text });
    }
    return out;
  }

  function asstDropTyping() {
    for (var i = asst.msgs.length - 1; i >= 0; i--) {
      if (asst.msgs[i].kind === 'typing') asst.msgs.splice(i, 1);
    }
    renderAsstLog();
  }

  function asstAskModel(text) {
    var pick = pickModel('assistant');
    var model = pick.model;
    if (!model) { asstApplyLocal(text, null); return; }

    asst.busy = true;
    asstPush({ role: 'assistant', kind: 'typing', text: '' });

    var messages = [{ role: 'system', content: asstSystemPrompt() }]
      .concat(asstHistoryFor(text), [{ role: 'user', content: text }]);

    runMessages(model, {
      messages: messages,
      temperature: 0.1,
      timeout: 30000
    }, function (err, res) {
      asst.busy = false;
      asstDropTyping();
      if (err) {
        /* 在线这条路断了就用本地规则接上，用户至少拿到结果 */
        asstApplyLocal(text, { err: err });
        return;
      }
      var intent = parseIntentPayload(res.text);
      if (!intent) {
        asstApplyLocal(text, { err: '模型没按约定输出动作' });
        return;
      }
      var use = asstUseOf(model, res, pick);
      asst.lastModel = use;
      renderAsstModel();
      asstApply(intent, use);
    });
  }

  /* -------------------------------------------------------- 本地大模型（电脑 Ollama）

     语音助手第三引擎：与在线模型共用同一套 JSON 意图协议和提示词，
     走 Ollama 原生 /api/chat（think:false 关思考）。地址按序尝试：
     先 WiFi 直连电脑，再 127.0.0.1（USB 时 adb reverse tcp:11434）。
     电脑不在身边 / 未放行跨域时自动退回本地规则，绝不卡住用户。 */

  var OLLAMA_BASES = ['http://192.168.1.3:11434', 'http://127.0.0.1:11434'];
  var OLLAMA_MODEL = 'qwen3:8b';
  var ollamaBase = '';

  function ollamaChat(base, messages, onDone) {
    var controller = null;
    try { controller = new AbortController(); } catch (err) { controller = null; }
    var timer = setTimeout(function () {
      if (controller) { try { controller.abort(); } catch (err) { /* 已完成 */ } }
    }, 20000);
    fetch(base + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller ? controller.signal : undefined,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: true,
        think: false,
        options: { temperature: 0.1 },
        messages: messages
      })
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var reader = res.body && res.body.getReader ? res.body.getReader() : null;
      if (!reader) throw new Error('不支持流式读取');
      var dec = new TextDecoder();
      var buf = '';
      var out = '';
      function pump() {
        return reader.read().then(function (step) {
          if (step.done) return out;
          buf += dec.decode(step.value, { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop();
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            try {
              var obj = JSON.parse(line);
              if (obj.message && obj.message.content) out += obj.message.content;
            } catch (err) { /* 半行 JSON，等下一块拼齐 */ }
          }
          return pump();
        });
      }
      return pump();
    }).then(function (text) {
      clearTimeout(timer);
      onDone(null, text);
    }).catch(function (err) {
      clearTimeout(timer);
      onDone(err, '');
    });
  }

  function asstAskOllama(text) {
    asst.busy = true;
    asstPush({ role: 'assistant', kind: 'typing', text: '' });
    var messages = [{ role: 'system', content: asstSystemPrompt() }]
      .concat(asstHistoryFor(text), [{ role: 'user', content: text }]);
    var bases = (ollamaBase ? [ollamaBase] : []).concat(OLLAMA_BASES);
    var at = 0;
    var tryNext = function () {
      if (at >= bases.length) {
        asst.busy = false;
        asstDropTyping();
        asstApplyLocal(text, { err: '电脑没连上（Ollama）' });
        return;
      }
      var base = bases[at++];
      ollamaChat(base, messages, function (err, res) {
        if (err) { tryNext(); return; }
        ollamaBase = base;
        asst.busy = false;
        asstDropTyping();
        var intent = parseIntentPayload(res);
        if (!intent) {
          asstApplyLocal(text, { err: '模型没按约定输出动作' });
          return;
        }
        var use = { name: OLLAMA_MODEL + ' · 电脑本地', id: 'ollama' };
        asst.lastModel = use;
        renderAsstModel();
        asstApply(intent, use);
      });
    };
    tryNext();
  }

  /* -------------------------------------------------------- 提示词与解析 */

  function asstTodoDigest() {
    var open = [];
    for (var i = 0; i < state.todos.length; i++) {
      if (!state.todos[i].done) open.push(state.todos[i]);
    }
    open.sort(function (a, b) {
      var ad = a.dueAt || 0, bd = b.dueAt || 0;
      if (ad && bd) return ad - bd;
      if (ad) return -1;
      if (bd) return 1;
      return 0;
    });
    var lines = [];
    for (var j = 0; j < open.length && j < ASST_TODO_IN_PROMPT; j++) {
      var t = open[j];
      lines.push('- ' + t.text + (t.dueAt ? ' @' + dueTextOf(t) : '（没设时间）'));
    }
    if (open.length > ASST_TODO_IN_PROMPT) {
      lines.push('- 还有 ' + (open.length - ASST_TODO_IN_PROMPT) + ' 条没列出来');
    }
    return lines.length ? lines.join('\n') : '（现在一条待办都没有）';
  }

  function asstSystemPrompt() {
    var now = new Date();
    var stamp = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()) +
      ' ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    return '你是「今日待办」App 里的语音助手，负责把一句口语变成实际的待办操作。\n' +
      '现在是 ' + stamp + '（星期' + '日一二三四五六'.charAt(now.getDay()) + '），时间一律按本地时间算。\n' +
      '只输出一个 JSON 对象，不要解释、不要代码块，字段如下：\n' +
      '{"action":"create|complete|delete|query|reply","text":"create 时的待办标题",' +
      '"times":["YYYY-MM-DDTHH:mm"],"targets":["complete/delete 时要匹配的待办关键词"],' +
      '"filter":"today|tomorrow|overdue|done|open","reply":"reply 时的一句话回答"}\n' +
      '判断规则：\n' +
      '1. 用户说要做什么事 → create。标题去掉「提醒我」「帮我」这类口头语，不超过 30 字；' +
      '时间换算成 24 小时制本地时间，相对说法（半小时后、明天）基于现在换算。\n' +
      '2. 用户说某件事做完了 → complete，targets 取待办原文里的关键词。\n' +
      '3. 用户说删掉某件事 → delete，targets 同上。\n' +
      '4. 用户问还有什么事 → query，filter 取 today/tomorrow/overdue/done/open。\n' +
      '5. 其它（打招呼、问建议、聊两句）→ reply，用一句中文直接回答，不超过 40 字。\n' +
      '拿不准是哪条待办时不要编造编号，把关键词放进 targets。\n' +
      '当前未完成待办：\n' + asstTodoDigest();
  }

  /** 模型回的 JSON → 意图对象；不合格返回 null（调用方退回本地规则） */
  function parseIntentPayload(payload) {
    var raw = String(payload || '').trim()
      .replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    var start = raw.indexOf('{');
    var end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) return null;

    var data;
    try { data = JSON.parse(raw.slice(start, end + 1)); } catch (error) { return null; }
    if (!data || typeof data !== 'object') return null;

    var action = String(data.action || '').toLowerCase();
    if (['create', 'complete', 'delete', 'query', 'reply'].indexOf(action) === -1) return null;

    var times = [];
    var list = Object.prototype.toString.call(data.times) === '[object Array]' ? data.times : [];
    for (var i = 0; i < list.length; i++) {
      var at = parseIsoLocal(typeof list[i] === 'string' ? list[i] : (list[i] && list[i].at));
      if (at) times.push(at);
    }

    var targets = [];
    var tl = Object.prototype.toString.call(data.targets) === '[object Array]' ? data.targets : [];
    for (var j = 0; j < tl.length; j++) {
      var s = String(tl[j] == null ? '' : tl[j]).trim();
      if (s) targets.push(s);
    }

    var filter = String(data.filter || '').toLowerCase();
    if (['today', 'tomorrow', 'overdue', 'done', 'open'].indexOf(filter) === -1) filter = 'open';

    return {
      action: action,
      text: String(data.text == null ? '' : data.text).trim(),
      times: times,
      targets: targets,
      filter: filter,
      reply: String(data.reply == null ? '' : data.reply).trim(),
      source: 'llm'
    };
  }

  /* -------------------------------------------------------- 撤销与确认 */

  function asstUndo(index) {
    var msg = asst.msgs[index];
    if (!msg || !msg.undo || msg.undoUsed) return;
    var u = msg.undo;
    var n = 0;
    for (var i = 0; i < u.ids.length; i++) {
      var todo = findTodo(u.ids[i]);
      if (!todo) continue;
      if (u.kind === 'add') { deleteTodo(todo.id); n++; }
      else if (u.kind === 'done') { if (setDone(todo, false)) n++; }
    }
    msg.undoUsed = true;
    msg.undoResult = n ? '已撤销' : '撤销失败，这条可能已经不在了';
    renderAsstLog();
    toast(msg.undoResult);
  }

  function asstResolvePending(index, yes) {
    var msg = asst.msgs[index];
    if (!msg || !msg.pending) return;
    var p = msg.pending;
    msg.pending = null;
    if (!yes) {
      msg.text = '好，这条留着。';
      msg.tag = '';
      renderAsstLog();
      return;
    }
    var res = asstDelete(p.id);
    msg.text = res.text;
    msg.tag = res.tag;
    msg.err = !res.ok;
    renderAsstLog();
    toast(truncate(res.text, 24));
  }

  /* -------------------------------------------------------- 面板与模型切换 */

  function asstModelLabel() {
    if (prefs.voiceEngine === 'ollama') return '本地大模型 · 电脑';
    if (prefs.voiceEngine !== 'llm') return '本地规则';
    var pick = pickModel('assistant');
    if (!pick.model) return '本地规则';
    var use = asst.lastModel;
    var tail = (use && use.id === pick.model.id && use.version) ? ' · ' + use.version : '';
    return (pick.manual ? '' : '自动 · ') + modelTitle(pick.model) + tail;
  }

  function renderAsstModel() {
    if (!el.assistantModelName) return;
    el.assistantModelName.textContent = asstModelLabel();
    if (el.assistantModel) {
      el.assistantModel.classList.toggle('is-llm', prefs.voiceEngine === 'llm');
      el.assistantModel.title = prefs.voiceEngine === 'llm'
        ? '当前用在线大模型，点一下换下一个'
        : '当前用本地规则，点一下切到在线大模型';
    }
  }

  /** 一处控三态：本地规则 → 自动挑选 → 逐个档案 → 回到本地规则 */
  function asstCycleModel() {
    var list = usableModels();
    if (!list.length) {
      toast('先去设置里添加一个模型（地址 + 密钥）');
      return;
    }
    if (prefs.voiceEngine !== 'llm') {
      prefs.voiceEngine = 'llm';
      prefs.llmRoute = 'auto';
      prefs.llmActiveId = list[0].id;
    } else if (prefs.llmRoute !== 'manual') {
      prefs.llmRoute = 'manual';
      prefs.llmActiveId = list[0].id;
    } else {
      var at = -1;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === prefs.llmActiveId) at = i;
      }
      if (at === -1 || at === list.length - 1) {
        /* 轮完一圈回到本地规则，省得用户被「一直在线」拖着走 */
        prefs.voiceEngine = 'local';
        prefs.llmRoute = 'auto';
        prefs.llmActiveId = '';
      } else {
        prefs.llmActiveId = list[at + 1].id;
      }
    }
    savePrefs();
    syncVoiceEnginePick();
    renderRouteState();
    renderAsstModel();
    toast('语音助手：' + asstModelLabel());
  }

  function openAssistant() {
    if (!el.assistantLayer) return;
    asst.open = true;
    show(el.assistantLayer, true);
    renderAsstLog();
    renderAsstModel();
  }

  function closeAssistant() {
    asst.open = false;
    show(el.assistantLayer, false);
    if (el.assistantInput && typeof el.assistantInput.blur === 'function') {
      el.assistantInput.blur();
    }
  }

  /** 助手面板里的发送：打字或快捷短语都走这里 */
  function asstSubmit(text) {
    var value = asstNormalize(text);
    if (!value) return;
    /* 上一句还在等模型：把话留在输入框里，别让人白打一遍 */
    if (asst.busy) {
      if (el.assistantInput && !el.assistantInput.value) el.assistantInput.value = value;
      toast('助手还在回上一句，稍等一下');
      return;
    }
    if (el.assistantInput) el.assistantInput.value = '';
    openAssistant();
    asstTurn(value, 'text');
  }

  /* ------------------------------------------------------------ 语音输入

     手机版：调系统自带的语音识别（小米是小爱、其他机器可能是 Google 语音服务）。
     识别结果交给语音助手处理（见上面「语音助手」一节），不再回填输入框。
     网页版：有 Web Speech API 的浏览器（Chrome / Edge）直接用它，别的退化到提示。
     这一段只管「把麦克风开起来、把文字收回来」，理解与执行都在助手那边。
     ========================================================================== */

  var voiceTimer = null;        /* 计时器（每 200ms 刷一次秒数） */
  var voiceAutoStop = null;     /* 兜底：一直不出结果就自己收 */
  var voiceWaveTimer = null;    /* 声波刷新 */
  var voiceLevel = 0;           /* 0..1，来自原生的 onRmsChanged */
  var voiceLevelTarget = 0;
  var voiceStartedAt = 0;
  var voiceText = '';           /* 这一轮识别到的文字 */
  var voiceReviewTimer = null;  /* 「正在识别」超过 4s 就自己降级到可编辑 */
  /* 「继续说」的锚点：出稿后再次开麦时先记住已有文字，
     新一轮 partial/result 都接到它后面，合成一段再交给助手 */
  var voiceResumeBase = '';

  /* 停顿多久算「说完了」。原生侧给引擎的静音 extra 只是建议值，
     小米等 ROM 的识别引擎不认（约 2 秒就自作主张断句），
     所以真正的 5 秒口径由页面在这里兜底执行。
     测试可通过 window.__VOICE_SILENCE_MS__ 覆盖。 */
  var VOICE_SILENCE_MS = (typeof global.__VOICE_SILENCE_MS__ === 'number' && global.__VOICE_SILENCE_MS__ > 0)
    ? global.__VOICE_SILENCE_MS__ : 5000;
  var voiceLastVoiceAt = 0;     /* 最近一次确凿人声（开口 / 出字）的时刻 */
  var voiceSilenceTimer = null; /* 停顿满 5 秒自动收稿 */
  var voiceRestartCount = 0;    /* 连续重开麦却没等到任何人声的次数，防死循环 */
  var voiceEmptyRetries = 0;    /* 引擎报错且一个字都没吐过时的自动重试次数 */
  var voiceLastRestartAt = 0;   /* 上次重开麦的时刻：限流，防止引擎重建期
                                   的连环 busy 报错把重启打成机关枪 */
  var voiceLastFailAt = 0;      /* 上次引擎报错时刻：重启后才报错 = 引擎真死了 */
  var VOICE_RESTART_GAP_MS = (typeof global.__VOICE_RESTART_GAP_MS__ === 'number' && global.__VOICE_RESTART_GAP_MS__ >= 0)
    ? global.__VOICE_RESTART_GAP_MS__ : 1200;
  var voiceSessionStartAt = 0;  /* 当前这枚引擎会话的开麦时刻 */

  /**
   * 单次引擎会话的保鲜期。ROM 的联网识别服务对一段连续会话有隐式时长上限，
   * 超了会被服务端掐流，客户端只会收到 ERROR_NETWORK(_TIMEOUT)——
   * 就是「短语音没事、长语音报网络错误」的根因。到点前主动换气。
   * 测试可通过 window.__VOICE_SESSION_MS__ 覆盖（0 = 用默认值）。
   */
  function voiceSessionMs() {
    return (typeof global.__VOICE_SESSION_MS__ === 'number' && global.__VOICE_SESSION_MS__ > 0)
      ? global.__VOICE_SESSION_MS__ : 20000;
  }

  function touchVoiceSession() { voiceSessionStartAt = Date.now(); }

  /** 语音事件时间线：真机排查「提前中断」这类问题用。
      CDP 里读 window.__voiceLog（环形 300 条），关键事件同时进 console → logcat。 */
  function voiceLog(ev, detail) {
    try {
      var log = global.__voiceLog || (global.__voiceLog = []);
      log.push({
        t: Date.now(), ev: ev,
        detail: detail == null ? '' : String(detail).slice(0, 80),
        owner: voiceOwner,
        state: (voiceOwner === 'memo' && memoVoice) ? memoVoice.state : voiceState
      });
      if (log.length > 300) log.splice(0, log.length - 300);
      if (ev !== 'level' && ev !== 'partial' && global.console && global.console.log) {
        global.console.log('[voice] ' + ev + ' ' + (detail == null ? '' : String(detail).slice(0, 60)));
      }
    } catch (error) { /* 日志失败不影响主流程 */ }
  }

  /** 两段识别结果拼接：中文直接接，两边都是英文数字才补个空格 */
  function joinVoiceParts(a, b) {
    var s = String(a || ''), t = String(b || '');
    if (!s) return t;
    if (!t) return s;
    var word = /[A-Za-z0-9]$/;
    var joiner = word.test(s) && /^[A-Za-z0-9]/.test(t) ? ' ' : '';
    return s + joiner + t;
  }

  var VOX_MAX_MS = 60000;       /* 一口气说一分钟已经很长了 */
  var VOX_BARS = 27;            /* 声波柱数，和设计稿一致：中间高、两边低 */

  function nativeVoiceApi() {
    var api = global.TodoNative;
    if (!api) return null;
    if (typeof api.startVoiceListening === 'function') return api;
    return null;
  }

  function webSpeechCtor() {
    return global.SpeechRecognition || global.webkitSpeechRecognition || null;
  }

  function voiceSupported() {
    return !!nativeVoiceApi() || !!webSpeechCtor();
  }

  /* 语音输入的五个状态，全都画在同一屏里：
       idle      没开
       listening 正在聆听：声波跟着音量跳，中间结果实时上屏
       stopping  说完了，等引擎出最终稿
       review    出稿了，文字可改，改完点发送
       typing    识别不可用 / 没听清：这一屏直接当输入框用
     closing 只是取消后吸收迟到回调的短暂过渡，界面上不出现。 */
  var voiceState = 'idle';
  /* 麦克风现在归谁用：panel=整屏语音助手，memo=笔记详情里的语音输入。
     原生识别回调只有一个入口（VoiceHost），按这个字段分发，两边互不串音。 */
  var voiceOwner = 'panel';

  /* ---------------- 声波 ---------------- */

  /** 中间高两边低的静态轮廓，乘上实时音量就是「说话时的起伏」 */
  function voxShape(i) {
    var mid = (VOX_BARS - 1) / 2;
    var d = Math.abs(i - mid) / mid;          /* 0 中间 → 1 两端 */
    return 0.22 + 0.78 * Math.pow(1 - d, 1.35);
  }

  function buildVoiceWave() {
    if (!el.voiceWave || el.voiceWave.childNodes.length === VOX_BARS) return;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < VOX_BARS; i++) {
      var bar = document.createElement('i');
      bar.className = 'vox__bar';
      /* 偶数米位高一点点，看起来更像真实波形 */
      bar.setAttribute('data-seed', String(0.7 + (i % 5) * 0.06).slice(0, 4));
      frag.appendChild(bar);
    }
    el.voiceWave.textContent = '';
    el.voiceWave.appendChild(frag);
  }

  function paintVoiceWave() {
    if (!el.voiceWave) return;
    var bars = el.voiceWave.childNodes;
    if (!bars.length) return;
    var t = Date.now() / 1000;
    for (var i = 0; i < bars.length; i++) {
      var bar = bars[i];
      if (!bar || !bar.style) continue;
      var seed = parseFloat(bar.getAttribute('data-seed') || '0.8');
      var wobble = 0.55 + 0.45 * Math.sin(t * 6.5 + i * 0.9);
      /* 没有音量时也留一点呼吸感，让人知道正在听 */
      var idle = 0.16 + 0.1 * Math.sin(t * 2.2 + i * 0.55);
      var scale = Math.max(0.08, Math.min(1, voxShape(i) * (idle + voiceLevel * 1.45 * wobble) * seed));
      bar.style.transform = 'scaleY(' + scale.toFixed(3) + ')';
    }
  }

  function startVoiceWave() {
    buildVoiceWave();
    if (voiceWaveTimer) return;
    voiceWaveTimer = global.setInterval(paintVoiceWave, 70);
    paintVoiceWave();
  }

  function stopVoiceWave() {
    if (voiceWaveTimer) {
      global.clearInterval(voiceWaveTimer);
      voiceWaveTimer = null;
    }
    voiceLevel = 0;
    voiceLevelTarget = 0;
    paintVoiceWave();
  }

  /** 原生音量（dB 大约 -2..10）折算成 0..1，再做一点平滑 */
  function setVoiceLevel(db) {
    var v = (Number(db) + 2) / 12;
    if (!isFinite(v)) v = 0;
    voiceLevelTarget = Math.max(0, Math.min(1, v));
    voiceLevel = voiceLevel + (voiceLevelTarget - voiceLevel) * 0.45;
    if (voiceState === 'listening') paintVoiceWave();
  }

  /* ---------------- 计时 ---------------- */

  function formatVoxClock(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    return pad2(Math.floor(total / 60)) + ':' + pad2(total % 60);
  }

  function startVoiceTimer() {
    stopVoiceTimer();
    voiceStartedAt = Date.now();
    if (el.voiceTimer) el.voiceTimer.textContent = '00:00';
    voiceTimer = global.setInterval(function () {
      if (el.voiceTimer) el.voiceTimer.textContent = formatVoxClock(Date.now() - voiceStartedAt);
      /* 录音转写不限时长：不换气、不设上限（大模型按段转写，段间无重叠） */
      if (dictationActive()) return;
      maybeRecycleVoiceSession();
      if (Date.now() - voiceStartedAt > VOX_MAX_MS) finishVoiceListening();
    }, 200);

    if (voiceAutoStop) global.clearTimeout(voiceAutoStop);
    /* 引擎一声不吭的情况：到点自己收，别让人对着黑屏干等 */
    voiceAutoStop = global.setTimeout(function () {
      voiceAutoStop = null;
      if (voiceState === 'listening') finishVoiceListening();
    }, VOX_MAX_MS + 3000);
  }

  function stopVoiceTimer() {
    if (voiceTimer) {
      global.clearInterval(voiceTimer);
      voiceTimer = null;
    }
    if (voiceAutoStop) {
      global.clearTimeout(voiceAutoStop);
      voiceAutoStop = null;
    }
  }

  /* ---------------- 这一屏的四种样子 ---------------- */

  var VOX_COPY = {
    listening: {
      title: '正在聆听',
      sub: '把想做的事，轻声说出来',
      label: '结束录音',
      hint: '结束后可以改字，再交给助手'
    },
    stopping: {
      title: '正在识别',
      sub: '松手了，马上就好',
      label: '识别中…',
      hint: '大概一秒，别急'
    },
    review: {
      title: '确认内容',
      sub: '哪里听岔了，直接改字',
      label: '发送给助手',
      hint: '停顿断句了就点「继续说」，说完再发'
    },
    typing: {
      title: '直接打字也行',
      sub: '这台手机没听成，把话写下来一样',
      label: '发送给助手',
      hint: '写完点发送，或点「继续说」再试一次'
    }
  };

  function setVoiceState(state, message) {
    voiceState = state || 'idle';
    var copy = VOX_COPY[voiceState];
    if (el.voiceLayer) el.voiceLayer.setAttribute('data-state', voiceState);

    if (copy) {
      if (el.voiceTitle) el.voiceTitle.textContent = copy.title;
      if (el.voiceSub) el.voiceSub.textContent = message || copy.sub;
      if (el.voiceStopLabel) el.voiceStopLabel.textContent = copy.label;
      if (el.voiceHint) el.voiceHint.textContent = copy.hint;
    }

    /* 只有 review / typing 才把文字换成可编辑的输入框 */
    var editing = voiceState === 'review' || voiceState === 'typing';
    /* v4：大输入框常驻——实时文字直接进大框，随时可以打字/改字，无额外输入行 */
    show(el.voiceLive, false);
    show(el.voiceEdit, true);
    show(el.voicePh, false);
    show(el.voiceWave, voiceState === 'listening');
    show(el.voiceTimer, voiceState === 'listening' || voiceState === 'stopping');
    /* 识别出文字之后，除了「交给助手」，也该能「存成笔记」——
       长内容塞不进一条待办，这是 M1 里最重要的一条入口 */
    /* v4.2：＋笔记/＋待办 常驻可见（空文时点击有 toast 提示） */
    show(el.voiceToMemo, true);
    /* 出稿后还能接着说：停顿被判断句不打断流程，新话接到后面 */
    show(el.voiceMore, editing);

    if (el.voiceStop) {
      el.voiceStop.disabled = voiceState === 'stopping';
      el.voiceStop.setAttribute('aria-busy', voiceState === 'stopping' ? 'true' : 'false');
      el.voiceStop.setAttribute('aria-label', (VOX_COPY[voiceState] || {}).label || '结束录音');
      el.voiceStop.classList.toggle('is-send', editing);
    }

    if (!editing && el.voiceLive) el.voiceLive.textContent = voiceText;
    /* v4：听录/识别中，已确认的文字同步进大框显示 */
    if (el.voiceEdit && el.voiceEdit.value !== voiceText) el.voiceEdit.value = voiceText;
  }

  function renderVoiceText() {
    if (el.voiceLive) el.voiceLive.textContent = voiceText;
    /* v4：听录中大框就是正文显示区（打字回写由 voiceEdit 的 input 监听完成） */
    if (el.voiceEdit && voiceState === 'listening') el.voiceEdit.value = voiceText;
    saveVoiceDraft();
    show(el.voicePh, voiceState !== 'review' && voiceState !== 'typing' && !voiceText);
    /* 「存入待办」：听录中出了字就能直接放进去，不必等出稿 */
    /* 「＋待办」：v4.2 起常驻可见（空文时点击有 toast 提示） */
    if (el.voiceToTodo) {
      show(el.voiceToTodo, true);
    }
    /* 「打字补充」：录音转写模式下边录边打字，两路输入并存 */
    if (el.voiceDictType) {
      show(el.voiceDictType, dict.mode && voiceState === 'listening');
    }
  }

  /** 打字补充：把键盘输入并入当前正文（录音不停） */
  function insertDictationTyping() {
    var typed = String((el.voiceDictTypeInput && el.voiceDictTypeInput.value) || '').trim();
    if (!typed) return;
    voiceText = joinVoiceParts(voiceText, typed);
    if (voiceOwner === 'panel') voiceResumeBase = voiceText;
    el.voiceDictTypeInput.value = '';
    renderVoiceText();
  }

  var voiceViewportFrame = 0;

  function scheduleVoiceViewport() {
    if (!el.voiceLayer || el.voiceLayer.classList.contains('is-hidden') || voiceViewportFrame) return;
    voiceViewportFrame = global.requestAnimationFrame(function () {
      voiceViewportFrame = 0;
      var viewport = global.visualViewport;
      if (!viewport || viewport.height <= 0) return;
      el.voiceLayer.style.setProperty('--vox-viewport-height', viewport.height + 'px');
      el.voiceLayer.style.setProperty('--vox-viewport-top', viewport.offsetTop + 'px');
    });
  }

  function showVoiceLayer(on) {
    if (!el.voiceLayer) return;
    show(el.voiceLayer, !!on);
    if (on) {
      scheduleVoiceViewport();
      return;
    }
    if (el.voiceLayer.contains(document.activeElement)) document.activeElement.blur();
    if (voiceViewportFrame) global.cancelAnimationFrame(voiceViewportFrame);
    voiceViewportFrame = 0;
    el.voiceLayer.style.removeProperty('--vox-viewport-height');
    el.voiceLayer.style.removeProperty('--vox-viewport-top');
    el.voiceLayer.querySelector('.vox').scrollTop = 0;
    stopVoiceWave();
    stopVoiceTimer();
  }

  /** 打开这一屏并开麦；识别器不可用时直接进打字态，入口永远有效。
      keep 为 true 时不清字（「继续说」从出稿态接着录，网页兜底路径用） */
  /* ============ 草稿自动保存：误关浮层 / 杀掉 App 都不丢已识别文字 ============
     存 localStorage（跟着 App 数据走）；存档/发送/存入待办时清掉，✕ 误触保留 */
  var VOICE_DRAFT_KEY = 'voice.draft';

  function saveVoiceDraft() {
    try {
      if (String(voiceText || '').trim()) {
        global.localStorage.setItem(VOICE_DRAFT_KEY, String(voiceText));
      } else {
        global.localStorage.removeItem(VOICE_DRAFT_KEY);
      }
    } catch (err) { /* 存不上也不影响当次使用 */ }
  }

  function loadVoiceDraft() {
    try { return global.localStorage.getItem(VOICE_DRAFT_KEY) || ''; } catch (err) { return ''; }
  }

  function clearVoiceDraft() {
    try { global.localStorage.removeItem(VOICE_DRAFT_KEY); } catch (err) { /* 忽略 */ }
  }

  function openVoiceLayer(keep) {
    if (!keep) {
      voiceText = '';
      voiceResumeBase = '';
      voiceLastVoiceAt = 0;
      voiceRestartCount = 0;
      voiceEmptyRetries = 0;
      voiceLastRestartAt = 0;
      voiceLastFailAt = 0;
      clearVoiceSilenceTimer();
      /* 恢复上次没存档的草稿（语音识别的文字来之不易） */
      var draft = loadVoiceDraft();
      if (draft) {
        voiceText = isRadioNumberRun(draft) ? panelSpokenText(draft) : draft;
        toast('已恢复上次未存档的内容');
      }
    }
    if (el.voiceEdit) el.voiceEdit.value = '';
    if (el.voiceLive) el.voiceLive.textContent = '';
    if (el.voiceDictateKey) show(el.voiceDictateKey, false);
    showVoiceLayer(true);
    setVoiceState('listening');
    startVoiceWave();
    startVoiceTimer();
  }

  /** 「结束录音」：停止收音，等最终稿 */
  function finishVoiceListening() {
    if (voiceState !== 'listening') return;
    /* 收音已结束，只剩转写排队时，再点结束不能切进系统识别的 stopping 状态。 */
    if (dict.mode && !dict.recording && (dict.busy || dict.pending.length)) return;
    clearVoiceSilenceTimer();
    stopVoiceWave();
    stopVoiceTimer();
    if (dictationActive()) {
      /* 录音转写：录音停，转写继续（可能还有几段在路上），排空后进 review。
         recording 保持 true：尾段的 segment/stopped 回调仍要收。 */
      setVoiceState('listening');
      if (el.voiceTitle) el.voiceTitle.textContent = '录音转写';
      if (el.voiceSub) el.voiceSub.textContent = '录音结束，正在转写剩余段落…';
      syncVoiceStop();   /* 大按钮切到「跳过剩余转写」 */
      var api = dictationApi();
      if (api) api.stopDictation();
      pumpDictation();
      return;
    }
    setVoiceState('stopping');

    var api = nativeVoiceApi();
    var stopped = false;
    if (api && typeof api.stopVoiceListening === 'function') {
      try { stopped = api.stopVoiceListening() !== false; } catch (err) { stopped = false; }
    }
    if (!stopped) {
      /* 网页版语音 / 老桥接：没有 stop，只能整段收掉，把现有文字交出去 */
      if (voiceText) enterVoiceReview(voiceText);
      else enterVoiceTyping('没听到内容，再说一次或直接打字');
      return;
    }

    /* 有的引擎 stop 之后既不给结果也不报错，4 秒兜底 */
    if (voiceReviewTimer) global.clearTimeout(voiceReviewTimer);
    voiceReviewTimer = global.setTimeout(function () {
      voiceReviewTimer = null;
      if (voiceState !== 'stopping') return;
      if (voiceText) enterVoiceReview(voiceText);
      else enterVoiceTyping('这次没识别出来，再说一次或直接打字');
    }, 4000);
  }

  function clearVoiceReviewTimer() {
    if (voiceReviewTimer) {
      global.clearTimeout(voiceReviewTimer);
      voiceReviewTimer = null;
    }
  }

  /* ---------------- 停顿闸门：5 秒口径由页面兜底 ---------------- */

  function clearVoiceSilenceTimer() {
    if (voiceSilenceTimer) {
      global.clearTimeout(voiceSilenceTimer);
      voiceSilenceTimer = null;
    }
  }

  /** 确凿的人声来了（吐出了文字）：
      停顿计时重新起算，提示语回到「我在听」 */
  function markVoiceActivity() {
    voiceLastVoiceAt = Date.now();
    voiceRestartCount = 0;
    voiceEmptyRetries = 0;
    clearVoiceSilenceTimer();
    if (voiceOwner === 'panel' && voiceState === 'listening' && el.voiceSub) {
      el.voiceSub.textContent = '我在听，请说…';
    }
  }

  /** 引擎停顿断句后进来：静音满 5 秒才收稿，没满就重新开麦接着收 */
  function armVoiceSegment() {
    clearVoiceSilenceTimer();
    var wait = VOICE_SILENCE_MS - (Date.now() - voiceLastVoiceAt);
    if (wait <= 0 || voiceRestartCount >= 4) {
      /* 没观测到任何人声信号（引擎不吐 partial 也不报开口），
         或重开太多次都没人说话：按老流程直接出稿，别拖着 */
      voiceLog('gate-now', 'wait=' + Math.round(wait) + ' restarts=' + voiceRestartCount + ' text=' + voiceText);
      finalizeVoiceBySilence();
      return;
    }
    voiceLog('gate-arm', 'wait=' + Math.round(wait) + ' restarts=' + voiceRestartCount);
    if (voiceOwner === 'panel' && voiceState === 'listening' && el.voiceSub) {
      el.voiceSub.textContent = '停顿中，接着说或等几秒自动整理';
    }
    voiceSilenceTimer = global.setTimeout(finalizeVoiceBySilence, wait);
    /* 重开麦限流：刚重启过的引擎还来得及收音，连环 busy 报错就别再开了，
       计时器已挂上，到点自动收稿。两个例外通道：
       - 距上次重启超过限流窗口：正常重开；
       - 重启 300ms 之后才报的错 = 引擎不是重建期抖动，是真死了，立即重开，
         否则会出现「没有引擎在听」的空窗，收稿只能靠 4 秒兜底。 */
    var sinceRestart = Date.now() - voiceLastRestartAt;
    var engineDied = voiceLastFailAt > voiceLastRestartAt && sinceRestart > 300;
    if (sinceRestart >= VOICE_RESTART_GAP_MS || engineDied) {
      restartVoiceCapture();
    }
  }

  /** 重新开麦接着收（自动续听，与手动「继续说」共用 startVoiceListening） */
  function restartVoiceCapture() {
    var api = nativeVoiceApi();
    if (api) {
      voiceRestartCount += 1;
      voiceLastRestartAt = Date.now();
      touchVoiceSession();
      voiceLog('restart', 'count=' + voiceRestartCount);
      try {
        if (api.startVoiceListening() !== false) { startVoiceWave(); return; }
      } catch (err) { /* 落到下面的兜底 */ }
    } else if (webSpeechCtor()) {
      voiceRestartCount += 1;
      voiceLastRestartAt = Date.now();
      touchVoiceSession();
      voiceLog('restart-web', 'count=' + voiceRestartCount);
      startWebSpeech(true);   /* 浏览器兜底：同样不清已有文字 */
      return;
    }
    /* 重开失败：别让人干等，把已有文字直接交出去 */
    voiceLog('restart-fail', 'text=' + voiceText);
    clearVoiceSilenceTimer();
    if (voiceText) enterVoiceReview(voiceText);
    else enterVoiceTyping('这次没识别出来，直接打字也行');
  }

  /** 停顿满 5 秒：按一次正常的「结束录音」收稿（识别器可能还在跑） */
  function finalizeVoiceBySilence() {
    clearVoiceSilenceTimer();
    if (voiceOwner !== 'panel' || voiceState !== 'listening') return;
    voiceLog('silence-done', 'text=' + voiceText);
    finishVoiceListening();
  }

  /**
   * 引擎会话保鲜：联网识别引擎一段会话连得太久，服务端会掐流
   * （长语音才报「网络错误」的根因，短语音在限内没事）。
   * 快到上限就主动「换口气」：让引擎把这一段交成最终稿——
   * result 回来会合进 voiceResumeBase，停顿闸门再自然重开麦，文字不丢。
   */
  function maybeRecycleVoiceSession() {
    if (voiceOwner !== 'panel' || voiceState !== 'listening') return;
    if (Date.now() - voiceSessionStartAt < voiceSessionMs()) return;
    touchVoiceSession();
    voiceLog('session-recycle', 'text=' + voiceText);
    if (el.voiceSub) el.voiceSub.textContent = '换口气接着听，说过的都在…';
    var api = nativeVoiceApi();
    if (api && typeof api.stopVoiceListening === 'function') {
      try { api.stopVoiceListening(); } catch (err) { restartVoiceCapture(); }
      return;
    }
    /* 浏览器版没有 stop：直接重建识别器，已有文字经 startWebSpeech(true) 保留 */
    restartVoiceCapture();
  }

  /** 出稿：文字进可编辑框，改完点发送 */
  function enterVoiceReview(text) {
    voiceLog('review', text);
    clearVoiceReviewTimer();
    clearVoiceSilenceTimer();
    stopVoiceWave();
    stopVoiceTimer();
    voiceResumeBase = '';   /* 出稿即消费掉「继续说」的锚点 */
    voiceText = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    var invalidTime = compactClocks(voiceText).some(function(clock) { return clock.invalid && clock.labelled; });
    setVoiceState(voiceText ? 'review' : 'typing', invalidTime
      ? '请核对时间，时间应读四位数字，或说几点几分'
      : undefined);
  }

  /** 识别失败 / 引擎不开放：这一屏直接当输入框 */
  function enterVoiceTyping(message) {
    voiceLog('typing', message);
    clearVoiceReviewTimer();
    clearVoiceSilenceTimer();
    stopVoiceWave();
    stopVoiceTimer();
    setVoiceState('typing', message);
  }

  /**
   * 「继续说」：出稿后（review/typing）再按一次麦克风接着说。
   * 已有文字留在原地当锚点，新一轮 partial/result 都接到它后面，
   * 说完再回到出稿态 —— 停顿被判断句也不会打断「说话 → 确认」这个流程。
   */
  function resumeVoiceListening() {
    if (voiceState !== 'review' && voiceState !== 'typing') return;
    /* 录音转写模式下「继续说」必须续录转写，不能错开系统识别器；
       keep=true：已转出的文字与没转完的段全都保留（共享草稿） */
    if (dict.mode) {
      var base = String(voiceText || '');
      startDictationFlow(true);
      voiceResumeBase = base;   /* startDictationFlow 会重开浮层，锚点在之后恢复 */
      renderVoiceText();
      return;
    }
    var api = nativeVoiceApi();
    if (!api) {
      /* 浏览器版没有独立的继续录能力，退回打字态（文字都还在） */
      if (!webSpeechCtor()) {
        enterVoiceTyping('这里接不上录音，直接把要补的话打出来吧');
        return;
      }
      voiceResumeBase = String(voiceText || '');
      startWebSpeech(true);   /* 自己会调 VoiceHost，走同一套合并逻辑 */
      return;
    }
    voiceResumeBase = String(voiceText || '');
    var started = false;
    try { started = api.startVoiceListening() !== false; } catch (err) { started = false; }
    if (!started) {
      voiceResumeBase = '';
      enterVoiceTyping('没接着录上，直接把要补的话打出来吧');
      return;
    }
    voiceOwner = 'panel';
    touchVoiceSession();
    setVoiceState('listening');
    startVoiceWave();
    startVoiceTimer();
  }

  /** 这一屏唯一一次「交出去」：文字给语音助手，接着就是它在办 */
  /** 当前这一屏上用户认可的文字：改字框优先，否则用识别结果 */
  function voiceTextNow() {
    var text = '';
    if (voiceState === 'review' || voiceState === 'typing') {
      text = String((el.voiceEdit && el.voiceEdit.value) || voiceText || '');
    } else {
      text = voiceText;
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  function sendVoiceText() {
    var text = voiceTextNow();
    if (!text) {
      toast('还没听到内容，说一句或写一句都行');
      if (el.voiceEdit) {
        try { el.voiceEdit.focus(); } catch (err) { /* 忽略 */ }
      }
      return;
    }
    closeVoiceLayer();
    clearVoiceDraft();   /* 文字已交出去，草稿不再恢复 */
    openAssistant();
    asstTurn(text, 'voice');
  }

  /**
   * 「存入待办」（加号按钮）：退出语音界面，把当前识别文字填进「新增待办」输入框。
   * 不自动提交——用户还能看一眼、改字，再点待办栏的加号。
   */
  function sendVoiceToTodoInput() {
    var text = voiceTextNow();
    if (!text) {
      toast('还没听到内容，说一句或写一句都行');
      return;
    }
    if (voiceState === 'listening' || voiceState === 'stopping') {
      voiceState = 'closing';
      stopNativeVoice();
      clearVoiceReviewTimer();
      clearVoiceSilenceTimer();
    }
    closeVoiceLayer();
    clearVoiceDraft();   /* 已填入待办栏，草稿不再恢复 */
    if (el.newTodo) {
      el.newTodo.value = prepareAddVoiceDigits(text);
      try {
        el.newTodo.dispatchEvent(new global.Event('input', { bubbles: true }));
      } catch (error) { /* 事件失败不影响填字 */ }
      try { el.newTodo.focus(); } catch (error) { /* 忽略 */ }
    }
    toast('已填入新增待办，看一眼再点加号');
  }

  /* ============================================== 录音转写（方案 1 增强版）

     与「实时识别」的区别：讲话时录音不限时长，停止说话5秒后收稿；按静音自动切段，
     每段录完就串行发给同一个支持音频的大模型转写，先出段的文字先上屏。
     适合长口述：想到哪说到哪，静音5秒或点「结束录音」后，全文进可编辑框。

       DictationHost.ready()                     开麦了
       DictationHost.segment(seq, seconds)       一段录完（转写队列里排队）
       DictationHost.stopped()                   录音结束（尾段已交出）
       DictationHost.level(db)                   实时音量
       DictationHost.failed(msg)                 录音出错
     出稿之后的出口（交给助手 / 存成笔记 / 存入待办）与实时识别完全共用。 */

  var dict = {
    mode: false,        /* 浮层当前处于「录音转写」模式 */
    recording: false,   /* 原生录音中 */
    gen: 0,             /* 会话代号：取消/重开后，迟到的转写结果按它丢弃 */
    busy: false,        /* 当前有一个转写请求在飞 */
    pending: [],        /* 待转写段 [{seq, seconds}] */
    fails: 0,           /* 连续转写失败次数 */
    done: 0,            /* 已成功转写出的段数 */
    localSuspended: false, /* 本地引擎看门狗超时后：本会话不再用它，改走网络/跳过 */
    noVoice: false,     /* 开麦到结束没听到任何人声（页面据此给出准确提示） */
    model: null         /* 本次会话用的模型档案 */
  };

  function dictationApi() {
    var api = global.TodoNative;
    return api && typeof api.startDictation === 'function' ? api : null;
  }

  function dictateReady() {
    return !!(prefs.dictate && prefs.dictate.endpoint && prefs.dictate.key);
  }

  /** 离线转写引擎（whisper.cpp）：模型随包 + 本地库就绪。优先于网络服务 */
  function whisperReady() {
    var api = global.TodoNative;
    if (!api || typeof api.whisperAvailable !== 'function') return false;
    try {
      return api.whisperAvailable() === true;
    } catch (error) {
      return false;
    }
  }

  function dictationActive() {
    return dict.mode && dict.recording;
  }

  /** 浮层头部的小切换：实时识别 ⇄ 录音转写。
      两种模式共用同一屏与同一段共享草稿：任何时候都能切，
      已识别的文字原样保留、录音进行中切换也不丢前文。 */
  function toggleDictationMode() {
    if (!dict.mode && !dictationApi()) {
      toast('录音转写需要手机版');
      return;
    }
    var wasListening = voiceState === 'listening';
    var current = String(voiceText || '');

    if (wasListening && dict.mode) {
      /* 录音转写 → 实时识别：让原生自然收尾（尾段照常入队转写、文字不丢），
         已转出的文字作为实时识别的锚点接着用 */
      var apiStop = dictationApi();
      if (apiStop) { try { apiStop.stopDictation(); } catch (err) { /* stopped 回调兜底 */ } }
      dict.mode = false;
      syncDictationToggle();
      prefs.voiceTodoMode = 'realtime';
      savePrefs();
      syncVoiceModePicks();
      if (current) voiceResumeBase = current;
      clearVoiceSilenceTimer();
      voiceOwner = 'panel';
      setVoiceState('listening');
      startVoiceWave();
      startVoiceTimer();
      var api2 = nativeVoiceApi();
      var started2 = false;
      try { started2 = api2 && api2.startVoiceListening() !== false; } catch (err) { started2 = false; }
      if (!started2 && webSpeechCtor()) { startWebSpeech(true); started2 = true; }
      if (!started2) enterVoiceTyping('识别器没接上，转出的文字都还在，直接打字补充');
      toast('语音输入：实时识别');
      return;
    }

    if (wasListening && !dict.mode) {
      /* 实时识别 → 录音转写：掐掉系统识别器，已识别文字接在录音转写前面 */
      stopNativeVoice();   /* 此刻 dict.mode 还是 false：走的是 cancelVoiceListening */
      clearVoiceReviewTimer();
      clearVoiceSilenceTimer();
      stopVoiceWave();
      stopVoiceTimer();
      dict.mode = true;
      syncDictationToggle();
      prefs.voiceTodoMode = 'dict';
      savePrefs();
      syncVoiceModePicks();
      startDictationFlow(true);
      toast('录音转写：不限时长，说完自动转文字');
      return;
    }

    /* review / typing / 刚打开：只切标记，文字留在原地，下次开麦沿用新模式 */
    dict.mode = !dict.mode;
    syncDictationToggle();
    /* 用户手动切换视为改默认：写进「待办语音输入」设置 */
    prefs.voiceTodoMode = dict.mode ? 'dict' : 'realtime';
    savePrefs();
    syncVoiceModePicks();
    toast(dict.mode ? '录音转写：不限时长，说完自动转文字' : '语音输入：实时识别');
  }

  function syncDictationToggle() {
    if (el.voiceDictate) {
      el.voiceDictate.classList.toggle('is-on', dict.mode);
      el.voiceDictate.setAttribute('aria-pressed', dict.mode ? 'true' : 'false');
    }
    if (el.voiceBadge) {
      el.voiceBadge.textContent = dict.mode ? '录音转写' : '语音输入';
    }
  }

  /** 开一场录音转写。keep=true：续录/模式切换共用——已有文字与未转写的段
      全都保留，只重开麦克风；false 才是全新会话。 */
  function startDictationFlow(keep) {
    if (memoDict.active) {
      toast('笔记语音正占着麦克风，先关掉它');
      return;
    }
    if (!whisperReady() && !dictateReady()) {
      openVoiceLayer(!!keep);
      enterVoiceTyping('录音转写需要先配置一个语音识别服务（默认用硅基流动的免费模型，粘贴 API Key 即可）');
      show(el.voiceDictateKey, true);   /* 密钥输入区就在下面，填好点保存 */
      return;
    }
    if (keep) {
      if (dict.fails >= 3) dict.fails = 2;   /* 续录给队列一次恢复机会 */
    } else {
      dict.busy = false;
      dict.pending = [];
      dict.fails = 0;
      dict.done = 0;
      dict.localSuspended = false;
    }
    dict.recording = true;
    dict.noVoice = false;
    dict.gen += 1;
    voiceOwner = 'panel';
    openVoiceLayer(!!keep);
    if (keep && voiceText) voiceResumeBase = String(voiceText);   /* 共享草稿：前文不丢 */
    setVoiceState('listening');
    if (el.voiceTitle) el.voiceTitle.textContent = '录音转写';
    if (el.voiceSub) el.voiceSub.textContent = keep && voiceText ? '前文已保留，正在开麦…' : '正在开麦…';
    var api = dictationApi();
    if (!api) {
      enterVoiceTyping('录音转写需要手机版');
      return;
    }
    var started = false;
    try { started = api.startDictation() !== false; } catch (error) { started = false; }
    if (!started) enterVoiceTyping('录音没开起来，直接打字吧');
  }

  /** 转写队列：串行，一段一个请求；失败跳过，连续失败停止。
      每个在飞请求都挂着看门狗：引擎卡死（本地模型挂起/网络无回包）时
      到点强制跳过，队列永不永久堵死 —— 这是「转写过程卡死」的兜底。 */
  function pumpDictation() {
    if (!dict.pending.length || dict.busy) {
      maybeFinishDictation();
      return;
    }
    if (dict.fails >= 3) {
      /* 连续三段都转不出来：多半是模型/网络出了状况，别再烧后面的段 */
      dict.pending = [];
      maybeFinishDictation();
      toast('转写连续失败（共 ' + dict.done + ' 段成功），已保留转出的文字');
      return;
    }
    var seg = dict.pending[0];
    var api = dictationApi();
    if (!api) {
      dict.pending.shift();
      pumpDictation();
      return;
    }
    var localOk = whisperReady() && !dict.localSuspended;
    if (localOk) seg.engine = 'local';
    else if (dictateReady()) seg.engine = 'net';
    else {
      /* 本地引擎被看门狗挂起又没配网络服务：跳过这一段，别让人干等 */
      voiceLog('dict-skip-noengine', 'seq=' + seg.seq);
      dict.pending.shift();
      dict.fails += 1;
      pumpDictation();
      return;
    }
    dict.busy = true;
    if (dict.mode && el.voiceSub) {
      el.voiceSub.textContent = dict.recording
        ? '录音中 · 转写第 ' + (dict.done + 1) + ' 段…'
        : '转写剩余段落…';
    }
    syncVoiceStop();
    var rid = 'd' + dict.gen + '-' + seg.seq;
    dict.pending[0].rid = rid;
    armDictWatchdog(seg);
    if (seg.engine === 'local') {
      /* 随包 Zipformer 本地转写；原生层另尝试本机/局域网纠错。 */
      api.transcribeSegmentLocal(rid, seg.seq);
      return;
    }
    /* 网络识别服务（OpenAI 兼容 /v1/audio/transcriptions）：
       multipart 文件直传，二进制在 Java 侧组装，不过 WebView */
    var cfg = prefs.dictate;
    api.llmUploadAudio(rid, cfg.endpoint, JSON.stringify({
      Authorization: 'Bearer ' + cfg.key
    }), seg.seq, JSON.stringify({
      model: cfg.model,
      language: 'zh'
    }));
  }

  /* ---------------- 转写看门狗：单段卡死到点强制跳过 ---------------- */

  var dictWatchdog = null;

  function clearDictWatchdog() {
    if (dictWatchdog) {
      global.clearTimeout(dictWatchdog);
      dictWatchdog = null;
    }
  }

  function armDictWatchdog(seg) {
    clearDictWatchdog();
    var localMs = typeof global.__DICT_LOCAL_TIMEOUT_MS__ === 'number' && global.__DICT_LOCAL_TIMEOUT_MS__ > 0
      ? global.__DICT_LOCAL_TIMEOUT_MS__ : 90000;
    var netMs = typeof global.__DICT_NET_TIMEOUT_MS__ === 'number' && global.__DICT_NET_TIMEOUT_MS__ > 0
      ? global.__DICT_NET_TIMEOUT_MS__ : 60000;
    dictWatchdog = global.setTimeout(function () {
      dictWatchdog = null;
      if (!dict.busy) return;
      var cur = dict.pending[0];
      if (!cur || cur.rid !== seg.rid) return;   /* 已经被正常回包收走了 */
      voiceLog('dict-watchdog', seg.rid + ' ' + seg.engine);
      if (seg.engine === 'local') dict.localSuspended = true;
      dict.pending.shift();
      dict.busy = false;
      dict.fails += 1;
      toast('第 ' + seg.seq + ' 段转写超时，已跳过');
      pumpDictation();
    }, seg.engine === 'local' ? localMs : netMs);
  }

  /** 排空期：录音已停、转写还没跑完。此时大按钮临时变成「跳过剩余转写」 */
  function dictDraining() {
    return dict.mode && voiceState === 'listening' && !dict.recording
      && (dict.busy || dict.pending.length);
  }

  /** 大按钮文案随排空期变化；转写状态每变一次都调一次 */
  function syncVoiceStop() {
    if (!el.voiceStop || !el.voiceStopLabel) return;
    if (dictDraining()) {
      el.voiceStopLabel.textContent = '跳过剩余转写';
      el.voiceStop.disabled = false;
      el.voiceStop.setAttribute('aria-label', '跳过剩余转写，直接用已转出的文字');
      return true;
    }
    return false;
  }

  /** 排空期点大按钮：丢掉没转写的段（在飞的那段等它回来），直接拿现有文字出稿 */
  function skipRemainingDictation() {
    voiceLog('dict-skip-remaining', 'pending=' + dict.pending.length);
    clearDictWatchdog();
    if (dict.busy && dict.pending.length) {
      dict.pending = [dict.pending[0]];   /* 在飞请求的回包仍能找到自己的段 */
    } else if (!dict.busy) {
      dict.pending = [];
    }
    maybeFinishDictation();
  }

  /** 识别服务的回包汇入点（DictationNet 由原生 evaluate 调用） */
  global.DictationNet = {
    done: function (reqId, code, resp) {
      /* 笔记离线转写的回包（rid 以 m 开头）：段文字插到笔记光标处 */
      if (String(reqId || '').charAt(0) === 'm') {
        if (!memoDict.active) return;
        var mseg = memoDictTakeByRid(String(reqId || ''));
        if (!mseg) return;
        memoDict.busy = false;
        var mtext = '';
        try {
          var mparsed = JSON.parse(String(resp == null ? '' : resp));
          mtext = typeof mparsed.text === 'string' ? mparsed.text.trim() : '';
        } catch (error) { /* 非 JSON 按空处理 */ }
        if (code >= 200 && code < 300 && mtext && mtext !== '无语音' && mtext !== '。' && mtext !== ',') {
          memoDict.fails = 0;
          memoDict.done += 1;
          memoDictCommit(mtext);
        } else {
          memoDict.fails += 1;
        }
        memoDictPump();
        return;
      }
      var seg = takePendingByRid(String(reqId || ''));
      voiceLog('dict-done', 'rid=' + reqId + ' found=' + !!seg + ' code=' + code);
      if (!seg) return;   /* 迟到的回包：会话已被取消/重开 */
      clearDictWatchdog();
      dict.busy = false;   /* 释放串行锁：漏掉它队列会在第一段后永久卡死 */
      var text = '';
      try {
        var parsed = JSON.parse(String(resp == null ? '' : resp));
        text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
      } catch (error) { /* 非 JSON 响应按空处理 */ }
      if (code < 200 || code >= 300) {
        segFail(seg, '接口返回 ' + code + (text ? '：' + text.slice(0, 60) : ''));
        return;
      }
      if (!text || text === '无语音' || text === '。' || text === ',') {
        segFail(seg, '');
        return;
      }
      dict.fails = 0;
      dict.done += 1;
      absorbDictationText(text);
      pumpDictation();
    },
    error: function (reqId, message) {
      /* 笔记离线转写的失败回包：计失败数继续后面的段 */
      if (String(reqId || '').charAt(0) === 'm') {
        if (!memoDict.active) return;
        var meseg = memoDictTakeByRid(String(reqId || ''));
        if (!meseg) return;
        memoDict.busy = false;
        memoDict.fails += 1;
        memoDictPump();
        return;
      }
      var seg = takePendingByRid(String(reqId || ''));
      if (!seg) return;
      clearDictWatchdog();
      /* 离线引擎失败：该段改走网络识别服务（若已配置），文字不丢段 */
      if (seg.engine === 'local' && !dict.localSuspended && dictateReady() && dictationApi()) {
        seg.engine = 'net';
        dict.pending.unshift(seg);
        var cfg = prefs.dictate;
        var rid2 = 'd' + dict.gen + '-' + seg.seq + '-net';
        dict.pending[0].rid = rid2;
        voiceLog('dict-fallback-net', 'seq=' + seg.seq);
        armDictWatchdog(seg);
        dictationApi().llmUploadAudio(rid2, cfg.endpoint, JSON.stringify({
          Authorization: 'Bearer ' + cfg.key
        }), seg.seq, JSON.stringify({
          model: cfg.model,
          language: 'zh'
        }));
        return;
      }
      segFail(seg, String(message || '请求失败'));
    }
  };

  /** 一段转写文字并入共享草稿。分三种落点：
      listening：接到 voiceText 后面，并同步续听锚点（partial 才不会用旧锚点盖字）；
      review/typing：用户已经在改字了——迟到的段落只准追加到现文末尾，
      绝不整体覆盖，手工修改一字不动。 */
  function absorbDictationText(text) {
    text = panelSpokenText(text);
    if (voiceState === 'review' || voiceState === 'typing') {
      var edited = String((el.voiceEdit && el.voiceEdit.value) || voiceText || '');
      voiceText = joinVoiceParts(edited, text);
      if (el.voiceEdit) el.voiceEdit.value = voiceText;
      renderVoiceText();
      return;
    }
    voiceText = joinVoiceParts(voiceText, text);
    if (voiceState === 'listening' && !dict.mode) voiceResumeBase = voiceText;
    renderVoiceText();
  }

  function takePendingByRid(rid) {
    for (var i = 0; i < dict.pending.length; i++) {
      if (dict.pending[i].rid === rid) return dict.pending.splice(i, 1)[0];
    }
    return null;
  }

  function segFail(seg, message) {
    dict.busy = false;
    dict.fails += 1;
    voiceLog('dict-fail', 'seq=' + seg.seq + ' ' + (message || 'empty'));
    if (message) toast('第 ' + seg.seq + ' 段转写失败（' + message + '）');
    pumpDictation();
  }

  function maybeFinishDictation() {
    if (dict.recording || dict.busy || dict.pending.length) return;
    if (voiceState !== 'listening') return;
    if (dictationApi()) dictationApi().cleanupDictation();
    voiceLog('dict-done', 'text=' + voiceText);
    if (!dict.mode) {
      /* 已切回实时识别：排空的段落已并入共享草稿，
         别把正在进行的实时识别硬拽进出稿态 */
      if (voiceText) voiceResumeBase = voiceText;
      setVoiceState('listening');   /* 刷新大按钮文案（可能还挂着「跳过剩余转写」） */
      return;
    }
    if (voiceText) enterVoiceReview(voiceText);
    else enterVoiceTyping(dict.noVoice
      ? '没听到人声，凑近一点再说一次，或直接打字'
      : '没听到内容，再说一次或直接打字');
  }

  /** 原生录音转写回调（页面只认当前 gen 的会话） */
  global.DictationHost = {
    ready: function () {
      if (el.voiceSub) el.voiceSub.textContent = '录音中…停止说话5秒后自动结束';
    },
    level: function (db) {
      if (voiceState === 'listening') setVoiceLevel(db);
    },
    segment: function (seq, seconds) {
      if (memoDict.active) {   /* 笔记离线转写：段走笔记自己的队列 */
        if (memoDict.stopped) return;
        memoDict.pending.push({ seq: seq, seconds: seconds });
        memoDictPump();
        return;
      }
      if (!dict.recording) return;   /* 取消/重开后迟到的原生回调：丢弃 */
      voiceLog('dict-seg', 'seq=' + seq + ' ' + seconds + 's');
      /* 队列因连续失败停止后，用户新说的每一段都给一次恢复机会——
         （键盘/输入法抢麦几秒导致的瞬时失败，关掉键盘就能自愈） */
      if (dict.fails >= 3) dict.fails = 2;
      dict.pending.push({ seq: seq, seconds: seconds });
      pumpDictation();
    },
    /** 开麦后一直没人声：原生满 5 秒自己收了（纯静音不产段、不建转写任务） */
    noVoice: function () {
      voiceLog('dict-novoice', '');
      dict.noVoice = true;
      if (dict.mode && voiceState === 'listening' && el.voiceSub) {
        el.voiceSub.textContent = '开麦 5 秒没听到人声，正在结束…';
      }
    },
    stopped: function () {
      if (memoDict.active) {   /* 笔记转写收尾：排空剩余段后自动落稿 */
        clearMemoDictStopTimer();
        memoDict.stopped = true;
        memoDict.stopping = true;
        memoVoice.state = 'stopping';
        memoVoicePaint();
        memoDictPump();
        return;
      }
      if (!dict.recording) return;
      voiceLog('dict-stopped', 'novoice=' + dict.noVoice);
      stopVoiceTimer();
      stopVoiceWave();
      dict.recording = false;   /* 会话收尾：之后的回调不再认 */
      if (dict.mode && el.voiceSub) {
        el.voiceSub.textContent = dict.noVoice
          ? '没听到人声，已自动结束'
          : '录音结束，正在转写剩余段落…';
      }
      syncVoiceStop();
      pumpDictation();
    },
    failed: function (message) {
      if (memoDict.active) {   /* 笔记转写出错：整场作废，正文里已插入的文字保留 */
        memoDictCancel(message || '录音没成功，已保留写入的文字');
        if (message) toast(message);
        return;
      }
      voiceLog('dict-failed', message);
      var api = dictationApi();
      if (api) api.cancelDictation();
      clearDictWatchdog();
      dict.recording = false;
      dict.gen += 1;
      dict.pending = [];
      dict.busy = false;
      if (voiceText) enterVoiceReview(voiceText);
      else enterVoiceTyping(message || '录音没成功，直接打字也行');
      if (message) toast(message);
    }
  };

  /** 开一个录音转写会话时给 renderVoiceText 的显隐口径 */
  function stopDictationUi() {
    if (el.voiceToTodo) show(el.voiceToTodo, false);
  }

  /**
   * 存成笔记：原话进 memo.sourceText，正文也先用原话。
   * 之后可以让 AI 整理成标题+正文（structVoice），整理结果只改 title/body，
   * 原话始终留着——这样模型理解错了还能对回原话。
   */
  function saveVoiceAsMemo() {
    var text = voiceTextNow();
    if (!text) {
      toast('还没听到内容，说一句或写一句都行');
      return;
    }
    closeVoiceLayer();
    if (!global.MemoService) { toast('笔记模块没加载'); return; }

    var before = global.MemoService.list(memoUser()).length;
    var memo = global.MemoService.create(memoUser(), { body: text, sourceText: text });
    if (!memo) { toast('保存失败，检查存储空间'); return; }
    clearVoiceDraft();   /* 已入笔记，草稿不再恢复 */
    /* 超过上限时最老的一条会被挤掉，这里不假装成功 */
    if (global.MemoService.list(memoUser()).length <= before) {
      setMemoHint('笔记已到 ' + global.MemoService.MAX_MEMOS + ' 条上限，最久没动的那条被挤掉了', 'bad');
    }

    switchPanel('memos');
    openMemoSheet(memo.id);
    setMemoStat('原话已存下。可以让 AI 整理成标题和正文，或直接提取待办。');
  }

  function closeVoiceLayer() {
    clearVoiceReviewTimer();
    showVoiceLayer(false);
    voiceState = 'idle';
    voiceText = '';
    if (el.voiceToTodo) show(el.voiceToTodo, false);
  }

  /** 只负责让原生停掉麦克风，不碰页面状态 */
  function stopNativeVoice() {
    var api = global.TodoNative;
    if (!api) return;
    if (dictationActive()) {
      /* 录音转写被中途取消：丢掉未转写的段，已转出的文字已在上屏 */
      dict.recording = false;
      dict.gen += 1;
      dict.pending = [];
      dict.busy = false;
      try { api.cancelDictation(); } catch (error) { /* 忽略 */ }
      return;
    }
    try {
      if (typeof api.cancelVoiceListening === 'function') api.cancelVoiceListening();
    } catch (error) { /* 桥接异常不影响页面收尾 */ }
  }

  /**
   * 取消语音输入：正在听就掐掉麦克风，任何状态都能把这一屏关掉。
   * 返回 true 表示这次真的做了事（关掉了麦克风或关掉了面板）。
   */
  function cancelVoice(quiet) {
    var open = el.voiceLayer && !el.voiceLayer.classList.contains('is-hidden');
    if (!open && voiceState === 'idle') return false;

    var wasListening = voiceState === 'listening' || voiceState === 'stopping';
    voiceState = 'closing';

    if (wasListening) stopNativeVoice();
    clearVoiceReviewTimer();
    clearVoiceSilenceTimer();
    clearDictWatchdog();
    showVoiceLayer(false);
    voiceText = '';
    voiceResumeBase = '';
    dict.pending = [];
    dict.busy = false;
    dict.recording = false;
    dict.noVoice = false;
    voiceLastVoiceAt = 0;
    voiceRestartCount = 0;
    voiceLastRestartAt = 0;
    voiceLastFailAt = 0;
    if (el.voiceBtn) {
      el.voiceBtn.classList.remove('is-listening');
      el.voiceBtn.setAttribute('aria-label', '语音助手');
    }
    if (el.assistantMic) el.assistantMic.classList.remove('is-listening');

    global.setTimeout(function () {
      if (voiceState === 'closing') voiceState = 'idle';
    }, 400);

    if (!quiet) toast('已取消语音输入');
    return true;
  }

  function startVoiceInput() {
    if (memoDict.active || voiceOwner === 'memo' && memoVoice.state !== 'idle') {
      toast('笔记语音正占着麦克风，先关掉它');
      return;
    }
    if (voiceState === 'listening' || voiceState === 'stopping') {
      /* 已经在听了：再点一下就是「说完了」 */
      finishVoiceListening();
      return;
    }
    if (voiceState === 'closing') voiceState = 'idle';

    /* 录音转写不依赖系统识别器（走 AudioRecord + 大模型），先于 voiceSupported 判断 */
    if (dict.mode) {
      startDictationFlow();
      return;
    }

    if (!voiceSupported()) {
      openVoiceLayer();
      enterVoiceTyping('这个环境没有语音能力，直接打字一样好用');
      return;
    }

    var api = nativeVoiceApi();
    if (api) {
      voiceOwner = 'panel';   /* 笔记那边可能用过麦克风，先收回归属再开整屏 */
      openVoiceLayer();
      if (el.voiceBtn) {
        el.voiceBtn.classList.add('is-listening');
        el.voiceBtn.setAttribute('aria-label', '正在听，请说话');
      }
      if (el.assistantMic) el.assistantMic.classList.add('is-listening');
      touchVoiceSession();
      var started = false;
      try {
        started = api.startVoiceListening() !== false;
      } catch (error) {
        started = false;
      }
      if (!started) {
        /* 桥接直接拒绝：原地切成打字态，不再去拉系统识别界面 */
        enterVoiceTyping('这台手机的识别服务没开放给第三方，直接把话打出来也一样');
      }
      return;
    }

    startWebSpeech();
  }

  /** 浏览器版语音兜底。keepBase=true：从出稿态接着录（「继续说」），不清已有文字 */
  function startWebSpeech(keepBase) {
    var Ctor = webSpeechCtor();
    if (!Ctor) {
      openVoiceLayer();
      enterVoiceTyping('这个浏览器没有语音能力，直接打字一样好用');
      return;
    }

    var recognizer;
    try {
      recognizer = new Ctor();
    } catch (error) {
      openVoiceLayer();
      enterVoiceTyping('语音启动失败，直接打字吧');
      return;
    }

    voiceRecognizer = recognizer;
    recognizer.lang = 'zh-CN';
    recognizer.interimResults = true;   /* 边说边显示，声波与文字才同步 */
    recognizer.maxAlternatives = 1;
    recognizer.onstart = function () {
      if (global.VoiceHost && global.VoiceHost.ready) global.VoiceHost.ready();
    };
    recognizer.onresult = function (event) {
      var text = '';
      var isFinal = true;
      try {
        var last = event.results[event.results.length - 1];
        text = (last && last[0] && last[0].transcript) || '';
        isFinal = !!(last && last.isFinal);
      } catch (error) {
        text = '';
      }
      if (!isFinal) {
        if (global.VoiceHost && global.VoiceHost.partial) global.VoiceHost.partial(text);
        return;
      }
      if (global.VoiceHost && global.VoiceHost.result) global.VoiceHost.result(text);
    };
    recognizer.onerror = function () {
      enterVoiceTyping('没听清，再说一次或直接打字');
    };
    recognizer.onend = function () {
      /* 只有「当前这一轮」的识别器收尾才算数：停顿闸门重启后，
         旧实例迟到的 onend 不能把新会话掐掉 */
      if (voiceRecognizer !== recognizer) return;
      if (voiceState === 'listening') finishVoiceListening();
    };

    openVoiceLayer(!!keepBase);
    touchVoiceSession();
    try {
      recognizer.start();
    } catch (error) {
      enterVoiceTyping('语音启动失败，直接打字吧');
    }
  }

  var voiceRecognizer = null;

  /* 原生语音识别回来走这里：状态全部落在这四个回调里 */
  global.VoiceHost = {
    /** 麦克风开了，可以说话了 */
    ready: function () {
      if (voiceOwner === 'memo') return memoVoiceEvent('ready');
      if (voiceState !== 'listening') return;
      touchVoiceSession();   /* 引擎真正连上才算会话起点 */
      if (el.voiceSub) el.voiceSub.textContent = '我在听，请说…';
    },
    /** 检测到人声：声波立刻起来。
        注意：onBeginningOfSpeech 在引擎起臂和环境噪声时也会触发，
        不是确凿人声 —— 不参与 5 秒停顿计时（否则真机上闸门永远到不了点，
        真机日志实测：speaking@812ms 把出稿从 5.8s 推到 9.3s 之外）。
        停顿计时只认「吐出了文字」的 partial。 */
    speaking: function () {
      if (voiceOwner === 'memo') return;
      if (voiceState !== 'listening') return;
      voiceLevel = Math.max(voiceLevel, 0.35);
    },
    /** 实时音量 */
    level: function (db) {
      if (voiceOwner === 'memo') return;
      if (voiceState !== 'listening') return;
      setVoiceLevel(db);
    },
    /** 边说边回显 */
    partial: function (text) {
      if (voiceOwner === 'memo') return memoVoiceEvent('partial', text);
      if (voiceState !== 'listening') return;
      var t = String(text == null ? '' : text).trim();
      if (!t) return;
      markVoiceActivity();
      voiceText = voiceResumeBase ? joinVoiceParts(voiceResumeBase, t) : t;
      renderVoiceText();
    },
    /** 引擎收完音了（多数 ROM 约 2 秒就自断，不理会 5 秒 extra）。
        不在这里出稿：等 result 进来后按 5 秒停顿口径决定「接着听」还是「收稿」 */
    speechEnd: function () {
      if (voiceOwner === 'memo') return memoVoiceEvent('speechEnd');
      if (voiceState !== 'listening') return;
      if (el.voiceSub) el.voiceSub.textContent = '停顿中，接着说或等几秒自动整理';
    },
    result: function (text) {
      if (voiceOwner === 'memo') return memoVoiceEvent('result', text);
      if (voiceState === 'closing' || voiceState === 'idle') return;
      var seg = String(text == null ? '' : text).trim();
      seg = panelSpokenText(seg);
      var merged = voiceResumeBase ? joinVoiceParts(voiceResumeBase, seg) : seg;
      if (voiceState === 'listening') {
        /* 引擎停顿自断送回来的这段：先收下，5 秒口径没到就重新开麦接着收。
           定稿本身就是确凿人声——有的引擎不吐 partial 只回 result，
           不刷新 voiceLastVoiceAt 的话闸门会算出负等待、当场收稿（≈2 秒中断）。 */
        markVoiceActivity();
        voiceText = merged;
        voiceResumeBase = merged;
        renderVoiceText();
        armVoiceSegment();
        return;
      }
      voiceResumeBase = '';
      enterVoiceReview(merged);
    },
    cancelled: function () {
      if (voiceOwner === 'memo') return memoVoiceEvent('cancelled');
      if (voiceState === 'closing') return;
      closeVoiceLayer();
    },
    failed: function (message) {
      if (voiceOwner === 'memo') return memoVoiceEvent('failed', message);
      if (voiceState === 'closing' || voiceState === 'idle') return;
      if (voiceState === 'listening') {
        voiceLastFailAt = Date.now();
        if (voiceText) {
          /* 引擎自己超时/没匹配上（ERROR_NO_MATCH / ERROR_SPEECH_TIMEOUT 常见）：
             5 秒口径没到就重开麦接着听，别把人正要说的话掐了 */
          if (VOICE_SILENCE_MS - (Date.now() - voiceLastVoiceAt) > 0 && voiceRestartCount < 4) {
            armVoiceSegment();
            return;
          }
        } else if (voiceEmptyRetries < 2) {
          /* 一个字都没吐过就报错：多半是引擎刚被掐掉重建期的抽风，
             限流内自动再试两次，别一步跳进打字模式（真机上表现为 ≈2 秒中断） */
          voiceEmptyRetries += 1;
          restartVoiceCapture();
          return;
        }
      }
      /* 有半截文字就留着让人改，一个字都没有就直接转打字 */
      if (voiceText) enterVoiceReview(voiceText);
      else enterVoiceTyping(message || '这次没识别出来，直接打字也行');
      if (message) toast(message);
    }
  };

  /* VoiceHost 事件时间线：每个回调先进日志再分发，出问题一查便知 */
  (function () {
    var host = global.VoiceHost;
    if (!host) return;
    var names = ['ready', 'speaking', 'partial', 'speechEnd', 'result', 'failed', 'cancelled'];
    for (var i = 0; i < names.length; i++) {
      (function (name) {
        var raw = host[name];
        if (typeof raw !== 'function') return;
        host[name] = function (a) { voiceLog(name, a); return raw.call(this, a); };
      })(names[i]);
    }
  })();

  /* 原生附件选择结果回来走这里（拍照/相册/文件） */
  global.AttachmentHost = {
    picked: function (payload) {
      if (!payload || typeof payload !== 'object') return;
      var kind = payload.kind === 'photo' || payload.kind === 'audio' || payload.kind === 'file'
        ? payload.kind : 'photo';
      addAttachment({
        id: newId(),
        kind: kind,
        name: payload.name || '附件',
        dataUrl: payload.dataUrl || ''
      });
      toast('已添加附件');
    },
    cancelled: function () {
      /* 用户取消了，不用提示 */
    }
  };

  /* ------------------------------------------------------------ 文件扫描

     相机采集（原生 Camera2 全分辨率）→ 边缘检测 → 透视矫正 → 图像增强（OpenCV）。
     原生负责拍照与处理，页面只管预览、切档、入库：
       ScanHost.captured({raw, mode, quad, width, height, dataUrl})  拍好了
       ScanHost.processed({mode, width, height, dataUrl})           换增强档完成
       ScanHost.failed(msg) / ScanHost.cancelled()
     网页版没有原生桥，入口按钮会提示需要手机版。
     ========================================================================== */

  var scanUi = {
    raw: '', mode: 'color', dataUrl: '', busy: false, saved: false,
    ocr: '',            /* 当前成品的 OCR 文字（提取过才有） */
    ocrBusy: false      /* OCR 正在跑（原生异步，回 ocrDone） */
  };

  function scanNative() {
    return (global.TodoNative && typeof global.TodoNative.startScan === 'function')
      ? global.TodoNative : null;
  }

  /** 附件来源面板的「扫描」：起原生取景界面 */
  function startScanFlow() {
    var native = scanNative();
    if (!native) {
      toast('文件扫描需要手机版，网页版可以直接「拍照」');
      return;
    }
    native.startScan();
  }

  function syncScanModes() {
    if (!el.scanModes) return;
    var btns = el.scanModes.querySelectorAll('.scan__mode');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-mode') === scanUi.mode;
      btns[i].classList.toggle('is-active', on);
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function showScanLoading(on) {
    if (el.scanLoading) show(el.scanLoading, on);
  }

  function closeScanReview() {
    if (el.scanLayer) show(el.scanLayer, false);
    var native = scanNative();
    if (native && scanUi.raw && typeof native.cleanupScan === 'function') {
      native.cleanupScan(scanUi.raw);
    }
    scanUi.raw = '';
    scanUi.dataUrl = '';
    scanUi.mode = 'color';
    scanUi.busy = false;
    scanUi.saved = false;
    resetScanOcr();
  }

  /** 清掉 OCR 结果区（重拍 / 换档 / 关弹层时） */
  function resetScanOcr() {
    scanUi.ocr = '';
    scanUi.ocrBusy = false;
    if (el.scanOcrText) {
      el.scanOcrText.value = '';
      show(el.scanOcrText, false);
    }
    if (el.scanOcrCopy) show(el.scanOcrCopy, false);
    restoreScanOcrButton();
  }

  function restoreScanOcrButton() {
    if (!el.scanOcr) return;
    el.scanOcr.disabled = false;
    el.scanOcr.textContent = '提取文字';
  }

  function setScanOcrButtonBusy(label) {
    if (el.scanOcr) {
      el.scanOcr.disabled = true;
      el.scanOcr.textContent = label;
    }
  }

  /** 识别结果落进弹层：大模型与离线 OCR 共用这一个出口 */
  function applyScanOcrText(text, via) {
    scanUi.ocr = text;
    if (el.scanOcrText) {
      el.scanOcrText.value = text;
      show(el.scanOcrText, true);
    }
    if (el.scanOcrCopy) show(el.scanOcrCopy, true);
    toast((via ? via + '提取 ' : '已提取 ') + text.length + ' 个字');
  }

  /**
   * 「提取文字」：优先走大模型（视觉接口看图认字，准得多），
   * 没配模型或大模型失败时自动落回内置离线 OCR。
   */
  function runScanOcr() {
    if (scanUi.ocrBusy) return;
    if (!scanUi.dataUrl) return;
    var model = activeModel();
    if (model && global.AiGateway && typeof global.AiGateway.run === 'function') {
      runScanOcrByLlm(model);
      return;
    }
    runScanOcrNative('');
  }

  function runScanOcrByLlm(model) {
    scanUi.ocrBusy = true;
    setScanOcrButtonBusy('大模型识别中…');
    var messages = [{
      role: 'user',
      content: [
        { type: 'text', text: '请把图片里的文字完整转录成纯文本：'
          + '保持原有段落换行，按从上到下、从左到右的顺序；'
          + '表格转成用「 | 」分隔的行；只输出文字本身，'
          + '不要解释、不要 Markdown 代码块。图里没有文字就只输出：无文字' },
        { type: 'image_url', image_url: { url: scanUi.dataUrl } }
      ]
    }];
    global.AiGateway.run({
      task: 'extract',
      model: model,
      messages: messages,
      timeout: 60000,
      retries: 0,
      maxTokensOut: 2000
    }, function (err, res) {
      /* 迟到的结果不属于当前这张成品（重拍/换档过）就丢掉 */
      if (!scanUi.ocrBusy) return;
      var text = res && res.text ? String(res.text).trim() : '';
      if (err || !text || text === '无文字') {
        /* 大模型这条路走不通（没配视觉模型 / 额度到顶 / 网络问题），落回离线 */
        runScanOcrNative(err ? '大模型识别没成功（' + err + '），改用离线 OCR' : '');
        return;
      }
      scanUi.ocrBusy = false;
      restoreScanOcrButton();
      applyScanOcrText(text, '大模型');
    });
  }

  function runScanOcrNative(hint) {
    var native = scanNative();
    if (hint) toast(hint);
    if (!native || typeof native.ocrScan !== 'function') {
      scanUi.ocrBusy = false;
      restoreScanOcrButton();
      if (!hint) toast('提取文字需要手机版，或在设置里配置一个模型');
      return;
    }
    scanUi.ocrBusy = true;
    setScanOcrButtonBusy('识别中…');
    native.ocrScan();
  }

  /** 复制文本到剪贴板（WebView 里 clipboard API 可能缺失，退回 execCommand） */
  function copyTextToClipboard(text) {
    if (!text) return false;
    var done = false;
    try {
      if (global.navigator && global.navigator.clipboard
          && typeof global.navigator.clipboard.writeText === 'function') {
        global.navigator.clipboard.writeText(text);
        done = true;
      }
    } catch (e) { done = false; }
    if (!done) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        done = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (e) { done = false; }
    }
    return done;
  }

  /** 换增强档：同一张原图重新处理（原生异步，回 processed） */
  function setScanMode(mode) {
    if (scanUi.busy || mode === scanUi.mode) return;
    var native = scanNative();
    if (!native || !scanUi.raw || typeof native.processScan !== 'function') return;
    scanUi.busy = true;
    scanUi.mode = mode;
    /* 成品马上要换了，旧的识别文字作废 */
    resetScanOcr();
    syncScanModes();
    showScanLoading(true);
    native.processScan(scanUi.raw, mode);
  }

  function scanNow() {
    var now = new Date();
    var hh = ('0' + now.getHours()).slice(-2);
    var mm = ('0' + now.getMinutes()).slice(-2);
    var att = {
      id: newId(),
      kind: 'scan',
      name: '扫描 ' + hh + ':' + mm,
      dataUrl: scanUi.dataUrl
    };
    if (scanUi.ocr) att.text = scanUi.ocr;
    var ok = addAttachment(att);
    /* 超限时 addAttachment 自己会提示，弹层留着让人切灰度/黑白（体积小得多） */
    if (!ok) return;
    scanUi.saved = true;
    toast('已添加附件');
    closeScanReview();
  }

  global.ScanHost = {
    /** 拍好了（原生处理完彩色档先回来） */
    captured: function (payload) {
      if (!payload || typeof payload !== 'object') return;
      scanUi.raw = payload.raw || '';
      scanUi.mode = payload.mode || 'color';
      scanUi.dataUrl = payload.dataUrl || '';
      scanUi.busy = false;
      scanUi.saved = false;
      resetScanOcr();
      if (el.scanImg) el.scanImg.src = scanUi.dataUrl;
      if (el.scanQuadTag) show(el.scanQuadTag, !!payload.quad);
      syncScanModes();
      showScanLoading(false);
      show(el.scanLayer, true);
    },
    /** 换档处理完成 */
    processed: function (payload) {
      scanUi.busy = false;
      showScanLoading(false);
      if (!payload || typeof payload !== 'object') return;
      /* 迟到的旧档结果不覆盖新档 */
      if (payload.mode && payload.mode !== scanUi.mode) return;
      if (payload.dataUrl) {
        scanUi.dataUrl = payload.dataUrl;
        if (el.scanImg) el.scanImg.src = scanUi.dataUrl;
      }
    },
    /** OCR 提取完成（离线引擎回） */
    ocrDone: function (payload) {
      scanUi.ocrBusy = false;
      restoreScanOcrButton();
      if (!payload || typeof payload !== 'object') return;
      if (!payload.ok) {
        toast(payload.error || '识别失败，再试一次');
        return;
      }
      var text = String(payload.text || '');
      if (!text) {
        toast('没识别出文字，试试黑白档或离近一点');
        return;
      }
      applyScanOcrText(text, '');
    },
    failed: function (message) {
      scanUi.busy = false;
      showScanLoading(false);
      if (message) toast(message);
      /* 一次成品都没有（处理挂了）就别开着空弹层 */
      if (!scanUi.dataUrl) closeScanReview();
    },
    cancelled: function () {
      /* 拍照途中取消：没有成品时直接收掉弹层 */
      if (!scanUi.dataUrl) closeScanReview();
    }
  };

  /* ------------------------------------------------------------ 附件与手绘

     附件统一挂在 todo.attachments 上，结构：
       { id, kind, name, dataUrl? }
       kind：drawing（手绘 PNG 位图）/ photo / audio / file / scan（其余四类留给后续来源）
     dataUrl 直接存 localStorage，手绘导出时压到合适尺寸（最长边 ~800px）控制在几十 KB。

     手绘：
       canvas + Pointer Events 压感（宽度随 pressure 变化），撤销快照栈上限 20 步，
       6 色 × 3 档粗细，画完确认 → toDataURL('image/png') → 成为一条 drawing 附件。
     ========================================================================== */

  /* 新增栏暂存的附件（随下一次「添加」一起写入这条 todo） */
  var editingAttachments = [];

  var DRAW_COLORS = ['#f55b23', '#26282f', '#4f6ef7', '#2e9e5b', '#e23b3b', '#b06ae0'];
  var DRAW_SIZES = [3, 6, 12];

  var draw = {
    on: false,               /* 是否正在落笔 */
    lastX: 0, lastY: 0,
    color: DRAW_COLORS[0],
    size: DRAW_SIZES[1],
    undo: [],                /* 撤销快照栈（不含当前） */
    dirty: false             /* 画过没有（用于「未保存」确认） */
  };

  function resetEditingAttachments() {
    editingAttachments = [];
    renderAttachmentBar();
  }

  function renderAttachmentBar() {
    var box = el.editAttachList;
    if (!box) return;
    box.textContent = '';
    for (var i = 0; i < editingAttachments.length; i++) {
      box.appendChild(buildAttachmentChip(editingAttachments[i], i, true));
    }
    show(el.editAttachBar, editingAttachments.length > 0);
  }

  /** 附件缩略片（新增栏暂存区 / todo 卡片共用） */
  function buildAttachmentChip(att, index, removable) {
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'attach__chip';
    chip.setAttribute('data-index', String(index));

    if (att.kind === 'drawing' || att.kind === 'photo' || att.kind === 'scan') {
      var img = document.createElement('img');
      img.className = 'attach__thumb';
      img.alt = att.name || '附件';
      img.src = att.dataUrl || '';
      chip.appendChild(img);
    } else {
      var glyph = document.createElement('span');
      glyph.className = 'attach__glyph';
      glyph.textContent = att.kind === 'audio' ? '♪' : att.kind === 'file' ? '▤' : '☰';
      chip.appendChild(glyph);
    }

    if (removable) {
      var x = document.createElement('span');
      x.className = 'attach__x';
      x.textContent = '×';
      chip.appendChild(x);
    }
    return chip;
  }

  /* ------------------------------------------------ 手绘画板弹层 */

  function openDrawPad() {
    if (!el.drawLayer) return;
    var c = el.drawCanvas;
    if (!c) return;

    /* 画布按容器物理尺寸铺满，DPR 对齐让线条更细 */
    var box = el.drawStage;
    var dpr = global.devicePixelRatio || 1;
    var w = box.clientWidth || 320;
    var h = box.clientHeight || 420;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = w + 'px';
    c.style.height = h + 'px';
    var ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    draw.on = false;
    draw.dirty = false;
    draw.undo = [];
    draw.color = DRAW_COLORS[0];
    draw.size = DRAW_SIZES[1];
    syncDrawToolbar();
    show(el.drawLayer, true);
  }

  function closeDrawPad(discard) {
    if (discard && draw.dirty) {
      askConfirm({ title: '放弃这张画', text: '还没保存，确定不要了吗？', okText: '放弃', tone: 'primary' })
        .then(function (r) {
          if (r === 'ok') show(el.drawLayer, false);
        });
      return;
    }
    show(el.drawLayer, false);
  }

  function drawPoint(x, y) {
    var ctx = el.drawCanvas.getContext('2d');
    var dpr = global.devicePixelRatio || 1;
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function beginStroke(x, y) {
    var ctx = el.drawCanvas.getContext('2d');
    var dpr = global.devicePixelRatio || 1;
    /* 落笔前把当前画面存成快照（栈满 20 步丢最旧） */
    if (draw.undo.length >= 20) draw.undo.shift();
    draw.undo.push(el.drawCanvas.toDataURL('image/png'));
    ctx.save();
    ctx.strokeStyle = draw.color;
    ctx.lineWidth = draw.size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    draw.on = true;
    draw.lastX = x;
    draw.lastY = y;
    draw.dirty = true;
  }

  function moveStroke(x, y) {
    if (!draw.on) return;
    var ctx = el.drawCanvas.getContext('2d');
    /* 压感：把粗细随 pressure 微调（无压感时保持档位） */
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
    draw.lastX = x;
    draw.lastY = y;
  }

  function endStroke() {
    if (!draw.on) return;
    var ctx = el.drawCanvas.getContext('2d');
    ctx.closePath();
    ctx.restore();
    draw.on = false;
  }

  function undoStroke() {
    if (draw.undo.length === 0) {
      toast('没有可撤销的笔画了');
      return;
    }
    var c = el.drawCanvas;
    var prev = draw.undo.pop();
    var img = new Image();
    img.onload = function () {
      var ctx = c.getContext('2d');
      var dpr = global.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.clientWidth, c.clientHeight);
      draw.dirty = true;
    };
    img.src = prev;
  }

  function syncDrawToolbar() {
    var colors = el.drawColors;
    var sizes = el.drawSizes;
    if (colors) {
      var bs = colors.querySelectorAll('[data-color]');
      for (var i = 0; i < bs.length; i++) {
        var on = bs[i].getAttribute('data-color') === draw.color;
        bs[i].classList.toggle('is-active', on);
        bs[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    if (sizes) {
      var ss = sizes.querySelectorAll('[data-size]');
      for (var j = 0; j < ss.length; j++) {
        var sOn = Number(ss[j].getAttribute('data-size')) === draw.size;
        ss[j].classList.toggle('is-active', sOn);
        ss[j].setAttribute('aria-pressed', sOn ? 'true' : 'false');
      }
    }
  }

  function finishDrawPad() {
    var c = el.drawCanvas;
    if (!c) return;
    if (!draw.dirty) {
      toast('还没画东西呢');
      return;
    }
    /* 导出前把画布压到最长边 800px，控制 localStorage 体积 */
    var dataUrl = downscaleCanvas(c, 800);
    if (!dataUrl) {
      toast('保存失败，重试一次');
      return;
    }
    editingAttachments.push({
      id: newId(),
      kind: 'drawing',
      name: '手绘 ' + formatClockDate(new Date()),
      dataUrl: dataUrl
    });
    show(el.drawLayer, false);
    renderAttachmentBar();
    toast('已把手绘加到这条待办');
  }

  /** 把画布等比压到最长边 maxEdge，返回 PNG dataUrl */
  function downscaleCanvas(source, maxEdge) {
    var w = source.clientWidth || source.width;
    var h = source.clientHeight || source.height;
    var scale = Math.min(1, maxEdge / Math.max(w, h));
    var tw = Math.max(1, Math.round(w * scale));
    var th = Math.max(1, Math.round(h * scale));
    var tmp = document.createElement('canvas');
    tmp.width = tw;
    tmp.height = th;
    var tctx = tmp.getContext('2d');
    tctx.fillStyle = '#ffffff';
    tctx.fillRect(0, 0, tw, th);
    tctx.drawImage(source, 0, 0, tw, th);
    try {
      return tmp.toDataURL('image/png');
    } catch (error) {
      return null;
    }
  }

  /* ------------------------------------------------ 附件来源选择面板

     五个来源：手绘 / 拍照 / 相册 / 录音 / 文件。
     手机版走原生 Intent（拍照、相册、文件），录音走网页 MediaRecorder；
     网页版统一用 <input type="file"> 的 accept/capture 降级。
     结果都转成 dataUrl 挂进 editingAttachments，随「添加」写进这条待办。
     ========================================================================== */

  function openAttachSource() {
    show(el.attachSrcLayer, true);
  }

  function closeAttachSource() {
    show(el.attachSrcLayer, false);
  }

  /* 单条附件的体积上限（base64 字符数）。
     localStorage 一共只有约 5MB，一个 4MB 的文件转成 base64 是 5.3MB，
     一次就把配额吃穿、整条待办都存不进去。所以入口处统一卡住。 */
  var MAX_ATTACH_CHARS = Math.floor(1.2 * 1024 * 1024 * 4 / 3);

  function addAttachment(att) {
    var size = att && att.dataUrl ? String(att.dataUrl).length : 0;
    if (size > MAX_ATTACH_CHARS) {
      toast('这个附件太大（约 ' + Math.round(size / 1024 / 1024 * 0.75 * 10) / 10
        + 'MB），换个小一点的，或者先压缩一下');
      return false;
    }
    editingAttachments.push(att);
    renderAttachmentBar();
    return true;
  }

  /** 把选中的文件（图片/音频/任意文件）读成 dataUrl 附件 */
  function fileToAttachment(file, kind, name) {
    if (!file) return;
    /* 文件太大读进 localStorage 会超限，按 base64 之后的体积判断 */
    if (file.size > MAX_ATTACH_CHARS * 0.75) {
      toast('文件超过 ' + Math.round(MAX_ATTACH_CHARS * 0.75 / 1024 / 1024 * 10) / 10
        + 'MB，暂不支持（本机存储放不下）');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      addAttachment({
        id: newId(),
        kind: kind,
        name: name || file.name || '附件',
        dataUrl: String(reader.result || '')
      });
      toast('已添加附件');
    };
    reader.onerror = function () {
      toast('读取文件失败');
    };
    reader.readAsDataURL(file);
  }

  /** 通用文件选择：一个隐藏 input，按 accept 类型区分 */
  function pickAttachmentFile(kind) {
    var accept = kind === 'camera' ? 'image/*' :
      kind === 'gallery' ? 'image/*' :
      kind === 'audio' ? 'audio/*' : '*/*';
    var capture = kind === 'camera' ? 'environment' : null;

    var input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    if (capture) input.setAttribute('capture', capture);
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      var attKind = kind === 'audio' ? 'audio' : (kind === 'file' ? 'file' : 'photo');
      fileToAttachment(file, attKind);
    });
    document.body.appendChild(input);
    input.click();
  }

  /** 来源面板：分发到各来源 */
  function dispatchAttachSource(src) {
    closeAttachSource();
    if (src === 'draw') {
      openDrawPad();
    } else if (src === 'scan') {
      startScanFlow();
    } else if (src === 'camera') {
      if (global.TodoNative && typeof global.TodoNative.pickAttachment === 'function') {
        if (global.TodoNative.pickAttachment('camera')) return;
      }
      pickAttachmentFile('camera');
    } else if (src === 'gallery') {
      if (global.TodoNative && typeof global.TodoNative.pickAttachment === 'function') {
        if (global.TodoNative.pickAttachment('gallery')) return;
      }
      pickAttachmentFile('gallery');
    } else if (src === 'audio') {
      startAudioRecord();
    } else if (src === 'file') {
      if (global.TodoNative && typeof global.TodoNative.pickAttachment === 'function') {
        if (global.TodoNative.pickAttachment('file')) return;
      }
      pickAttachmentFile('file');
    }
  }

  /* ------------------------------------------------ 录音（网页 MediaRecorder）

     手机版 WebView 也支持 getUserMedia + MediaRecorder，统一走这条路，
     录成 webm/ogg 的 dataUrl 附件，最长 60 秒。
     ========================================================================== */

  var audioRec = null;      /* MediaRecorder */
  var audioChunks = [];
  var audioTimer = null;

  function startAudioRecord() {
    var getUserMedia = global.navigator.mediaDevices &&
      global.navigator.mediaDevices.getUserMedia;
    if (!getUserMedia || !global.MediaRecorder) {
      toast('这个环境不支持录音');
      return;
    }
    var ctor = global.MediaRecorder;
    var mime = '';
    try {
      var types = ['audio/webm', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg'];
      for (var i = 0; i < types.length; i++) {
        if (ctor.isTypeSupported && ctor.isTypeSupported(types[i])) { mime = types[i]; break; }
      }
    } catch (e) { /* 忽略 */ }

    getUserMedia.call(global.navigator.mediaDevices, { audio: true })
      .then(function (stream) {
        var rec;
        try {
          rec = mime ? new ctor(stream, { mimeType: mime }) : new ctor(stream);
        } catch (e) {
          rec = new ctor(stream);
        }
        audioRec = rec;
        audioChunks = [];
        rec.ondataavailable = function (event) {
          if (event.data && event.data.size > 0) audioChunks.push(event.data);
        };
        rec.onstop = function () {
          if (audioChunks.length === 0) { toast('没录到声音'); return; }
          var blob = new Blob(audioChunks, { type: mime || 'audio/webm' });
          var reader = new FileReader();
          reader.onload = function () {
            addAttachment({
              id: newId(),
              kind: 'audio',
              name: '录音 ' + formatClockDate(new Date()),
              dataUrl: String(reader.result || '')
            });
            toast('录音已添加');
          };
          reader.readAsDataURL(blob);
          stream.getTracks().forEach(function (t) { t.stop(); });
        };
        rec.start();
        toast('开始录音，点「停止」结束');
        /* 60 秒自动停 */
        audioTimer = global.setTimeout(function () {
          if (audioRec && audioRec.state === 'recording') audioRec.stop();
        }, 60000);
        showAudioRecorder(true);
      })
      .catch(function () {
        toast('没有麦克风权限，录音失败');
      });
  }

  function stopAudioRecord() {
    if (audioRec && audioRec.state === 'recording') {
      audioRec.stop();
      audioRec = null;
    }
    if (audioTimer) { global.clearTimeout(audioTimer); audioTimer = null; }
    showAudioRecorder(false);
  }

  function showAudioRecorder(on) {
    if (el.audioRecBar) show(el.audioRecBar, on);
  }

  /* ------------------------------------------------ 附件预览（大图/详情） */

  /** 预览层当前附件（「复制识别文字」按钮要用） */
  var previewAttachment = null;

  function openAttachmentPreview(att) {
    if (!el.attachPreviewLayer) return;
    var img = el.attachPreviewImg;
    var label = el.attachPreviewLabel;
    previewAttachment = att || null;
    if ((att.kind === 'drawing' || att.kind === 'photo' || att.kind === 'scan')
        && att.dataUrl && img) {
      img.src = att.dataUrl;
      img.hidden = false;
    } else if (img) {
      img.hidden = true;
    }
    if (label) label.textContent = att.name || '附件';
    /* 带识别文字的附件（扫描 / 录音提取过）：预览里直接给全文和复制 */
    var ocrText = att && att.text ? String(att.text) : '';
    if (el.previewOcr) show(el.previewOcr, !!ocrText);
    if (el.previewOcrText) el.previewOcrText.textContent = ocrText;
    syncAttachmentSttButton();
    show(el.attachPreviewLayer, true);
  }

  /* ---------------- 附件录音「提取文字」（本地 whisper 离线转写） ----------------

     录音附件是 WebView MediaRecorder 的产物（webm/opus 或 mp4/aac）。
     页面用 OfflineAudioContext 解码并重采样成 16k 单声道，打包成 WAV 的 base64
     交给原生喂 whisper——二进制不过字符串拼接，解码由浏览器保证。 */

  var sttJob = { rid: '', att: null, busy: false };

  /** 按当前预览刷新按钮，后台任务可以属于另一个附件。 */
  function syncAttachmentSttButton() {
    if (!el.previewStt) return;
    var att = previewAttachment;
    var able = att && att.kind === 'audio' && !!att.dataUrl && !att.text &&
      !!global.TodoNative && typeof global.TodoNative.whisperTranscribeWav === 'function';
    show(el.previewStt, !!able);
    el.previewStt.disabled = !!sttJob.busy;
    el.previewStt.dataset.busy = sttJob.busy ? '1' : '0';
    el.previewStt.textContent = sttJob.busy && sttJob.att === att ? '转写中…' : '提取文字';
  }

  function floatPcmToWavBase64(samples, rate) {
    var n = samples.length;
    var bytes = new Uint8Array(44 + n * 2);
    var dv = new DataView(bytes.buffer);
    var wstr = function (off, str) {
      for (var i = 0; i < str.length; i++) bytes[off + i] = str.charCodeAt(i);
    };
    wstr(0, 'RIFF');
    dv.setUint32(4, 36 + n * 2, true);
    wstr(8, 'WAVE');
    wstr(12, 'fmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);            /* PCM */
    dv.setUint16(22, 1, true);            /* mono */
    dv.setUint32(24, rate, true);
    dv.setUint32(28, rate * 2, true);
    dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true);
    wstr(36, 'data');
    dv.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) {
      var v = Math.max(-1, Math.min(1, samples[i]));
      dv.setInt16(44 + i * 2, v < 0 ? v * 32768 : v * 32767, true);
    }
    var bin = '';
    var CH = 8192;
    for (var j = 0; j < bytes.length; j += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(j, Math.min(j + CH, bytes.length)));
    }
    return 'data:audio/wav;base64,' + global.btoa(bin);
  }

  function setSttBusy(busy) {
    sttJob.busy = !!busy;
    syncAttachmentSttButton();
  }

  function runAttachmentStt(att) {
    if (!att || att.kind !== 'audio' || !att.dataUrl) return;
    var api = global.TodoNative;
    if (!api || typeof api.whisperTranscribeWav !== 'function') {
      toast('提取文字需要手机版');
      return;
    }
    if (!whisperReady()) {
      toast('离线识别引擎还没准备好，稍后再试');
      return;
    }
    if (sttJob.busy) return;
    sttJob.att = att;
    setSttBusy(true);
    fetch(att.dataUrl).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
      var Ctx = global.OfflineAudioContext || global.webkitOfflineAudioContext;
      if (!Ctx) throw new Error('这个环境不支持音频解码');
      var ctx = new Ctx(1, 16000, 16000);   /* 解码重采样到16k，声道在下一步显式混合 */
      return ctx.decodeAudioData(buf);
    }).then(function (audio) {
      var pcm = audio.getChannelData(0);
      if (!pcm.length) throw new Error('录音内容为空');
      var channels = audio.numberOfChannels || 1;
      if (channels > 1) {
        var mono = new Float32Array(pcm.length);
        for (var channel = 0; channel < channels; channel++) {
          var data = audio.getChannelData(channel);
          for (var i = 0; i < mono.length; i++) mono[i] += data[i] / channels;
        }
        pcm = mono;
      }
      return floatPcmToWavBase64(pcm, 16000);
    }).then(function (b64) {
      var rid = 'stt-' + Date.now();
      sttJob.rid = rid;
      sttJob.att = att;
      global.TodoNative.whisperTranscribeWav(rid, b64);
    }).catch(function (e) {
      sttJob.rid = '';
      sttJob.att = null;
      setSttBusy(false);
      toast('提取失败（' + (e && e.message ? e.message : '音频解码不支持') + '）');
    });
  }

  /** 原生转写回包汇入点 */
  global.AttStt = {
    done: function (reqId, code, resp) {
      if (sttJob.rid !== String(reqId || '')) return;   /* 迟到的回包丢弃 */
      var att = sttJob.att;
      sttJob.rid = '';
      sttJob.att = null;
      var text = '';
      try {
        var parsed = JSON.parse(String(resp == null ? '' : resp));
        text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
      } catch (error) { /* 非 JSON 按空处理 */ }
      if (code < 200 || code >= 300 || !text) {
        setSttBusy(false);
        toast('没提取出文字' + (text ? '' : '（可能没有可辨认的语音）'));
        return;
      }
      text = restoreVoiceNames(text);
      if (att) {
        att.text = text;      /* 随附件保存，预览与列表都能看到 */
        saveTodos();
        renderList();
      }
      if (previewAttachment === att) {
        if (el.previewOcr) show(el.previewOcr, true);
        if (el.previewOcrText) el.previewOcrText.textContent = text;
      }
      setSttBusy(false);
      toast('已提取 ' + text.length + ' 个字');
    },
    error: function (reqId, message) {
      if (sttJob.rid !== String(reqId || '')) return;
      sttJob.rid = '';
      sttJob.att = null;
      setSttBusy(false);
      toast(String(message || '转写失败'));
    }
  };

  function closeAttachmentPreview() {
    previewAttachment = null;
    show(el.attachPreviewLayer, false);
  }

  /** 从某条 todo 里删一个附件 */
  function removeAttachment(todoId, attId) {
    var todo = findTodo(todoId);
    if (!todo) return;
    var idx = -1;
    for (var i = 0; i < todo.attachments.length; i++) {
      if (todo.attachments[i].id === attId) { idx = i; break; }
    }
    if (idx === -1) return;
    todo.attachments.splice(idx, 1);
    todo.updatedAt = Date.now();
    saveTodos();
    renderList();
    toast('附件已删除');
  }

  /** 画板指针坐标（相对画布，CSS 像素） */
  function drawPos(event) {
    var rect = el.drawCanvas.getBoundingClientRect();
    var cx = (event.clientX - rect.left);
    var cy = (event.clientY - rect.top);
    return { x: cx, y: cy };
  }

  function bindDrawEvents() {
    /* 附件按钮：打开来源选择面板（手绘/拍照/相册/录音/文件） */
    if (el.drawBtn) el.drawBtn.addEventListener('click', openAttachSource);

    /* 新增栏附件暂存区：点 × 删掉暂存附件，点缩略图开预览。
       （此前这里只渲染不绑事件，暂存附件的 × 是死的） */
    if (el.editAttachList) {
      el.editAttachList.addEventListener('click', function (event) {
        var chip = event.target.closest ? event.target.closest('.attach__chip') : null;
        if (!chip || !el.editAttachList.contains(chip)) return;
        var index = parseInt(chip.getAttribute('data-index'), 10);
        if (isNaN(index) || index < 0 || index >= editingAttachments.length) return;
        var att = editingAttachments[index];
        var x = event.target.closest ? event.target.closest('.attach__x') : null;
        if (x && chip.contains(x)) {
          event.stopPropagation();
          editingAttachments.splice(index, 1);
          renderAttachmentBar();
          toast('已移除附件');
          return;
        }
        openAttachmentPreview(att);
      });
    }

    /* 来源面板分发 */
    if (el.attachSrcLayer) {
      el.attachSrcLayer.addEventListener('click', function (event) {
        if (event.target === el.attachSrcLayer) closeAttachSource();
      });
      var srcBtns = el.attachSrcLayer.querySelectorAll('[data-src]');
      for (var sb = 0; sb < srcBtns.length; sb++) {
        srcBtns[sb].addEventListener('click', function () {
          dispatchAttachSource(this.getAttribute('data-src'));
        });
      }
    }
    if (el.attachSrcCancel) el.attachSrcCancel.addEventListener('click', closeAttachSource);
    if (el.scanModes) el.scanModes.addEventListener('click', function (event) {
      var btn = event.target.closest ? event.target.closest('.scan__mode') : null;
      if (btn) setScanMode(btn.getAttribute('data-mode'));
    });
    if (el.scanRetake) el.scanRetake.addEventListener('click', function () {
      closeScanReview();
      startScanFlow();
    });
    if (el.scanSave) el.scanSave.addEventListener('click', scanNow);

    /* OCR 提取文字 + 复制 */
    if (el.scanOcr) el.scanOcr.addEventListener('click', runScanOcr);
    if (el.scanOcrCopy) el.scanOcrCopy.addEventListener('click', function () {
      toast(copyTextToClipboard(scanUi.ocr) ? '已复制' : '复制失败，长按文字手动复制');
    });
    if (el.previewOcrCopy) el.previewOcrCopy.addEventListener('click', function () {
      var text = previewAttachment && previewAttachment.text
        ? String(previewAttachment.text) : '';
      toast(copyTextToClipboard(text) ? '已复制' : '复制失败，长按文字手动复制');
    });

    /* 录音停止 */
    if (el.audioRecStop) el.audioRecStop.addEventListener('click', stopAudioRecord);

    if (el.drawCancel) el.drawCancel.addEventListener('click', function () { closeDrawPad(true); });
    if (el.drawDone) el.drawDone.addEventListener('click', finishDrawPad);
    if (el.drawUndo) el.drawUndo.addEventListener('click', undoStroke);
    if (el.drawClear) {
      el.drawClear.addEventListener('click', function () {
        var c = el.drawCanvas;
        if (!c) return;
        var dpr = global.devicePixelRatio || 1;
        var ctx = c.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.clientWidth, c.clientHeight);
        draw.dirty = false;
        draw.undo = [];
      });
    }

    /* 颜色 / 粗细切换 */
    if (el.drawColors) {
      el.drawColors.addEventListener('click', function (event) {
        var t = event.target;
        var btn = t && typeof t.closest === 'function' ? t.closest('[data-color]') : null;
        if (!btn) return;
        draw.color = btn.getAttribute('data-color');
        syncDrawToolbar();
      });
    }
    if (el.drawSizes) {
      el.drawSizes.addEventListener('click', function (event) {
        var t = event.target;
        var btn = t && typeof t.closest === 'function' ? t.closest('[data-size]') : null;
        if (!btn) return;
        draw.size = Number(btn.getAttribute('data-size')) || DRAW_SIZES[1];
        syncDrawToolbar();
      });
    }

    /* 落笔：Pointer Events，手写笔/手指/鼠标通用 */
    if (el.drawCanvas) {
      var c = el.drawCanvas;
      c.addEventListener('pointerdown', function (event) {
        event.preventDefault();
        var p = drawPos(event);
        beginStroke(p.x, p.y);
        try { c.setPointerCapture(event.pointerId); } catch (e) { /* 忽略 */ }
      });
      c.addEventListener('pointermove', function (event) {
        var p = drawPos(event);
        moveStroke(p.x, p.y);
      });
      c.addEventListener('pointerup', endStroke);
      c.addEventListener('pointercancel', endStroke);
    }

    /* 附件预览层关闭 */
    if (el.attachPreviewClose) el.attachPreviewClose.addEventListener('click', closeAttachmentPreview);
    /* 附件录音「提取文字」：走本地 whisper 离线转写 */
    if (el.previewStt) {
      el.previewStt.addEventListener('click', function () {
        runAttachmentStt(previewAttachment);
      });
    }
    if (el.attachPreviewLayer) {
      el.attachPreviewLayer.addEventListener('click', function (event) {
        if (event.target === el.attachPreviewLayer) closeAttachmentPreview();
      });
    }

    /* 画板层点遮罩 = 放弃 */
    if (el.drawLayer) {
      el.drawLayer.addEventListener('click', function (event) {
        if (event.target === el.drawLayer) closeDrawPad(true);
      });
    }
  }

  /* ------------------------------------------------------------ 事件绑定 */

  function setBusy(button, busy, busyText, idleText) {
    button.disabled = busy;
    button.textContent = busy ? busyText : idleText;
  }

  function switchTab(which) {
    var toLogin = which === 'login';
    el.tabLogin.classList.toggle('is-active', toLogin);
    el.tabRegister.classList.toggle('is-active', !toLogin);
    el.tabLogin.setAttribute('aria-selected', String(toLogin));
    el.tabRegister.setAttribute('aria-selected', String(!toLogin));
    show(el.formLogin, toLogin);
    show(el.formRegister, !toLogin);
    el.loginError.textContent = '';
    el.regError.textContent = '';
    (toLogin ? el.loginUsername : el.regUsername).focus();
  }

  function bindAuthEvents() {
    el.tabLogin.addEventListener('click', function () { switchTab('login'); });
    el.tabRegister.addEventListener('click', function () { switchTab('register'); });

    /* 登录页下方的四个入口 */
    if (el.guestBtn) el.guestBtn.addEventListener('click', loginAsGuest);
    if (el.changePassBtn) {
      el.changePassBtn.addEventListener('click', function () { openAuthSheet('change'); });
    }
    if (el.forgotBtn) {
      el.forgotBtn.addEventListener('click', function () {
        if (!global.TodoNative) {
          toast('网页版调不起手机验证，请用「修改密码」');
        }
        openAuthSheet('forgot');
      });
    }
    if (el.deleteAccountBtn) {
      el.deleteAccountBtn.addEventListener('click', function () { openAuthSheet('delete'); });
    }
    if (el.authSheetClose) el.authSheetClose.addEventListener('click', closeAuthSheet);
    if (el.authLayer) {
      el.authLayer.addEventListener('click', function (event) {
        if (event.target === el.authLayer) closeAuthSheet();
      });
    }

    el.formLogin.addEventListener('submit', function (event) {
      event.preventDefault();
      var name = el.loginUsername.value.trim();
      var password = el.loginPassword.value;
      el.loginError.textContent = '';

      if (!name) { el.loginError.textContent = '请输入用户名'; return; }
      if (!password) { el.loginError.textContent = '请输入密码'; return; }

      setBusy(el.loginSubmit, true, '登录中…', '登录');
      Auth.login(name, password).then(function (result) {
        setBusy(el.loginSubmit, false, '', '登录');
        if (!result.ok) {
          el.loginError.textContent = result.error;
          return;
        }
        el.loginPassword.value = '';
        enterApp(result.user);
        toast('欢迎回来，' + result.user.name);
      });
    });

    el.formRegister.addEventListener('submit', function (event) {
      event.preventDefault();
      var name = el.regUsername.value.trim();
      var password = el.regPassword.value;
      var confirm = el.regConfirm.value;
      el.regError.textContent = '';

      var nameError = Auth.validateName(name);
      if (nameError) { el.regError.textContent = nameError; return; }

      var passwordError = Auth.validatePassword(password);
      if (passwordError) { el.regError.textContent = passwordError; return; }

      if (password !== confirm) { el.regError.textContent = '两次输入的密码不一致'; return; }

      setBusy(el.regSubmit, true, '创建中…', '创建账号');
      Auth.register(name, password).then(function (result) {
        setBusy(el.regSubmit, false, '', '创建账号');
        if (!result.ok) {
          el.regError.textContent = result.error;
          return;
        }
        el.regPassword.value = '';
        el.regConfirm.value = '';
        enterApp(result.user);
        toast('账号已创建，开始记录今天吧');
      });
    });
  }

  /** 时间面板自身的交互：预设、三个自绘下拉、确定/取消、点遮罩关闭、Esc 关闭 */
  function bindTimePopoverEvents() {
    if (!el.timePopLayer) return;

    el.timePopOk.addEventListener('click', confirmTimePopover);

    /* 模糊时段：点一下选定，再点一下取消（回到精确到分钟） */
    if (el.timePopSlots) {
      el.timePopSlots.addEventListener('click', function (event) {
        var node = event.target;
        var btn = node && typeof node.closest === 'function'
          ? node.closest('.timeslot__btn') : null;
        if (!btn) return;
        var key = btn.getAttribute('data-slot');
        var slot = fuzzySlot(key);
        if (!slot) return;
        timePop.fuzzy = timePop.fuzzy === key ? null : key;
        if (timePop.fuzzy) {
          /* 代表时刻同步进下拉，切回精确模式时不会跳回旧值 */
          timePop.hour = slot.hour;
          timePop.minute = 0;
        }
        if (el.timePopError) el.timePopError.textContent = '';
        closeTimePick();
        syncTimePopoverText();
      });
    }
    el.timePopCancel.addEventListener('click', function () { closeTimePopover(true); });
    el.timePopClose.addEventListener('click', function () { closeTimePopover(true); });

    /* 点面板外的空白处关闭 */
    el.timePopLayer.addEventListener('click', function (event) {
      if (event.target === el.timePopLayer) closeTimePopover(true);
    });

    el.timePopPresets.addEventListener('click', function (event) {
      var node = event.target;
      if (!node || typeof node.closest !== 'function') return;
      var button = node.closest('.timepop__preset');
      if (!button) return;
      useTimePreset(parseInt(button.getAttribute('data-minutes'), 10));
    });

    /* 三个下拉：点按钮展开/收起，点选项落值 */
    var triggers = [
      [el.timePopDateBtn, 'date'],
      [el.timePopHourBtn, 'hour'],
      [el.timePopMinuteBtn, 'minute']
    ];
    for (var i = 0; i < triggers.length; i++) {
      (function (btn, kind) {
        if (!btn) return;
        btn.addEventListener('click', function (event) {
          event.stopPropagation();
          openTimePick(kind);
        });
      })(triggers[i][0], triggers[i][1]);
    }

    if (el.timePopList) {
      el.timePopList.addEventListener('click', function (event) {
        var node = event.target;
        var opt = node && typeof node.closest === 'function'
          ? node.closest('.timepick__opt') : null;
        if (!opt) return;
        event.stopPropagation();
        var kind = timePop.open;
        if (!kind) return;
        pickTimeOption(kind, parseInt(opt.getAttribute('data-value'), 10) || 0);
      });
    }

    /* 点面板里下拉以外的区域，把下拉收起来（避免两个下拉叠在一起） */
    if (el.timePop) {
      el.timePop.addEventListener('click', function (event) {
        if (!timePop.open) return;
        var node = event.target;
        if (el.timePopList && el.timePopList.contains(node)) return;
        if (node && typeof node.closest === 'function' && node.closest('.timepickfield')) return;
        closeTimePick();
      });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (el.timePopLayer.classList.contains('is-hidden')) return;
      if (timePop.open) {
        closeTimePick();
        return;
      }
      closeTimePopover(true);
    });

    /* 宽屏是贴着按钮浮出来的，滚动或缩放后位置就不对了，直接收起 */
    global.addEventListener('resize', function () {
      closeTimePick();
      positionTimePopover();
    });
    global.addEventListener(
      'scroll',
      function () {
        if (!isNarrowScreen()) closeTimePopover(false);
      },
      true
    );
  }

  function bindTodoEvents() {
    if (global.MessageWorkbench) global.MessageWorkbench.bind({
      userKey: function() { return state.user ? state.user.key : ''; },
      store: Store,
      normalizeNames: normalizeVoiceNames,
      todos: function() { return state.todos; },
      schedule: function(plan, dueAt) {
        return addTodo('消息发送提醒 · ' + (plan.platform === 'qq' ? 'QQ' : '微信'), {
          dueAt: dueAt, fromAssistant: true, messagePlan: plan
        });
      },
      finish: function(todo) { setDone(todo, true); },
      startDictation: startVoiceInput,
      encodeRecording: function(buffer) {
        var Context = global.OfflineAudioContext || global.webkitOfflineAudioContext;
        if (!Context) return Promise.reject(new Error('音频转换不可用'));
        return new Context(1, 16000, 16000).decodeAudioData(buffer).then(function(decoded) {
          if (decoded.length === 0 || decoded.length > 16 * 16000) throw new Error('录音时长超限');
          var mono = new Float32Array(decoded.length);
          for (var channel = 0; channel < decoded.numberOfChannels; channel++) {
            var data = decoded.getChannelData(channel);
            for (var i = 0; i < data.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
          }
          return floatPcmToWavBase64(mono, 16000);
        });
      },
      canRecord: function() {
        return !(audioRec && audioRec.state === 'recording') &&
          !memoDict.active && !dictationActive() &&
          (voiceState === 'idle' || voiceState === 'closing') && memoVoice.state === 'idle';
      },
      fromVoice: function() {
        if (voiceState === 'listening' || voiceState === 'stopping') {
          toast('请先结束录音并等转写完成');
          return '';
        }
        var text = voiceTextNow();
        if (text) { closeVoiceLayer(); clearVoiceDraft(); }
        return text;
      }
    });
    bindTimePopoverEvents();
    bindConfirmEvents();

    el.tabTodos.addEventListener('click', function () { switchPanel('todos'); });
    el.tabArchive.addEventListener('click', function () { switchPanel('archive'); });

    el.archiveAll.addEventListener('change', function () {
      toggleArchiveAll(el.archiveAll.checked);
    });
    el.archiveDelete.addEventListener('click', deleteSelectedArchive);
    el.archiveClear.addEventListener('click', clearArchive);

    el.formAdd.addEventListener('submit', function (event) {
      event.preventDefault();
      var scheduled = parseScheduledTodo(el.newTodo.value, Date.now());
      var added = scheduled
        ? addTodo(scheduled.text, readAddTime() === null ? { dueAt: scheduled.dueAt } : undefined)
        : addTodo(el.newTodo.value);
      if (added) {
        el.newTodo.value = '';
        el.newTodo.focus();
      }
    });

    el.newTodo.addEventListener('input', function () {
      if (addDigits && addDigits.before !== el.newTodo.value) clearAddDigits();
      if (addDigitApplying) return;
      if (el.addHint.textContent) setAddHint('');
      refreshAddTimeSuggestions();
    });
    if (el.addDigitAdopt) el.addDigitAdopt.addEventListener('click',function(){adoptAddDigits(false);});
    if (el.addDigitUndo) el.addDigitUndo.addEventListener('click',function(){adoptAddDigits(true);});
    if (el.addDigitDismiss) el.addDigitDismiss.addEventListener('click',clearAddDigits);
    if (el.addTimeDismiss) el.addTimeDismiss.addEventListener('click',clearAddTimeSuggestions);
    if (el.addTimeCustom) el.addTimeCustom.addEventListener('click',function(){
      openTimePopover({kind:'add'},el.timeChip,readAddTime());
    });

    el.timeChip.addEventListener('click', function () {
      openTimePopover({ kind: 'add' }, el.timeChip, readAddTime());
    });

    el.timeClear.addEventListener('click', function () {
      resetAddTime(true);
      el.newTodo.focus();
    });

    el.clearDone.addEventListener('click', clearCompleted);

    /* 麦克风入口：直接进语音那一屏。能听就听，听不了也能打字，
       不再顺手把助手面板也拉起来 —— 屏幕上只留一个界面。 */
    if (el.voiceBtn) {
      el.voiceBtn.addEventListener('click', startVoiceInput);
    }

    /* 语音那一屏右上角的 ✕：任何状态都能关掉 */
    if (el.voiceCancel) {
      el.voiceCancel.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        cancelVoice(false);
      });
    }

    /* 唯一的圆形大按钮：听的时候是「结束录音」，排空期是「跳过剩余转写」，出稿之后是「发送」 */
    if (el.voiceStop) {
      el.voiceStop.addEventListener('click', function (event) {
        event.preventDefault();
        if (voiceState === 'listening') {
          if (dictDraining()) { skipRemainingDictation(); return; }
          finishVoiceListening();
          return;
        }
        if (voiceState === 'stopping') return;      /* 正在出稿，别重复点 */
        if (voiceState === 'review' || voiceState === 'typing') sendVoiceText();
        else startVoiceInput();
      });
    }

    /* 识别出文字后多出来的那个次要按钮：存成笔记 */
    if (el.voiceToMemo) {
      el.voiceToMemo.addEventListener('click', function (event) {
        event.preventDefault();
        saveVoiceAsMemo();
      });
    }

    /* 「导出txt」：把正文一键复制到剪贴板，粘贴到任意 App 即可存成 txt */
    if (el.voiceExport) {
      el.voiceExport.addEventListener('click', function (event) {
        event.preventDefault();
        var text = voiceTextNow();
        if (!text) {
          toast('还没有内容，说一句或写一句都行');
          return;
        }
        if (copyTextToClipboard(text)) {
          toast('全文已复制，粘贴到微信/备忘录即可保存');
        } else {
          toast('复制失败，请长按输入框手动复制');
        }
      });
    }

    /* 出稿后再按一次麦克风：接着录，新话接到已有内容后面 */
    /* 「转写」模式切换：实时识别 ⇄ 录音转写（网页版没有原生录音，藏掉） */
    if (el.voiceDictate) {
      if (!global.TodoNative || typeof global.TodoNative.startDictation !== 'function') {
        el.voiceDictate.classList.add('is-hidden');
      } else {
        el.voiceDictate.addEventListener('click', function () {
          toggleDictationMode();
        });
      }
      /* 开麦默认模式按「待办语音输入」设置走（离线转写=本机引擎全链路） */
      if (el.voiceDictate && dictationApi() && whisperReady()
          && prefs.voiceTodoMode !== 'realtime') {
        dict.mode = true;
        syncDictationToggle();
      }
    }

    /* 录音转写识别服务：粘贴 key 即保存并直接开录 */
    if (el.voiceDictateKeySave) {
      el.voiceDictateKeySave.addEventListener('click', function () {
        var key = String((el.voiceDictateKeyInput && el.voiceDictateKeyInput.value) || '').trim();
        if (!key) {
          toast('先粘贴 API Key（cloud.siliconflow.cn 可免费注册）');
          return;
        }
        prefs.dictate.key = key;
        savePrefs();
        show(el.voiceDictateKey, false);
        toast('识别服务已配置');
        startDictationFlow();
      });
    }

    /* 录音转写「打字补充」：边录边打字，两路输入并存 */
    if (el.voiceDictTypeAdd) {
      el.voiceDictTypeAdd.addEventListener('click', insertDictationTyping);
    }
    if (el.voiceDictTypeInput) {
      el.voiceDictTypeInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          insertDictationTyping();
        }
      });
    }

    /* 使用可见区域尺寸，兼容 WebView 的窗口与可见区域同时缩小。 */
    if (global.visualViewport) {
      global.visualViewport.addEventListener('resize', scheduleVoiceViewport);
      global.visualViewport.addEventListener('scroll', scheduleVoiceViewport);
      global.addEventListener('resize', scheduleVoiceViewport);
    }

    /* 「存入待办」加号按钮：退出语音，文字进新增栏输入框 */
    if (el.voiceToTodo) {
      el.voiceToTodo.addEventListener('click', function (event) {
        sendVoiceToTodoInput();
      });
    }

    if (el.voiceMore) {
      el.voiceMore.addEventListener('click', function (event) {
        event.preventDefault();
        resumeVoiceListening();
      });
    }

    /* 改字：一边改一边记住，发送时用的是改后的内容 */
    if (el.voiceEdit) {
      el.voiceEdit.addEventListener('input', function () {
        voiceText = String(el.voiceEdit.value || '');
        saveVoiceDraft();
      });
      el.voiceEdit.addEventListener('keydown', function (event) {
        /* 回车发送，Shift+回车换行 */
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
          event.preventDefault();
          sendVoiceText();
        }
      });
    }

    /* ---------------- 语音助手：面板、输入、气泡里的按钮 ---------------- */

    if (el.assistantClose) {
      el.assistantClose.addEventListener('click', closeAssistant);
    }
    /* 点面板外面的遮罩也关掉，和别的弹层一致 */
    if (el.assistantLayer) {
      el.assistantLayer.addEventListener('click', function (event) {
        if (event.target === el.assistantLayer) closeAssistant();
      });
    }
    if (el.assistantForm) {
      el.assistantForm.addEventListener('submit', function (event) {
        event.preventDefault();
        asstSubmit(el.assistantInput ? el.assistantInput.value : '');
      });
    }
    /* 面板里的麦克风：和底部那颗走同一条链路，说完话自动回到对话里 */
    if (el.assistantMic) {
      el.assistantMic.addEventListener('click', function () {
        startVoiceInput();
      });
    }
    /* 快捷示范：点一下等于说了一遍 */
    if (el.assistantQuick) {
      el.assistantQuick.addEventListener('click', function (event) {
        var node = event.target;
        var chip = node && typeof node.closest === 'function'
          ? node.closest('[data-say]') : null;
        if (!chip) return;
        asstSubmit(chip.getAttribute('data-say') || '');
      });
    }
    /* 右上角的模型徽标：本地规则 → 自动挑选 → 逐个档案 → 回到本地规则 */
    if (el.assistantModel) {
      el.assistantModel.addEventListener('click', asstCycleModel);
    }
    /* 气泡里的「撤销」「删除 / 算了」都靠委托，重绘也不会丢 */
    if (el.assistantLog) {
      el.assistantLog.addEventListener('click', function (event) {
        var node = event.target;
        if (!node || typeof node.closest !== 'function') return;
        var wrap = node.closest('.asstmsg');
        if (!wrap) return;
        var index = parseInt(wrap.getAttribute('data-index'), 10);
        if (isNaN(index)) return;

        if (node.closest('[data-undo]')) { asstUndo(index); return; }
        var pend = node.closest('[data-pending]');
        if (pend) asstResolvePending(index, pend.getAttribute('data-pending') === 'yes');
      });
    }

    /* 语音助手引擎：本地规则 / 在线大模型 */
    if (el.voiceEnginePick) {
      el.voiceEnginePick.addEventListener('click', function (event) {
        var target = event.target;
        var btn = target && typeof target.closest === 'function'
          ? target.closest('[data-engine]') : null;
        if (!btn) return;
        var attr = btn.getAttribute('data-engine');
        var engine = ['local', 'llm', 'ollama'].indexOf(attr) >= 0 ? attr : 'local';
        if (prefs.voiceEngine === engine) return;
        prefs.voiceEngine = engine;
        savePrefs();
        syncVoiceEnginePick();
        renderAsstModel();
        toast('语音助手：' + (
          engine === 'llm' ? '在线大模型' :
          engine === 'ollama' ? '本地大模型（电脑 Ollama）' : '本地规则'));
      });
    }

    /* 三处语音入口的独立模式选择 */
    bindModePick(el.voiceTodoPick, 'data-vt', ['dict', 'realtime'], 'voiceTodoMode');
    var contactDirectory = $('open-contact-directory');
    if (contactDirectory && global.AndroidHost && typeof global.AndroidHost.openContactDirectory === 'function') {
      contactDirectory.hidden = false;
      contactDirectory.addEventListener('click', function() {
        global.AndroidHost.openContactDirectory();
      });
    }
    if (el.saveVoiceNames) el.saveVoiceNames.addEventListener('click', function() {
      prefs.voiceNames = normalizeVoiceNames(el.voiceNames.value);
      el.voiceNames.value = prefs.voiceNames;
      savePrefs();
      toast(prefs.voiceNames ? '常用人名已保存' : '常用人名已清空');
    });
    if (el.voiceNamesFile) $('import-voice-names').addEventListener('click', function() {
      el.voiceNamesFile.click();
    });
    if (el.voiceNamesFile) el.voiceNamesFile.addEventListener('change', function() {
      var file = el.voiceNamesFile.files[0];
      el.voiceNamesFile.value = '';
      if (!file) return;
      if (file.size > 65536) { toast('请选小于 64 KB 的姓名文本'); return; }
      var reader = new global.FileReader();
      reader.onerror = function() { toast('姓名文本读取失败'); };
      reader.onload = function() {
        var imported = normalizeVoiceNames(String(reader.result || ''));
        if (!imported) { toast('文件中没有可导入的中文姓名'); return; }
        var merged = normalizeVoiceNames(el.voiceNames.value + '、' + imported);
        el.voiceNames.value = merged;
        toast('共 ' + merged.split('、').length + ' 个候选，请核对后保存');
      };
      reader.readAsText(file, 'UTF-8');
    });
    bindModePick(el.voiceMemoPick, 'data-vm', ['dict', 'realtime'], 'voiceMemoMode');
    syncVoiceModePicks();

    /* ---------------- 大模型：路由策略 / 档案卡片 / 编辑弹层 / 对比弹层 ---------------- */

    if (el.llmRoutePick) {
      el.llmRoutePick.addEventListener('click', function (event) {
        var node = event.target;
        var btn = node && typeof node.closest === 'function'
          ? node.closest('[data-route]') : null;
        if (!btn) return;
        var route = btn.getAttribute('data-route') === 'manual' ? 'manual' : 'auto';
        if (prefs.llmRoute === route) return;
        if (route === 'manual' && !activeModel()) {
          toast('先添加并填好一个模型');
          return;
        }
        prefs.llmRoute = route;
        savePrefs();
        renderRouteState();
        toast(route === 'manual' ? '已改为手动指定模型' : '已改为按任务自动挑模型');
      });
    }

    if (el.llmModelAdd) {
      el.llmModelAdd.addEventListener('click', function () { openModelSheet(''); });
    }
    if (el.llmCompareOpen) {
      el.llmCompareOpen.addEventListener('click', openCompare);
    }
    if (el.llmModelList) {
      el.llmModelList.addEventListener('click', function (event) {
        var node = event.target;
        if (!node || typeof node.closest !== 'function') return;
        var btn = node.closest('[data-act]');
        if (!btn) return;
        var card = btn.closest('.mdl');
        if (!card) return;
        var id = card.getAttribute('data-id');
        var act = btn.getAttribute('data-act');
        if (act === 'probe') probeModelCard(id);
        else if (act === 'use') useModel(id);
        else if (act === 'edit') openModelSheet(id);
        else if (act === 'del') deleteModel(id);
      });
    }

    /* 档案编辑弹层 */
    if (el.modelClose) el.modelClose.addEventListener('click', closeModelSheet);
    if (el.modelCancel) el.modelCancel.addEventListener('click', closeModelSheet);
    if (el.modelLayer) {
      el.modelLayer.addEventListener('click', function (event) {
        if (event.target === el.modelLayer) closeModelSheet();
      });
    }
    if (el.modelSave) el.modelSave.addEventListener('click', saveModelForm);
    if (el.modelProbeBtn) el.modelProbeBtn.addEventListener('click', probeDraft);
    if (el.modelPresets) {
      el.modelPresets.addEventListener('click', function (event) {
        var node = event.target;
        var btn = node && typeof node.closest === 'function'
          ? node.closest('[data-preset]') : null;
        if (!btn) return;
        applyPreset(btn.getAttribute('data-preset'));
      });
    }
    if (el.modelChips) {
      el.modelChips.addEventListener('click', function (event) {
        var node = event.target;
        var btn = node && typeof node.closest === 'function'
          ? node.closest('[data-model]') : null;
        if (!btn) return;
        if (el.modelId) el.modelId.value = btn.getAttribute('data-model');
        renderModelChips(presetModelsOf(el.modelEndpoint ? el.modelEndpoint.value : ''),
          btn.getAttribute('data-model'));
      });
    }
    if (el.modelCaps) {
      el.modelCaps.addEventListener('click', function (event) {
        var node = event.target;
        var btn = node && typeof node.closest === 'function'
          ? node.closest('[data-cap]') : null;
        if (!btn) return;
        var key = btn.getAttribute('data-cap');
        var level = parseInt(btn.getAttribute('data-level'), 10) || 2;
        if (CAP_KEYS.indexOf(key) === -1) return;
        if (!modelSheet.caps) modelSheet.caps = defaultCaps();
        modelSheet.caps[key] = level;
        modelSheet.capsTouched = true;
        renderCapsEditor();
      });
    }
    if (el.modelKeyEye) {
      el.modelKeyEye.addEventListener('click', function () {
        var on = el.modelKey.getAttribute('type') === 'password';
        el.modelKey.setAttribute('type', on ? 'text' : 'password');
        el.modelKeyEye.setAttribute('aria-pressed', on ? 'true' : 'false');
        el.modelKeyEye.setAttribute('aria-label', on ? '隐藏密钥' : '显示密钥');
      });
    }
    if (el.modelEndpoint) {
      el.modelEndpoint.addEventListener('change', function () {
        renderModelPresets(el.modelEndpoint.value);
        renderModelChips(presetModelsOf(el.modelEndpoint.value),
          el.modelId ? el.modelId.value : '');
        if (el.modelName && !String(el.modelName.value || '').trim()) {
          var norm = normalizeEndpoint(el.modelEndpoint.value);
          for (var pi = 0; pi < MODEL_PRESETS.length; pi++) {
            if (MODEL_PRESETS[pi].endpoint &&
                normalizeEndpoint(MODEL_PRESETS[pi].endpoint) === norm) {
              el.modelName.value = MODEL_PRESETS[pi].name;
              break;
            }
          }
        }
      });
    }
    if (el.modelId) {
      el.modelId.addEventListener('change', function () {
        renderModelChips(presetModelsOf(el.modelEndpoint ? el.modelEndpoint.value : ''),
          String(el.modelId.value || '').trim());
      });
    }

    /* 对比弹层 */
    if (el.compareClose) el.compareClose.addEventListener('click', closeCompare);
    if (el.compareLayer) {
      el.compareLayer.addEventListener('click', function (event) {
        if (event.target === el.compareLayer) closeCompare();
      });
    }
    if (el.compareTasks) {
      el.compareTasks.addEventListener('click', function (event) {
        var node = event.target;
        var btn = node && typeof node.closest === 'function'
          ? node.closest('[data-task]') : null;
        if (!btn) return;
        var key = btn.getAttribute('data-task');
        if (!LLM_TASKS[key] || compare.task === key) return;
        compare.task = key;
        if (el.compareInput) el.compareInput.value = LLM_TASKS[key].sample;
        if (el.compareResults) el.compareResults.textContent = '';
        setCompareStatus('', '');
        renderCompareTasks();
      });
    }
    if (el.compareModels) {
      el.compareModels.addEventListener('change', function (event) {
        var input = event.target;
        if (!input || !input.getAttribute) return;
        var id = input.getAttribute('data-id');
        if (!id) return;
        compare.picked[id] = !!input.checked;
      });
    }
    if (el.compareSample) {
      el.compareSample.addEventListener('click', function () {
        if (el.compareInput) el.compareInput.value = LLM_TASKS[compare.task].sample;
      });
    }
    if (el.compareAuto) el.compareAuto.addEventListener('click', showAutoPick);
    if (el.compareRun) el.compareRun.addEventListener('click', runCompare);
    /* 模型目录在线更新：检查 → 安装 → 回滚 */
    if (el.catalogCheck) el.catalogCheck.addEventListener('click', checkModelCatalog);
    if (el.catalogInstall) el.catalogInstall.addEventListener('click', installCatalogUpdate);
    if (el.catalogRollback) {
      el.catalogRollback.addEventListener('click', function () { rollbackCatalog(false); });
    }
    /* AI 用量与预算 */
    if (el.aiBudgetBtn) el.aiBudgetBtn.addEventListener('click', cycleAiBudget);
    if (el.aiUsageClear) el.aiUsageClear.addEventListener('click', clearAiUsage);
    if (el.aiMaskToggle) el.aiMaskToggle.addEventListener('click', toggleAiMask);

    if (el.llmStatusRefresh) {
      el.llmStatusRefresh.addEventListener('click', function () {
        var pick = pickModel('assistant');
        if (!pick.model) {
          setLlmStatus('还没有可用模型，先添加一份档案', 'bad');
          return;
        }
        setLlmStatus('正在用「' + modelTitle(pick.model) + '」试一句…', '');
        /* 拿助手真实用的提示词和协议去试，连通性之外还能看出它听不听话 */
        runMessages(pick.model, {
          messages: [
            { role: 'system', content: asstSystemPrompt() },
            { role: 'user', content: '明天下午三点开会' }
          ],
          temperature: 0.1, timeout: 25000
        }, function (err, res) {
          if (err) { setLlmStatus('连接失败：' + err, 'bad'); return; }
          var head = '连接成功' + (res.ms ? '，' + (res.ms / 1000).toFixed(1) + 's' : '');
          var intent = parseIntentPayload(res.text);
          if (!intent) {
            setLlmStatus(head + '；但没按约定输出动作，助手会退回本地规则', 'bad');
            return;
          }
          var say = intent.action === 'create'
            ? '建待办「' + intent.text + '」' +
              (intent.times.length ? ' @' + formatDateTime(intent.times[0]) : '')
            : intent.action;
          setLlmStatus(head + '，示例指令解析成：' + say, 'ok');
        });
      });
    }

    el.userBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      var willOpen = el.userMenu.classList.contains('is-hidden');
      show(el.userMenu, willOpen);
      el.userBtn.setAttribute('aria-expanded', String(willOpen));
    });

    /* 手绘画板：入口 + 工具条 + 落笔 */
    bindDrawEvents();

    /* 点头像 = 换头像；点名字 = 账号菜单（两件事分开，别互相抢点击） */
    if (el.avatarBtn) {
      el.avatarBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        openAvatarSheet();
      });
    }
    if (el.avatarClose) el.avatarClose.addEventListener('click', closeAvatarSheet);
    if (el.avatarLayer) {
      el.avatarLayer.addEventListener('click', function (event) {
        if (event.target === el.avatarLayer) closeAvatarSheet();
      });
    }
    if (el.avatarGallery) el.avatarGallery.addEventListener('click', pickAvatarFromGallery);
    if (el.avatarRemove) {
      el.avatarRemove.addEventListener('click', function () {
        applyAvatar('');
        toast('已恢复成名字首字母');
      });
    }

    /* 文字头像：入口 + 弹层交互 */
    if (el.textAvatarBtn) el.textAvatarBtn.addEventListener('click', openTextAvatar);
    if (el.textAvatarClose) el.textAvatarClose.addEventListener('click', closeTextAvatar);
    if (el.textAvatarCancel) el.textAvatarCancel.addEventListener('click', closeTextAvatar);
    if (el.textAvatarOk) el.textAvatarOk.addEventListener('click', confirmTextAvatar);
    if (el.textAvatarLayer) {
      el.textAvatarLayer.addEventListener('click', function (event) {
        if (event.target === el.textAvatarLayer) closeTextAvatar();
      });
    }
    if (el.textAvatarInput) {
      el.textAvatarInput.addEventListener('input', function () {
        var v = el.textAvatarInput.value || '';
        if (Array.from(v).length > 6) v = Array.from(v).slice(0, 6).join('');
        el.textAvatarInput.value = v;
        textAvatar.text = v;
        paintTextAvatarPreview();
        repaintTextAvatarAfterFont();
      });
    }
    var txtBgBoxes = [el.textAvatarGradients, el.textAvatarSolids];
    for (var bi = 0; bi < txtBgBoxes.length; bi++) {
      if (!txtBgBoxes[bi]) continue;
      txtBgBoxes[bi].addEventListener('click', function (event) {
        var node = event.target;
        if (!node || typeof node.closest !== 'function') return;
        var sw = node.closest('.txtav__swatch');
        if (!sw) return;
        setTextAvatarBg(sw.getAttribute('data-type'),
          Number(sw.getAttribute('data-index')) || 0);
      });
    }

    /* 字体切换：楷体 / 甲骨文 */
    if (el.textAvatarFonts) {
      el.textAvatarFonts.addEventListener('click', function (event) {
        var node = event.target;
        if (!node || typeof node.closest !== 'function') return;
        var btn = node.closest('.txtav__font');
        if (!btn) return;
        textAvatar.font = btn.getAttribute('data-font') === 'oracle' ? 'oracle' : 'kai';
        preloadArtFont();
        var btns = el.textAvatarFonts.querySelectorAll('.txtav__font');
        for (var i = 0; i < btns.length; i++) {
          var on = btns[i] === btn;
          btns[i].classList.toggle('is-active', on);
          btns[i].setAttribute('aria-checked', on ? 'true' : 'false');
        }
        paintTextAvatarPreview();
        repaintTextAvatarAfterFont();
      });
    }

    /* 裁切界面：按钮 + 滑杆 + 拖动/双指/滚轮 */
    if (el.cropCancel) el.cropCancel.addEventListener('click', closeCropper);
    if (el.cropOk) el.cropOk.addEventListener('click', confirmCrop);
    if (el.cropZoom) {
      el.cropZoom.addEventListener('input', function () {
        setCropZoom((Number(el.cropZoom.value) || 100) / 100);
      });
    }
    if (el.cropLayer) {
      el.cropLayer.addEventListener('click', function (event) {
        if (event.target === el.cropLayer) closeCropper();
      });
    }
    bindCropGestures();

    if (el.settingsBtn) {
      el.settingsBtn.addEventListener('click', function () {
        openSettings();
      });
    }
    if (el.switchBtn) el.switchBtn.addEventListener('click', switchAccount);
    if (el.settingsClose) el.settingsClose.addEventListener('click', closeSettings);
    if (el.settingsLayer) {
      el.settingsLayer.addEventListener('click', function (event) {
        if (event.target === el.settingsLayer) closeSettings();
      });
    }
    if (el.ringRow) el.ringRow.addEventListener('click', openRingSheet);
    if (el.ringToggle) el.ringToggle.addEventListener('click', toggleRing);

    /* 排序：两个入口 + 弹层关闭 */
    if (el.sortBtnActive) {
      el.sortBtnActive.addEventListener('click', function () { openSortSheet('active'); });
    }
    if (el.sortBtnArchive) {
      el.sortBtnArchive.addEventListener('click', function () { openSortSheet('archive'); });
    }
    if (el.sortClose) el.sortClose.addEventListener('click', closeSortSheet);
    if (el.sortLayer) {
      el.sortLayer.addEventListener('click', function (event) {
        if (event.target === el.sortLayer) closeSortSheet();
      });
    }

    /* 功能指引：设置入口 + 弹层按钮 + 左右滑动翻页 */
    if (el.guideRow) {
      el.guideRow.addEventListener('click', function () {
        closeSettings();
        openGuide(true);
      });
    }
    if (el.guideSkip) el.guideSkip.addEventListener('click', function () { finishGuide(true); });
    if (el.guidePrev) el.guidePrev.addEventListener('click', function () {
      if (guide.index > 0) { guide.index -= 1; renderGuide(); }
    });
    if (el.guideNext) el.guideNext.addEventListener('click', guideNext);
    if (el.guideLayer) {
      var touchX = null;
      var touchY = null;
      el.guideLayer.addEventListener('keydown', function (event) {
        if (!guide.open || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          if (guide.index < GUIDE_ITEMS.length - 1) { guide.index += 1; renderGuide(); }
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          if (guide.index > 0) { guide.index -= 1; renderGuide(); }
        } else if (event.key === 'Tab') {
          var nodes = el.guideLayer.querySelectorAll('button:not([disabled]), summary, a[href], [tabindex="0"]');
          var visible = Array.prototype.filter.call(nodes, function (node) { return node.getClientRects().length > 0; });
          var first = visible[0], last = visible[visible.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === el.guidePager)) {
            event.preventDefault(); if (last) last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); if (first) first.focus();
          }
        }
      });
      el.guideLayer.addEventListener('touchstart', function (e) {
        touchX = e.touches[0].clientX;
        touchY = e.touches[0].clientY;
      }, { passive: true });
      el.guideLayer.addEventListener('touchend', function (e) {
        if (touchX === null) return;
        var dx = e.changedTouches[0].clientX - touchX;
        var dy = e.changedTouches[0].clientY - touchY;
        touchX = null;
        touchY = null;
        if (Math.abs(dy) >= Math.abs(dx)) return;
        if (dx < -50 && guide.index < GUIDE_ITEMS.length - 1) {
          guide.index += 1;
          renderGuide();
        } else if (dx > 50 && guide.index > 0) {
          guide.index -= 1;
          renderGuide();
        }
      }, { passive: true });
    }
    if (el.batteryBtn) {
      el.batteryBtn.addEventListener('click', function () {
        var api = global.TodoNative;
        if (api && typeof api.openBatteryOptimization === 'function') {
          api.openBatteryOptimization();
        }
      });
    }
    if (el.autoStartBtn) {
      el.autoStartBtn.addEventListener('click', function () {
        var api = global.TodoNative;
        if (api && typeof api.openAutoStart === 'function') {
          api.openAutoStart();
        }
      });
    }

    /* 主题：三个按钮，点哪个就锁哪个 */
    if (el.themePick) {
      el.themePick.addEventListener('click', function (event) {
        var target = event.target;
        var btn = target && typeof target.closest === 'function'
          ? target.closest('[data-mode]') : null;
        if (!btn) return;
        applyThemeMode(btn.getAttribute('data-mode'));
      });
    }
    if (el.ringClose) {
      el.ringClose.addEventListener('click', function () {
        show(el.ringLayer, false);
        show(el.settingsLayer, true);
      });
    }
    if (el.ringLayer) {
      el.ringLayer.addEventListener('click', function (event) {
        if (event.target === el.ringLayer) show(el.ringLayer, false);
      });
    }

    el.logoutBtn.addEventListener('click', function () {
      closeUserMenu();
      closeSheets();
      Auth.logout();
      state.user = null;
      state.todos = [];
      state.avatar = '';
      el.todoList.textContent = '';
      el.loginUsername.value = '';
      el.loginPassword.value = '';
      clearReminders();
      resetAddTime();
      resetArchiveView();
      /* 退出登录等于没有待办，顺手把系统里挂着的闹钟都撤掉 */
      syncNative();
      showAuthView();
      switchTab('login');
      toast('已退出登录');
    });

    document.addEventListener('click', function (event) {
      if (!el.userMenu.classList.contains('is-hidden') && !el.user.contains(event.target)) {
        closeUserMenu();
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (closeSheets()) return;
      closeUserMenu();
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) tick();
    });
  }

  /* ------------------------------------------------- 手机版（Android 容器）接入
     网页版没有 TodoNative 这个对象，下面几处都会安静地跳过，行为与原来完全一致。 */

  /** 把当前待办整表交给原生，由它按提醒时间挂系统闹钟 */
  function syncNative() {
    syncNativeRingPreference();
    if (!global.TodoNative || typeof global.TodoNative.sync !== 'function') return;
    try {
      global.TodoNative.sync(state.todos);
    } catch (error) {
      /* 桥接出问题不能影响页面本身的逻辑 */
    }
  }

  /** 原生那边后台提醒是否真的能送达（通知权限开着才算） */
  function nativeBackgroundReady() {
    if (!global.TodoNative || typeof global.TodoNative.backgroundReady !== 'function') return false;
    try {
      return !!global.TodoNative.backgroundReady();
    } catch (error) {
      return false;
    }
  }

  /**
   * 手机版从后台回到前台：这段时间里原生通知已经把到点的档位提示过了，
   * 这里把它们静默标记掉，免得一回来又被同样内容的卡片刷一遍。
   * 通知没开的时候不做这件事——否则那几条提醒就永远看不到了。
   */
  function catchUpReminders() {
    if (!nativeBackgroundReady()) return;

    var now = Date.now();
    var changed = false;
    for (var i = 0; i < state.todos.length; i++) {
      if (markPastOffsets(state.todos[i], now)) changed = true;
      var todo=state.todos[i];
      if (!todo.done) (todo.extraTimes || []).forEach(function(at){
        if (at<=now && todo.remindedExtra.indexOf(at)===-1) {todo.remindedExtra.push(at);changed=true;}
      });
    }
    if (changed) saveTodos();
  }

  /**
   * 手机版的返回键 / 返回手势：从最上层往下逐层关，
   * 全关完了才把控制权交回容器，由容器决定是否真的退出应用。
   */
  function handleNativeBack() {
    if (closeSheets()) return true;
    if (el.confirmLayer && !el.confirmLayer.classList.contains('is-hidden')) {
      settleConfirm('cancel');
      return true;
    }
    if (el.timePopLayer && !el.timePopLayer.classList.contains('is-hidden')) {
      /* 下拉开着时，返回键先收下拉，再按一次才关面板 */
      if (timePop.open) {
        closeTimePick();
        return true;
      }
      closeTimePopover(false);
      return true;
    }
    if (el.reminderLayer && el.reminderLayer.children.length > 0) {
      clearReminders();
      return true;
    }
    if (el.userMenu && !el.userMenu.classList.contains('is-hidden')) {
      closeUserMenu();
      return true;
    }
    if (currentPanel === 'archive' && el.viewTodo && !el.viewTodo.classList.contains('is-hidden')) {
      switchPanel('todos');
      return true;
    }
    return false;
  }

  global.__onNativeBack = function () {
    return handleNativeBack() ? 'handled' : 'exit';
  };

  global.__onNativeResume = function () {
    catchUpReminders();
    tick();
    syncNative();
  };

  /* ------------------------------------------------------------ 启动 */

  function cacheElements() {
    el.viewAuth = $('view-auth');
    el.viewTodo = $('view-todo');
    el.tabLogin = $('tab-login');
    el.tabRegister = $('tab-register');
    el.formLogin = $('form-login');
    el.formRegister = $('form-register');
    el.loginUsername = $('login-username');
    el.loginPassword = $('login-password');
    el.loginError = $('login-error');
    el.loginSubmit = $('login-submit');
    el.regUsername = $('reg-username');
    el.regPassword = $('reg-password');
    el.regConfirm = $('reg-confirm');
    el.regError = $('reg-error');
    el.regSubmit = $('reg-submit');
    el.todayDate = $('today-date');
    el.user = document.querySelector('.user');
    el.userBtn = $('user-btn');
    el.userAvatar = $('user-avatar');
    el.userName = $('user-name');
    el.userMenu = $('user-menu');
    el.logoutBtn = $('logout-btn');
    el.settingsBtn = $('settings-btn');
    el.avatarBtn = $('avatar-btn');
    el.avatarLayer = $('avatar-layer');
    el.avatarClose = $('avatar-close');
    el.avatarPreview = $('avatar-preview');
    el.avatarGroups = $('avatar-groups');
    el.avatarGallery = $('avatar-gallery');
    el.avatarRemove = $('avatar-remove');
    el.avatarHint = $('avatar-hint');
    el.textAvatarBtn = $('avatar-text');
    el.textAvatarLayer = $('text-avatar-layer');
    el.textAvatarClose = $('text-avatar-close');
    el.textAvatarInput = $('text-avatar-input');
    el.textAvatarPreview = $('text-avatar-preview');
    el.textAvatarGradients = $('text-avatar-gradients');
    el.textAvatarSolids = $('text-avatar-solids');
    el.textAvatarOk = $('text-avatar-ok');
    el.textAvatarCancel = $('text-avatar-cancel');
    el.cropLayer = $('crop-layer');
    el.cropStage = $('crop-stage');
    el.cropImg = $('crop-img');
    el.cropZoom = $('crop-zoom');
    el.cropOk = $('crop-ok');
    el.cropCancel = $('crop-cancel');
    el.settingsLayer = $('settings-layer');
    el.settingsClose = $('settings-close');
    el.settingsFoot = $('settings-foot');
    el.ringRow = $('ring-row');
    el.ringValue = $('ring-value');
    el.ringToggle = $('ring-toggle');
    el.ringLayer = $('ring-layer');
    el.ringClose = $('ring-close');
    el.ringList = $('ring-list');
    el.sortLayer = $('sort-layer');
    el.sortClose = $('sort-close');
    el.sortList = $('sort-list');
    el.sortBtnActive = $('sort-btn-active');
    el.sortBtnArchive = $('sort-btn-archive');
    el.guideLayer = $('guide-layer');
    el.guidePager = $('guide-pager');
    el.guideDots = $('guide-dots');
    el.guideSkip = $('guide-skip');
    el.guideNext = $('guide-next');
    el.guidePrev = $('guide-prev');
    el.guideRow = $('guide-row');
    el.textAvatarFonts = $('text-avatar-fonts');
    el.themePick = $('theme-pick');
    el.themeDesc = $('theme-desc');
    el.batteryRow = $('battery-row');
    el.batteryDesc = $('battery-desc');
    el.batteryBtn = $('battery-btn');
    el.autoStartRow = $('autostart-row');
    el.autoStartDesc = $('autostart-desc');
    el.autoStartBtn = $('autostart-btn');
    el.authLayer = $('auth-layer');
    el.authSheetTitle = $('auth-sheet-title');
    el.authSheetSub = $('auth-sheet-sub');
    el.authSheetBody = $('auth-sheet-body');
    el.authSheetActions = $('auth-sheet-actions');
    el.authSheetClose = $('auth-sheet-close');
    el.guestBtn = $('guest-btn');
    el.changePassBtn = $('change-pass-btn');
    el.forgotBtn = $('forgot-btn');
    el.deleteAccountBtn = $('delete-account-btn');
    el.switchBtn = $('switch-btn');
    el.tabTodos = $('tab-todos');
    el.tabArchive = $('tab-archive');
    el.badgeTodos = $('badge-todos');
    el.badgeArchive = $('badge-archive');
    el.panelTodos = $('panel-todos');
    el.panelArchive = $('panel-archive');
    el.archiveAll = $('archive-all');
    el.archiveCount = $('archive-count');
    el.archiveDelete = $('archive-delete');
    el.archiveClear = $('archive-clear');
    el.archiveList = $('archive-list');
    el.archiveEmpty = $('archive-empty');
    el.confirmLayer = $('confirm-layer');
    el.confirmTitle = $('confirm-title');
    el.confirmText = $('confirm-text');
    el.confirmOk = $('confirm-ok');
    el.confirmCancel = $('confirm-cancel');
    el.confirmExtra = $('confirm-extra');
    el.formAdd = $('form-add');
    el.newTodo = $('new-todo');
    el.addBtn = $('add-btn');
    el.voiceBtn = $('voice-btn');
    el.voiceLayer = $('voice-layer');
    el.voiceCancel = $('voice-cancel');
    el.voiceLive = $('voice-live');
    el.voiceWave = $('voice-wave');
    el.voiceTitle = $('voice-title');
    el.voiceSub = $('voice-sub');
    el.voicePh = $('voice-ph');
    el.voiceEdit = $('voice-edit');
    el.voiceTimer = $('voice-timer');
    el.voiceStop = $('voice-stop');
    el.voiceStopLabel = $('voice-stoplabel');
    el.voiceHint = $('voice-hint');
    el.voiceToMemo = $('voice-to-memo');
    el.voiceToTodo = $('voice-to-todo');
    el.voiceExport = $('voice-export');
    el.voiceDictate = $('voice-dictate');
    el.voiceBadge = $('voice-badge');
    el.voiceDictateKey = $('voice-dictate-key');
    el.voiceDictateKeyInput = $('voice-dictate-key-input');
    el.voiceDictateKeySave = $('voice-dictate-key-save');
    el.voiceDictType = $('voice-dict-type');
    el.voiceDictTypeInput = $('voice-dict-type-input');
    el.voiceDictTypeAdd = $('voice-dict-type-add');
    el.voiceMore = $('voice-more');
    el.assistantLayer = $('assistant-layer');
    el.assistantLog = $('assistant-log');
    el.assistantQuick = $('assistant-quick');
    el.assistantForm = $('assistant-form');
    el.assistantInput = $('assistant-input');
    el.assistantMic = $('assistant-mic');
    el.assistantSend = $('assistant-send');
    el.assistantClose = $('assistant-close');
    el.assistantModel = $('assistant-model');
    el.assistantModelName = $('assistant-model-name');
    el.voiceEnginePick = $('voice-engine-pick');
    el.voiceTodoPick = $('voice-todo-pick');
    el.voiceNames = $('voice-names');
    el.saveVoiceNames = $('save-voice-names');
    el.voiceNamesFile = $('voice-names-file');
    el.voiceTodoDesc = $('voice-todo-desc');
    el.voiceMemoPick = $('voice-memo-pick');
    el.voiceMemoDesc = $('voice-memo-desc');
    el.voiceEngineDesc = $('voice-engine-desc');
    el.llmConfig = $('llm-config');
    el.llmStatus = $('llm-status');
    el.llmStatusRefresh = $('llm-status-refresh');
    el.llmRoutePick = $('llm-route-pick');
    el.llmRouteDesc = $('llm-route-desc');
    el.llmModelList = $('llm-model-list');
    el.llmModelAdd = $('llm-model-add');
    el.llmCompareOpen = $('llm-compare-open');

    /* 模型档案编辑弹层 */
    el.modelLayer = $('model-layer');
    el.modelSheetTitle = $('model-sheet-title');
    el.modelPresets = $('model-presets');
    el.modelName = $('model-name');
    el.modelEndpoint = $('model-endpoint');
    el.modelId = $('model-id');
    el.modelChips = $('model-chips');
    el.modelHint = $('model-hint');
    el.catalogVer = $('catalog-ver');
    el.catalogMeta = $('catalog-meta');
    el.catalogBar = $('catalog-bar');
    el.catalogFill = $('catalog-fill');
    el.catalogCheck = $('catalog-check');
    el.catalogInstall = $('catalog-install');
    el.catalogRollback = $('catalog-rollback');
    el.catalogLog = $('catalog-log');
    el.aiUsageBadge = $('ai-usage-badge');
    el.aiUsageMeta = $('ai-usage-meta');
    el.aiUsageBar = $('ai-usage-bar');
    el.aiUsageFill = $('ai-usage-fill');
    el.aiBudgetBtn = $('ai-budget-btn');
    el.aiUsageClear = $('ai-usage-clear');
    el.aiUsageLog = $('ai-usage-log');
    el.aiMaskToggle = $('ai-mask-toggle');
    el.aiMaskDesc = $('ai-mask-desc');
    el.modelKey = $('model-key');
    el.modelKeyEye = $('model-key-eye');
    el.modelCaps = $('model-caps');
    el.modelProbeBtn = $('model-probe');
    el.modelProbeResult = $('model-probe-result');
    el.modelSave = $('model-save');
    el.modelCancel = $('model-cancel');
    el.modelClose = $('model-close');

    /* 模型对比弹层 */
    el.compareLayer = $('compare-layer');
    el.compareTasks = $('compare-tasks');
    el.compareTaskDesc = $('compare-task-desc');
    el.compareInput = $('compare-input');
    el.compareSample = $('compare-sample');
    el.compareAuto = $('compare-auto');
    el.compareAutoHint = $('compare-auto-hint');
    el.compareModels = $('compare-models');
    el.compareRun = $('compare-run');
    el.compareResults = $('compare-results');
    el.compareStatus = $('compare-status');
    el.compareClose = $('compare-close');
    el.addTimeField = $('add-timefield');
    el.timeChip = $('time-chip');
    el.timeChipText = $('time-chip-text');
    el.timeClear = $('time-clear');
    el.timePopLayer = $('time-pop-layer');
    el.timePop = $('time-pop');
    el.timePopPresets = $('time-pop-presets');
    el.timePopDateBtn = $('time-pop-date-btn');
    el.timePopDateText = $('time-pop-date-text');
    el.timePopHourBtn = $('time-pop-hour-btn');
    el.timePopHourText = $('time-pop-hour-text');
    el.timePopMinuteBtn = $('time-pop-minute-btn');
    el.timePopMinuteText = $('time-pop-minute-text');
    el.timePopList = $('time-pop-list');
    el.timePopClock = $('time-pop-clock');
    el.timePopSlots = $('time-pop-slots');
    el.timePopSlotNote = $('time-pop-slotnote');
    el.timePopError = $('time-pop-error');
    el.timePopOk = $('time-pop-ok');
    el.timePopCancel = $('time-pop-cancel');
    el.timePopClose = $('time-pop-close');
    el.addHint = $('add-hint');
    el.addTimeSuggestions = $('add-time-suggestions');
    el.addDigitFix = $('add-digit-fix');
    el.addDigitRaw = $('add-digit-raw');
    el.addDigitAdopt = $('add-digit-adopt');
    el.addDigitUndo = $('add-digit-undo');
    el.addDigitDismiss = $('add-digit-dismiss');
    el.addTimeOptions = $('add-time-options');
    el.addTimeDismiss = $('add-time-dismiss');
    el.addTimeCustom = $('add-time-custom');
    el.summaryText = $('summary-text');
    el.clearDone = $('clear-done');
    el.todoList = $('todo-list');
    el.emptyState = $('empty-state');
    el.emptyTitle = $('empty-title');
    el.emptyText = $('empty-text');
    el.reminderLayer = $('reminder-layer');
    el.toast = $('toast');

    /* 附件与手绘 */
    el.drawBtn = $('draw-btn');
    el.editAttachBar = $('edit-attach-bar');
    el.editAttachList = $('edit-attach-list');
    el.attachSrcLayer = $('attach-src-layer');
    el.attachSrcCancel = $('attach-src-cancel');
    el.scanLayer = $('scan-layer');
    el.scanImg = $('scan-img');
    el.scanLoading = $('scan-loading');
    el.scanQuadTag = $('scan-quadtag');
    el.scanModes = $('scan-modes');
    el.scanRetake = $('scan-retake');
    el.scanSave = $('scan-save');
    el.scanOcr = $('scan-ocr');
    el.scanOcrCopy = $('scan-ocr-copy');
    el.scanOcrText = $('scan-ocr-text');
    el.previewStt = $('attach-preview-stt');
    el.previewOcr = $('attach-preview-ocr');
    el.previewOcrText = $('attach-preview-ocrtext');
    el.previewOcrCopy = $('attach-preview-copy');
    el.audioRecBar = $('audio-rec-bar');
    el.audioRecStop = $('audio-rec-stop');
    el.drawLayer = $('draw-layer');
    el.drawStage = $('draw-stage');
    el.drawCanvas = $('draw-canvas');
    el.drawColors = $('draw-colors');
    el.drawSizes = $('draw-sizes');
    el.drawUndo = $('draw-undo');
    el.drawClear = $('draw-clear');
    el.drawCancel = $('draw-cancel');
    el.drawDone = $('draw-done');
    el.attachPreviewLayer = $('attach-preview-layer');
    el.attachPreviewImg = $('attach-preview-img');
    el.attachPreviewLabel = $('attach-preview-label');
    el.attachPreviewClose = $('attach-preview-close');
  }

  /* ============================================================ 笔记（M1）

     待办不再限长（长内容在列表里折叠展示），而「摘要 / 提取待办」这些
     能力必须有正文才谈得上。所以这一层做三件事：

       1. 笔记的增删改查；列表与详情两屏，详情里直接改，停手 450ms 自动落盘
       2. AI 结果（摘要 / 待办草稿）写进 DerivedStore 并带指纹，
          正文一改就标「可能已过期」，而不是悄悄留着一份过时结论
       3. 草稿必须逐条勾选、点「创建」才变成待办 —— 模型不能直接写业务数据

     判断「这段正文能不能发出去」统一走 ConsentPolicy，位置在调模型之前。
     ========================================================================== */

  var MEMO_SAVE_DELAY = 450;
  var memoUi = { id: '', timer: 0, busy: false, searchTimer: 0 };
  var draftUi = { items: [], memoId: '' };

  function memoUser() {
    return state.user ? String(state.user.key || state.user.name || '') : '';
  }

  function memoOf(id) {
    if (!global.MemoService || !id) return null;
    return global.MemoService.get(memoUser(), id);
  }

  /** 今天 09:12 / 昨天 21:40 / 10月8日 */
  function memoStampOf(timestamp) {
    if (!timestamp) return '';
    var target = new Date(timestamp);
    var now = new Date();
    var clock = pad2(target.getHours()) + ':' + pad2(target.getMinutes());
    var yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (sameDay(target, now)) return '今天 ' + clock;
    if (sameDay(target, yesterday)) return '昨天 ' + clock;
    var monthDay = (target.getMonth() + 1) + '月' + target.getDate() + '日';
    if (target.getFullYear() === now.getFullYear()) return monthDay;
    return target.getFullYear() + '年' + monthDay;
  }

  function setMemoHint(text, tone) {
    if (!el.memoHint) return;
    el.memoHint.textContent = text || '';
    el.memoHint.setAttribute('data-tone', tone || '');
  }

  function setMemoStat(text, tone) {
    if (!el.memoStat) return;
    el.memoStat.textContent = text || '';
    el.memoStat.setAttribute('data-tone', tone || '');
  }

  function renderMemoBadge(count) {
    if (!el.badgeMemos) return;
    var n = typeof count === 'number' ? count : (global.MemoService ? global.MemoService.list(memoUser()).length : 0);
    el.badgeMemos.textContent = String(n);
    show(el.badgeMemos, n > 0);
  }

  /** 一条笔记的 AI 状态标签：有摘要 / 有草稿 / 已过期 */
  function memoTagOf(memo) {
    var derived = global.DerivedStore;
    if (!derived) return null;
    var summary = derived.get(memoUser(), memo.id, 'summary', memoFingerprint(memo));
    if (!summary) return null;
    if (summary.status === 'stale') return { text: '摘要过期', stale: true };
    return { text: '有摘要', stale: false };
  }

  /** 已采纳的标签（用户点过「采用」的才有资格上列表） */
  function adoptedTagsOf(memo) {
    var derived = global.DerivedStore;
    if (!derived || !memo) return [];
    var rec = derived.get(memoUser(), memo.id, 'tags');
    var tags = rec && rec.payload && rec.payload.tags;
    return Object.prototype.toString.call(tags) === '[object Array]' ? tags.slice(0, 3) : [];
  }

  /**
   * 衍生数据的新鲜度指纹。
   * modelId 不参与比较：换个模型重跑不该让所有旧摘要在界面上齐刷刷变红，
   * 卡片上会标出「由哪个模型生成」，需要重跑时用户自己点。
   */
  function memoFingerprint(memo) {
    var registry = global.AiTaskRegistry;
    return {
      memoRev: memo ? memo.rev : 0,
      promptVer: registry ? registry.PROMPT_VER : '',
      schemaVer: registry ? registry.SCHEMA_VER : 0
    };
  }

  function renderMemoList() {
    if (!el.memoList || !global.MemoService) return;
    var seq = (memoUi.searchSeq || 0) + 1;
    memoUi.searchSeq = seq;
    var searchOwner=memoUser();
    var query = el.memoSearch ? String(el.memoSearch.value || '') : '';
    if (!query.trim()) { paintMemoList(global.MemoService.list(memoUser()), ''); return; }

    /* 混合检索：字面先出，AI 扩词回来再补一轮；没有检索层就退回字面搜索 */
    var svc = global.SearchService;
    if (!svc || typeof svc.hybrid !== 'function') {
      paintMemoList(global.MemoService.search(memoUser(), query), query);
      return;
    }
    svc.hybrid(memoUser(), query, function (res) {
      if (memoUi.searchSeq !== seq || memoUser()!==searchOwner || String(el.memoSearch.value || '')!==query) return;
      paintMemoList((res && res.items) || [], query, res && res.via, res && res.final);
    });
  }

  function paintMemoList(list, query, via, final) {
    el.memoList.textContent = '';
    for (var i = 0; i < list.length; i++) {
      el.memoList.appendChild(memoItemNode(list[i]));
    }

    var none = list.length === 0;
    if (el.memoEmpty) {
      show(el.memoEmpty, none);
      if (none) {
        var searching = !!query.trim();
        if (el.memoEmptyTitle) {
          el.memoEmptyTitle.textContent = searching ? '没有匹配的笔记' : '还没有笔记';
        }
        if (el.memoEmptyText) {
          el.memoEmptyText.textContent = !searching
            ? '点右上角「记一条」，长内容也有地方放了'
            : (final ? '换个词试试，或点「问」让 AI 在笔记里找' : '正在扩大范围找…');
        }
      }
    }
    renderMemoBadge(query ? -1 : list.length);
  }

  function memoItemNode(memo) {
    var li = document.createElement('li');
    li.className = 'memo';
    li.setAttribute('data-id', memo.id);

    var main = document.createElement('button');
    main.type = 'button';
    main.className = 'memo__main';
    main.setAttribute('data-act', 'open');

    var title = document.createElement('span');
    title.className = 'memo__title';
    title.textContent = memo.title || '未命名笔记';
    main.appendChild(title);

    var preview = global.MemoService.previewOf(memo, 64);
    if (preview) {
      var pre = document.createElement('span');
      pre.className = 'memo__pre';
      pre.textContent = preview;
      main.appendChild(pre);
    }

    var meta = document.createElement('span');
    meta.className = 'memo__meta';
    var when = document.createElement('span');
    when.textContent = memoStampOf(memo.updatedAt);
    meta.appendChild(when);
    var chars = document.createElement('span');
    chars.textContent = (memo.body || '').length + ' 字';
    meta.appendChild(chars);
    /* 已采纳的 AI 标签排在最前——这是 M2 里「记得的方式」之一 */
    var adopted = adoptedTagsOf(memo);
    for (var t = adopted.length - 1; t >= 0; t--) {
      var tagChip = document.createElement('span');
      tagChip.className = 'memo__tag';
      tagChip.textContent = '#' + adopted[t];
      meta.appendChild(tagChip);
    }
    var tag = memoTagOf(memo);
    if (tag) {
      var chip = document.createElement('span');
      chip.className = 'memo__tag' + (tag.stale ? ' memo__tag--stale' : '');
      chip.textContent = tag.text;
      meta.appendChild(chip);
    }
    main.appendChild(meta);
    li.appendChild(main);

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'memo__del';
    del.setAttribute('data-act', 'del');
    del.setAttribute('aria-label', '删除这条笔记');
    del.innerHTML = ICON_TRASH;
    li.appendChild(del);

    return li;
  }

  /* --------------------------------------------------------- 详情弹层 */

  function openMemoSheet(id) {
    if (!el.memoLayer) return;
    cancelUiAi('memo');
    clearMemoDigits();
    cancelMemoRewrite();
    memoVoiceCancel(true);
    var memo = id ? memoOf(id) : null;
    memoUi.id = memo ? memo.id : '';
    memoUi.tagSug = [];
    el.memoTitleInput.value = memo ? memo.title : '';
    el.memoBodyInput.value = memo ? memo.body : '';
    if (el.memoStamp) el.memoStamp.textContent = memo ? memoStampOf(memo.updatedAt) : '新建';
    setMemoStat(memo && memo.sourceText ? '正文来自口述，原话已单独留存' : '');
    renderMemoAi();
    renderMemoTags();
    /* M3：改写现场清掉，相关笔记按这篇重算 */
    if (el.memoRwModes) show(el.memoRwModes, false);
    hideRewriteCard();
    renderMemoRelated();
    show(el.memoLayer, true);
    setMemoHint('');
    try { el.memoBodyInput.focus(); } catch (error) { /* 聚焦失败不影响输入 */ }
  }

  function closeMemoSheet() {
    cancelUiAi('memo');
    cancelMemoRewrite();
    memoVoiceCancel(true);   /* 还在听就先收麦，撤掉没定稿的半截字再保存 */
    var saved = memoSaveNow();
    var hasContent = el.memoBodyInput && String(el.memoBodyInput.value || '').trim()
      || el.memoTitleInput && String(el.memoTitleInput.value || '').trim();
    if (!saved && hasContent) {
      setMemoStat('保存失败，正文仍在当前页，请重试或先复制内容', 'bad');
      toast('保存失败，已保留当前页面');
      return;
    }
    show(el.memoLayer, false);
    memoUi.id = '';
  }

  /** 详情弹层是不是开着（保存与 AI 动作都要先确认这一点） */
  function memoSheetOpen() {
    return !!(el.memoLayer && !el.memoLayer.classList.contains('is-hidden'));
  }

  /** 立刻落盘（关弹层、切页、点 AI 之前都先调一次，别丢用户刚敲的字） */
  function memoSaveNow() {
    if (!el.memoBodyInput || !global.MemoService) return null;
    if (memoUi.timer) {
      global.clearTimeout(memoUi.timer);
      memoUi.timer = 0;
    }
    var title = el.memoTitleInput ? el.memoTitleInput.value : '';
    var body = el.memoBodyInput ? el.memoBodyInput.value : '';

    if (!memoUi.id) {
      /* 弹层已经关了就不再新建：关弹层后输入框里还留着上一次的内容，
         若此时任何路径叫到这里，会把同一段话再存成一条重复笔记 */
      if (!memoSheetOpen()) return null;
      if (!String(title).trim() && !String(body).trim()) return null;
      var created = global.MemoService.create(memoUser(), { title: title, body: body });
      if (!created) {
        setMemoStat('保存失败，可能是存储空间不够了', 'bad');
        return null;
      }
      memoUi.id = created.id;
      if (el.memoStamp) el.memoStamp.textContent = '刚刚';
      renderMemoList();
      return created;
    }

    var before = memoOf(memoUi.id);
    var updated = global.MemoService.update(memoUser(), memoUi.id, { title: title, body: body });
    if (!updated) {
      setMemoStat('保存失败，正文仍在当前页，请重试或先复制内容', 'bad');
      return null;
    }
    /* rev 变了说明正文真改过：把旧的摘要/草稿标记为过期，别让用户看着旧结论 */
    if (before && updated.rev !== before.rev) {
      if (global.DerivedStore) global.DerivedStore.markStale(memoUser(), memoUi.id);
      if (el.memoStamp) el.memoStamp.textContent = '刚刚';
      renderMemoList();
      renderMemoAi();
    }
    return updated;
  }

  function scheduleMemoSave() {
    if (memoUi.timer) global.clearTimeout(memoUi.timer);
    memoUi.timer = global.setTimeout(function () {
      memoUi.timer = 0;
      memoSaveNow();
    }, MEMO_SAVE_DELAY);
  }

  function memoWordCount() {
    var body = el.memoBodyInput ? String(el.memoBodyInput.value || '') : '';
    var chars = body.replace(/\s/g, '').length;
    setMemoStat(chars ? chars + ' 字 · 停手后自动保存' : '写了就自动保存');
  }

  /* --------------------------------------------------------- 语音输入

     复用整屏语音那套内嵌识别器（TodoNative.startVoiceListening），
     用 voiceOwner 把 VoiceHost 回调分发给笔记这边。识别文字实时插进
     正文光标处：partial 是暂挂的半截字，result 到了才覆盖成定稿。 */
  var memoDigits = null;

  function normalizeVoiceNames(value) {
    if (typeof value !== 'string') return '';
    var names = value.split(/[、，,；;\s]+/).filter(function(name) {
      return /^[\u3400-\u9fff]{2,4}$/.test(name);
    });
    return Array.from(new Set(names)).slice(0, 2000).join('、');
  }

  function restoreVoiceNames(text) {
    var pinyin = global.TodoNamePinyin;
    if (!pinyin) return text;
    var libraryNames = state.user && global.MessageWorkbench
      ? global.MessageWorkbench.names(Store, state.user.key) : '';
    var configured = normalizeVoiceNames([prefs.voiceNames || '', libraryNames].join('、'));
    if (!configured) return text;
    function key(name) {
      var syllables = Array.from(name,function(ch){return pinyin[ch];});
      return syllables.every(Boolean) ? syllables.join('/') : '';
    }
    var names = Object.create(null);
    configured.split('、').forEach(function(name) {
      var sound = key(name);
      if (sound) names[sound] = Object.prototype.hasOwnProperty.call(names,sound) ? null : name;
    });
    return text.replace(/(联系|通知|拜访|会见|跟|根|和|与|给|请|找|接|叫)([\u3400-\u9fff]{2,4}?)(?=\s*(?:一起|开会|见面|交接|汇报|签字|沟通|吃饭|发邮件|发消息|发微信|打电话|拿材料|取材料|[，。！？、；,.!?;]|$))/g,
      function(match, cue, heard) {
        var name = names[key(heard)];
        return name ? (cue === '根' ? '跟' : cue) + name : match;
      });
  }

  // In the recording panel a long sequence with callsigns is a spoken number.
  // Keep short homophones and ordinary speech editable without guessing.
  function isRadioNumberRun(text) {
    return /^[0-9零〇洞动動一幺么二两兩三四五六七拐八九勾沟溝钩鉤\s]+$/.test(text)
      && text.replace(/\s/g,'').length >= 4 && /[幺拐洞]/.test(text);
  }

  function panelSpokenText(raw) {
    var text = restoreVoiceNames(String(raw)).replace(/山东(?:省)?(?:合则|荷泽|菏則|菏澤)/g, function(place) {
      return place.indexOf('省') >= 0 ? '山东省菏泽' : '山东菏泽';
    });
    compactClocks(text).reverse().forEach(function(clock) {
      if (clock.labelled && !clock.invalid) {
        text = text.slice(0, clock.digitStart) + pad2(clock.hour) + ':' + pad2(clock.minute) + text.slice(clock.e);
      }
    });
    return text.split(/([，。！？、；,.!?;\n]+)/).map(function(part) {
      var number = spokenNumericClause(part);
      return number.candidate && isRadioNumberRun(part) ? number.candidate : number.text;
    }).join('');
  }

  // Normalize standalone numeric clauses; ordinary clauses stay untouched.
  function spokenDigitCandidate(raw) {
    var ambiguous = false, text = [], candidate = [];
    String(raw).split(/([，。！？、；,.!?;]+)/).forEach(function(part){
      var result = spokenNumericClause(part);
      text.push(result.text); candidate.push(result.candidate || result.text);
      if (result.candidate) ambiguous = true;
    });
    return {text:text.join(''),candidate:ambiguous ? candidate.join('') : null};
  }
  function spokenNumericClause(raw) {
    // R8 can produce traditional characters and spaces between spoken digits.
    // A number label gives even a single homophone an explicit numeric context.
    var labelled = /^(.*(?:手机号码|手机号|电话号码|号码|编号|验证码|尾号|数字)(?:为|是)?[：:\s]*)([0-9零〇洞动動一幺么二两兩三四五六七拐八九勾钩鉤沟溝]+(?:[ \t]+[0-9零〇洞动動一幺么二两兩三四五六七拐八九勾钩鉤沟溝]+)*)(\s*)$/.exec(raw);
    var radio = {'洞':'0','动':'0','動':'0','零':'0','〇':'0','一':'1','幺':'1','么':'1','二':'2','两':'2','兩':'2','三':'3','四':'4','五':'5','六':'6','七':'7','拐':'7','八':'8','九':'9','勾':'9','沟':'9','溝':'9','钩':'9','鉤':'9'};
    function digits(value) { return value.replace(/[ \t]/g,'').replace(/[^0-9]/g,function(ch){return radio[ch];}); }
    if (labelled) return {text:labelled[1]+digits(labelled[2])+labelled[3]};
    var only = /^(\s*)([0-9零〇洞动動一幺么二两兩三四五六七拐八九勾钩鉤沟溝]+(?:[ \t]+[0-9零〇洞动動一幺么二两兩三四五六七拐八九勾钩鉤沟溝]+)*?)(\s*)$/.exec(raw);
    if (only) {
      var number = only[1]+digits(only[2])+only[3];
      if (/[动動沟溝钩鉤么]/.test(only[2]) || /^(?:拐|勾|洞|两|兩)$/.test(only[2])) return {text:raw,candidate:number};
      if (digits(only[2]).length >= 3 || /[幺拐勾洞]/.test(only[2]) || only[2].length === 1) return {text:number};
    }
    var map = { '零':'0', '〇':'0', '洞':'0', '一':'1', '幺':'1', '二':'2', '两':'2',
      '三':'3', '四':'4', '五':'5', '六':'6', '七':'7', '拐':'7', '八':'8', '九':'9', '勾':'9' };
    var guess = { '腰':'1', '有':'1', '动':'0', '沟':'9' };
    var chunks = String(raw).split(/([，。！？、；,.!?;\s]+|和)/);
    var safe = [], proposed = [], ambiguous = false, seen = false;
    for (var i = 0; i < chunks.length; i++) {
      var token = chunks[i];
      if (!token || /^[，。！？、；,.!?;\s]+$/.test(token) || token === '和') {
        safe.push(token); proposed.push(token); continue;
      }
      if (!/^[0-9零〇洞动一幺二两三四五六七拐八九勾沟腰有十百千万亿]+$/.test(token)) return {text:raw};
      var isGuess = /[腰有动沟]/.test(token);
      var hasUnits = /[十百千万亿]/.test(token);
      if ((!hasUnits && token.length < 3) || (isGuess && (hasUnits || token.length < 4 || token.replace(/[腰有动沟]/g,'').length < 3))) return {text:raw};
      var converted;
      if (hasUnits) {
        // Reject malformed mixed styles rather than inventing a value.
        if (/[0-9幺洞拐勾]/.test(token) || /[百千万亿][一二两三四五六七八九]$/.test(token)) return {text:raw};
        var total = 0, section = 0, digit = 0, lastUnit = 10000, lastBigUnit = Infinity, previousDigit = false;
        for (var j = 0; j < token.length; j++) {
          var ch = token.charAt(j);
          if (map[ch] !== undefined) {
            if (previousDigit && digit !== 0) return {text:raw};
            digit = Number(map[ch]); previousDigit = true;
          } else {
            var unit = { '十':10,'百':100,'千':1000,'万':10000,'亿':100000000 }[ch];
            if (unit < 10000) {
              if (unit >= lastUnit || (!previousDigit && ch !== '十')) return {text:raw};
              section += (previousDigit ? digit : 1) * unit; lastUnit = unit;
            } else {
              if (unit >= lastBigUnit) return {text:raw};
              lastBigUnit = unit;
              section += digit;
              if (!section) return {text:raw};
              if (unit === 100000000) {total = (total + section) * unit; section = 0;}
              else section *= unit;
              lastUnit = 10000;
            }
            digit = 0; previousDigit = false;
          }
        }
        converted = String(total + section + digit);
      } else converted = token.replace(/[零〇洞动一幺二两三四五六七拐八九勾沟腰有]/g,function (ch) {return map[ch] || guess[ch];});
      seen = true;
      safe.push(isGuess ? token : converted); proposed.push(converted);
      if (isGuess) ambiguous = true;
    }
    return seen ? {text:safe.join(''), candidate:ambiguous ? proposed.join('') : null} : {text:raw};
  }

  function clearMemoDigits() { memoDigits = null; paintMemoDigits(); }
  function paintMemoDigits() {
    if (!el.memoDigitFix) return;
    show(el.memoDigitFix, !!memoDigits);
    if (!memoDigits) return;
    el.memoDigitRaw.textContent = '识别原文：' + memoDigits.patches.map(function(p){return p.raw;}).join(' ');
    el.memoDigitAdopt.textContent = '按数字采用：' + memoDigits.patches.map(function(p){return p.value;}).join(' ');
    el.memoDigitAdopt.disabled = memoVoice && memoVoice.state !== 'idle';
    show(el.memoDigitAdopt, !memoDigits.applied);
    show(el.memoDigitUndo, !!memoDigits.applied);
  }
  function adoptMemoDigits(undo) {
    var d = memoDigits, ta = el.memoBodyInput;
    if (!d || !ta || !memoSheetOpen() || memoVoice.state !== 'idle') return;
    if (d.owner !== memoUser() || d.id !== memoUi.id || ta.value !== d.before) {
      clearMemoDigits(); setMemoStat('正文已改变，请重新核对数字', 'bad'); return;
    }
    var before = ta.value, next = before;
    if (undo) next = d.original;
    else {
      d.patches.slice().sort(function(a,b){return b.start-a.start;}).forEach(function(p){
        next = next.slice(0,p.start) + p.value + next.slice(p.start+p.raw.length);
      });
    }
    ta.value = next; d.before = next;
    ta.dispatchEvent(new global.Event('input', {bubbles:true}));
    if (!memoSaveNow()) {
      ta.value = before; d.before = before;
      ta.dispatchEvent(new global.Event('input', {bubbles:true}));
      setMemoStat('数字保存失败，已恢复原文，可重试', 'bad'); return;
    }
    memoVoice.base = next;
    if (undo) clearMemoDigits();
    else {d.original = before; d.applied = true; paintMemoDigits();}
    setMemoStat(undo ? '已恢复识别原文并保存' : '已按核对后的数字替换并保存；可恢复识别原文', 'ok');
    toast(undo ? '识别原文已恢复' : '数字已替换并保存');
  }

  var memoVoice = {
    state: 'idle', base: '', pos: 0, glue: '', live: '', timer: null,
    /* 停顿闸门：与整屏语音同一套口径（VOICE_SILENCE_MS）。
       gated = 引擎自断过一次、这段已收进正文，正等「接着说或到点收稿」 */
    silence: null, gated: false, wrote: false,
    lastVoiceAt: 0, restarts: 0, lastRestartAt: 0, lastFailAt: 0,
    /* 联网引擎「5 秒无结果就报网络超时」的自动换气次数：
       连续听写数分钟后小米服务会开始抽风，不重试就是用户看到的「网络错误」 */
    netRetries: 0
  };

  function clearMemoVoiceSilence() {
    if (memoVoice.silence) {
      global.clearTimeout(memoVoice.silence);
      memoVoice.silence = null;
    }
  }

  function memoVoiceApi() {
    var api = global.TodoNative;
    return api && typeof api.startVoiceListening === 'function' ? api : null;
  }

  /** 边界字符都是英文数字时补个空格；中文之间不补 */
  function memoVoiceGlue(head, tail) {
    var a = head ? head.charAt(head.length - 1) : '';
    var b = tail ? tail.charAt(0) : '';
    var word = /[A-Za-z0-9]/;
    return word.test(a) && word.test(b) ? ' ' : '';
  }

  function memoVoicePaint() {
    paintMemoDigits();
    if (!el.memoVoice) return;
    el.memoVoice.setAttribute('data-state', memoVoice.state);
    var label = { idle: '语音', listening: '停止', stopping: '识别中' }[memoVoice.state] || '语音';
    if (el.memoVoiceLabel) el.memoVoiceLabel.textContent = label;
    el.memoVoice.setAttribute('aria-label',
      memoVoice.state === 'listening' ? '结束录音，把说的话写进笔记' : '语音输入');
  }

  /** 把一段识别文字落到光标处；base/pos 是这一轮的锚点，partial 反复覆盖 */
  function memoVoicePaintText(text) {
    var ta = el.memoBodyInput;
    if (!ta) return;
    var head = memoVoice.base.slice(0, memoVoice.pos);
    var tail = memoVoice.base.slice(memoVoice.pos);
    var next = head + memoVoice.glue + text + tail;
    if (next === ta.value) return;
    ta.value = next;
    var caret = (head + memoVoice.glue + text).length;
    try { ta.setSelectionRange(caret, caret); } catch (error) { /* 光标放不进就算了 */ }
    memoVoice.live = text;
  }

  function memoVoiceReset(message, tone) {
    clearMemoVoiceSilence();
    if (memoVoice.timer) {
      global.clearTimeout(memoVoice.timer);
      memoVoice.timer = null;
    }
    memoVoice.state = 'idle';
    memoVoice.gated = false;
    memoVoice.wrote = false;
    memoVoice.lastVoiceAt = 0;
    memoVoice.restarts = 0;
    memoVoice.netRetries = 0;
    voiceOwner = 'panel';
    memoVoice.live = '';
    memoVoicePaint();
    if (message) setMemoStat(message, tone);
    else memoWordCount();
    if (memoDigits && !memoDigits.applied && el.memoDigitFix) global.requestAnimationFrame(function () {
      if (memoDigits && memoVoice.state === 'idle' && memoSheetOpen()) el.memoDigitFix.scrollIntoView({block:'nearest'});
    });
  }

  /** 收麦、撤掉没定稿的半截字。关弹层/切笔记前都会先叫这个 */
  function memoVoiceCancel(quiet) {
    if (memoDict.active) {
      memoDictCancel();
      return;
    }
    var active = memoVoice.state === 'listening' || memoVoice.state === 'stopping';
    if (active) {
      var api = memoVoiceApi();
      if (api && typeof api.cancelVoiceListening === 'function') {
        try { api.cancelVoiceListening(); } catch (error) { /* 原生那边自己兜底 */ }
      }
    }
    if (memoVoice.live && el.memoBodyInput) el.memoBodyInput.value = memoVoice.base;
    memoVoiceReset();
  }

  /** 手动「停止」：进 stopping 等最终稿，4 秒憋不出就兜底 */
  function memoVoiceWait() {
    if (memoVoice.state !== 'listening') return;
    clearMemoVoiceSilence();
    memoVoice.gated = false;
    memoVoice.state = 'stopping';
    memoVoicePaint();
    setMemoStat('正在识别…');
    var api = memoVoiceApi();
    if (api && typeof api.stopVoiceListening === 'function') {
      try { api.stopVoiceListening(); } catch (error) { /* 结果回调会兜底 */ }
    }
    if (memoVoice.timer) global.clearTimeout(memoVoice.timer);
    memoVoice.timer = global.setTimeout(function () {
      memoVoice.timer = null;
      if (memoVoice.state !== 'stopping') return;
      if (memoVoice.live) memoVoiceEvent('result', memoVoice.live);
      else if (memoVoice.wrote) memoVoiceFinish();   /* 说过话但引擎没回稿：收下已写入的 */
      else memoVoiceEvent('failed', '这次没识别出来，直接打字也一样');
    }, 4000);
  }

  /** 收下一段定稿：画进正文、锚点挪到这段末尾，下一轮从这里接着写 */
  function memoVoiceAbsorb(text) {
    memoVoicePaintText(text);
    memoVoice.wrote = true;
    memoVoice.lastVoiceAt = Date.now();   /* 定稿本身就是确凿人声 */
    memoVoice.restarts = 0;
    memoVoice.netRetries = 0;
    memoVoice.gated = false;
    var ta = el.memoBodyInput;
    if (!ta) return;
    memoVoice.base = String(ta.value || '');
    var caret = memoVoice.base.length;
    try { caret = ta.selectionStart; } catch (error) { /* 拿不到就用末尾 */ }
    if (typeof caret !== 'number' || caret < 0 || caret > memoVoice.base.length) caret = memoVoice.base.length;
    memoVoice.pos = caret;
    memoVoice.glue = memoVoiceGlue(memoVoice.base.slice(0, caret), memoVoice.base.slice(caret));
    memoVoice.live = '';
  }

  /** 收稿：正文提交给自动保存，回空闲态；引擎还开着就顺手关掉 */
  function memoVoiceFinish() {
    voiceLog('memo-finish', 'wrote=' + memoVoice.wrote);
    clearMemoVoiceSilence();
    var active = memoVoice.state === 'listening' || memoVoice.state === 'stopping';
    if (active) {
      var api = memoVoiceApi();
      if (api && typeof api.cancelVoiceListening === 'function') {
        try { api.cancelVoiceListening(); } catch (error) { /* 原生那边自己兜底 */ }
      }
      if (memoVoice.wrote) {
        if (el.memoBodyInput) el.memoBodyInput.dispatchEvent(
          new global.Event('input', { bubbles: true }));
        toast('已写入笔记');
      }
    }
    memoVoiceReset();
  }

  /** 重开麦接着收（与面板侧同款限流：1200ms 内不重开，引擎真死除外） */
  function memoVoiceRestart() {
    var api = memoVoiceApi();
    var now = Date.now();
    var gap = now - memoVoice.lastRestartAt;
    var engineDied = memoVoice.lastFailAt > memoVoice.lastRestartAt && gap > 300;
    if (gap < VOICE_RESTART_GAP_MS && !engineDied) return;   /* 闸门计时器到点自动收稿 */
    if (api) {
      memoVoice.restarts += 1;
      memoVoice.lastRestartAt = now;
      try { if (api.startVoiceListening() !== false) return; } catch (error) { /* 落到兜底 */ }
    }
    memoVoiceFinish();   /* 重开失败：别让人干等，收下已写入的 */
  }

  /** 引擎停顿自断进来：静音满 5 秒才收稿，没满就重开麦接着收 */
  function armMemoVoiceSegment() {
    clearMemoVoiceSilence();
    if (memoVoice.state !== 'listening') return;
    var wait = VOICE_SILENCE_MS - (Date.now() - memoVoice.lastVoiceAt);
    if (wait <= 0 || memoVoice.restarts >= 4) {
      voiceLog('memo-gate-now', 'wait=' + Math.round(wait) + ' restarts=' + memoVoice.restarts);
      memoVoiceFinish();
      return;
    }
    voiceLog('memo-gate-arm', 'wait=' + Math.round(wait) + ' restarts=' + memoVoice.restarts);
    memoVoice.gated = true;
    setMemoStat('停顿中，接着说或等几秒自动整理');
    memoVoice.silence = global.setTimeout(function () {
      memoVoice.silence = null;
      if (memoVoice.state === 'listening') memoVoiceFinish();
    }, wait);
    memoVoiceRestart();
  }

  /** 原生回调的中转站：voiceOwner === 'memo' 时 VoiceHost 全走这里 */
  function memoVoiceEvent(name, a) {
    if (!memoSheetOpen()) { memoVoiceCancel(true); return; }
    switch (name) {
      case 'ready':
        if (memoVoice.state === 'listening') setMemoStat('我在听，请说…');
        break;
      case 'partial': {
        if (memoVoice.state !== 'listening') return;
        var t = String(a == null ? '' : a).trim();
        if (!t) return;
        /* 吐了字就是确凿人声：停顿重新起算，闸门重挂 */
        memoVoice.lastVoiceAt = Date.now();
        memoVoice.restarts = 0;
        memoVoice.netRetries = 0;   /* 引擎回血了，换气次数清零 */
        memoVoice.gated = false;
        memoVoicePaintText(t);
        break;
      }
      case 'speechEnd':
        /* 引擎自断 ≈ 2 秒，不等于用户说完了：有人声就按 5 秒口径续听 */
        if (memoVoice.state === 'listening' && memoVoice.lastVoiceAt) {
          armMemoVoiceSegment();
        } else if (memoVoice.state === 'listening') {
          memoVoiceWait();   /* 一个字都没有：按老流程等定稿/兜底 */
        }
        break;
      case 'result': {
        var wasStopping = memoVoice.state === 'stopping';
        if (!wasStopping && memoVoice.state !== 'listening') return;
        var text = String(a == null ? '' : a).replace(/\s+/g, ' ').trim();
        if (text) memoVoiceAbsorb(restoreVoiceNames(text));
        if (wasStopping) { memoVoiceFinish(); break; }
        armMemoVoiceSegment();   /* 听着的时候送来定稿 = 引擎自断的这一段 */
        break;
      }
      case 'cancelled':
        memoVoiceCancel(true);
        break;
      case 'failed': {
        memoVoice.lastFailAt = Date.now();
        if (memoVoice.state === 'listening') {
          var keep = memoVoice.live;
          var sawVoice = !!memoVoice.lastVoiceAt;
          /* 窗口要在收字之前判：absorb 会把人声时刻刷新成当下 */
          var windowLeft = VOICE_SILENCE_MS - (Date.now() - memoVoice.lastVoiceAt);
          var canContinue = (sawVoice || keep) && windowLeft > 0 && memoVoice.restarts < 4;
          /* 小米联网引擎对「5 秒无识别结果」直接报网络超时（真机实测 error 1，
             连续听写数分钟后尤其频繁）：这种错误不吞话也不收场，
             自动换气重开麦，用户只感到轻微一顿。 */
          if (!canContinue && /网络|没响应/.test(String(a || '')) && memoVoice.netRetries < 3) {
            memoVoice.netRetries += 1;
            memoVoice.gated = false;
            voiceLog('memo-net-retry', 'n=' + memoVoice.netRetries + ' keep=' + keep);
            if (keep) memoVoiceAbsorb(keep);   /* 半截话先收进正文 */
            setMemoStat('网络抖了一下，换口气接着听…', '');
            memoVoiceRestart();
            break;
          }
          if (keep) memoVoiceAbsorb(keep);   /* 半截话先收进正文，报错不能吞话 */
          if (canContinue) {
            armMemoVoiceSegment();   /* 引擎抽风：续听，别把正要说的话掐了 */
            break;
          }
        }
        var had = !!memoVoice.live;
        memoVoiceReset(a || '没听清，再说一次，或直接打字', 'bad');
        if (a) toast(a);
        /* 说出来的半截话留着（可手动改），报错不能把用户的话也吞了 */
        if (had) setMemoStat('识别中断，说出的半截话已留在正文里', 'bad');
        break;
      }
    }
    return;
  }

  /** 网页版兜底：没有原生桥时直接用 Web Speech，回调同样进 memoVoiceEvent */
  function memoVoiceStartWeb() {
    var Ctor = webSpeechCtor();
    if (!Ctor) {
      setMemoStat('这个环境没有语音能力，直接打字也一样', 'bad');
      toast('没有可用的语音识别');
      return;
    }
    var rec;
    try { rec = new Ctor(); } catch (error) {
      setMemoStat('语音启动失败，直接打字吧', 'bad');
      return;
    }
    rec.lang = 'zh-CN';
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = function () { memoVoiceEvent('ready'); };
    rec.onresult = function (event) {
      var text = '', isFinal = true;
      try {
        var last = event.results[event.results.length - 1];
        text = (last && last[0] && last[0].transcript) || '';
        isFinal = !!(last && last.isFinal);
      } catch (error) { text = ''; }
      memoVoiceEvent(isFinal ? 'result' : 'partial', text);
    };
    rec.onerror = function () { memoVoiceEvent('failed', '没听清，再说一次，或直接打字'); };
    rec.onend = function () { if (memoVoice.state === 'listening') memoVoiceWait(); };
    try { rec.start(); } catch (error) {
      memoVoiceReset('语音启动失败，直接打字吧', 'bad');
    }
  }

  /** 麦克风按钮：空闲点一下开录，在听点一下停，出结果中不响应 */
  /* ============ 笔记语音·离线转写分支：共用原生 Dictaphone，段文字插到光标 ============
     与整屏转写互斥；识别走本地模型+同音纠错+标点，原生另尝试本机/局域网AI纠错。 */
  var memoDict = { active: false, pending: [], busy: false, gen: 0, fails: 0,
    done: 0, text: '', stopping: false, stopped: true, watchdog: null, stopTimer: null, owner: '' };

  function clearMemoDictWatchdog() {
    if (memoDict.watchdog) global.clearTimeout(memoDict.watchdog);
    memoDict.watchdog = null;
  }

  function clearMemoDictStopTimer() {
    if (memoDict.stopTimer) global.clearTimeout(memoDict.stopTimer);
    memoDict.stopTimer = null;
  }

  /** 每段都基于当前编辑内容插入，提交后立即落盘；不重画整场录音前的快照。 */
  function memoDictCommit(text) {
    if (!memoDict.active || !memoSheetOpen() || memoUser() !== memoDict.owner) {
      memoDictCancel();
      return;
    }
    var ta = el.memoBodyInput;
    if (!ta) return;
    var current = String(ta.value || '');
    if (memoDigits && memoDigits.before !== current) clearMemoDigits();
    if (current !== memoVoice.base) {
      memoVoice.base = current;
      try { memoVoice.pos = ta.selectionStart; } catch (err) { memoVoice.pos = current.length; }
    }
    if (typeof memoVoice.pos !== 'number' || memoVoice.pos < 0 || memoVoice.pos > current.length) {
      memoVoice.pos = current.length;
    }
    var digits = spokenDigitCandidate(restoreVoiceNames(text));
    text = digits.text;
    memoVoice.glue = memoVoiceGlue(current.slice(0, memoVoice.pos), text);
    var insertAt = memoVoice.pos;
    var insertedLength = memoVoice.glue.length + text.length;
    if (memoDigits && memoDigits.applied) clearMemoDigits();
    if (memoDigits) memoDigits.patches.forEach(function (p) {
      if (p.start >= insertAt) p.start += insertedLength;
    });
    if (digits.candidate) {
      if (!memoDigits) memoDigits = { owner: memoUser(), id: memoUi.id, patches: [], applied: false };
      memoDigits.patches.push({ start: insertAt + memoVoice.glue.length, raw: text, value: digits.candidate });
    }
    memoVoiceAbsorb(text);
    if (memoDigits) memoDigits.before = ta.value;
    paintMemoDigits();
    memoDict.text = joinVoiceParts(memoDict.text, text);
    ta.dispatchEvent(new global.Event('input', { bubbles: true }));
    memoDict.unsaved = !memoSaveNow();
    if (memoDigits && !memoDict.unsaved) memoDigits.id = memoUi.id;
    if (memoDict.unsaved) setMemoStat('转写已显示但保存失败，请保留当前页并重试', 'bad');
  }

  /** 先失效请求再收麦，关闭/切换笔记后的回包不能写到另一篇正文。 */
  function memoDictCancel(message) {
    clearMemoDictWatchdog();
    clearMemoDictStopTimer();
    memoDict.active = false;
    memoDict.gen += 1;
    memoDict.pending = [];
    memoDict.busy = false;
    memoDict.stopped = true;
    var api = dictationApi();
    if (api) { try { api.cancelDictation(); } catch (err) { /* 已失效的回包会被丢弃 */ } }
    memoVoice.live = '';
    if (memoSheetOpen() && memoUser() === memoDict.owner) memoDict.unsaved = !memoSaveNow();
    memoVoiceReset(memoDict.unsaved ? '转写文字尚未保存，请保留当前页并重试' : message || '',
      memoDict.unsaved ? 'bad' : '');
  }

  function memoDictTakeByRid(rid) {
    for (var i = 0; i < memoDict.pending.length; i++) {
      if (memoDict.pending[i].rid === rid) {
        clearMemoDictWatchdog();
        return memoDict.pending.splice(i, 1)[0];
      }
    }
    return null;
  }

  function memoDictPump() {
    if (!memoDict.active || memoDict.busy) return;
    if (memoDict.fails >= 3) {
      toast('笔记转写连续失败，已保留转出的部分');
      memoDictCancel('笔记转写连续失败，已保留转出的部分');
      return;
    }
    if (!memoDict.pending.length) {
      memoDictMaybeFinish();
      return;
    }
    var seg = memoDict.pending[0];
    var api = dictationApi();
    if (!api) { memoDict.pending.shift(); memoDict.fails += 1; memoDictPump(); return; }
    seg.rid = 'm' + memoDict.gen + '-' + seg.seq;
    memoDict.busy = true;
    var timeout = typeof global.__DICT_LOCAL_TIMEOUT_MS__ === 'number' && global.__DICT_LOCAL_TIMEOUT_MS__ > 0
      ? global.__DICT_LOCAL_TIMEOUT_MS__ : 90000;
    memoDict.watchdog = global.setTimeout(function () {
      memoDict.watchdog = null;
      if (!memoDict.active || !memoDict.busy || memoDict.pending[0] !== seg) return;
      voiceLog('memo-dict-timeout', seg.rid);
      global.DictationNet.error(seg.rid, '转写超时');
      toast('第 ' + seg.seq + ' 段转写超时，已保留其他文字');
    }, timeout);
    var accepted = false;
    try { accepted = typeof api.transcribeSegmentLocal === 'function'
      && api.transcribeSegmentLocal(seg.rid, seg.seq) !== false; } catch (err) { accepted = false; }
    if (!accepted) global.DictationNet.error(seg.rid, '离线引擎未接受转写');
  }

  function memoDictMaybeFinish() {
    if (!memoDict.active) return;
    if (memoDict.stopping && memoDict.stopped && !memoDict.busy && !memoDict.pending.length) {
      clearMemoDictWatchdog();
      clearMemoDictStopTimer();
      if (memoSheetOpen() && memoUser() === memoDict.owner) memoDict.unsaved = !memoSaveNow();
      memoDict.active = false;
      var api = dictationApi();
      if (api) { try { api.cleanupDictation(); } catch (err) { /* 忽略 */ } }
      memoVoiceReset(memoDict.unsaved ? '转写文字尚未保存，请保留当前页并重试'
        : memoDict.text && memoDict.done ? '已离线转写 ' + memoDict.done + ' 段并保存' : '',
        memoDict.unsaved ? 'bad' : '');
    }
  }

  function memoDictStart() {
    var api = dictationApi();
    if (!api || !whisperReady()) {
      toast('离线转写没就绪，先用系统识别');
      return false;
    }
    if (dict.recording || voiceState === 'listening' || voiceState === 'stopping') {
      toast('整屏语音正占着麦克风，先关掉它');
      return true;   /* 已提示，别再落回实时识别 */
    }
    clearMemoDigits();
    memoVoice.base = String((el.memoBodyInput && el.memoBodyInput.value) || '');
    try { memoVoice.pos = el.memoBodyInput.selectionStart; }
    catch (err) { memoVoice.pos = memoVoice.base.length; }
    if (typeof memoVoice.pos !== 'number' || memoVoice.pos < 0 || memoVoice.pos > memoVoice.base.length) {
      memoVoice.pos = memoVoice.base.length;
    }
    memoVoice.glue = memoVoiceGlue(memoVoice.base.slice(0, memoVoice.pos), '');
    memoVoice.live = '';
    memoDict = { active: true, pending: [], busy: false, gen: memoDict.gen + 1, fails: 0,
      done: 0, text: '', stopping: false, stopped: false, watchdog: null, stopTimer: null, owner: memoUser() };
    memoVoice.state = 'listening';
    memoVoicePaint();
    var ok = false;
    try { ok = api.startDictation() !== false; } catch (err) { ok = false; }
    if (!ok) {
      memoDictCancel('开麦失败，再试一次或直接打字');
    }
    return true;
  }

  function memoDictStop() {
    if (!memoDict.active) return;
    memoVoice.state = 'stopping';
    memoVoicePaint();
    memoDict.stopping = true;
    var gen = memoDict.gen;
    var timeout = typeof global.__MEMO_DICT_STOP_TIMEOUT_MS__ === 'number' && global.__MEMO_DICT_STOP_TIMEOUT_MS__ > 0
      ? global.__MEMO_DICT_STOP_TIMEOUT_MS__ : 6000;
    clearMemoDictStopTimer();
    memoDict.stopTimer = global.setTimeout(function () {
      memoDict.stopTimer = null;
      if (!memoDict.active || memoDict.gen !== gen || memoDict.stopped) return;
      var cancelApi = dictationApi();
      if (cancelApi) { try { cancelApi.cancelDictation(); } catch (err) { /* 有界收尾 */ } }
      memoDict.stopped = true;
      memoDictPump();
    }, timeout);
    var api = dictationApi();
    var accepted = false;
    if (api) { try { accepted = api.stopDictation() !== false; } catch (err) { /* 定时器兜底 */ } }
    if (!accepted) memoDictCancel('录音停止失败，已保留写入的文字');
    memoDictMaybeFinish();
  }

  function memoVoiceToggle() {
    if (!memoSheetOpen()) return;
    if (memoVoice.state === 'listening') {
      /* 离线转写分支：点一下收尾（尾段转完插入） */
      if (memoDict.active) { memoDictStop(); return; }
      /* 停顿等待期（这段已收进正文）：点一下就是「就到这」，立刻收稿 */
      if (memoVoice.gated) { memoVoiceFinish(); return; }
      memoVoiceWait();
      return;
    }
    if (memoVoice.state === 'stopping') return;   /* 正在出结果，别重复点 */
    if (voiceState === 'listening' || voiceState === 'stopping') {
      toast('语音助手正占着麦克风，先关掉它');
      return;
    }
    if (!el.memoBodyInput) return;
    /* 按「笔记语音输入」设置分路：离线转写 or 系统实时识别 */
    if (prefs.voiceMemoMode === 'dict' && dictationApi() && whisperReady()) {
      memoDictStart();
      return;
    }
    memoVoice.base = String(el.memoBodyInput.value || '');
    try { memoVoice.pos = el.memoBodyInput.selectionStart; }
    catch (error) { memoVoice.pos = memoVoice.base.length; }
    if (typeof memoVoice.pos !== 'number' || memoVoice.pos < 0) memoVoice.pos = memoVoice.base.length;
    memoVoice.glue = memoVoiceGlue(memoVoice.base.slice(0, memoVoice.pos),
                                   memoVoice.base.slice(memoVoice.pos));
    memoVoice.live = '';
    memoVoice.state = 'listening';
    voiceOwner = 'memo';
    memoVoicePaint();
    setMemoStat('正在开麦…');
    var api = memoVoiceApi();
    if (!api) { memoVoiceStartWeb(); return; }
    var started = false;
    try { started = api.startVoiceListening() !== false; } catch (error) { started = false; }
    if (!started) memoVoiceReset('这台手机的识别服务没开放给第三方，直接打字也一样', 'bad');
  }

  function deleteMemo(id) {
    var memo = memoOf(id);
    if (!memo) return;
    var owner = memoUser();
    askConfirm({
      title: '删除这条笔记？',
      text: '「' + truncate(memo.title || '未命名笔记', 18) + '」的正文和 AI 结果会一起删掉，不能恢复。',
      okText: '删除'
    }).then(function (result) {
      if (result !== 'ok') return;
      if (memoUser() !== owner) return;
      memoVoiceCancel(true);
      if (!global.MemoService.remove(owner, id)) {
        setMemoStat('删除失败，笔记和 AI 记录已保留，请重试', 'bad');
        toast('笔记删除失败'); return;
      }
      if (global.DerivedStore) global.DerivedStore.drop(owner, id);
      if (memoUi.id === id) {
        cancelUiAi('memo'); cancelMemoRewrite();
        memoUi.id = '';
        show(el.memoLayer, false);
      }
      renderMemoList();
      toast('笔记已删除');
    });
  }

  /* ------------------------------------------------------------- AI 结果 */

  function renderMemoAi() {
    if (!el.memoAiCard) return;
    if (!memoUi.id) { show(el.memoAiCard, false); return; }
    var memo = memoOf(memoUi.id);
    var derived = global.DerivedStore;
    if (!memo || !derived) { show(el.memoAiCard, false); return; }

    var rec = derived.get(memoUser(), memo.id, 'summary', memoFingerprint(memo));
    if (!rec) { show(el.memoAiCard, false); return; }

    show(el.memoAiCard, true);
    var stale = rec.status === 'stale';
    if (el.memoAiLabel) el.memoAiLabel.textContent = 'AI 摘要';
    if (el.memoAiBadge) {
      el.memoAiBadge.textContent = stale
        ? '正文改过，点重新生成'
        : ((rec.modelId || '模型') + ' · ' + memoStampOf(rec.createdAt));
      el.memoAiBadge.setAttribute('data-tone', stale ? 'stale' : '');
    }
    if (el.memoAiBody) el.memoAiBody.textContent = (rec.payload && rec.payload.summary) || '';

    if (el.memoAiPoints) {
      el.memoAiPoints.textContent = '';
      var points = (rec.payload && rec.payload.keyPoints) || [];
      for (var i = 0; i < points.length; i++) {
        var li = document.createElement('li');
        li.textContent = points[i];
        el.memoAiPoints.appendChild(li);
      }
      show(el.memoAiPoints, points.length > 0);
    }
  }

  /** 把任务层接到现有模型通道上：挑模型、发请求、回文本 */
  function registerAiTransport() {
    var registry = global.AiTaskRegistry;
    if (!registry || typeof registry.setTransport !== 'function') return;
    registry.setTransport(function (job, cb) {
      var picked = pickModel(job.route || 'polish');
      var model = picked && picked.model;
      if (!model) { cb('还没有可用的模型，先去设置里加一个', null); return; }
      runMessages(model, {
        messages: job.messages,
        temperature: job.temperature,
        timeout: job.timeout || 30000,
        task: job.route || 'polish'
      }, function (err, res) {
        if (err) { cb(err, null); return; }
        cb(null, { text: res.text, realModel: res.realModel, usage: res.usage });
      });
    });
  }

  var uiAiJobs = {};
  function cancelUiAi(name) {
    var job = uiAiJobs[name];
    if (!job) return;
    global.clearTimeout(job.timer); delete uiAiJobs[name]; job.lock(false);
  }
  function runUiAi(name, kind, input, valid, lock, done) {
    cancelUiAi(name);
    var job = {owner:memoUser(),lock:lock,timer:null};
    uiAiJobs[name] = job; lock(true);
    function finish(err,res) {
      if (uiAiJobs[name] !== job) return;
      cancelUiAi(name);
      if (memoUser() !== job.owner || !valid()) return;
      done(err,res);
    }
    var timeout=Number(global.__MEMO_AI_TIMEOUT_MS__) || 90000;
    job.timer=global.setTimeout(function(){finish('AI 处理超时，可重试',null);},timeout);
    try {global.AiTaskRegistry.run(kind,input,finish);}
    catch(error){finish('AI 请求失败：'+String(error.message || error),null);}
  }

  function runMemoTask(kind) {
    if (memoUi.busy) { setMemoStat('上一次还在跑，稍等一下'); return; }
    /* 弹层关着的时候这几个按钮不该有反应（防残留触发） */
    if (!memoSheetOpen()) return;
    var registry = global.AiTaskRegistry;
    var policy = global.ConsentPolicy;
    if (!registry) { setMemoStat('AI 模块没加载，重启应用试试', 'bad'); return; }

    var memo = memoSaveNow();
    if (!memo) { setMemoStat('先写点内容，AI 才有东西可读', 'bad'); return; }
    var body = String(memo.body || '').trim();
    if (body.length < 8) { setMemoStat('正文太短了，多写两句再让 AI 看', 'bad'); return; }
    if (!usableModels().length) {
      setMemoStat('还没有可用的模型：设置 → 在线大模型 里加一个', 'bad');
      return;
    }
    if (policy) {
      var consent = policy.check({ text: body, task: kind });
      if (!consent.allowed) { setMemoStat(consent.reason, 'bad'); return; }
    }

    setMemoStat(kind === 'summarize' ? '正在读这篇，写摘要…'
      : (kind === 'structVoice' ? '正在整理成标题和正文…'
        : (kind === 'tags' ? '正在想几个标签…' : '正在找里面要做的事…')));

    var memoId = memo.id;
    var memoRev = memo.rev;
    var originalBody=el.memoBodyInput.value, originalTitle=el.memoTitleInput.value;
    runUiAi('memo',kind,body,function(){return memoSheetOpen() && memoUi.id===memoId;},
      function(busy){memoUi.busy=busy;},function (err, res) {
      if (err) { setMemoStat(err, 'bad'); return; }
      var current=memoOf(memoId);
      if (!current || current.rev!==memoRev || el.memoBodyInput.value!==originalBody || el.memoTitleInput.value!==originalTitle) {
        setMemoStat('正文或标题已改变，请重新生成 AI 结果', 'bad'); return;
      }

      if (kind === 'structVoice') {
        applyStructuredMemo(memoId, res);
        return;
      }

      if (kind === 'tags') {
        /* 标签是「建议」：给出来先不上身，用户点了才采纳（M2 验收线） */
        memoUi.tagSug = res.data.tags || [];
        renderMemoTags();
        setMemoStat('给标签：点一个就采用，点 × 全部不要', 'ok');
        return;
      }

      var kindKey = kind === 'summarize' ? 'summary' : 'todoDraft';
      if (global.DerivedStore) {
        var recorded=global.DerivedStore.put(memoUser(), memoId, kindKey, res.data, {
          memoRev: memoRev,
          modelId: res.model,
          promptVer: res.promptVer,
          schemaVer: res.schemaVer
        });
        if (!recorded) {setMemoStat('AI 结果保存失败，请重试', 'bad');return;}
      }

      var tip = '用时 ' + (res.ms / 1000).toFixed(1) + ' 秒';
      if (res.repaired) tip += ' · 模型第一次没按格式，自动重试了一次';
      setMemoStat(tip, 'ok');

      if (kind === 'summarize') {
        if (memoUi.id === memoId) renderMemoAi();
        renderMemoList();
      } else {
        openDraftSheet(res.data.todos, memoId);
      }
    });
  }

  /**
   * 口述整理：把模型的标题/正文写回表单，立刻落盘。
   * 只覆盖 title 与 body；sourceText（原话）永远不动，模型理解错了还能对回去。
   */
  function applyStructuredMemo(memoId, res) {
    var data = res.data || {};
    if (memoUi.id !== memoId) { return; }
    var previousTitle=el.memoTitleInput.value, previousBody=el.memoBodyInput.value;
    if (el.memoTitleInput) el.memoTitleInput.value = data.title || el.memoTitleInput.value;
    if (el.memoBodyInput) el.memoBodyInput.value = data.body || el.memoBodyInput.value;

    var saved = memoSaveNow();
    if (!saved) {
      el.memoTitleInput.value=previousTitle; el.memoBodyInput.value=previousBody;
      setMemoStat('整理稿保存失败，已恢复原文，请重试', 'bad'); return;
    }
    var tip = '已整理成 ' + (data.title ? '「' + truncate(data.title, 14) + '」' : '正文');
    if (data.unclear && data.unclear.length) tip += '；有 ' + data.unclear.length + ' 处没听清，原文里保留着';
    setMemoStat(tip, 'ok');

    /* 顺带把草稿存下来，稍后「提取待办」不用再花一次钱 */
    if (global.DerivedStore && saved) {
      var draftSaved=global.DerivedStore.put(memoUser(), memoId, 'todoDraft', { todos: data.todos || [] }, {
        memoRev: saved.rev,
        modelId: res.model,
        promptVer: res.promptVer,
        schemaVer: res.schemaVer
      });
      if (!draftSaved) setMemoStat(tip+'；待办草稿保存失败，当前预览仍可使用', 'bad');
    }
    renderMemoList();
    if (data.todos && data.todos.length) openDraftSheet(data.todos, memoId);
  }

  /* ------------------------------------------------------- 标签建议（M2） */

  /** 建议行：已采纳的在前（可移除），建议的在后（点了才采纳），最后是「不要」 */
  function renderMemoTags() {
    if (!el.memoTagSug) return;
    el.memoTagSug.textContent = '';
    var memo = memoUi.id ? memoOf(memoUi.id) : null;
    var adopted = memo ? adoptedTagsOf(memo) : [];
    var sug = (memoUi.tagSug || []).filter(function (t) {
      return adopted.indexOf(String(t)) === -1;
    });
    if (!adopted.length && !sug.length) { show(el.memoTagSug, false); return; }

    for (var i = 0; i < adopted.length; i++) {
      el.memoTagSug.appendChild(tagChipNode(adopted[i], 'ok'));
    }
    for (var j = 0; j < sug.length; j++) {
      el.memoTagSug.appendChild(tagChipNode(sug[j], 'sug'));
    }
    if (sug.length) {
      var no = document.createElement('button');
      no.type = 'button';
      no.className = 'memo__tagchip-x';
      no.setAttribute('aria-label', '不要这些建议');
      no.textContent = '×';
      no.addEventListener('click', function () {
        memoUi.tagSug = [];
        renderMemoTags();
        setMemoStat('标签建议已丢弃');
      });
      el.memoTagSug.appendChild(no);
    }
    show(el.memoTagSug, true);
  }

  function tagChipNode(text, kind) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'memo__tagchip' + (kind === 'ok' ? ' memo__tagchip--ok' : ' memo__tagchip--sug');
    b.textContent = (kind === 'sug' ? '+ ' : '#') + text;
    b.title = kind === 'sug' ? '点一下采用这个标签' : '点一下移除这个标签';
    b.addEventListener('click', function () {
      if (kind === 'sug') adoptMemoTag(String(text));
      else removeMemoTag(String(text));
    });
    return b;
  }

  function adoptMemoTag(tag) {
    var memo = memoUi.id ? memoOf(memoUi.id) : null;
    var derived = global.DerivedStore;
    if (!memo || !derived) return;
    var tags = adoptedTagsOf(memo).slice();
    if (tags.indexOf(tag) === -1) tags.push(tag);
    var fp = memoFingerprint(memo);
    fp.memoRev = memo.rev;
    if (!derived.put(memoUser(), memo.id, 'tags', { tags: tags.slice(0, 6) }, fp, 'adopted')) {
      setMemoStat('标签保存失败，请重试', 'bad'); return;
    }
    memoUi.tagSug = (memoUi.tagSug || []).filter(function (t) { return t !== tag; });
    renderMemoTags();
    renderMemoList();
    setMemoStat('已采用 #' + tag + '，以后按它搜也找得到', 'ok');
  }

  function removeMemoTag(tag) {
    var memo = memoUi.id ? memoOf(memoUi.id) : null;
    var derived = global.DerivedStore;
    if (!memo || !derived) return;
    var tags = adoptedTagsOf(memo).filter(function (t) { return t !== tag; });
    var fp = memoFingerprint(memo);
    fp.memoRev = memo.rev;
    if (!derived.put(memoUser(), memo.id, 'tags', { tags: tags }, fp, 'adopted')) {
      setMemoStat('标签移除失败，请重试', 'bad'); return;
    }
    renderMemoTags();
    renderMemoList();
  }

  /* ----------------------------------------------------- 相关笔记（M3） */

  /** 纯本地：索引词共现 + 已采纳标签重合，不出网不花钱 */
  function renderMemoRelated() {
    if (!el.memoRelatedList) return;
    el.memoRelatedList.textContent = '';
    var svc = global.LinkService;
    var memo = memoUi.id ? memoOf(memoUi.id) : null;
    if (!svc || !memo || !el.memoRelated) { if (el.memoRelated) show(el.memoRelated, false); return; }
    var items = [];
    try { items = svc.related(memoUser(), memo.id, 3) || []; } catch (error) { items = []; }
    if (!items.length) { show(el.memoRelated, false); return; }

    for (var i = 0; i < items.length; i++) {
      el.memoRelatedList.appendChild(relatedNode(items[i]));
    }
    show(el.memoRelated, true);
  }

  function relatedNode(item) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'memo__rel';
    var title = document.createElement('span');
    title.className = 'memo__rel-title';
    title.textContent = truncate(item.memo.title || '未命名笔记', 12);
    b.appendChild(title);
    if (item.shared && item.shared.length) {
      var tag = document.createElement('span');
      tag.className = 'memo__rel-tag';
      tag.textContent = '#' + item.shared[0];
      b.appendChild(tag);
    } else {
      var pre = document.createElement('span');
      pre.className = 'memo__rel-pre';
      pre.textContent = global.MemoService.previewOf(item.memo, 12);
      b.appendChild(pre);
    }
    var id = item.memo.id;
    b.addEventListener('click', function () { openMemoSheet(id); });
    return b;
  }

  /* ----------------------------------------------------- AI 改写（M3） */

  function cancelMemoRewrite() {
    var request = memoUi.rewriteRequest;
    if (!request) return;
    if (request.timer) global.clearTimeout(request.timer);
    memoUi.rewriteRequest = null;
    memoUi.busy = false;
  }

  /** 点「AI 改写」先出两档选择，点了档位才发请求 */
  function showRwModes() {
    if (!memoSheetOpen()) return;
    if (el.memoRwModes) show(el.memoRwModes, true);
  }

  function runMemoRewrite(mode) {
    if (el.memoRwModes) show(el.memoRwModes, false);
    if (memoUi.busy) { setMemoStat('上一次还在跑，稍等一下'); return; }
    if (!memoSheetOpen()) return;
    var registry = global.AiTaskRegistry;
    var policy = global.ConsentPolicy;
    if (!registry) { setMemoStat('AI 模块没加载，重启应用试试', 'bad'); return; }

    var memo = memoSaveNow();
    if (!memo) { setMemoStat('先写点内容，AI 才有东西可改', 'bad'); return; }
    var body = String(memo.body || '').trim();
    if (body.length < 8) { setMemoStat('正文太短了，多写两句再改写', 'bad'); return; }
    if (!usableModels().length) {
      setMemoStat('还没有可用的模型：设置 → 在线大模型 里加一个', 'bad');
      return;
    }
    if (policy) {
      var consent = policy.check({ text: body, task: 'rewrite' });
      if (!consent.allowed) { setMemoStat(consent.reason, 'bad'); return; }
    }

    memoUi.busy = true;
    hideRewriteCard();
    var request = { memoId: memo.id, owner: memoUser(), memoRev: memo.rev, timer: null };
    memoUi.rewriteRequest = request;
    setMemoStat(mode === 'expand' ? '正在扩写，只补条理不编事实…' : '正在润色，数字金额一个不动…');
    function finish(err, res) {
      if (memoUi.rewriteRequest !== request) return;
      if (request.timer) global.clearTimeout(request.timer);
      memoUi.rewriteRequest = null;
      memoUi.busy = false;
      if (!memoSheetOpen() || memoUi.id !== request.memoId || memoUser() !== request.owner) return;
      if (err) { setMemoStat(err, 'bad'); return; }
      if (!res || !res.data || typeof res.data.text !== 'string' || !res.data.text.trim()) {
        setMemoStat('这次没有生成有效正文，可以再次扩写或润色', 'bad');
        return;
      }
      if (mode === 'expand') {
        if (!memoUi.expandCounts) memoUi.expandCounts = {};
        var key = request.owner + ':' + request.memoId;
        memoUi.expandCounts[key] = (memoUi.expandCounts[key] || 0) + 1;
      }
      showRewriteCard(mode, body, res, request);
    }
    var timeout = typeof global.__MEMO_REWRITE_TIMEOUT_MS__ === 'number' && global.__MEMO_REWRITE_TIMEOUT_MS__ > 0
      ? global.__MEMO_REWRITE_TIMEOUT_MS__ : 90000;
    request.timer = global.setTimeout(function () {
      finish('本次改写等待超时，可以再次尝试扩写或润色');
    }, timeout);
    try {
      registry.run('rewrite', JSON.stringify({ text: body, mode: mode }), finish);
    } catch (error) {
      finish('改写未完成，可以再次尝试：' + String(error && error.message || error));
    }
  }

  /** 双列对照（原文 | 改写稿）：冲突结论并排展示，是设计文档 M3 的验收线 */
  function showRewriteCard(mode, original, res, request) {
    if (!el.memoRwCard) return;
    memoUi.rewrite = {
      mode: mode, original: original, text: res.data.text,
      memoId: request.memoId, owner: request.owner, memoRev: request.memoRev,
      model: res.model || '', ms: res.ms || 0,
      promptVer: res.promptVer || '', schemaVer: res.schemaVer || 0
    };
    if (el.memoRwLabel) el.memoRwLabel.textContent = mode === 'expand' ? 'AI 扩写' : 'AI 润色';
    if (el.memoRwBadge) {
      el.memoRwBadge.textContent = ((res.model || '模型') + ' · ' +
        ((res.ms || 0) / 1000).toFixed(1) + ' 秒' + (res.repaired ? ' · 自动重试过一次' : ''));
      el.memoRwBadge.setAttribute('data-tone', '');
    }
    if (el.memoRwOrig) el.memoRwOrig.textContent = truncate(original, 600);
    if (el.memoRwNew) el.memoRwNew.textContent = res.data.text;
    show(el.memoRwCard, true);
    var count = memoUi.expandCounts && memoUi.expandCounts[request.owner + ':' + request.memoId] || 0;
    setMemoStat((mode === 'expand' ? '扩写完成（本次会话第 ' + count + ' 次），可继续点击「AI 改写 → 允许扩写」。'
      : '已生成有改动的润色预览，可再次生成。') + '原正文暂未修改；点「替换正文」在当前页替换并保存', 'ok');
    var shown = memoUi.rewrite;
    global.requestAnimationFrame(function () {
      if (!memoSheetOpen() || memoUi.rewrite !== shown) return;
      if (el.memoRwAdopt && typeof el.memoRwAdopt.scrollIntoView === 'function') {
        el.memoRwAdopt.scrollIntoView({ block: 'center', behavior: 'auto' });
      }
    });
  }

  function hideRewriteCard() {
    if (el.memoRwCard) show(el.memoRwCard, false);
    memoUi.rewrite = null;
  }

  function adoptRewrite() {
    if (!memoSheetOpen()) return;
    setMemoStat('正在替换正文并保存…');
    var rw = memoUi.rewrite;
    var memo = memoUi.id ? memoOf(memoUi.id) : null;
    if (!rw || !el.memoBodyInput) {
      setMemoStat('改写稿已失效，请重新生成后再替换', 'bad');
      return;
    }
    if (!memo) {
      setMemoStat('笔记记录未找到或暂不可读，正文尚未替换，请重试', 'bad');
      toast('笔记记录暂不可读，正文尚未替换');
      return;
    }
    if (rw.memoId !== memoUi.id || rw.owner !== memoUser()) { hideRewriteCard(); return; }
    if (String(el.memoBodyInput.value || '').trim() !== rw.original) {
      hideRewriteCard();
      setMemoStat('正文在生成后改过了，请基于当前正文重新扩写或润色', 'bad');
      toast('正文已修改，请重新生成改写稿');
      return;
    }
    memoVoiceCancel(true);
    var before = el.memoBodyInput.value;
    var payload = { mode: rw.mode, text: rw.text, original: rw.original, sourceMemoRev: rw.memoRev };
    var archive = global.DerivedStore && global.DerivedStore.put(memoUser(), memo.id, 'rewrite', payload,
      { memoRev: memo.rev, modelId: rw.model, promptVer: rw.promptVer, schemaVer: rw.schemaVer });
    if (!archive) {
      setMemoStat('原稿记录保存失败，正文未替换，请重试或先复制原文', 'bad');
      toast('原稿保存失败，正文保持不变');
      return;
    }
    el.memoBodyInput.value = rw.text;
    el.memoBodyInput.dispatchEvent(new global.Event('input', { bubbles: true }));
    var saved = memoSaveNow();
    if (!saved) {
      el.memoBodyInput.value = before;
      setMemoStat('替换保存失败，原正文已保留，请重试', 'bad');
      toast('替换未保存，请重试');
      return;
    }
    global.DerivedStore.put(memoUser(), memo.id, 'rewrite', payload,
      { memoRev: saved.rev, modelId: rw.model, promptVer: rw.promptVer, schemaVer: rw.schemaVer });
    global.DerivedStore.adopt(memoUser(), memo.id, 'rewrite');
    hideRewriteCard();
    setMemoStat('正文已替换为' + (rw.mode === 'expand' ? '扩写稿' : '润色稿') + '并保存；'
      + '替换前正文已保留在 AI 记录里。可继续扩写或润色', 'ok');
    toast('正文已替换并保存');
    renderMemoList();
  }

  /** 部分 Android WebView 会丢弃焦点/布局切换后的兼容 click，触控抬起直接采用。
      只处理短按；滚动、长按、多指与取消均不采用，并拦住随后合成的重复 click。 */
  function bindRewriteAdopt(button) {
    var origin = null, moved = false, suppressClickUntil = 0;
    button.addEventListener('touchstart', function (event) {
      origin = event.touches.length === 1
        ? { x: event.touches[0].clientX, y: event.touches[0].clientY, at: Date.now() } : null;
      moved = false;
    }, { passive: true });
    button.addEventListener('touchmove', function (event) {
      if (origin && event.touches.length === 1
          && (Math.abs(event.touches[0].clientX - origin.x) > 10 || Math.abs(event.touches[0].clientY - origin.y) > 10)) moved = true;
    }, { passive: true });
    button.addEventListener('touchcancel', function () { origin = null; });
    button.addEventListener('touchend', function (event) {
      var start = origin;
      origin = null;
      if (!start || moved || event.touches.length || Date.now() - start.at > 700) return;
      var end = event.changedTouches[0];
      if (!end || Math.abs(end.clientX - start.x) > 10 || Math.abs(end.clientY - start.y) > 10) return;
      if (event.cancelable) event.preventDefault();
      suppressClickUntil = Date.now() + 800;
      adoptRewrite();
    }, { passive: false });
    button.addEventListener('click', function (event) {
      if (Date.now() < suppressClickUntil) { event.preventDefault(); return; }
      adoptRewrite();
    });
  }

  /* ----------------------------------------------------- 本周回顾（M3） */

  function openReviewSheet() {
    if (!el.reviewLayer) return;
    cancelUiAi('review');
    memoSaveNow();
    renderReview();
    show(el.reviewLayer, true);
  }

  function setRvwHint(text, tone) {
    if (!el.rvwHint) return;
    el.rvwHint.textContent = text || '';
    el.rvwHint.setAttribute('data-tone', tone || '');
  }

  function addRvwCell(grid, label, value) {
    var div = document.createElement('div');
    div.className = 'rvw__cell';
    var v = document.createElement('span');
    v.className = 'rvw__cell-value';
    v.textContent = value;
    var l = document.createElement('span');
    l.className = 'rvw__cell-label';
    l.textContent = label;
    div.appendChild(v);
    div.appendChild(l);
    grid.appendChild(div);
  }

  function renderReview() {
    if (!el.rvwGrid) return;
    el.rvwGrid.textContent = '';
    var stats = global.StatsService ? global.StatsService.week(memoUser(), Date.now()) : null;
    if (!stats) { setRvwHint('统计模块没加载，重启应用试试', 'bad'); return; }

    addRvwCell(el.rvwGrid, '新记笔记', stats.newMemos + ' 条');
    addRvwCell(el.rvwGrid, '动过的笔记', stats.activeMemos + ' 条');
    addRvwCell(el.rvwGrid, '完成待办', stats.completedTodos + ' 条');
    addRvwCell(el.rvwGrid, '还挂着', stats.openTodos + ' 条');
    addRvwCell(el.rvwGrid, 'AI 建议', stats.generated + ' 条');
    addRvwCell(el.rvwGrid, '采纳率', stats.ratio === null ? '—' : Math.round(stats.ratio * 100) + '%');

    if (el.rvwTags) {
      el.rvwTags.textContent = '';
      if (stats.topTags.length) {
        for (var i = 0; i < stats.topTags.length; i++) {
          var chip = document.createElement('span');
          chip.className = 'rvw__tag';
          chip.textContent = '#' + stats.topTags[i].tag +
            (stats.topTags[i].n > 1 ? ' ×' + stats.topTags[i].n : '');
          el.rvwTags.appendChild(chip);
        }
        show(el.rvwTags, true);
      } else {
        show(el.rvwTags, false);
      }
    }

    if (el.rvwSedList) {
      el.rvwSedList.textContent = '';
      if (stats.sediment.length) {
        for (var j = 0; j < stats.sediment.length; j++) {
          el.rvwSedList.appendChild(sedimentNode(stats.sediment[j]));
        }
        show(el.rvwSed, true);
      } else {
        show(el.rvwSed, false);
      }
    }

    if (el.rvwAi) show(el.rvwAi, false);
    setRvwHint('统计都是本地算的，一个字都没出网');
  }

  function sedimentNode(item) {
    var li = document.createElement('li');
    li.className = 'rvw__seditem';
    var t = document.createElement('span');
    t.className = 'rvw__sedtitle';
    t.textContent = truncate(item.title, 14);
    var s = document.createElement('span');
    s.className = 'rvw__sedtext';
    s.textContent = item.text;
    li.appendChild(t);
    li.appendChild(s);
    if (item.memoId) {
      li.addEventListener('click', function () {
        show(el.reviewLayer, false);
        openMemoSheet(item.memoId);
      });
    }
    return li;
  }

  /** AI 周评可选：只发统计数字、标签和已采纳摘要，consent 不放行就不发 */
  function runReviewAi() {
    if (el.rvwAiBtn && el.rvwAiBtn.disabled) return;
    var registry = global.AiTaskRegistry;
    var policy = global.ConsentPolicy;
    if (!registry) { setRvwHint('AI 模块没加载，重启应用试试', 'bad'); return; }
    if (!usableModels().length) {
      setRvwHint('还没有可用的模型：设置 → 在线大模型 里加一个', 'bad');
      return;
    }
    var payload = global.StatsService ? global.StatsService.reviewPayload(memoUser(), Date.now()) : null;
    if (!payload) { setRvwHint('统计模块没加载', 'bad'); return; }
    if (policy) {
      var consent = policy.check({ text: JSON.stringify(payload), task: 'review' });
      if (!consent.allowed) { setRvwHint(consent.reason, 'bad'); return; }
    }
    setRvwHint('只发统计数字、标签和已采纳摘要，不发整篇正文…');
    runUiAi('review','review',JSON.stringify(payload),function(){return !el.reviewLayer.classList.contains('is-hidden');},
      function(busy){if(el.rvwAiBtn)el.rvwAiBtn.disabled=busy;},function (err, res) {
      if (err) { setRvwHint(String(err), 'bad'); return; }
      if (el.rvwAiText) el.rvwAiText.textContent = (res.data && res.data.text) || '';
      if (el.rvwAi) show(el.rvwAi, true);
      setRvwHint('用时 ' + ((res.ms || 0) / 1000).toFixed(1) + ' 秒 · 点沉淀条目可跳回原笔记', 'ok');
    });
  }


  /* ----------------------------------------------------- 问一问（M2 qa） */

  function openQaSheet() {
    if (!el.qaLayer) return;
    cancelUiAi('qa');
    memoSaveNow();   /* 笔记弹层要是开着，先把正在写的内容落盘再检索 */
    if (el.qaInput) el.qaInput.value = '';
    if (el.qaResult) show(el.qaResult, false);
    setQaHint('从你的笔记里检索最相关的几段，回答都带出处。');
    if (el.qaAsk) el.qaAsk.disabled = false;
    show(el.qaLayer, true);
    try { if (el.qaInput) el.qaInput.focus(); } catch (error) { /* 忽略 */ }
  }

  function setQaHint(text, tone) {
    if (!el.qaHint) return;
    el.qaHint.textContent = text || '';
    el.qaHint.setAttribute('data-tone', tone || '');
  }

  function qaAskNow() {
    if (!el.qaInput || !global.SearchService) return;
    var q = String(el.qaInput.value || '').trim();
    if (!q) { setQaHint('先写一句要找什么', 'bad'); return; }
    if (el.qaAsk && el.qaAsk.disabled) return;

    var snippets = global.SearchService.topSnippets(memoUser(), q, 5);
    if (!snippets.length) {
      /* 检索层一无所获就不花这个钱，直接如实说没有 */
      if (el.qaResult) show(el.qaResult, false);
      setQaHint('笔记里没有找到相关内容——换个词，或先记一条笔记', 'bad');
      return;
    }

    var registry = global.AiTaskRegistry;
    var policy = global.ConsentPolicy;
    if (!registry) { setQaHint('AI 模块没加载，重启应用试试', 'bad'); return; }
    if (!usableModels().length) { setQaHint('还没有可用的模型：设置 → 在线大模型 里加一个', 'bad'); return; }
    if (policy) {
      var consent = policy.check({ text: q, task: 'qa' });
      if (!consent.allowed) { setQaHint(consent.reason, 'bad'); return; }
    }

    setQaHint('正在笔记里找「' + truncate(q, 12) + '」的答案…');
    if (el.qaResult) show(el.qaResult, false);

    var payload = { q: q, snippets: snippets };
    runUiAi('qa','qa',JSON.stringify(payload),function(){return !el.qaLayer.classList.contains('is-hidden');},
      function(busy){if(el.qaAsk)el.qaAsk.disabled=busy;},function (err, res) {
      if (err) { setQaHint(String(err), 'bad'); return; }
      if (String(el.qaInput.value || '').trim()!==q) {setQaHint('问题已改变，请重新提问');return;}
      var data = res.data || {};
      if (el.qaAnswer) el.qaAnswer.textContent = data.answer || '';
      if (el.qaRefs) {
        el.qaRefs.textContent = '';
        var refs = data.refs || [];
        for (var i = 0; i < refs.length; i++) {
          var snip = null;
          for (var j = 0; j < snippets.length; j++) {
            if (Number(snippets[j].n) === Number(refs[i])) { snip = snippets[j]; break; }
          }
          if (!snip) continue;
          var chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'qa__ref';
          chip.textContent = '[' + snip.n + '] ' + truncate(snip.title, 14);
          (function(targetId){chip.addEventListener('click', function () {
            cancelUiAi('qa');show(el.qaLayer, false);
            openMemoSheet(targetId);
          });})(snip.memoId);
          el.qaRefs.appendChild(chip);
        }
        if (!el.qaRefs.children.length) {
          var none = document.createElement('span');
          none.className = 'qa__norefs';
          none.textContent = '（这段回答没有给出处，参考着看）';
          el.qaRefs.appendChild(none);
        }
      }
      if (el.qaResult) show(el.qaResult, true);
      setQaHint(data.enough === false
        ? '笔记里没有找到足够的依据，以上仅供参考'
        : '点出处可直接跳回原笔记 · 用时 ' + (res.ms / 1000).toFixed(1) + ' 秒',
        data.enough === false ? 'warn' : '');
    });
  }

  /* --------------------------------------------------------- 待办草稿 */

  function openDraftSheet(items, memoId) {
    if (!el.draftLayer) return;
    var list = items || [];
    var now = Date.now();
    draftUi.items = [];
    draftUi.memoId = memoId || '';

    for (var i = 0; i < list.length; i++) {
      var raw = list[i] || {};
      var text = String(raw.text || '').trim();
      if (!text) continue;

      /* 时间交给本地解析器：模型只负责「说出原话里的时间」，落到几点由程序算。
         模型给的时间说法可能是过去时，那就先不设提醒。 */
      var dueAt = null;
      var fuzzy = null;
      var spoken = String(raw.when || '').trim();
      if (spoken) {
        var intent = parseLocalIntent(text + ' ' + spoken, now);
        if (intent && intent.action === 'create' && intent.times && intent.times.length) {
          var at = Number(intent.times[0]);
          if (at > now) { dueAt = at; fuzzy = intent.fuzzy || null; }
          else spoken = spoken + '（已过，先不设提醒）';
        }
      }

      draftUi.items.push({
        text: text, when: spoken, who: String(raw.who || '').trim(),
        dueAt: dueAt, fuzzy: fuzzy, checked: true
      });
    }

    renderDraftList();
    show(el.draftLayer, true);
  }

  function renderDraftList() {
    if (!el.draftList) return;
    el.draftList.textContent = '';
    for (var i = 0; i < draftUi.items.length; i++) {
      el.draftList.appendChild(draftNode(draftUi.items[i], i));
    }
    syncDraftCount();
  }

  function draftNode(item, index) {
    var li = document.createElement('li');
    li.className = 'draft';
    li.setAttribute('data-index', String(index));

    var box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'draft__box';
    box.checked = !!item.checked;
    box.setAttribute('aria-label', '选择「' + item.text + '」');
    box.addEventListener('change', function () {
      item.checked = !!box.checked;
      syncDraftCount();
    });
    li.appendChild(box);

    var main = document.createElement('div');
    main.className = 'draft__main';
    var text = document.createElement('span');
    text.className = 'draft__text';
    text.textContent = item.text;
    main.appendChild(text);

    var whenText = '';
    if (item.dueAt) {
      var slot = fuzzySlot(item.fuzzy);
      whenText = slot
        ? dayPrefixOf(item.dueAt) + ' ' + slot.label
        : formatDateTime(item.dueAt);
    } else if (item.when) {
      whenText = item.when;
    }
    if (whenText) {
      var when = document.createElement('span');
      when.className = 'draft__when';
      when.setAttribute('data-tone', item.dueAt ? '' : 'warn');
      when.textContent = whenText;
      main.appendChild(when);
    }
    li.appendChild(main);
    return li;
  }

  function selectedDrafts() {
    var out = [];
    for (var i = 0; i < draftUi.items.length; i++) {
      if (draftUi.items[i].checked) out.push(draftUi.items[i]);
    }
    return out;
  }

  function syncDraftCount() {
    var picked = selectedDrafts().length;
    if (el.draftTitle) el.draftTitle.textContent = '将要创建 ' + picked + ' 条待办';
    if (el.draftOk) el.draftOk.disabled = picked === 0;
    if (el.draftStat) {
      el.draftStat.textContent = draftUi.items.length
        ? '共 ' + draftUi.items.length + ' 条草稿，勾掉的不会创建'
        : '这篇笔记里没找到要做的事';
    }
  }

  function confirmDraft() {
    var picked = selectedDrafts();
    if (!picked.length) { toast('先勾一条'); return; }
    var created = 0;
    var failed = 0;
    for (var i = 0; i < picked.length; i++) {
      var item = picked[i];
      if (addTodo(item.text, {
        dueAt: item.dueAt, fuzzy: item.fuzzy, fromAssistant: true
      })) created += 1;
      else failed += 1;
    }
    if (created && global.DerivedStore && draftUi.memoId) {
      global.DerivedStore.adopt(memoUser(), draftUi.memoId, 'todoDraft');
    }
    show(el.draftLayer, false);
    draftUi.items = [];
    renderMemoList();
    if (created) {
      toast(failed
        ? '创建了 ' + created + ' 条，' + failed + ' 条没成功'
        : '已创建 ' + created + ' 条待办');
    } else {
      toast('一条都没建成，检查存储空间');
    }
  }

  /* --------------------------------------------------------- 数据范围三档 */

  function renderConsent() {
    var pick = el.consentPick;
    var policy = global.ConsentPolicy;
    if (!pick || !policy) return;
    var mode = policy.mode();
    pick.textContent = '';

    var list = policy.all();
    for (var i = 0; i < list.length; i++) {
      pick.appendChild(consentButton(list[i], mode));
    }
    if (el.consentDesc) el.consentDesc.textContent = policy.describe(mode);
  }

  function consentButton(item, mode) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'consent__btn';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('data-mode', item.key);
    btn.setAttribute('aria-checked', String(item.key === mode));
    btn.textContent = item.label;
    btn.addEventListener('click', function () {
      if (!global.ConsentPolicy.setMode(item.key)) {
        toast('保存失败，稍后再试');
        return;
      }
      renderConsent();
      toast(item.key === 'online'
        ? '正文可以发给模型了，发送前按脱敏设置处理'
        : (item.key === 'local' ? '正文不会再离开这台手机' : 'AI 已关闭，只用本地规则'));
    });
    return btn;
  }

  /* ------------------------------------------------------------- 事件绑定 */

  function cacheMemoElements() {
    el.tabMemos = $('tab-memos');
    el.badgeMemos = $('badge-memos');
    el.panelMemos = $('panel-memos');
    el.memoList = $('memo-list');
    el.memoEmpty = $('memo-empty');
    el.memoEmptyTitle = $('memo-empty-title');
    el.memoEmptyText = $('memo-empty-text');
    el.memoSearch = $('memo-search');
    el.memoNew = $('memo-new');
    el.memoAsk = $('memo-ask');
    el.memoHint = $('memo-hint');
    el.memoLayer = $('memo-layer');
    el.memoSheetTitle = $('memo-sheet-title');
    el.memoStamp = $('memo-stamp');
    el.memoTitleInput = $('memo-title-input');
    el.memoBodyInput = $('memo-body-input');
    el.memoStat = $('memo-stat');
    el.memoDigitFix = $('memo-digit-fix');
    el.memoDigitRaw = $('memo-digit-raw');
    el.memoDigitAdopt = $('memo-digit-adopt');
    el.memoDigitUndo = $('memo-digit-undo');
    el.memoDigitDismiss = $('memo-digit-dismiss');
    el.memoVoice = $('memo-voice');
    el.memoVoiceLabel = $('memo-voice-label');
    el.memoClose = $('memo-close');
    el.memoSummarize = $('memo-summarize');
    el.memoStruct = $('memo-struct');
    el.memoExtract = $('memo-extract');
    el.memoDelete = $('memo-delete');
    el.memoAiCard = $('memo-ai-card');
    el.memoAiLabel = $('memo-ai-label');
    el.memoAiBadge = $('memo-ai-badge');
    el.memoAiBody = $('memo-ai-body');
    el.memoAiPoints = $('memo-ai-points');
    el.memoAiAgain = $('memo-ai-again');
    el.memoAiHide = $('memo-ai-hide');
    el.memoTagsBtn = $('memo-tags-btn');
    el.memoTagSug = $('memo-tagsug');
    el.qaLayer = $('qa-layer');
    el.qaInput = $('qa-input');
    el.qaAsk = $('qa-ask');
    el.qaHint = $('qa-hint');
    el.qaResult = $('qa-result');
    el.qaAnswer = $('qa-answer');
    el.qaRefs = $('qa-refs');
    el.qaClose = $('qa-close');
    el.memoReview = $('memo-review');
    el.memoRewrite = $('memo-rewrite');
    el.memoRwModes = $('memo-rwmodes');
    el.memoRwPolish = $('memo-rw-polish');
    el.memoRwExpand = $('memo-rw-expand');
    el.memoRwNo = $('memo-rw-no');
    el.memoRwCard = $('memo-rwcard');
    el.memoRwLabel = $('memo-rw-label');
    el.memoRwBadge = $('memo-rw-badge');
    el.memoRwOrig = $('memo-rw-orig');
    el.memoRwNew = $('memo-rw-new');
    el.memoRwAdopt = $('memo-rw-adopt');
    el.memoRwDrop = $('memo-rw-drop');
    el.memoRelated = $('memo-related');
    el.memoRelatedList = $('memo-related-list');
    el.reviewLayer = $('review-layer');
    el.reviewClose = $('review-close');
    el.rvwGrid = $('rvw-grid');
    el.rvwTags = $('rvw-tags');
    el.rvwSed = $('rvw-sed');
    el.rvwSedList = $('rvw-sedlist');
    el.rvwHint = $('rvw-hint');
    el.rvwAi = $('rvw-ai');
    el.rvwAiText = $('rvw-aitext');
    el.rvwAiBtn = $('rvw-ai-btn');
    el.draftLayer = $('draft-layer');
    el.draftTitle = $('draft-title');
    el.draftNote = $('draft-note');
    el.draftList = $('draft-list');
    el.draftStat = $('draft-stat');
    el.draftOk = $('draft-ok');
    el.draftCancel = $('draft-cancel');
    el.draftClose = $('draft-close');
    el.consentPick = $('consent-pick');
    el.consentDesc = $('consent-desc');
  }

  function bindMemoEvents() {
    if (el.tabMemos) {
      el.tabMemos.addEventListener('click', function () { switchPanel('memos'); });
    }
    if (el.memoNew) {
      el.memoNew.addEventListener('click', function () { openMemoSheet(''); });
    }
    if (el.memoList) {
      el.memoList.addEventListener('click', function (event) {
        var li = event.target.closest ? event.target.closest('.memo') : null;
        if (!li) return;
        var id = li.getAttribute('data-id');
        var act = event.target.closest('[data-act]');
        var action = act ? act.getAttribute('data-act') : '';
        if (action === 'del') { deleteMemo(id); return; }
        openMemoSheet(id);
      });
    }
    if (el.memoSearch) {
      el.memoSearch.addEventListener('input', function () {
        if (memoUi.searchTimer) global.clearTimeout(memoUi.searchTimer);
        memoUi.searchTimer = global.setTimeout(function () {
          memoUi.searchTimer = 0;
          renderMemoList();
        }, 140);
      });
    }
    if (el.memoBodyInput) {
      el.memoBodyInput.addEventListener('input', function () {
        if (memoDigits && memoDigits.before !== el.memoBodyInput.value) clearMemoDigits();
        memoWordCount();
        scheduleMemoSave();
      });
    }
    if (el.memoTitleInput) {
      el.memoTitleInput.addEventListener('input', scheduleMemoSave);
    }
    if (el.memoClose) el.memoClose.addEventListener('click', closeMemoSheet);
    if (el.memoLayer) {
      el.memoLayer.addEventListener('click', function (event) {
        if (event.target === el.memoLayer) closeMemoSheet();
      });
    }
    if (el.memoSummarize) el.memoSummarize.addEventListener('click', function () { runMemoTask('summarize'); });
    if (el.memoVoice) el.memoVoice.addEventListener('click', memoVoiceToggle);
    if (el.memoDigitAdopt) el.memoDigitAdopt.addEventListener('click', function () { adoptMemoDigits(false); });
    if (el.memoDigitUndo) el.memoDigitUndo.addEventListener('click', function () { adoptMemoDigits(true); });
    if (el.memoDigitDismiss) el.memoDigitDismiss.addEventListener('click', clearMemoDigits);
    if (el.memoStruct) el.memoStruct.addEventListener('click', function () { runMemoTask('structVoice'); });
    if (el.memoExtract) el.memoExtract.addEventListener('click', function () { runMemoTask('extractTodos'); });
    if (el.memoTagsBtn) el.memoTagsBtn.addEventListener('click', function () { runMemoTask('tags'); });
    if (el.memoAiAgain) el.memoAiAgain.addEventListener('click', function () { runMemoTask('summarize'); });
    if (el.memoAiHide) el.memoAiHide.addEventListener('click', function () { show(el.memoAiCard, false); });
    if (el.memoReview) el.memoReview.addEventListener('click', openReviewSheet);
    if (el.reviewClose) el.reviewClose.addEventListener('click', function () { cancelUiAi('review');show(el.reviewLayer, false); });
    if (el.rvwAiBtn) el.rvwAiBtn.addEventListener('click', runReviewAi);
    if (el.memoRewrite) el.memoRewrite.addEventListener('click', showRwModes);
    if (el.memoRwPolish) el.memoRwPolish.addEventListener('click', function () { runMemoRewrite('polish'); });
    if (el.memoRwExpand) el.memoRwExpand.addEventListener('click', function () { runMemoRewrite('expand'); });
    if (el.memoRwNo) el.memoRwNo.addEventListener('click', function () { if (el.memoRwModes) show(el.memoRwModes, false); });
    if (el.memoRwAdopt) bindRewriteAdopt(el.memoRwAdopt);
    if (el.memoRwDrop) el.memoRwDrop.addEventListener('click', function () {
      hideRewriteCard();
      setMemoStat('改写稿已丢弃，正文没动');
    });
    if (el.memoAsk) el.memoAsk.addEventListener('click', openQaSheet);
    if (el.qaClose) el.qaClose.addEventListener('click', function () { cancelUiAi('qa');show(el.qaLayer, false); });
    if (el.qaLayer) {
      el.qaLayer.addEventListener('click', function (event) {
        if (event.target === el.qaLayer) {cancelUiAi('qa');show(el.qaLayer, false);}
      });
    }
    if (el.qaAsk) el.qaAsk.addEventListener('click', qaAskNow);
    if (el.qaInput) {
      el.qaInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          qaAskNow();
        }
      });
    }
    if (el.memoDelete) {
      el.memoDelete.addEventListener('click', function () {
        if (!memoUi.id) { toast('还没保存，没什么可删的'); return; }
        deleteMemo(memoUi.id);
      });
    }
    if (el.draftOk) el.draftOk.addEventListener('click', confirmDraft);
    if (el.draftCancel) el.draftCancel.addEventListener('click', function () { show(el.draftLayer, false); });
    if (el.draftClose) el.draftClose.addEventListener('click', function () { show(el.draftLayer, false); });
    if (el.draftLayer) {
      el.draftLayer.addEventListener('click', function (event) {
        if (event.target === el.draftLayer) show(el.draftLayer, false);
      });
    }
  }

  /** 退出登录：别把上一个人的笔记留在屏幕上 */
  function resetMemoView() {
    cancelUiAi('memo'); cancelUiAi('qa'); cancelUiAi('review');
    cancelMemoRewrite();
    memoVoiceCancel(true);
    memoUi.id = '';
    memoUi.searchSeq=(memoUi.searchSeq || 0)+1;
    if (memoUi.searchTimer) {global.clearTimeout(memoUi.searchTimer);memoUi.searchTimer=0;}
    if (el.memoSearch) el.memoSearch.value='';
    if (memoUi.timer) { global.clearTimeout(memoUi.timer); memoUi.timer = 0; }
    draftUi.items = [];
    if (el.memoList) el.memoList.textContent = '';
    if (el.memoLayer) show(el.memoLayer, false);
    if (el.draftLayer) show(el.draftLayer, false);
    renderMemoBadge(0);
  }

  /**
   * M2 迁移：localStorage 里的 memo / derived 搬进原生 SQLite。
   * 规矩：只复制不删源（localStorage 那份留着当回滚依据）；逐条幂等——
   * 库里已有的 id 直接跳过，搬一半崩了下次启动接着搬。
   * 任何一条写失败都抛错，让 Migrator 把版本停在 v3 下次重试，绝不搬一半就宣布完成。
   */
  function migrateLocalToSqlite() {
    var repo = global.SqlRepo;
    if (!repo || typeof repo.available !== 'function' || !repo.available()) {
      throw new Error('sqlite unavailable');
    }
    var indexer = global.IndexStore;

    var users = {};
    try {
      var PREFIX = 'today-todo:v1:';
      for (var i = 0; i < global.localStorage.length; i++) {
        var k = global.localStorage.key(i);
        if (k && k.indexOf(PREFIX + 'memo:') === 0) users[k.slice((PREFIX + 'memo:').length)] = true;
      }
    } catch (error) { /* 列不出来就只搬当前登录用户 */ }
    var ids = Object.keys(users);
    var me = memoUser();
    if (me && ids.indexOf(me) === -1) ids.push(me);

    var copied = 0;
    var failed = 0;
    for (var u = 0; u < ids.length; u++) {
      var userId = ids[u];
      if (!userId) continue;
      var memos = Store.read('memo:' + userId, []);
      if (Array.isArray(memos)) {
        for (var m = 0; m < memos.length; m++) {
          var memo = global.MemoService ? global.MemoService.normalize(memos[m]) : null;
          if (!memo) continue;
          if (repo.getMemo(userId, memo.id)) continue;   /* 幂等 */
          if (repo.putMemo(memo)) {
            copied += 1;
            if (indexer && typeof indexer.syncMemo === 'function') {
              try { indexer.syncMemo(memo); } catch (error) { /* 索引坏了下次 rebuild */ }
            }
          } else failed += 1;
        }
      }
      var derived = Store.read('derived:' + userId, {});
      if (derived && typeof derived === 'object') {
        for (var dk in derived) {
          if (!Object.prototype.hasOwnProperty.call(derived, dk)) continue;
          var rec = derived[dk];
          if (!rec || !rec.memoId || !rec.kind) continue;
          if (repo.getDerived(userId, rec.memoId, rec.kind)) continue;
          if (repo.putDerived(userId, rec)) copied += 1;
          else failed += 1;
        }
      }
    }
    if (failed) throw new Error('sqlite copy failed x' + failed);
    return copied;
  }

  function boot() {
    cacheElements();

    if (!Store.available) {
      show(el.viewAuth, true);
      el.loginError.textContent =
        '浏览器存储不可用（可能处于隐私模式），无法保存账号和待办数据。';
      el.loginSubmit.disabled = true;
      el.regSubmit.disabled = true;
      return;
    }

    /* 数据版本先推一版：这次是从「明文密钥 + 无用量表」到 v2，
       迁移函数都是幂等的，失败也不会把数据改坏，下次启动继续尝试 */
    if (global.Migrator && typeof global.Migrator.up === 'function') {
      try {
        global.Migrator.up({
          2: function () { /* 结构性变更都在首次读写时按字段兼容，这里只推版本号 */ },
          3: function () { /* M1：memo / derived 是新命名空间，没有旧数据要搬 */ },
          4: function () {
            /* M2：memo / derived 搬进原生 SQLite 并建索引。
               网页版没有 SQLite 会在这里停住（版本留在 3），继续用 localStorage，
               这是设计内的降级，不算失败；原生设备搬不动则下次启动重试 */
            migrateLocalToSqlite();
          }
        });
      } catch (error) {
        /* 迁移失败不影响启动 */
      }
    }

    loadPrefs();
    /* 密钥搬家：明文 → Keystore（只在原生环境做，网页版保持原样） */
    secureKeys();
    /* 记账后刷新设置页上的用量；页面没开就不做任何事 */
    if (global.AiUsage && typeof global.AiUsage === 'object') {
      global.AiUsage.onChange = function () {
        if (el.settingsLayer && !el.settingsLayer.classList.contains('is-hidden')) {
          renderAiUsage();
        }
      };
    }
    bindAuthEvents();
    bindTodoEvents();
    /* 笔记：元素缓存 → 事件 → 数据范围三档 → 把任务层接到模型通道 */
    cacheMemoElements();
    bindMemoEvents();
    renderConsent();
    registerAiTransport();
    /* 混合检索的 AI 扩词只有在「有模型 + 允许联网」时才走，其余一路字面兜底 */
    if (global.SearchService && typeof global.SearchService.setAiGate === 'function') {
      global.SearchService.setAiGate(function () {
        var policy = global.ConsentPolicy;
        return usableModels().length > 0 && (!policy || policy.mode() === 'online');
      });
    }
    preloadArtFont();

    /* 上次选过主题就照旧，没选过就跟着系统深浅色走（由原生推过来） */
    if (prefs.theme) applyThemeMode(prefs.theme);

    var user = Auth.currentUser();
    if (user) {
      enterApp(user);
    } else {
      showAuthView();
      switchTab('login');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);

/* ==========================================================================
   键盘稳定层 + 图片兜底（2026-11-26 追加在 app.js 末尾，独立作用域，不改上面的逻辑）

   键盘为什么会把布局弄乱
   ----------------------
   原生在键盘弹起时，把「键盘高度」加成根视图的底部内边距，WebView 因此整体变矮。
   对页面来说这是一次视口骤缩，而且键盘动画的每一帧都会来一次：
   · 所有 vh / dvh 尺寸逐帧变化，居中的弹层跟着逐帧上下跳、内容被压扁重排；
   · 弹层里靠下的输入框直接落到键盘底下，没有任何逻辑把它露出来。
   原生其实已经把内边距推给了页面（TodoNativeHost.receiveInsets → --inset-bottom），
   但页面只记录不使用。

   这一层做什么
   ------------
   1. 收到内边距开始变大 → 判定「键盘正在弹出」，把当前浮层的尺寸锁在弹出前的大小，
      浮层画布也保持弹出前的高度。于是键盘动画期间内容零重排，只是下沿被键盘盖住。
   2. 键盘动画落定后 → 如果聚焦的输入框在可视区下方，先滚弹层内部，不够再整体上移。
   3. 内边距回落 → 解除锁定，浮层原位恢复。
   没有原生内边距的环境（普通浏览器）退化为按可视高度变化判断，行为一致。
   ========================================================================== */
(function (global) {
  'use strict';

  var doc = global.document;
  var root = doc.documentElement;
  var OPEN_DELTA = 80;    /* 底部内边距比「无键盘」多出这么多，就认定键盘在弹出 */
  var CLOSE_DELTA = 28;   /* 回落到基准的这个范围以内，认定键盘已收起 */
  var SETTLE_MS = 100;   /* 内边距最后一次变化后等这么久，算动画结束。
                            偶尔在动画中途就到了也没关系：露出输入框的算法可以重复执行，之后会再修正一次 */
  var EDGE = 16;         /* 输入框与键盘之间留的空隙 */

  var baseBottom = -1;   /* 没有键盘时的底部内边距（手势条 / 导航栏） */
  var restVp = 0;        /* 没有键盘时的可视高度 */
  var open = false;
  var locked = [];
  var settleTimer = 0;
  var restTimer = 0;
  var releaseTimer = 0;
  var pendingRestore = null;   /* 解除后等 200ms 才还原的记录 */

  function visible(el) {
    if (!el || el.classList.contains('is-hidden')) return false;
    return el.getBoundingClientRect().height > 0;
  }

  /* 浮层 = 页面里的弹层（.sheet-layer）+ 原生 <dialog>（词库面板） */
  function floaters() {
    var out = [];
    var layers = doc.querySelectorAll('.sheet-layer');
    for (var i = 0; i < layers.length; i++) if (visible(layers[i])) out.push(layers[i]);
    var dialogs = doc.querySelectorAll('dialog[open]');
    for (var j = 0; j < dialogs.length; j++) out.push(dialogs[j]);
    return out;
  }

  function innerSheet(box) {
    if (box.tagName === 'DIALOG') return box;
    return box.querySelector('.sheet') || box;
  }

  function isTextEntry(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    var t = (el.type || 'text').toLowerCase();
    return t !== 'checkbox' && t !== 'radio' && t !== 'button' && t !== 'submit' && t !== 'range' && t !== 'file';
  }

  /* 记住「没有键盘时」各浮层的高度。键盘弹出可能只给我们一次回调机会，
     届时视口也许已经矮了一截，所以尺寸必须提前在静止时量好。 */
  function captureRest() {
    if (open) return;
    /* 原生内边距已经离开基准 = 键盘正在弹出/收起，此刻视口是矮的。
       这时采下去会把「无键盘高度」记成动画中间值：实测快速收起再弹出时，
       上一轮 release() 的 200ms 定时器正好落在这一轮的弹出动画里（视口 802 而非 869），
       基准被记成 802，下一次锁定就按矮的高度锁，弹层整体上跳 67px。
       所以此时直接跳过，等真回到基准后的那一次采集再更新。 */
    if (baseBottom >= 0 && lastBottom > baseBottom + CLOSE_DELTA) return;
    restVp = global.innerHeight;
    var boxes = floaters();
    for (var i = 0; i < boxes.length; i++) {
      var sheet = innerSheet(boxes[i]);
      sheet.__uiRestH = sheet.offsetHeight;
      sheet.__uiRestScroll = sheet.scrollHeight > sheet.clientHeight + 1;
    }
  }

  function scheduleRest() {
    clearTimeout(restTimer);
    restTimer = setTimeout(captureRest, 140);
  }

  function engage() {
    if (open) return;
    /* 上一轮的「解除还原」还排在定时器里没执行：先立刻还原干净，再记这一轮的旧值。
       否则那个迟到的定时器会把这一轮刚锁上的样式抹掉（实测：快速连开两次键盘，
       第二次弹层就没锁住，而且内联样式会永久残留）。 */
    flushRestore();
    open = true;
    root.setAttribute('data-kb', 'open');
    if (!restVp) restVp = global.innerHeight;
    var boxes = floaters();
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      var sheet = innerSheet(box);
      var isLayer = box.tagName !== 'DIALOG';
      /* 没有静止时的记录（浮层刚开、键盘立刻弹出）：高度补上已经缩掉的那一截 */
      var kb = baseBottom >= 0 ? lastBottom - baseBottom : 0;
      var h = sheet.__uiRestH || (sheet.offsetHeight + Math.max(0, kb));
      var scrollable = typeof sheet.__uiRestScroll === 'boolean' ? sheet.__uiRestScroll : sheet.scrollHeight > sheet.clientHeight + 1;
      var rec = { box: box, sheet: sheet, isLayer: isLayer, boxProps: [], sheetProps: [] };
      if (isLayer) {
        setProp(rec, true, box, 'height', restVp + 'px');
        setProp(rec, true, box, 'bottom', 'auto');
        setProp(rec, true, box, 'transition', 'none');
      }
      setProp(rec, false, sheet, 'max-height', h + 'px');
      if (scrollable) setProp(rec, false, sheet, 'height', h + 'px');
      /* 把这两个属性也纳入记录：解除时能精确还原，不留内联残留 */
      setProp(rec, false, sheet, 'transform', 'none');
      setProp(rec, false, sheet, 'transition', 'none');
      locked.push(rec);
    }
  }

  /* 逐属性记录旧的内联值，解除时精确还原，不碰应用自己写的内联样式 */
  function setProp(rec, onBox, el, name, value) {
    (onBox ? rec.boxProps : rec.sheetProps).push([name, el.style.getPropertyValue(name), el.style.getPropertyPriority(name)]);
    el.style.setProperty(name, value);
  }

  function restore(rec) {
    var i;
    var p;
    for (i = 0; i < rec.boxProps.length; i++) {
      p = rec.boxProps[i];
      if (p[1]) rec.box.style.setProperty(p[0], p[1], p[2]); else rec.box.style.removeProperty(p[0]);
    }
    for (i = 0; i < rec.sheetProps.length; i++) {
      p = rec.sheetProps[i];
      if (p[1]) rec.sheet.style.setProperty(p[0], p[1], p[2]); else rec.sheet.style.removeProperty(p[0]);
    }
  }

  /* 键盘落定：把聚焦的输入框挪到键盘上方 */
  function reveal() {
    var el = doc.activeElement;
    if (!isTextEntry(el)) return;
    var limit = global.innerHeight - EDGE;
    var r = el.getBoundingClientRect();
    if (r.height <= 0) return;
    /* 单行输入框要整条露出来；多行文本域只要求最上面的两行露出来，
       否则一个大文本域会让整个弹层跳上去 */
    var needBottom = el.tagName === 'TEXTAREA' ? Math.min(r.bottom, r.top + 72) : r.bottom;
    if (needBottom <= limit && r.top >= EDGE) return;   /* 本来就看得见 */

    var over = needBottom + EDGE - limit;
    for (var i = 0; i < locked.length; i++) {
      var rec = locked[i];
      if (!rec.box.contains(el)) continue;
      var sheet = rec.sheet;
      /* 先用弹层自己的滚动；只有短弹层或已经滚到底才需要整体上移 */
      if (sheet.scrollHeight > sheet.clientHeight + 1) {
        var canScroll = sheet.scrollHeight - sheet.clientHeight - sheet.scrollTop;
        var scrolled = Math.min(over, canScroll);
        if (scrolled > 0) {
          sheet.scrollTop += scrolled;
          r = el.getBoundingClientRect();
          needBottom = el.tagName === 'TEXTAREA' ? Math.min(r.bottom, r.top + 72) : r.bottom;
          over = needBottom + EDGE - limit;
        }
      }
      if (over > 0) {
        var sr = sheet.getBoundingClientRect();
        var shift = Math.min(over, Math.max(0, sr.top - 8));
        if (shift > 0) {
          sheet.style.transition = 'transform 0.16s ease-out';
          sheet.style.transform = 'translateY(-' + Math.round(shift) + 'px)';
        }
      }
      return;
    }

    /* 输入框不在浮层里：让浏览器把它滚进可视区（弹层是 fixed 的，不会带动页面） */
    if (el.scrollIntoView) el.scrollIntoView({ block: 'center' });
  }

  function release() {
    if (!open) return;
    open = false;
    root.removeAttribute('data-kb');
    var i;
    for (i = 0; i < locked.length; i++) {
      if (locked[i].sheet.style.transform) {
        locked[i].sheet.style.transition = 'transform 0.16s ease-out';
        locked[i].sheet.style.transform = '';
      }
    }
    pendingRestore = locked;
    locked = [];
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(function () {
      flushRestore();
      captureRest();
    }, 200);
  }

  /* 把「解除后延迟还原」的样式立刻还原。键盘收起时先让上移的弹层滑回原位，再过 200ms 收掉内联样式。 */
  function flushRestore() {
    if (!pendingRestore) return;
    var list = pendingRestore;
    pendingRestore = null;
    clearTimeout(releaseTimer);
    for (var j = 0; j < list.length; j++) restore(list[j]);
  }

  var lastBottom = 0;

  function onBottom(bottom) {
    if (!(bottom >= 0)) return;
    lastBottom = bottom;
    if (baseBottom < 0) {
      /* 第一次就收到内边距。如果这时视口已经矮了一截，说明这一帧本身就是键盘，
         基准要倒推回去，否则会把「键盘高度」当成导航栏，之后永远判定不出弹出 */
      var shrink = restVp ? restVp - global.innerHeight : 0;
      baseBottom = shrink > OPEN_DELTA ? Math.max(0, bottom - shrink) : bottom;
    }
    if (!open && bottom < baseBottom) baseBottom = bottom;   /* 导航栏形态变化，基准取更小的 */

    if (!open && bottom > baseBottom + OPEN_DELTA) {
      engage();
    } else if (open && bottom <= baseBottom + CLOSE_DELTA) {
      release();
      return;
    } else if (!open) {
      return;
    }
    clearTimeout(settleTimer);
    settleTimer = setTimeout(function () {
      if (open) reveal();
    }, SETTLE_MS);
  }

  /* 信号一：原生推来的内边距（权威信号，含键盘动画的每一帧） */
  function hookNative(attempt) {
    var host = global.TodoNativeHost;
    if (host && typeof host.receiveInsets === 'function' && !host.__uiKbHooked) {
      var original = host.receiveInsets;
      host.receiveInsets = function (top, bottom) {
        var out = original.apply(this, arguments);
        try {
          onBottom(Number(bottom) || 0);
        } catch (err) { /* 稳定层自身出错不能影响原有逻辑 */ }
        return out;
      };
      host.__uiKbHooked = true;
      return true;
    }
    if (attempt < 40) setTimeout(function () { hookNative(attempt + 1); }, 100);
    return false;
  }

  /* 信号二：可视高度变化。没有原生内边距的环境靠它；有原生时它只是补充 */
  global.addEventListener('resize', function () {
    if (baseBottom >= 0) return;   /* 有原生信号时以原生为准 */
    var h = global.innerHeight;
    if (!restVp) { restVp = h; return; }
    if (!open && restVp - h > OPEN_DELTA) {
      lastBottom = h;
      engage();
    } else if (open && h >= restVp - CLOSE_DELTA) {
      release();
      return;
    } else {
      return;
    }
    clearTimeout(settleTimer);
    settleTimer = setTimeout(function () {
      if (open) reveal();
    }, SETTLE_MS);
  });

  /* 浮层开了又关是很频繁的：只在静止时（键盘没弹出）重新量尺寸 */
  function watchFloaters() {
    if (typeof global.MutationObserver !== 'function') return;
    var mo = new global.MutationObserver(function () {
      if (!open) scheduleRest();
    });
    mo.observe(doc.body, {
      attributes: true,
      attributeFilter: ['class', 'open', 'style'],
      subtree: true,
    });
  }

  /* 加载失败的图片：做个标记，样式层把它藏起来（登录页封面在所有包里都不存在）。
     用捕获阶段监听，能接住不冒泡的 error 事件；脚本执行前就已经失败的图要补扫一遍。 */
  function markBroken(img) {
    if (img && img.tagName === 'IMG' && img.complete && img.naturalWidth === 0) {
      img.setAttribute('data-broken', '1');
    }
  }
  doc.addEventListener('error', function (event) {
    markBroken(event.target);
  }, true);
  function sweepBroken() {
    var imgs = doc.images;
    for (var i = 0; i < imgs.length; i++) markBroken(imgs[i]);
  }

  /* 换主题时按钮不做渐变。
     样式层给所有按钮加了背景色 / 边框色过渡（按钮自身状态切换时配色不再「跳」）。
     但换主题会一次改掉页面上所有按钮的配色，一百多条过渡同时在主线程逐帧重算；
     连点换主题时主线程比原版多出三到六成。
     做法：根元素的主题属性一变，就挂上「正在换主题」标记（样式层据此临时关掉按钮过渡），
     等两帧画完再摘掉——这两帧里浏览器已经按新配色、无过渡地算过一遍样式，摘掉标记时数值不再变化，
     所以不会补跑过渡。按钮自身状态切换的渐变不受影响。
     效果：换主题时按钮配色即时切换（与原版一致），其余场合照常渐变。 */
  var RETHEME_CLASS = 'is-retheming';
  var rethemeFrames = 0;
  function rethemeTick() {
    rethemeFrames -= 1;
    if (rethemeFrames <= 0) root.classList.remove(RETHEME_CLASS);
    else global.requestAnimationFrame(rethemeTick);
  }
  function watchTheme() {
    if (typeof global.MutationObserver !== 'function' || typeof global.requestAnimationFrame !== 'function') return;
    new global.MutationObserver(function () {
      root.classList.add(RETHEME_CLASS);
      var idle = rethemeFrames <= 0;
      rethemeFrames = 2;                       /* 连点时续上，不重新计数 */
      if (idle) global.requestAnimationFrame(rethemeTick);
    }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  }

  function start() {
    hookNative(0);
    watchFloaters();
    watchTheme();
    sweepBroken();
    global.addEventListener('load', sweepBroken);
    scheduleRest();
  }
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window);
/* ==========================================================================
   paste-import.js — 常用人名「粘贴昵称」入口
   --------------------------------------------------------------------------
   为什么需要：设置页原来只有「从文本导入」，点开是系统文件选择器，要求用户先有
   一份 UTF-8 的 txt。微信 / QQ 都不提供好友名单导出，所以这个入口等于死路。

   本补丁在不碰 dex、不碰 HTML 的前提下，加一个「粘贴昵称」按钮 + 一个 <dialog>：
   在微信 / QQ 里长按复制昵称，粘进来，点「导入」即追加到 #voice-names。
   归一化与去重完全交给原有的「保存常用人名」流程（app.js 的 normalizeVoiceNames），
   这里不复制那套规则，避免两处规则漂移。

   注意：app.js 整体在 (function (global) { … })(window) 里，本补丁拼接在其后，
   拿不到闭包内的 toast / normalizeVoiceNames，因此 toast 复用页面上的 #toast 元素，
   样式只使用 :root 里的主题令牌，跟随三套主题自动变色。
   ========================================================================== */
(function (global) {
  'use strict';

  var doc = global.document;
  var BTN_ID = 'paste-voice-names';
  var DLG_ID = 'paste-voice-names-dialog';
  var STYLE_ID = 'paste-voice-names-style';

  var CSS = [
    '#' + DLG_ID + '{width:min(92vw,32rem);max-height:86vh;overflow:auto;padding:16px;',
    '  border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);color:var(--text);}',
    '#' + DLG_ID + '::backdrop{background:rgba(20,26,44,.42);}',
    '#' + DLG_ID + ' header{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:0 0 10px;}',
    '#' + DLG_ID + ' header h2{margin:0;font-size:16px;color:var(--text);}',
    '#' + DLG_ID + ' p{margin:0 0 10px;color:var(--text-2);font-size:13px;line-height:1.65;}',
    '#' + DLG_ID + ' textarea{width:100%;min-height:9em;padding:10px;border:1px solid var(--line);',
    '  border-radius:var(--radius-sm);background:var(--bg);color:var(--text);font:inherit;font-size:14px;resize:vertical;}',
    '#' + DLG_ID + ' .paste-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}',
    '#' + DLG_ID + ' button{min-height:40px;padding:0 14px;border:1px solid var(--line);',
    '  border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font:inherit;font-size:14px;}',
    '#' + DLG_ID + ' button[data-apply]{background:var(--primary);border-color:var(--primary);color:#fff;}',
  ].join('\n');

  function $(id) {
    return doc.getElementById(id);
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

  /* 一行一个为主流粘贴格式；顿号 / 逗号 / 分号 / 竖线也当分隔符。
     顺序很关键：必须**先按行剥掉行首序号，再切分隔符**。
     反例（真机实测）：`3、测试丙、测试丁` 若先按顿号切，会切出孤立的 `3`，
     序号正则匹配不到它，`3` 就被当成一个昵称导入了（提示「已加入 7 条」而非 6 条）。
     纯数字条目再兜底丢掉，避免序号以任何形式残留。 */
  function splitNames(text) {
    return String(text == null ? '' : text)
      .split(/\r?\n/)
      .map(function (line) {
        return line.replace(/^\s*\d+\s*[.、)．]\s*/, '').trim();
      })
      .join('\n')
      .split(/[\r\n、，,；;|]+/)
      .map(function (item) {
        return item.trim();
      })
      .filter(function (item) {
        return item.length > 0 && !/^\d+$/.test(item);
      });
  }

  function buildDialog() {
    var dlg = doc.createElement('dialog');
    dlg.id = DLG_ID;
    dlg.setAttribute('aria-labelledby', DLG_ID + '-title');
    dlg.innerHTML = [
      '<header>',
      '  <h2 id="' + DLG_ID + '-title">粘贴昵称</h2>',
      '  <button type="button" data-close>关闭</button>',
      '</header>',
      '<p>在微信 / QQ 里长按昵称或备注复制，粘到下面。一行一个，或用顿号、逗号分隔，行首序号（1. / 3、）会自动去掉。<br>',
      '  点「读取剪贴板」没反应时，长按输入框选「粘贴」即可。<br>',
      '  点「导入」只是追加到「常用人名」，核对无误后再点「保存常用人名」；保存时只保留 2–4 个汉字，',
      '  昵称里的表情、字母、数字行会被忽略。</p>',
      '<textarea id="' + DLG_ID + '-text" placeholder="李娜&#10;欧阳明宇"></textarea>',
      '<div class="paste-row">',
      '  <button type="button" data-clip>读取剪贴板</button>',
      '  <button type="button" data-close>取消</button>',
      '  <button type="button" data-apply>导入</button>',
      '</div>',
    ].join('\n');
    return dlg;
  }

  function area() {
    return $('voice-names');
  }

  function doImport(dlg) {
    var target = area();
    var box = $(DLG_ID + '-text');
    if (!target || !box) return;
    var names = splitNames(box.value);
    if (!names.length) {
      tip('没有可导入的内容');
      return;
    }
    var head = target.value.replace(/[、，,\s]+$/, '');
    target.value = (head ? head + '、' : '') + names.join('、');
    /* 值是被脚本改的，通知一下可能监听 input/change 的逻辑 */
    target.dispatchEvent(new global.Event('input', { bubbles: true }));
    dlg.close();
    tip('已加入 ' + names.length + ' 条，请核对后点「保存常用人名」');
  }

  /* 真机实测：待办 App 的 WebView 没处理 onPermissionRequest，readText() 必被拒
     （NotAllowedError），所以这里的失败分支是常态而不是例外。失败时把焦点放到输入框，
     让「长按 → 粘贴」这条系统菜单路径一步可达。 */
  function guideManualPaste(message) {
    var box = $(DLG_ID + '-text');
    tip(message);
    if (box) box.focus();
  }

  function readClipboard() {
    var box = $(DLG_ID + '-text');
    var clip = global.navigator && global.navigator.clipboard;
    if (!box) return;
    if (!clip || typeof clip.readText !== 'function') {
      guideManualPaste('长按输入框，选「粘贴」即可');
      return;
    }
    clip.readText().then(function (text) {
      if (!text) {
        tip('剪贴板是空的');
        return;
      }
      box.value = box.value ? box.value.replace(/\s+$/, '') + '\n' + text : text;
    }).catch(function () {
      guideManualPaste('长按输入框，选「粘贴」即可');
    });
  }

  function bind(dlg) {
    dlg.addEventListener('click', function (event) {
      var node = event.target;
      var btn = node && typeof node.closest === 'function' ? node.closest('button') : null;
      if (!btn) {
        /* 点遮罩关闭：event.target 就是 dialog 本身 */
        if (event.target === dlg) dlg.close();
        return;
      }
      if (btn.hasAttribute('data-close')) dlg.close();
      else if (btn.hasAttribute('data-clip')) readClipboard();
      else if (btn.hasAttribute('data-apply')) doImport(dlg);
    });
  }

  function mount() {
    if ($(BTN_ID)) return;
    var anchor = $('import-voice-names');
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
    btn.textContent = '粘贴昵称';
    anchor.parentNode.insertBefore(btn, anchor.nextSibling);

    var dlg = buildDialog();
    doc.body.appendChild(dlg);
    bind(dlg);

    btn.addEventListener('click', function () {
      var box = $(DLG_ID + '-text');
      if (box) box.value = '';
      dlg.showModal();
      if (box) box.focus();
      readClipboard();
    });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})(window);
