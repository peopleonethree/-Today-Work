/* ==========================================================================
   usage.js — AI 调用的计量表（L4）

   每次请求记一条：哪个任务、哪个模型、多少 token、多久、成没成。
   按天聚合成一份很小的记录落盘，只在本机，永不上传。

   对外只有四个动作：record / today / summary / budget*；
   页面拿它画「今日用量」，AiGateway 拿它做预算拦截。
   ========================================================================== */

(function (global) {
  'use strict';

  var KEY = 'aiUsage';
  var KEEP_DAYS = 60;          /* 只留两个月，够看趋势，也不会撑爆存储 */
  var DEFAULT_DAILY = 200000;  /* 每日 token 上限：够日常用，超了先提醒再拦 */

  var cache = null;
  /* 每次记账后通知一次（页面用它刷新「今日用量」），默认什么都不做 */
  var onChange = null;

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  /** 本地日历日（不是 UTC，跨时区不该算错一天） */
  function dayKey(ts) {
    var d = new Date(ts || Date.now());
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function blank(day) {
    return {
      day: day,
      calls: 0,
      ok: 0,
      fail: 0,
      tokensIn: 0,
      tokensOut: 0,
      ms: 0,
      byTask: {},
      byModel: {}
    };
  }

  function load() {
    if (cache) return cache;
    var raw = null;
    try {
      raw = global.AppStorage ? global.AppStorage.read(KEY, null) : null;
    } catch (error) {
      raw = null;
    }
    if (!raw || typeof raw !== 'object' || !raw.days) {
      cache = { v: 1, dailyLimit: DEFAULT_DAILY, days: {} };
      return cache;
    }
    cache = {
      v: 1,
      dailyLimit: typeof raw.dailyLimit === 'number' ? raw.dailyLimit : DEFAULT_DAILY,
      days: raw.days && typeof raw.days === 'object' ? raw.days : {}
    };
    return cache;
  }

  function persist() {
    var data = load();
    /* 按日期排序后裁掉过老的记录，避免无限长大 */
    var keys = Object.keys(data.days).sort();
    if (keys.length > KEEP_DAYS) {
      for (var i = 0; i < keys.length - KEEP_DAYS; i++) delete data.days[keys[i]];
    }
    try {
      if (global.AppStorage) global.AppStorage.write(KEY, data);
    } catch (error) {
      /* 落盘失败不影响本次请求的结果 */
    }
  }

  function bump(bucket, field, n) {
    if (!n) return;
    bucket[field] = (bucket[field] || 0) + n;
  }

  /**
   * 记一次调用。
   * rec = { task, modelId, tokensIn, tokensOut, ms, ok }
   */
  function record(rec) {
    var r = rec || {};
    var data = load();
    var key = dayKey(r.at);
    var d = data.days[key] || (data.days[key] = blank(key));

    d.calls += 1;
    if (r.ok) d.ok += 1; else d.fail += 1;
    d.tokensIn += Number(r.tokensIn) || 0;
    d.tokensOut += Number(r.tokensOut) || 0;
    d.ms += Number(r.ms) || 0;

    var task = String(r.task || 'chat');
    var t = d.byTask[task] || (d.byTask[task] = { calls: 0, ok: 0, fail: 0, tokensIn: 0, tokensOut: 0, ms: 0 });
    t.calls += 1;
    if (r.ok) t.ok += 1; else t.fail += 1;
    bump(t, 'tokensIn', Number(r.tokensIn) || 0);
    bump(t, 'tokensOut', Number(r.tokensOut) || 0);
    bump(t, 'ms', Number(r.ms) || 0);

    var model = String(r.modelId || '');
    if (model) {
      var m = d.byModel[model] || (d.byModel[model] = { calls: 0, tokensIn: 0, tokensOut: 0 });
      m.calls += 1;
      bump(m, 'tokensIn', Number(r.tokensIn) || 0);
      bump(m, 'tokensOut', Number(r.tokensOut) || 0);
    }

    persist();
    /* 设置页开着的时候要跟着跳数字，否则用户会以为统计坏了 */
    if (typeof onChange === 'function') {
      try { onChange(d); } catch (error) { /* 监听器自己的错不外溢 */ }
    }
    return d;
  }

  function today() {
    var data = load();
    return data.days[dayKey()] || blank(dayKey());
  }

  function totalOf(d) {
    return (d.tokensIn || 0) + (d.tokensOut || 0);
  }

  /** 给设置页用的聚合：调用数、token、失败率、平均耗时 */
  function summary() {
    var d = today();
    return {
      calls: d.calls,
      ok: d.ok,
      fail: d.fail,
      tokensIn: d.tokensIn,
      tokensOut: d.tokensOut,
      tokens: totalOf(d),
      tokensOutSum: d.tokensOut,
      avgMs: d.calls ? Math.round(d.ms / d.calls) : 0,
      failRate: d.calls ? Math.round(d.fail / d.calls * 100) : 0,
      byTask: d.byTask,
      byModel: d.byModel,
      dailyLimit: load().dailyLimit
    };
  }

  /** 今天还剩多少 token；limit <= 0 表示不设限，返回 -1 */
  function remaining() {
    var limit = load().dailyLimit;
    if (!limit || limit <= 0) return -1;
    return Math.max(0, limit - totalOf(today()));
  }

  function exceeded() {
    var left = remaining();
    return left === 0;
  }

  function dailyLimit() {
    return load().dailyLimit;
  }

  function setDailyLimit(n) {
    var v = Number(n);
    if (!isFinite(v) || v < 0) v = 0;
    load().dailyLimit = Math.round(v);
    persist();
    return load().dailyLimit;
  }

  function clear() {
    cache = { v: 1, dailyLimit: load().dailyLimit, days: {} };
    persist();
  }

  /** 上次一天的用量，给「昨天 / 今天」对比用 */
  function previousDay() {
    var data = load();
    var now = Date.now() - 86400000;
    return data.days[dayKey(now)] || blank(dayKey(now));
  }

  global.AiUsage = {
    record: record,
    today: today,
    summary: summary,
    remaining: remaining,
    exceeded: exceeded,
    dailyLimit: dailyLimit,
    setDailyLimit: setDailyLimit,
    clear: clear,
    previousDay: previousDay,
    dayKey: dayKey,
    /* 订阅：页面注册一个回调即可，不要在里面做重活 */
    set onChange(fn) { onChange = typeof fn === 'function' ? fn : null; },
    get onChange() { return onChange; }
  };
})(window);
