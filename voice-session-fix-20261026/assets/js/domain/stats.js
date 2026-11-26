/* ==========================================================================
   stats.js — 周报统计（M3「形成积累」之二，L3 领域层）
   设计文档的验收指标在这里落地：
     · 生成结果采用率 = derived.status=adopted 的比例（<40% 说明提示词选错场景）
     · 沉淀 = 用户亲手采纳的摘要 / 标签 / 待办草稿——AI 的产出被留下来多少
   纯本地统计，不联网。待办数据读 todos:<user>（与 app.js 同一命名空间），
   笔记走 MemoService，衍生数据走 DerivedStore.allOfUser。
   ========================================================================== */

(function (global) {
  'use strict';

  var Store = global.AppStorage;

  /** 自然周（周一起算，与 parseLocalIntent「下周三」的口径一致） */
  function weekRange(refMs) {
    var ref = new Date(Number(refMs) || Date.now());
    var day = ref.getDay();               /* 0=周日 */
    var back = day === 0 ? 6 : day - 1;   /* 周一为一周起点 */
    var start = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - back, 0, 0, 0, 0);
    return { start: start.getTime(), end: start.getTime() + 7 * 86400000 };
  }

  function inRange(at, range) {
    var n = Number(at) || 0;
    return n >= range.start && n < range.end;
  }

  function todosOf(userId) {
    var raw = Store ? Store.read('todos:' + String(userId || ''), []) : [];
    return Object.prototype.toString.call(raw) === '[object Array]' ? raw : [];
  }

  /**
   * 本周统计。
   * week(userId, refMs) → {
   *   range, newMemos, activeMemos, completedTodos, openTodos,
   *   generated, adopted, ratio,      // 采纳率（generated=0 时 ratio=null）
   *   topTags: [{tag, n}],            // 已采纳标签频次（本周内采纳的）
   *   sediment: [{memoId, title, text, at}]  // 本周采纳的摘要沉淀
   * }
   */
  function week(userId, refMs) {
    var user = String(userId || '');
    var range = weekRange(refMs);
    var out = {
      range: range,
      newMemos: 0, activeMemos: 0, completedTodos: 0, openTodos: 0,
      generated: 0, adopted: 0, ratio: null,
      topTags: [], sediment: []
    };

    var memoSvc = global.MemoService;
    var memos = memoSvc ? memoSvc.list(user) : [];
    var titles = {};
    for (var i = 0; i < memos.length; i++) {
      titles[memos[i].id] = memos[i].title || '未命名笔记';
      if (inRange(memos[i].createdAt, range)) out.newMemos += 1;
      if (inRange(memos[i].updatedAt, range)) out.activeMemos += 1;
    }

    var todos = todosOf(user);
    for (var t = 0; t < todos.length; t++) {
      var todo = todos[t] || {};
      if (todo.done) {
        if (inRange(todo.completedAt, range)) out.completedTodos += 1;
      } else {
        out.openTodos += 1;
      }
    }

    var derived = global.DerivedStore;
    var rows = derived && typeof derived.allOfUser === 'function' ? derived.allOfUser(user) : [];
    if (!rows) rows = [];

    var tagCount = {};
    for (var d = 0; d < rows.length; d++) {
      var rec = rows[d] || {};
      var kind = String(rec.kind || '');
      if (['summary', 'tags', 'todoDraft', 'rewrite', 'polish'].indexOf(kind) === -1) continue;
      out.generated += 1;
      if (rec.status !== 'adopted') continue;
      out.adopted += 1;

      if (kind === 'tags' && inRange(rec.createdAt, range)) {
        var tags = rec.payload && rec.payload.tags;
        if (Object.prototype.toString.call(tags) === '[object Array]') {
          for (var g = 0; g < tags.length; g++) {
            var tag = String(tags[g] || '').slice(0, 12);
            if (tag) tagCount[tag] = (tagCount[tag] || 0) + 1;
          }
        }
      }

      /* 沉淀：本周采纳的摘要（正文里被留下来的那部分理解） */
      if (kind === 'summary' && inRange(rec.createdAt, range)) {
        var text = rec.payload && rec.payload.summary ? String(rec.payload.summary) : '';
        if (text) {
          out.sediment.push({
            memoId: String(rec.memoId || ''),
            title: titles[rec.memoId] || '未命名笔记',
            text: text.slice(0, 160),
            at: Number(rec.createdAt) || 0
          });
        }
      }
    }
    out.sediment.sort(function (a, b) { return b.at - a.at; });
    out.sediment = out.sediment.slice(0, 6);

    var tagList = [];
    for (var k in tagCount) {
      if (Object.prototype.hasOwnProperty.call(tagCount, k)) tagList.push({ tag: k, n: tagCount[k] });
    }
    tagList.sort(function (a, b) { return b.n - a.n; });
    out.topTags = tagList.slice(0, 5);

    if (out.generated > 0) out.ratio = Math.round((out.adopted / out.generated) * 100) / 100;
    return out;
  }

  /** 给 AI 周评的素材：只给数字、标签和已采纳摘要，不整篇发正文 */
  function reviewPayload(userId, refMs) {
    var s = week(userId, refMs);
    return {
      weekStart: s.range.start,
      newMemos: s.newMemos,
      activeMemos: s.activeMemos,
      completedTodos: s.completedTodos,
      openTodos: s.openTodos,
      generated: s.generated,
      adopted: s.adopted,
      topTags: s.topTags.map(function (x) { return x.tag; }),
      summaries: s.sediment.map(function (x) {
        return { title: x.title, summary: x.text };
      })
    };
  }

  global.StatsService = {
    weekRange: weekRange,
    week: week,
    reviewPayload: reviewPayload
  };
})(window);
