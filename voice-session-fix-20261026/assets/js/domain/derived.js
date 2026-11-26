/* ==========================================================================
   derived.js — AI 衍生数据（L3 领域层）
   摘要 / 标签 / 待办草稿这些「模型产出的东西」不能混进原文里：
     · 原文是用户的事实，错了要能一眼看出来是模型错的
     · 换模型、改提示词之后，旧结果要能标记为「过期」而不是神秘地消失
   所以每条衍生数据都带指纹：memoRev + modelId + promptVer + schemaVer。
   指纹对不上就把 status 改成 stale，页面照常显示旧内容并提示「可能已过期」。
   ========================================================================== */

(function (global) {
  'use strict';

  var Store = global.AppStorage;
  var MAX_KINDS = 8; /* 一条笔记最多留几种衍生数据，防脏数据无限长 */

  var KINDS = {
    summary: '摘要',
    tags: '标签',
    links: '关联',
    polish: '润色',
    rewrite: '改写',
    todoDraft: '待办草稿',
    embedding: '向量'
  };

  function keyOf(userId) {
    return 'derived:' + (userId || 'anon');
  }

  function readAll(userId) {
    var raw = Store.read(keyOf(userId), {});
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  }

  function writeAll(userId, map) {
    return Store.write(keyOf(userId), map);
  }

  /** 双后端：原生 SQLite（行级）/ 网页 localStorage（整包），与 memo.js 同一套规矩 */
  function backend() {
    var repo = global.SqlRepo;
    return (repo && typeof repo.available === 'function' && repo.available()) ? repo : null;
  }

  function idOf(memoId, kind) {
    return String(memoId || '') + '#' + String(kind || '');
  }

  function sameFingerprint(rec, fp) {
    if (!rec || !fp) return true;
    if (fp.memoRev !== undefined && Number(rec.memoRev) !== Number(fp.memoRev)) return false;
    if (fp.modelId !== undefined && String(rec.modelId || '') !== String(fp.modelId || '')) return false;
    if (fp.promptVer !== undefined && String(rec.promptVer || '') !== String(fp.promptVer || '')) return false;
    if (fp.schemaVer !== undefined && Number(rec.schemaVer) !== Number(fp.schemaVer)) return false;
    return true;
  }

  /**
   * 写入一条衍生数据。
   * fp = { memoRev, modelId, promptVer, schemaVer }
   */
  function put(userId, memoId, kind, payload, fp, status) {
    if (!memoId || !kind) return null;
    var repo = backend();
    var f = fp || {};
    var rec = {
      memoId: String(memoId),
      kind: String(kind),
      payload: payload,
      memoRev: Number(f.memoRev) || 0,
      modelId: String(f.modelId || ''),
      promptVer: String(f.promptVer || ''),
      schemaVer: Number(f.schemaVer) || 0,
      status: status === 'adopted' ? 'adopted' : 'ok',
      createdAt: Date.now()
    };

    if (repo) {
      /* 一条笔记的衍生种类超上限时，先丢最老的 */
      var mine = repo.derivedOf(String(userId || ''), String(memoId)) || [];
      if (mine.length >= MAX_KINDS && !mine.some(function(item){return item.kind === kind;})) {
        mine.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
        repo.dropOneDerived(String(userId || ''), String(memoId), mine[0].kind);
      }
      return repo.putDerived(String(userId || ''), rec) ? rec : null;
    }

    var map = readAll(userId);
    map[idOf(memoId, kind)] = rec;

    /* 一条笔记的衍生种类超上限时，先丢最老的 */
    var mine2 = [];
    for (var k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
      if (map[k] && map[k].memoId === String(memoId)) mine2.push(k);
    }
    if (mine2.length > MAX_KINDS) {
      mine2.sort(function (a, b) { return (map[a].createdAt || 0) - (map[b].createdAt || 0); });
      for (var i = 0; i < mine2.length - MAX_KINDS; i++) delete map[mine2[i]];
    }

    return writeAll(userId, map) ? rec : null;
  }

  /**
   * 读一条衍生数据。传了 fp 就顺带校验新鲜度：
   * 对不上 → 返回的副本 status 变 stale（同时落盘，下次进来不用重算）
   */
  function get(userId, memoId, kind, fp) {
    var repo = backend();
    if (repo) {
      var rec = repo.getDerived(String(userId || ''), String(memoId || ''), String(kind || ''));
      if (!rec) return null;
      if (!sameFingerprint(rec, fp) && rec.status !== 'stale') {
        rec.status = 'stale';
        repo.setDerivedStatus(String(userId || ''), String(memoId || ''), String(kind || ''), 'stale');
      }
      return rec;
    }
    var map = readAll(userId);
    var rec2 = map[idOf(memoId, kind)];
    if (!rec2) return null;
    if (!sameFingerprint(rec2, fp)) {
      if (rec2.status !== 'stale') {
        rec2.status = 'stale';
        writeAll(userId, map);
      }
    }
    return rec2;
  }

  /** 整条笔记的衍生数据全部标过期（正文改动后调用） */
  function markStale(userId, memoId) {
    var repo = backend();
    if (repo) {
      var rows = repo.derivedOf(String(userId || ''), String(memoId)) || [];
      var hit = 0;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].status !== 'stale') {
          repo.setDerivedStatus(String(userId || ''), String(memoId), rows[i].kind, 'stale');
          hit += 1;
        }
      }
      return hit;
    }
    var map = readAll(userId);
    var hit2 = 0;
    for (var k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
      if (map[k] && map[k].memoId === String(memoId) && map[k].status !== 'stale') {
        map[k].status = 'stale';
        hit2 += 1;
      }
    }
    if (hit2) writeAll(userId, map);
    return hit2;
  }

  /** 用户点了「就用这条」之后标记为已采用，方便 M3 统计采纳率 */
  function adopt(userId, memoId, kind) {
    var repo = backend();
    if (repo) {
      return repo.setDerivedStatus(String(userId || ''), String(memoId || ''), String(kind || ''), 'adopted')
        ? repo.getDerived(String(userId || ''), String(memoId || ''), String(kind || '')) : null;
    }
    var map = readAll(userId);
    var rec = map[idOf(memoId, kind)];
    if (!rec) return null;
    rec.status = 'adopted';
    return writeAll(userId, map) ? rec : null;
  }

  function all(userId, memoId) {
    var repo = backend();
    if (repo) return repo.derivedOf(String(userId || ''), String(memoId || '')) || [];
    var map = readAll(userId);
    var out = [];
    for (var k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
      if (map[k] && map[k].memoId === String(memoId)) out.push(map[k]);
    }
    out.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    return out;
  }

  /** 整个用户的衍生数据（周报统计用）；后端不可用返回 null */
  function allOfUser(userId) {
    var repo = backend();
    if (repo) return repo.allDerived(String(userId || ''));
    var map = readAll(userId);
    var out = [];
    for (var k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
      if (map[k]) out.push(map[k]);
    }
    out.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    return out;
  }

  /** 删笔记时连带清理，别留孤儿数据把配额吃掉 */
  function drop(userId, memoId) {
    var repo = backend();
    if (repo) return repo.dropDerived(String(userId || ''), String(memoId || ''));
    var map = readAll(userId);
    var hit = false;
    for (var k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
      if (map[k] && map[k].memoId === String(memoId)) { delete map[k]; hit = true; }
    }
    if (hit) writeAll(userId, map);
    return hit;
  }

  /** 清掉指向已不存在笔记的记录（迁移后或异常退出时兜底） */
  function gc(userId, liveIds) {
    var repo = backend();
    if (repo) return repo.gcDerived(String(userId || ''), liveIds || []);
    var live = {};
    for (var i = 0; i < (liveIds || []).length; i++) live[String(liveIds[i])] = true;
    var map = readAll(userId);
    var removed = 0;
    for (var k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
      if (!map[k] || !live[map[k].memoId]) { delete map[k]; removed += 1; }
    }
    if (removed) writeAll(userId, map);
    return removed;
  }

  function labelOf(kind) {
    return KINDS[kind] || kind;
  }

  global.DerivedStore = {
    KINDS: KINDS,
    MAX_KINDS: MAX_KINDS,
    put: put,
    get: get,
    all: all,
    allOfUser: allOfUser,
    adopt: adopt,
    markStale: markStale,
    drop: drop,
    gc: gc,
    labelOf: labelOf,
    keyOf: keyOf
  };
})(window);
