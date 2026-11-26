/* ==========================================================================
   search.js — 混合检索（L2/L3）
   三路信号合一个分数：
     1. 倒排索引（SQLite 路径）/ 全表扫描（localStorage 兜底路径）——字面命中
     2. 标签命中——AI 打过的标签也算「记得的方式」
     3. 新近度——刚写的更容易是你要找的
   可选第四路：AI 扩词（searchExpand 任务）。关 AI（consent local/blocked）、
   没配模型、或预算紧张时自动没有这一路，字面检索永远兜底（设计文档 M2 验收线）。
   ========================================================================== */

(function (global) {
  'use strict';

  var FIELD_WEIGHT = { title: 3, body: 2, source: 1, scanTitle: 3, scanBody: 1, scanSource: 1 };
  var TAG_BOOST = 4;
  var LIMIT = 50;

  var aiGate = null; /* app.js 注册：现在允不允许走 AI 扩词 */

  function setAiGate(fn) { aiGate = typeof fn === 'function' ? fn : null; }

  function lower(text) { return String(text == null ? '' : text).toLowerCase(); }

  /** 查询词：走同一套分词，保证「索引里怎么存、查询就怎么切」 */
  function queryTerms(query) {
    var idx = global.IndexStore;
    var raw = String(query || '').trim();
    if (!raw) return [];
    var terms = idx && typeof idx.tokenize === 'function' ? idx.tokenize(raw, 24) : [];
    if (!terms.length) terms = [lower(raw).slice(0, 32)];
    /* 原句整串也算一个词：「记得半句话」的情形直接子串命中 */
    if (raw.length >= 2 && raw.length <= 32 && terms.indexOf(lower(raw)) === -1) {
      terms.push(lower(raw));
    }
    return terms;
  }

  function recencyBoost(updatedAt) {
    var days = (Date.now() - (Number(updatedAt) || 0)) / 86400000;
    return days < 0 ? 3 : Math.max(0, 3 - days / 30);
  }

  /** 标签表：memoId → [tags]；顺带把「标签文本」收进一个平表用于命中 */
  function tagIndex(userId) {
    var store = global.DerivedStore;
    if (!store || typeof store.all !== 'function') return null;
    var repo = global.SqlRepo;
    var rows = null;
    if (repo && typeof repo.available === 'function' && repo.available() && typeof repo.allDerived === 'function') {
      var all = repo.allDerived(String(userId || ''));
      if (!all) return null;
      rows = [];
      for (var i = 0; i < all.length; i++) if (all[i].kind === 'tags') rows.push(all[i]);
    } else {
      rows = [];
      var memos = global.MemoService.list(String(userId || ''));
      for (var j = 0; j < memos.length; j++) {
        var rec = store.get(String(userId || ''), memos[j].id, 'tags');
        if (rec) rows.push(rec);
      }
    }
    var map = {};
    for (var k = 0; k < rows.length; k++) {
      var tags = rows[k].payload && rows[k].payload.tags;
      if (Object.prototype.toString.call(tags) === '[object Array]' && tags.length) {
        map[rows[k].memoId] = tags.map(function (t) { return lower(t); });
      }
    }
    return map;
  }

  /** 字面打分：index 路径拿 postings，scan 路径直接扫列表 */
  function literal(userId, query, via) {
    var terms = queryTerms(query);
    if (!terms.length) return null;

    if (via === 'index') {
      var postings = global.IndexStore.query(terms);
      if (postings === null) return null;
      var scores = {};
      var hits = {};
      for (var i = 0; i < postings.length; i++) {
        var p = postings[i];
        scores[p.memoId] = (scores[p.memoId] || 0) + (FIELD_WEIGHT[p.field] || 1);
        hits[p.memoId] = (hits[p.memoId] || {});
        hits[p.memoId][p.term] = true;
      }
      var ids = [];
      for (var id in scores) {
        if (Object.prototype.hasOwnProperty.call(scores, id)) {
          /* 命中更多不同查询词的排前面 */
          scores[id] += Object.keys(hits[id]).length * 2;
          ids.push(id);
        }
      }
      var memos = global.SqlRepo.memosByIds(String(userId || ''), ids);
      var out = [];
      for (var m = 0; m < memos.length; m++) {
        out.push({ memo: memos[m], score: (scores[memos[m].id] || 0) + recencyBoost(memos[m].updatedAt) });
      }
      return { terms: terms, scored: out };
    }

    /* scan：localStorage 兜底，逐词子串匹配 */
    var all = global.MemoService.list(String(userId || ''));
    var out2 = [];
    for (var x = 0; x < all.length; x++) {
      var memo = all[x];
      var title = lower(memo.title);
      var body = lower(memo.body + '\n' + memo.sourceText);
      var score = 0;
      var matched = 0;
      for (var t = 0; t < terms.length; t++) {
        var term = lower(terms[t]);
        var hitTitle = title.indexOf(term) !== -1;
        var hitBody = body.indexOf(term) !== -1;
        if (hitTitle) score += FIELD_WEIGHT.scanTitle;
        if (hitBody) score += FIELD_WEIGHT.scanBody;
        if (hitTitle || hitBody) matched++;
      }
      if (matched > 0) {
        out2.push({ memo: memo, score: score + matched * 2 + recencyBoost(memo.updatedAt) });
      }
    }
    return { terms: terms, scored: out2 };
  }

  /** 把检索结果合成一份（去重、合并分数） */
  function merge(scored) {
    var byId = {};
    var out = [];
    for (var i = 0; i < scored.length; i++) {
      var item = scored[i];
      if (!item || !item.memo) continue;
      var id = item.memo.id;
      if (byId[id]) { byId[id].score += item.score; continue; }
      byId[id] = item;
      out.push(item);
    }
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, LIMIT).map(function (item) { return item.memo; });
  }

  function addTagBoost(userId, query, scored) {
    var tags = tagIndex(userId);
    if (!tags) return;
    var q = lower(query);
    for (var memoId in tags) {
      if (!Object.prototype.hasOwnProperty.call(tags, memoId)) continue;
      var list = tags[memoId];
      for (var i = 0; i < list.length; i++) {
        var tag = list[i];
        if (!tag) continue;
        /* 双向包含：搜「工作」命中 #工作事项；搜长句命中其中的短标签 */
        if (tag.indexOf(q) !== -1 || q.indexOf(tag) !== -1) {
          var hit = false;
          for (var j = 0; j < scored.length; j++) {
            if (scored[j].memo.id === memoId) { scored[j].score += TAG_BOOST; hit = true; break; }
          }
          if (!hit) {
            var memo = global.MemoService.get(String(userId || ''), memoId);
            if (memo) scored.push({ memo: memo, score: TAG_BOOST + recencyBoost(memo.updatedAt) });
          }
          break;
        }
      }
    }
  }

  /**
   * 同步检索（字面 + 标签 + 新近度）。
   * 返回 { items, terms, via: 'index' | 'scan' }；检索层不可用返回 null。
   */
  function search(userId, query, opts) {
    var q = String(query || '').trim();
    if (!q) return null;
    var via = (global.IndexStore && global.IndexStore.available()) ? 'index' : 'scan';
    var res = literal(String(userId || ''), q, via);
    if (!res) return null;
    addTagBoost(String(userId || ''), q, res.scored);
    return { items: merge(res.scored), terms: res.terms, via: via };
  }

  /**
   * 混合检索：先同步出一版字面结果，AI 扩词回来后再补一版（cb 会调两次，
   * 最后一轮 final:true；扩词失败也补一次 final，UI 不会等不到收尾）。
   */
  function hybrid(userId, query, cb) {
    var done = typeof cb === 'function' ? cb : function () {};
    var first = search(userId, query);
    if (!first) { done({ items: [], via: 'none', final: true }); return; }

    done({ items: first.items, via: first.via, final: false });

    var registry = global.AiTaskRegistry;
    if (!aiGate || !aiGate() || !registry || typeof registry.run !== 'function') {
      done({ items: first.items, via: first.via, final: true });
      return;
    }
    registry.run('searchExpand', String(query || ''), function (err, res) {
      if (err || !res || !res.data) {
        done({ items: first.items, via: first.via, final: true });
        return;
      }
      var extra = [];
      var words = res.data.terms;
      if (Object.prototype.toString.call(words) === '[object Array]') {
        for (var i = 0; i < words.length; i++) {
          var w = String(words[i] || '').trim();
          if (w && first.terms.indexOf(lower(w)) === -1 && w.length <= 32) extra.push(w);
        }
      }
      if (!extra.length) {
        done({ items: first.items, via: first.via, final: true });
        return;
      }
      var second = null;
      var via2 = first.via;
      if (first.via === 'index') {
        var postings = global.IndexStore.query(extra);
        var ids = [];
        var known = {};
        for (var k = 0; k < first.items.length; k++) known[first.items[k].id] = true;
        if (postings) {
          for (var p = 0; p < postings.length; p++) {
            if (!known[postings[p].memoId]) { ids.push(postings[p].memoId); known[postings[p].memoId] = true; }
          }
        }
        var memos = global.SqlRepo.memosByIds(String(userId || ''), ids);
        second = first.items.concat(memos);
        via2 = 'index+ai';
      } else {
        var all = global.MemoService.list(String(userId || ''));
        var known2 = {};
        for (var a = 0; a < first.items.length; a++) known2[first.items[a].id] = true;
        var extraItems = [];
        for (var b = 0; b < all.length; b++) {
          if (known2[all[b].id]) continue;
          var hay = lower(all[b].title + '\n' + all[b].body + '\n' + all[b].sourceText);
          for (var c = 0; c < extra.length; c++) {
            if (hay.indexOf(lower(extra[c])) !== -1) { extraItems.push(all[b]); break; }
          }
        }
        second = first.items.concat(extraItems);
        via2 = 'scan+ai';
      }
      done({ items: second, via: via2, final: true });
    });
  }

  /** qa 用的证据片段：检索 top-k，每片截一段正文，编号 [1..k] */
  function topSnippets(userId, query, k) {
    var res = search(userId, query);
    var items = res ? res.items : [];
    var max = Math.max(1, Math.min(Number(k) || 5, 8));
    var out = [];
    for (var i = 0; i < items.length && out.length < max; i++) {
      var memo = items[i];
      var text = String(memo.body || '').replace(/\s+/g, ' ').trim();
      if (!text) text = String(memo.sourceText || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      out.push({
        n: out.length + 1,
        memoId: memo.id,
        title: String(memo.title || '未命名笔记'),
        time: memo.updatedAt,
        text: text.slice(0, 600)
      });
    }
    return out;
  }

  global.SearchService = {
    queryTerms: queryTerms,
    setAiGate: setAiGate,
    search: search,
    hybrid: hybrid,
    topSnippets: topSnippets
  };
})(window);
