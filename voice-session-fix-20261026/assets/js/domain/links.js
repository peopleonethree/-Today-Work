/* ==========================================================================
   links.js — 相关笔记（M3「形成积累」之一，L3 领域层）
   打开一篇笔记时告诉用户「还有哪几篇跟它有关」：
     1. 内容词共现——走同一套倒排索引（title 3 / body 2 / source 1），
        共同命中越多、字段越重，越相关；
     2. 已采纳标签重合——用户亲手收下的标签是最强的「这件事和我有关」信号；
     3. 新近度——刚写过的更容易是现在想找的。
   全程本地计算，不出网、不花钱；索引层不在时退回全文扫描。
   ========================================================================== */

(function (global) {
  'use strict';

  var FIELD_WEIGHT = { title: 3, body: 2, source: 1 };
  var TAG_BOOST = 6;          /* 每个共同已采纳标签 */
  var TERM_HIT_BONUS = 2;     /* 命中更多不同词的额外加分 */
  var RECENCY_WINDOW = 3;     /* 新近度封顶，与 search.js 同一口径 */

  function lower(text) { return String(text == null ? '' : text).toLowerCase(); }

  function recencyBoost(updatedAt) {
    var days = (Date.now() - (Number(updatedAt) || 0)) / 86400000;
    return days < 0 ? RECENCY_WINDOW : Math.max(0, RECENCY_WINDOW - days / 30);
  }

  /** 源笔记的查询词：标题 + 已采纳标签优先（最能代表主题），正文补足 */
  function sourceTerms(memo, tags) {
    var idx = global.IndexStore;
    if (!idx || typeof idx.tokenize !== 'function') return [];
    var out = [];
    var seen = {};

    function take(list, cap) {
      for (var i = 0; i < list.length && out.length < cap; i++) {
        var t = String(list[i] || '');
        if (t && !seen[t]) { seen[t] = true; out.push(t); }
      }
    }

    /* 标签先切词再收：标签是短语，双字切法与索引侧一致 */
    for (var i = 0; i < tags.length && out.length < 8; i++) {
      take(idx.tokenize(tags[i], 4), 8);
    }
    take(idx.tokenize(memo.title, 24), 12);
    take(idx.tokenize(memo.body, 40), 24);
    return out.slice(0, 24);
  }

  /** 一条笔记的已采纳标签（小写）；derived 层不在就当没有 */
  function adoptedTags(userId, memoId) {
    var store = global.DerivedStore;
    if (!store || typeof store.get !== 'function') return [];
    var rec = store.get(String(userId || ''), String(memoId || ''), 'tags');
    var tags = rec && rec.payload && rec.payload.tags;
    if (Object.prototype.toString.call(tags) !== '[object Array]') return [];
    var out = [];
    for (var i = 0; i < tags.length; i++) {
      var t = lower(tags[i]).slice(0, 12);
      if (t) out.push(t);
    }
    return out;
  }

  /** 共同标签：返回原文写法（第一个笔记里出现的），供界面展示 */
  function sharedTags(tagsA, tagsB) {
    var out = [];
    for (var i = 0; i < tagsA.length; i++) {
      var a = lower(tagsA[i]);
      for (var j = 0; j < tagsB.length; j++) {
        if (a === lower(tagsB[j]) && out.indexOf(tagsB[j]) === -1) { out.push(tagsB[j]); break; }
      }
    }
    return out;
  }

  /** 标签表：memoId → [标签原文]；一次遍历建好，供所有候选共用 */
  function tagIndexOf(userId) {
    var store = global.DerivedStore;
    if (!store || typeof store.allOfUser !== 'function') return null;
    var rows = store.allOfUser(String(userId || ''));
    if (!rows) return null;
    var map = {};
    for (var i = 0; i < rows.length; i++) {
      var rec = rows[i];
      if (!rec || rec.kind !== 'tags') continue;
      var tags = rec.payload && rec.payload.tags;
      if (Object.prototype.toString.call(tags) === '[object Array]' && tags.length) {
        map[String(rec.memoId)] = tags.map(function (t) { return String(t || '').slice(0, 12); })
          .filter(function (t) { return t; });
      }
    }
    return map;
  }

  /**
   * 找相关笔记。
   * related(userId, memoId, limit) → [{ memo, score, shared: [标签] }]
   * 自己不出现在结果里；没有可用信号就返回空数组。
   */
  function related(userId, memoId, limit) {
    var user = String(userId || '');
    var max = Math.max(1, Math.min(Number(limit) || 3, 6));
    var memoSvc = global.MemoService;
    if (!memoSvc) return [];

    var source = memoSvc.get(user, String(memoId || ''));
    if (!source) return [];

    var srcTags = adoptedTags(user, source.id);
    var terms = sourceTerms(source, srcTags);
    var idx = global.IndexStore;
    var candidates = {};   /* memoId → {score, termHits, shared} */
    var order = [];

    if (idx && typeof idx.available === 'function' && idx.available() && terms.length && typeof idx.query === 'function') {
      var postings = idx.query(terms);
      if (postings) {
        for (var p = 0; p < postings.length; p++) {
          var row = postings[p];
          if (!row.memoId || row.memoId === source.id) continue;
          if (!candidates[row.memoId]) { candidates[row.memoId] = { score: 0, termHits: {} }; order.push(row.memoId); }
          candidates[row.memoId].score += FIELD_WEIGHT[row.field] || 1;
          candidates[row.memoId].termHits[row.term] = true;
        }
        for (var k = 0; k < order.length; k++) {
          var id = order[k];
          candidates[id].score += Object.keys(candidates[id].termHits).length * TERM_HIT_BONUS;
        }
      }
    }

    /* 标签重合：既能加分，也能把「只靠标签相关」的笔记带进候选
       （标签不在倒排索引里，光靠词共现发现不了它们） */
    var tagMap = tagIndexOf(user);
    if (tagMap && srcTags.length) {
      for (var tid in tagMap) {
        if (!Object.prototype.hasOwnProperty.call(tagMap, tid) || tid === source.id) continue;
        var shared = sharedTags(srcTags, tagMap[tid]);
        if (!shared.length) continue;
        if (!candidates[tid]) { candidates[tid] = { score: 0, termHits: {} }; order.push(tid); }
        candidates[tid].shared = shared;
        candidates[tid].score += shared.length * TAG_BOOST;
      }
    }

    /* 索引层不在（网页版 / localStorage 兜底）且没有标签候选：全文扫描 */
    if (!order.length) {
      var all = memoSvc.list(user);
      for (var i = 0; i < all.length; i++) {
        var other = all[i];
        if (other.id === source.id) continue;
        var hayTitle = lower(other.title);
        var hayBody = lower(other.body + '\n' + other.sourceText);
        var score = 0;
        var hits = 0;
        for (var t = 0; t < terms.length; t++) {
          var term = lower(terms[t]);
          if (hayTitle.indexOf(term) !== -1) { score += 3; hits++; }
          else if (hayBody.indexOf(term) !== -1) { score += 1; hits++; }
        }
        if (hits) {
          score += hits * TERM_HIT_BONUS;
          candidates[other.id] = { score: score, termHits: {}, shared: [] };
          order.push(other.id);
        }
      }
    }

    if (!order.length) return [];

    /* 扫描路径没算过的共同标签在这里补上 */
    if (tagMap) {
      for (var c = 0; c < order.length; c++) {
        var cid = order[c];
        if (candidates[cid].shared && candidates[cid].shared.length) continue;
        var otherTags = tagMap[cid] || adoptedTags(user, cid);
        candidates[cid].shared = sharedTags(srcTags, otherTags);
        if (candidates[cid].shared.length) candidates[cid].score += candidates[cid].shared.length * TAG_BOOST;
      }
    }

    /* 回表 + 新近度，排序取前 N */
    var repo = global.SqlRepo;
    var memos = null;
    if (repo && typeof repo.available === 'function' && repo.available() && typeof repo.memosByIds === 'function') {
      memos = repo.memosByIds(user, order);
    }
    var byId = {};
    for (var m = 0; m < (memos || []).length; m++) byId[memos[m].id] = memos[m];

    var out = [];
    for (var o = 0; o < order.length; o++) {
      var oid = order[o];
      var memo = byId[oid] || (function () {
        var found = memoSvc.get(user, oid);
        return found;
      })();
      if (!memo) continue;
      var c2 = candidates[oid];
      out.push({
        memo: memo,
        score: c2.score + recencyBoost(memo.updatedAt),
        shared: c2.shared || []
      });
    }
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, max);
  }

  global.LinkService = {
    related: related,
    sourceTerms: sourceTerms,
    adoptedTags: adoptedTags,
    sharedTags: sharedTags
  };
})(window);
