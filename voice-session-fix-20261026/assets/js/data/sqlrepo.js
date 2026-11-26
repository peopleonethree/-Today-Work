/* ==========================================================================
   sqlrepo.js — memo / derived 的 SQLite 行级读写（L5）
   localStorage 的「整包读写」在几百条长文下每次保存都全量序列化，撑不住；
   这里按行存，增删改只碰一行。索引 postings 不在这里（见 indexer.js）。

   SQL 面收得很窄：固定语句 + 全参数绑定，没有任何字符串拼接进 SQL 的口子。
   schema 由 ensureSchema() 幂等下发，原生侧不管理结构。
   ========================================================================== */

(function (global) {
  'use strict';

  var Db = global.Db;

  var SCHEMA = [
    "CREATE TABLE IF NOT EXISTS memo (" +
      "id TEXT PRIMARY KEY, userId TEXT NOT NULL, spaceId TEXT NOT NULL DEFAULT ''," +
      "title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT ''," +
      "bodyFormat TEXT NOT NULL DEFAULT 'plain', sourceText TEXT NOT NULL DEFAULT ''," +
      "sourceVoiceId TEXT NOT NULL DEFAULT '', rev INTEGER NOT NULL DEFAULT 1," +
      "createdAt INTEGER NOT NULL DEFAULT 0, updatedAt INTEGER NOT NULL DEFAULT 0," +
      "deletedAt INTEGER NOT NULL DEFAULT 0)",
    "CREATE TABLE IF NOT EXISTS derived (" +
      "userId TEXT NOT NULL, memoId TEXT NOT NULL, kind TEXT NOT NULL," +
      "payload TEXT NOT NULL DEFAULT '{}', memoRev INTEGER NOT NULL DEFAULT 0," +
      "modelId TEXT NOT NULL DEFAULT '', promptVer TEXT NOT NULL DEFAULT ''," +
      "schemaVer INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ok'," +
      "createdAt INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (userId, memoId, kind))",
    "CREATE TABLE IF NOT EXISTS memo_index (" +
      "term TEXT NOT NULL, memoId TEXT NOT NULL, field TEXT NOT NULL," +
      "PRIMARY KEY (term, memoId, field))",
    "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL DEFAULT '')",
    "CREATE INDEX IF NOT EXISTS memo_user_ix ON memo (userId, deletedAt, updatedAt)",
    "CREATE INDEX IF NOT EXISTS index_term_ix ON memo_index (term)"
  ];

  var MEMO_COLS = 'id,userId,spaceId,title,body,bodyFormat,sourceText,sourceVoiceId,rev,createdAt,updatedAt,deletedAt';
  var DERIVED_COLS = 'userId,memoId,kind,payload,memoRev,modelId,promptVer,schemaVer,status,createdAt';

  /** SQLite 没有配额压力，容量给到 localStorage 时代的 10 倍 */
  var MAX_MEMOS = 5000;

  var inited = false;

  function ensureSchema() {
    if (!Db || typeof Db.available !== 'function' || !Db.available()) return false;
    if (inited) return true;
    for (var i = 0; i < SCHEMA.length; i++) {
      if (!Db.exec(SCHEMA[i])) return false;
    }
    inited = true;
    return true;
  }

  function available() { return ensureSchema(); }

  /* --------------------------------------------------------------- 行映射 */

  function memoRow(m) {
    return [m.id, m.userId || '', m.spaceId || '', m.title || '', m.body || '',
      m.bodyFormat || 'plain', m.sourceText || '', m.sourceVoiceId || '',
      Number(m.rev) || 1, Number(m.createdAt) || 0, Number(m.updatedAt) || 0, Number(m.deletedAt) || 0];
  }

  function rowMemo(cols, r) {
    var m = {};
    for (var i = 0; i < cols.length; i++) m[cols[i]] = r[i];
    return {
      id: String(m.id || ''),
      userId: String(m.userId || ''),
      spaceId: String(m.spaceId || ''),
      title: String(m.title || ''),
      body: String(m.body || ''),
      bodyFormat: 'plain',
      sourceText: String(m.sourceText || ''),
      sourceVoiceId: String(m.sourceVoiceId || ''),
      rev: Number(m.rev) || 1,
      createdAt: Number(m.createdAt) || 0,
      updatedAt: Number(m.updatedAt) || 0,
      deletedAt: Number(m.deletedAt) || 0
    };
  }

  function rowDerived(cols, r) {
    var d = {};
    for (var i = 0; i < cols.length; i++) d[cols[i]] = r[i];
    var payload = {};
    try { payload = JSON.parse(String(d.payload || '{}')); } catch (e) { payload = {}; }
    return {
      memoId: String(d.memoId || ''),
      kind: String(d.kind || ''),
      payload: payload,
      memoRev: Number(d.memoRev) || 0,
      modelId: String(d.modelId || ''),
      promptVer: String(d.promptVer || ''),
      schemaVer: Number(d.schemaVer) || 0,
      status: String(d.status || 'ok'),
      createdAt: Number(d.createdAt) || 0
    };
  }

  function select(sql, params, mapFn) {
    var res = Db.query(sql, params);
    if (!res || !res.rows) return null;
    var cols = res.cols || [];
    var out = [];
    for (var i = 0; i < res.rows.length; i++) out.push(mapFn(cols, res.rows[i]));
    return out;
  }

  /* ------------------------------------------------------------------ memo */

  function memos(userId, includeDeleted) {
    if (!available()) return null;
    return select(
      'SELECT ' + MEMO_COLS + ' FROM memo WHERE userId=? ' +
      (includeDeleted ? '' : 'AND deletedAt=0 ') +
      'ORDER BY updatedAt DESC', [String(userId || '')], rowMemo);
  }

  function getMemo(userId, id) {
    if (!available()) return null;
    var rows = select(
      'SELECT ' + MEMO_COLS + ' FROM memo WHERE userId=? AND id=?',
      [String(userId || ''), String(id || '')], rowMemo);
    if (!rows) return null;
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i].deletedAt) return rows[i];
    }
    return null;
  }

  /** 检索命中后按 id 回表；最多 200 个，防 IN 子句失控 */
  function memosByIds(userId, ids) {
    if (!available() || !ids || !ids.length) return [];
    var marks = [];
    var params = [String(userId || '')];
    var list = ids.slice(0, 200);
    for (var i = 0; i < list.length; i++) { marks.push('?'); params.push(String(list[i])); }
    return select(
      'SELECT ' + MEMO_COLS + ' FROM memo WHERE userId=? AND deletedAt=0 AND id IN (' +
      marks.join(',') + ')', params, rowMemo) || [];
  }

  function putMemo(m) {
    if (!available() || !m || !m.id) return false;
    var ok = Db.exec(
      'INSERT OR REPLACE INTO memo (' + MEMO_COLS + ') VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      memoRow(m));
    if (!ok) return false;
    evictMemos(m.userId);
    return true;
  }

  function deleteMemo(userId, id, at) {
    if (!available()) return false;
    return !!Db.exec(
      'UPDATE memo SET deletedAt=?, updatedAt=? WHERE userId=? AND id=? AND deletedAt=0',
      [Number(at) || Date.now(), Number(at) || Date.now(), String(userId || ''), String(id || '')]);
  }

  /** 软删除超过 30 天的清掉（正文在索引和备份里仍有迹可循），再按总量硬顶 */
  function evictMemos(userId) {
    var monthAgo = Date.now() - 30 * 86400000;
    Db.exec('DELETE FROM memo WHERE userId=? AND deletedAt>0 AND updatedAt<?',
      [String(userId || ''), monthAgo]);
    Db.exec(
      'DELETE FROM memo WHERE userId=? AND id NOT IN ' +
      '(SELECT id FROM memo WHERE userId=? ORDER BY updatedAt DESC LIMIT ?)',
      [String(userId || ''), String(userId || ''), MAX_MEMOS]);
  }

  function countMemos(userId) {
    if (!available()) return -1;
    var res = Db.query('SELECT COUNT(*) AS n FROM memo WHERE userId=? AND deletedAt=0',
      [String(userId || '')]);
    return (res && res.rows && res.rows[0]) ? Number(res.rows[0][0]) : -1;
  }

  /* --------------------------------------------------------------- derived */

  function putDerived(userId, rec) {
    if (!available() || !rec || !rec.memoId || !rec.kind) return false;
    return !!Db.exec(
      'INSERT OR REPLACE INTO derived (' + DERIVED_COLS + ') VALUES (?,?,?,?,?,?,?,?,?,?)',
      [String(userId || ''), String(rec.memoId), String(rec.kind),
        JSON.stringify(rec.payload == null ? {} : rec.payload),
        Number(rec.memoRev) || 0, String(rec.modelId || ''), String(rec.promptVer || ''),
        Number(rec.schemaVer) || 0, String(rec.status || 'ok'), Number(rec.createdAt) || Date.now()]);
  }

  function getDerived(userId, memoId, kind) {
    if (!available()) return null;
    var rows = select(
      'SELECT ' + DERIVED_COLS + ' FROM derived WHERE userId=? AND memoId=? AND kind=?',
      [String(userId || ''), String(memoId || ''), String(kind || '')], rowDerived);
    return (rows && rows.length) ? rows[0] : null;
  }

  function allDerived(userId) {
    if (!available()) return null;
    return select('SELECT ' + DERIVED_COLS + ' FROM derived WHERE userId=? ORDER BY createdAt',
      [String(userId || '')], rowDerived);
  }

  function derivedOf(userId, memoId) {
    if (!available()) return null;
    return select(
      'SELECT ' + DERIVED_COLS + ' FROM derived WHERE userId=? AND memoId=? ORDER BY createdAt',
      [String(userId || ''), String(memoId || '')], rowDerived);
  }

  function setDerivedStatus(userId, memoId, kind, status) {
    if (!available()) return false;
    return !!Db.exec('UPDATE derived SET status=? WHERE userId=? AND memoId=? AND kind=?',
      [String(status || 'ok'), String(userId || ''), String(memoId || ''), String(kind || '')]);
  }

  function dropDerived(userId, memoId) {
    if (!available()) return false;
    return !!Db.exec('DELETE FROM derived WHERE userId=? AND memoId=?',
      [String(userId || ''), String(memoId || '')]);
  }

  /** 单条删除（一条笔记衍生种类超上限时丢最老的） */
  function dropOneDerived(userId, memoId, kind) {
    if (!available()) return false;
    return !!Db.exec('DELETE FROM derived WHERE userId=? AND memoId=? AND kind=?',
      [String(userId || ''), String(memoId || ''), String(kind || '')]);
  }

  function gcDerived(userId, liveIds) {
    if (!available()) return -1;
    var all = allDerived(userId);
    if (!all) return -1;
    var live = {};
    for (var i = 0; i < (liveIds || []).length; i++) live[String(liveIds[i])] = true;
    var removed = 0;
    for (var j = 0; j < all.length; j++) {
      if (!live[all[j].memoId] && dropDerived(userId, all[j].memoId)) removed++;
    }
    return removed;
  }

  /* ------------------------------------------------------------------ meta */

  function metaGet(key) {
    if (!available()) return null;
    var res = Db.query('SELECT v FROM meta WHERE k=?', [String(key)]);
    return (res && res.rows && res.rows[0]) ? String(res.rows[0][0]) : '';
  }

  function metaSet(key, value) {
    if (!available()) return false;
    return !!Db.exec('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)',
      [String(key), String(value == null ? '' : value)]);
  }

  global.SqlRepo = {
    MAX_MEMOS: MAX_MEMOS,
    available: available,
    memos: memos,
    memosByIds: memosByIds,
    getMemo: getMemo,
    putMemo: putMemo,
    deleteMemo: deleteMemo,
    countMemos: countMemos,
    putDerived: putDerived,
    getDerived: getDerived,
    allDerived: allDerived,
    derivedOf: derivedOf,
    setDerivedStatus: setDerivedStatus,
    dropDerived: dropDerived,
    dropOneDerived: dropOneDerived,
    gcDerived: gcDerived,
    metaGet: metaGet,
    metaSet: metaSet
  };
})(window);
