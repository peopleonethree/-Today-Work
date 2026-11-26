/* ==========================================================================
   migrate.js — 数据版本与一次性迁移（L5）

   规矩：只加字段，不删字段；版本号单向前进，永远不往回退。
   每次升级拿一个新的整数，老的安装包读到新数据只会忽略不认识的字段。

   为什么要有它：密钥从明文改成 Keystore 引用、AI 用量表上线、以后的 memo
   正文与索引，都是「同一份 localStorage 的不同形态」。没有一个版本号，
   出了问题是没法判断用户处在哪一档的。
   ========================================================================== */

(function (global) {
  'use strict';

  var KEY = 'schemaVersion';
  var LATEST = 4;
  /* 1 = v1.0.31 及以前：明文密钥、无用量表
     2 = v1.0.32：密钥进 Keystore（keyRef）、AI 用量表、发送前脱敏
     3 = v1.0.33：新增 memo / derived 两个命名空间（笔记有正文了）。
         没有历史数据要搬——之前根本没地方存长文——
         这一步只把版本号记上，以后排查「这条笔记是哪版之后出现的」有据可依
     4 = v1.0.38（M2）：memo / derived 搬进原生 SQLite，索引表建立。
         搬运只复制不删源数据（只加不删；localStorage 那份留作回滚依据），
         具体搬运在 boot() 里做——需要 AndroidHost 就绪后才能判断走不走 SQLite。
         没有原生桥的设备（网页版）停在 v3 语义下继续用 localStorage，不算失败 */

  function readRaw() {
    try {
      var raw = global.AppStorage ? global.AppStorage.read(KEY, null) : null;
      return raw && typeof raw === 'object' ? raw : null;
    } catch (error) {
      return null;
    }
  }

  function version() {
    var raw = readRaw();
    var v = raw ? Number(raw.version) : 0;
    return isFinite(v) && v > 0 ? v : 1;
  }

  function done(id) {
    var raw = readRaw();
    return !!(raw && raw.done && raw.done[id]);
  }

  function markDone(id) {
    var raw = readRaw() || { version: version(), done: {} };
    raw.done = raw.done || {};
    raw.done[id] = Date.now();
    try {
      if (global.AppStorage) global.AppStorage.write(KEY, raw);
    } catch (error) {
      /* 记不上就下次再跑；迁移函数必须自身幂等 */
    }
  }

  /** 跑一次就行的一次性任务；同一台设备上第二次调用直接跳过 */
  function once(id, fn) {
    if (done(id)) return false;
    var ran = false;
    try {
      ran = fn() !== false;
    } catch (error) {
      ran = false;
    }
    if (ran) markDone(id);
    return ran;
  }

  /**
   * 把版本号推到最新。handlers 是 { 2: fn, 3: fn … }，只跑「比当前大」的那几步。
   * 返回 { from, to, steps }
   */
  function up(handlers) {
    var from = version();
    var to = from;
    var steps = [];
    for (var v = from + 1; v <= LATEST; v++) {
      var fn = handlers && handlers[v];
      if (typeof fn === 'function') {
        try {
          fn();
        } catch (error) {
          /* 单步失败就停在这个版本，下次启动重试，不硬往下推 */
          break;
        }
      }
      steps.push(v);
      to = v;
    }
    if (to !== from) {
      var raw = readRaw() || { done: {} };
      raw.version = to;
      raw.done = raw.done || {};
      raw.at = Date.now();
      try {
        if (global.AppStorage) global.AppStorage.write(KEY, raw);
      } catch (error) {
        /* 写不进去也认了，内存里已经是新版行为 */
      }
    }
    return { from: from, to: to, steps: steps };
  }

  global.Migrator = {
    LATEST: LATEST,
    version: version,
    up: up,
    once: once,
    done: done
  };
})(window);
