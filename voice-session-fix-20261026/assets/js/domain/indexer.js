/* ==========================================================================
   indexer.js — 笔记倒排索引（L3/L5 之间，只服务 SQLite 路径）
   分词规则刻意朴素：CJK 按双字切（「燃气灶」→ 燃气 / 气灶，单字成词），
   ASCII 按连续字母数字切。不追求语言学正确，只保证「记得的词都找得到」。
   索引可以整体丢弃重建（rebuild），丢了不丢数据。
   ========================================================================== */

(function (global) {
  'use strict';

  var CJK = /[\u3400-\u4dbf\u4e00-\u9fff]+/g;
  var ASCII = /[a-z0-9][a-z0-9_'.-]*/g;

  var TITLE_MAX = 80;    /* 标题全量进索引 */
  var BODY_MAX = 1500;   /* 正文索引前 ~3000 字，够找回，不够全文检索 */
  var BATCH = 300;       /* 一条语句最多带多少行 VALUES */

  function fieldsOf(memo) {
    return [
      { field: 'title', text: String((memo && memo.title) || ''), max: TITLE_MAX },
      { field: 'body', text: String((memo && memo.body) || ''), max: BODY_MAX },
      { field: 'source', text: String((memo && memo.sourceText) || ''), max: 200 }
    ];
  }

  /** 单字段分词：小写化 → ASCII 词 + CJK 双字（奇数长度最后一个字单切） */
  function tokenize(text, max) {
    var lower = String(text == null ? '' : text).toLowerCase();
    var out = [];
    var seen = {};

    function push(term) {
      if (!term || term.length > 32) return;
      if (seen[term]) return;
      seen[term] = true;
      out.push(term);
    }

    var m;
    ASCII.lastIndex = 0;
    while ((m = ASCII.exec(lower)) !== null) push(m[0]);

    CJK.lastIndex = 0;
    while ((m = CJK.exec(lower)) !== null) {
      var run = m[0];
      for (var i = 0; i + 1 < run.length; i++) push(run.slice(i, i + 2));
      if (run.length === 1) push(run);
      if (out.length >= max) return out.slice(0, max);
    }
    return out.slice(0, max);
  }

  /** memo → [{term, field}]；同词多字段时只留权重最高的那档 */
  function termsOf(memo) {
    var rank = { title: 3, body: 2, source: 1 };
    var best = {};
    var fields = fieldsOf(memo);
    for (var i = 0; i < fields.length; i++) {
      var terms = tokenize(fields[i].text, fields[i].max);
      for (var j = 0; j < terms.length; j++) {
        var t = terms[j];
        if (!best[t] || rank[fields[i].field] > rank[best[t]]) best[t] = fields[i].field;
      }
    }
    var out = [];
    for (var k in best) {
      if (Object.prototype.hasOwnProperty.call(best, k)) out.push({ term: k, field: best[k] });
    }
    return out;
  }

  function available() {
    var repo = global.SqlRepo;
    return !!(repo && typeof repo.available === 'function' && repo.available());
  }

  /** 增量同步一篇笔记的 postings：先读旧表，diff 后删加各一批 */
  function syncMemo(memo) {
    if (!available() || !memo || !memo.id) return false;
    var Db = global.Db;
    var next = termsOf(memo);

    var old = Db.query('SELECT term, field FROM memo_index WHERE memoId=?', [String(memo.id)]);
    if (!old) return false;
    var oldMap = {};
    for (var i = 0; i < (old.rows || []).length; i++) {
      oldMap[String(old.rows[i][0])] = String(old.rows[i][1]);
    }
    var nextMap = {};
    for (var j = 0; j < next.length; j++) nextMap[next[j].term] = next[j].field;

    var toAdd = [];
    for (var a in nextMap) {
      if (Object.prototype.hasOwnProperty.call(nextMap, a) && oldMap[a] !== nextMap[a]) {
        toAdd.push({ term: a, field: nextMap[a] });
      }
    }
    var toDel = [];
    for (var d in oldMap) {
      if (Object.prototype.hasOwnProperty.call(oldMap, d) && nextMap[d] !== oldMap[d]) {
        toDel.push(d);
      }
    }

    for (var x = 0; x < toDel.length; x += BATCH) {
      var slice = toDel.slice(x, x + BATCH);
      var marks = [];
      var params = [String(memo.id)];
      for (var y = 0; y < slice.length; y++) { marks.push('?'); params.push(slice[y]); }
      if (!Db.exec('DELETE FROM memo_index WHERE memoId=? AND term IN (' +
        marks.join(',') + ')', params)) return false;
    }

    for (var p = 0; p < toAdd.length; p += BATCH) {
      var rows = toAdd.slice(p, p + BATCH);
      var marks2 = [];
      var params2 = [];
      for (var q = 0; q < rows.length; q++) {
        marks2.push('(?, ?, ?)');
        params2.push(rows[q].term, String(memo.id), rows[q].field);
      }
      if (!Db.exec('INSERT OR IGNORE INTO memo_index (term, memoId, field) VALUES ' +
        marks2.join(','), params2)) return false;
    }
    return true;
  }

  /** 删笔记时清 postings（软删除后搜不到才算真删） */
  function dropMemo(memoId) {
    if (!available()) return false;
    return !!global.Db.exec('DELETE FROM memo_index WHERE memoId=?', [String(memoId || '')]);
  }

  /** 整体重建：索引是纯派生物，删光重扫不丢任何用户数据 */
  function rebuild(userId) {
    var repo = global.SqlRepo;
    if (!available() || !repo) return -1;
    global.Db.exec('DELETE FROM memo_index');
    var all = repo.memos(String(userId || ''), false);
    if (!all) return -1;
    var done = 0;
    for (var i = 0; i < all.length; i++) {
      if (syncMemo(all[i])) done++;
    }
    return done;
  }

  /** postings 查询：terms → [{memoId, field}]（打分在 search.js） */
  function query(terms) {
    if (!available() || !terms || !terms.length) return null;
    var marks = [];
    var params = [];
    var list = terms.slice(0, 24);
    for (var i = 0; i < list.length; i++) { marks.push('?'); params.push(String(list[i])); }
    var res = global.Db.query(
      'SELECT term, memoId, field FROM memo_index WHERE term IN (' + marks.join(',') + ')',
      params);
    if (!res || !res.rows) return null;
    var out = [];
    for (var j = 0; j < res.rows.length; j++) {
      out.push({ term: String(res.rows[j][0]), memoId: String(res.rows[j][1]), field: String(res.rows[j][2]) });
    }
    return out;
  }

  global.IndexStore = {
    tokenize: tokenize,
    termsOf: termsOf,
    available: available,
    syncMemo: syncMemo,
    dropMemo: dropMemo,
    rebuild: rebuild,
    query: query
  };
})(window);
