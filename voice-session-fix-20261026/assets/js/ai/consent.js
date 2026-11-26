/* ==========================================================================
   consent.js — 什么内容允许离开这台手机（L4）

   三个档位，按「内容」而不是按「功能」判断：

     online  允许联网  正文发给模型，发送前按设置打码（默认档，和以前一样）
     local   只在本机  正文一个字都不出去；模型目录探测这类不含内容能跑
     blocked 关闭 AI    连模型目录都不查，全部退回本地规则

   判断必须在「拼上下文之前」发生，不是发出去以后才发现不该发。
   设置存在本机 today-todo:v1:aiConsent，跟着设备走，不随账号同步。
   ========================================================================== */

(function (global) {
  'use strict';

  var Store = global.AppStorage;
  var KEY = 'aiConsent';

  var MODES = {
    online: {
      key: 'online',
      label: '允许联网',
      desc: '正文发给模型服务商，发送前按脱敏设置处理',
      order: 0
    },
    local: {
      key: 'local',
      label: '只在本机',
      desc: '正文不出手机，只用本地规则；模型目录仍可更新',
      order: 1
    },
    blocked: {
      key: 'blocked',
      label: '关闭 AI',
      desc: '不联网、不调模型，只保留本地功能',
      order: 2
    }
  };

  var DEFAULT = 'online';

  /* 这两类请求只带接口地址，不带用户内容，所以「只在本机」档也放行 */
  var CONTENT_FREE = { catalog: true, probe: true, models: true };

  var listener = null;

  function readState() {
    var raw = Store.read(KEY, null);
    if (!raw || typeof raw !== 'object') return { mode: DEFAULT, updatedAt: 0 };
    var mode = MODES[raw.mode] ? raw.mode : DEFAULT;
    return { mode: mode, updatedAt: Number(raw.updatedAt) || 0 };
  }

  function mode() {
    return readState().mode;
  }

  function setMode(next) {
    if (!MODES[next]) return false;
    var ok = Store.write(KEY, { mode: next, updatedAt: Date.now() });
    if (ok && typeof listener === 'function') {
      try { listener(next); } catch (error) { /* 订阅方出错不影响设置落盘 */ }
    }
    return ok;
  }

  function onChange(fn) {
    listener = typeof fn === 'function' ? fn : null;
  }

  /** 给设置页渲染用：固定顺序的数组，不带内部实现细节 */
  function all() {
    var out = [];
    for (var k in MODES) {
      if (Object.prototype.hasOwnProperty.call(MODES, k)) out.push(MODES[k]);
    }
    out.sort(function (a, b) { return a.order - b.order; });
    return out;
  }

  /**
   * 能不能把这段内容发出去。
   * input: 字符串（正文）或 { text, task }
   * 返回 { allowed, code, reason, redactions, mode }
   *   code: ok | blocked | local-only | empty
   */
  function check(input) {
    var o = typeof input === 'string' ? { text: input } : (input || {});
    var text = String(o.text == null ? '' : o.text);
    var task = String(o.task || '');
    var m = mode();

    if (m === 'blocked') {
      return {
        allowed: false, code: 'blocked', mode: m, redactions: 0,
        reason: '已关闭 AI，正文不会离开这台手机'
      };
    }
    if (m === 'local') {
      if (CONTENT_FREE[task]) {
        return { allowed: true, code: 'ok', mode: m, redactions: 0, reason: '' };
      }
      return {
        allowed: false, code: 'local-only', mode: m, redactions: 0,
        reason: '当前设置是「只在本机」，这段内容不会发出去'
      };
    }

    /* online：算一下会打掉几处敏感信息，给确认框用 */
    var hits = 0;
    var safety = global.AiSafety;
    if (safety && typeof safety.maskPii === 'function' && text) {
      try { hits = safety.maskPii(text).hits; } catch (error) { hits = 0; }
    }
    if (!text.trim() && !CONTENT_FREE[task]) {
      return { allowed: false, code: 'empty', mode: m, redactions: 0, reason: '没有可发送的内容' };
    }
    return { allowed: true, code: 'ok', mode: m, redactions: hits, reason: '' };
  }

  /** 设置页那一行说明文字 */
  function describe(m) {
    var hit = MODES[m || mode()];
    return hit ? hit.desc : '';
  }

  global.ConsentPolicy = {
    MODES: MODES,
    DEFAULT: DEFAULT,
    all: all,
    mode: mode,
    setMode: setMode,
    onChange: onChange,
    check: check,
    describe: describe,
    key: KEY
  };
})(window);
