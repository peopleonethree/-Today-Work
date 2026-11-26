/* ==========================================================================
   memo.js — 笔记主体（L3 领域层）
   待办只有一句话（最多 120 字），摘要 / 润色 / 检索都没有处理对象，
   所以这里补一个「有正文的实体」。它与 todo 是两回事：
     memo 记事，todo 记要做的事；一条 memo 可以长出多条 todo（见 draft 流程）。
   存储按账号隔离，键名 today-todo:v1:memo:<userId>，只加字段不删字段。
   ========================================================================== */

(function (global) {
  'use strict';

  var Store = global.AppStorage;

  /* localStorage 大约 5MB，一条 500 字的正文约占 1KB，留出余量取 500 条 */
  var MAX_MEMOS = 500;
  var MAX_TITLE = 60;
  var MAX_BODY = 20000;

  function keyOf(userId) {
    return 'memo:' + (userId || 'anon');
  }

  function newId() {
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function trim(value, max) {
    var text = String(value == null ? '' : value).replace(/\r\n/g, '\n').trim();
    return max && text.length > max ? text.slice(0, max) : text;
  }

  /** 第一行非空内容，用来给没写标题的笔记兜底 */
  function firstLine(body) {
    var lines = String(body || '').split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line) return line;
    }
    return '';
  }

  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var id = String(raw.id || '');
    if (!id) return null;
    var body = String(raw.body == null ? '' : raw.body);
    var title = String(raw.title == null ? '' : raw.title);
    var created = Number(raw.createdAt) || 0;
    return {
      id: id,
      /* userId / spaceId 先留着：M2 做空间隔离时不用再改结构 */
      userId: String(raw.userId || ''),
      spaceId: String(raw.spaceId || ''),
      title: title || firstLine(body) || '未命名笔记',
      body: body,
      bodyFormat: raw.bodyFormat === 'plain' ? 'plain' : 'plain',
      /* 原始转写：不加工、不覆盖，模型整理错了还能对回原话 */
      sourceText: String(raw.sourceText == null ? '' : raw.sourceText),
      sourceVoiceId: String(raw.sourceVoiceId || ''),
      rev: Number(raw.rev) || 1,
      createdAt: created || Date.now(),
      updatedAt: Number(raw.updatedAt) || created || Date.now(),
      deletedAt: Number(raw.deletedAt) || 0
    };
  }

  function readAll(userId) {
    var raw = Store.read(keyOf(userId), []);
    var list = Array.isArray(raw) ? raw : [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var item = normalize(list[i]);
      if (item) out.push(item);
    }
    return out;
  }

  function writeAll(userId, list) {
    /* 只留最新的 MAX_MEMOS 条，超出的按「最久没动」淘汰 */
    var sorted = list.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    var keep = sorted.slice(0, MAX_MEMOS);
    return Store.write(keyOf(userId), keep);
  }

  /**
   * 双后端：原生环境走 SQLite（SqlRepo，行级读写 + 索引），
   * 网页版 / 测试环境没有 AndroidHost，退回 localStorage。
   * 两条路的对外行为完全一致；迁移由 Migrator v4 一次性搬运。
   */
  function backend() {
    var repo = global.SqlRepo;
    return (repo && typeof repo.available === 'function' && repo.available()) ? repo : null;
  }

  /** 落库成功后同步倒排索引；索引层不在也无所谓（检索退回字面扫描） */
  function indexSync(memo) {
    var idx = global.IndexStore;
    if (idx && typeof idx.syncMemo === 'function') {
      try { idx.syncMemo(memo); } catch (error) { /* 索引坏了不影响保存 */ }
    }
  }

  /** 列表：默认按更新时间倒序，不含已删除 */
  function list(userId) {
    var repo = backend();
    if (repo) return repo.memos(userId, false) || [];
    var all = readAll(userId);
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (!all[i].deletedAt) out.push(all[i]);
    }
    out.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    return out;
  }

  function get(userId, id) {
    var repo = backend();
    if (repo) return repo.getMemo(userId, id);
    var all = readAll(userId);
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) return all[i].deletedAt ? null : all[i];
    }
    return null;
  }

  /**
   * 新建一条笔记。
   * input: { title, body, sourceText, sourceVoiceId }
   * 标题正文都空就返回 null（不落空记录）。
   */
  function create(userId, input) {
    var o = input || {};
    var body = trim(o.body, MAX_BODY);
    var title = trim(o.title, MAX_TITLE);
    var source = trim(o.sourceText, MAX_BODY);
    if (!body && !title && !source) return null;

    var now = Date.now();
    var memo = {
      id: newId(),
      userId: String(userId || ''),
      spaceId: '',
      title: title || firstLine(body) || firstLine(source) || '未命名笔记',
      body: body || source,
      bodyFormat: 'plain',
      sourceText: source,
      sourceVoiceId: String(o.sourceVoiceId || ''),
      rev: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: 0
    };
    var repo = backend();
    if (repo) {
      if (!repo.putMemo(memo)) return null;
      indexSync(memo);
      return memo;
    }
    var all = readAll(userId);
    all.push(memo);
    Store.write(keyOf(userId), all);
    /* 写回时可能被截断，用读回的对象作为结果，避免内存里留一条其实没落盘的记录 */
    var back = get(userId, memo.id);
    return back || null;
  }

  /**
   * 改标题 / 正文。内容真变了才 rev+1 —— 衍生数据的「过期」判定靠它，
   * 每次打开就 +1 会让摘要永远显示过期。
   */
  function update(userId, id, patch) {
    var repo = backend();
    var hit = repo ? repo.getMemo(userId, id) : null;
    if (!hit) {
      var all = readAll(userId);
      for (var i = 0; i < all.length; i++) {
        if (all[i].id === id && !all[i].deletedAt) { hit = all[i]; break; }
      }
    }
    if (!hit) return null;

    var o = patch || {};
    var nextTitle = o.title === undefined ? hit.title : trim(o.title, MAX_TITLE);
    var nextBody = o.body === undefined ? hit.body : trim(o.body, MAX_BODY);
    if (!nextTitle && !nextBody) return hit;

    if (nextTitle === hit.title && nextBody === hit.body) return hit;

    hit.title = nextTitle || firstLine(nextBody) || '未命名笔记';
    hit.body = nextBody;
    hit.rev += 1;
    hit.updatedAt = Date.now();
    if (repo) {
      if (!repo.putMemo(hit)) return null;
      indexSync(hit);
      return hit;
    }
    if (!Store.write(keyOf(userId), all)) return null;
    return hit;
  }

  /** 软删除：正文先留着，衍生数据由调用方一并清理 */
  function remove(userId, id) {
    var repo = backend();
    if (repo) {
      var ok = repo.deleteMemo(userId, id, Date.now());
      if (ok) {
        var idx = global.IndexStore;
        if (idx && typeof idx.dropMemo === 'function') {
          try { idx.dropMemo(id); } catch (error) { /* 索引坏了不影响删除 */ }
        }
      }
      return ok;
    }
    var all = readAll(userId);
    var hit = null;
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) { hit = all[i]; break; }
    }
    if (!hit) return false;
    hit.deletedAt = Date.now();
    hit.updatedAt = hit.deletedAt;
    return Store.write(keyOf(userId), all);
  }

  /** 字面搜索：兜底路径（SQLite 路径的检索走 SearchService 混合打分） */
  function search(userId, query) {
    var q = String(query || '').trim().toLowerCase();
    var all = list(userId);
    if (!q) return all;
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var m = all[i];
      var hay = (m.title + '\n' + m.body + '\n' + m.sourceText).toLowerCase();
      if (hay.indexOf(q) !== -1) out.push(m);
    }
    return out;
  }

  function stats(userId) {
    var all = list(userId);
    var chars = 0;
    for (var i = 0; i < all.length; i++) chars += all[i].body.length;
    return { count: all.length, chars: chars, lastAt: all.length ? all[0].updatedAt : 0 };
  }

  /** 列表里两行预览：压掉换行，超长截断 */
  function previewOf(memo, max) {
    var body = String((memo && memo.body) || '');
    var title = String((memo && memo.title) || '');
    /* 正文开头常和标题重复，重复就跳过这一段 */
    if (title && body.indexOf(title) === 0) body = body.slice(title.length);
    var text = body.replace(/\s+/g, ' ').trim();
    if (!text) text = String((memo && memo.sourceText) || '').replace(/\s+/g, ' ').trim();
    var limit = max || 60;
    return text.length > limit ? text.slice(0, limit) + '…' : text;
  }

  global.MemoService = {
    MAX_MEMOS: MAX_MEMOS,
    MAX_TITLE: MAX_TITLE,
    MAX_BODY: MAX_BODY,
    list: list,
    get: get,
    create: create,
    update: update,
    remove: remove,
    search: search,
    stats: stats,
    previewOf: previewOf,
    firstLine: firstLine,
    normalize: normalize,
    keyOf: keyOf
  };
})(window);
