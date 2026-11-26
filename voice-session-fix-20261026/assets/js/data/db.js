/* ==========================================================================
   db.js — SQLite 同步桥（L5）
   原生 AndroidHost.dbQuery / dbExec 是同步调用：JS 这边阻塞到 Java 返回，
   所以领域层（memo / derived）能保持原来的同步 API 一行不改。
   网页版与 jsdom 测试没有 AndroidHost，available() 为 false，走各自兜底。

   返回约定：成功 {ok:true,...}，失败 {error:"..."} → 这里统一折成 null，
   让上层走「数据库不可用」分支，而不是拿到半个结果。
   ========================================================================== */

(function (global) {
  'use strict';

  var host = undefined; /* undefined = 还没探过，null = 探过没有 */

  function hostOf() {
    if (host !== undefined) return host;
    var h = global.AndroidHost;
    host = (h && typeof h.dbQuery === 'function' && typeof h.dbExec === 'function') ? h : null;
    return host;
  }

  /** 探测可用性；结果缓存——运行中途桥不会消失 */
  function available() {
    var h = hostOf();
    if (!h) return false;
    try {
      return typeof h.dbReady === 'function' ? !!h.dbReady() : true;
    } catch (error) {
      return false;
    }
  }

  function call(method, sql, params) {
    var h = hostOf();
    if (!h) return null;
    try {
      var raw = h[method](String(sql), JSON.stringify(params || []));
      var data = JSON.parse(raw);
      return (data && data.ok && !data.error) ? data : null;
    } catch (error) {
      return null;
    }
  }

  global.Db = {
    available: available,
    /** SELECT → {cols, rows}；失败 null */
    query: function (sql, params) { return call('dbQuery', sql, params); },
    /** INSERT/UPDATE/DELETE/CREATE → {changes, lastId}；失败 null */
    exec: function (sql, params) { return call('dbExec', sql, params); }
  };
})(window);
