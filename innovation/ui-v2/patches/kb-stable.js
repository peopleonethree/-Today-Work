
/* ==========================================================================
   键盘稳定层 + 图片兜底（2026-11-26 追加在 app.js 末尾，独立作用域，不改上面的逻辑）

   键盘为什么会把布局弄乱
   ----------------------
   原生在键盘弹起时，把「键盘高度」加成根视图的底部内边距，WebView 因此整体变矮。
   对页面来说这是一次视口骤缩，而且键盘动画的每一帧都会来一次：
   · 所有 vh / dvh 尺寸逐帧变化，居中的弹层跟着逐帧上下跳、内容被压扁重排；
   · 弹层里靠下的输入框直接落到键盘底下，没有任何逻辑把它露出来。
   原生其实已经把内边距推给了页面（TodoNativeHost.receiveInsets → --inset-bottom），
   但页面只记录不使用。

   这一层做什么
   ------------
   1. 收到内边距开始变大 → 判定「键盘正在弹出」，把当前浮层的尺寸锁在弹出前的大小，
      浮层画布也保持弹出前的高度。于是键盘动画期间内容零重排，只是下沿被键盘盖住。
   2. 键盘动画落定后 → 如果聚焦的输入框在可视区下方，先滚弹层内部，不够再整体上移。
   3. 内边距回落 → 解除锁定，浮层原位恢复。
   没有原生内边距的环境（普通浏览器）退化为按可视高度变化判断，行为一致。
   ========================================================================== */
(function (global) {
  'use strict';

  var doc = global.document;
  var root = doc.documentElement;
  var OPEN_DELTA = 80;    /* 底部内边距比「无键盘」多出这么多，就认定键盘在弹出 */
  var CLOSE_DELTA = 28;   /* 回落到基准的这个范围以内，认定键盘已收起 */
  var SETTLE_MS = 100;   /* 内边距最后一次变化后等这么久，算动画结束。
                            偶尔在动画中途就到了也没关系：露出输入框的算法可以重复执行，之后会再修正一次 */
  var EDGE = 16;         /* 输入框与键盘之间留的空隙 */

  var baseBottom = -1;   /* 没有键盘时的底部内边距（手势条 / 导航栏） */
  var restVp = 0;        /* 没有键盘时的可视高度 */
  var open = false;
  var locked = [];
  var settleTimer = 0;
  var restTimer = 0;
  var releaseTimer = 0;
  var pendingRestore = null;   /* 解除后等 200ms 才还原的记录 */

  function visible(el) {
    if (!el || el.classList.contains('is-hidden')) return false;
    return el.getBoundingClientRect().height > 0;
  }

  /* 浮层 = 页面里的弹层（.sheet-layer）+ 原生 <dialog>（词库面板） */
  function floaters() {
    var out = [];
    var layers = doc.querySelectorAll('.sheet-layer');
    for (var i = 0; i < layers.length; i++) if (visible(layers[i])) out.push(layers[i]);
    var dialogs = doc.querySelectorAll('dialog[open]');
    for (var j = 0; j < dialogs.length; j++) {
      /* 带 data-kb-skip 的弹层自己管键盘下的布局（如常用词档案的 flex 弹层，
         限高随视口走），不再按「弹出前高度」锁死——锁旧值反而会把它顶出视口 */
      if (!dialogs[j].hasAttribute('data-kb-skip')) out.push(dialogs[j]);
    }
    return out;
  }

  function innerSheet(box) {
    if (box.tagName === 'DIALOG') return box;
    return box.querySelector('.sheet') || box;
  }

  function isTextEntry(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    var t = (el.type || 'text').toLowerCase();
    return t !== 'checkbox' && t !== 'radio' && t !== 'button' && t !== 'submit' && t !== 'range' && t !== 'file';
  }

  /* 记住「没有键盘时」各浮层的高度。键盘弹出可能只给我们一次回调机会，
     届时视口也许已经矮了一截，所以尺寸必须提前在静止时量好。 */
  function captureRest() {
    if (open) return;
    /* 原生内边距已经离开基准 = 键盘正在弹出/收起，此刻视口是矮的。
       这时采下去会把「无键盘高度」记成动画中间值：实测快速收起再弹出时，
       上一轮 release() 的 200ms 定时器正好落在这一轮的弹出动画里（视口 802 而非 869），
       基准被记成 802，下一次锁定就按矮的高度锁，弹层整体上跳 67px。
       所以此时直接跳过，等真回到基准后的那一次采集再更新。 */
    if (baseBottom >= 0 && lastBottom > baseBottom + CLOSE_DELTA) return;
    restVp = global.innerHeight;
    var boxes = floaters();
    for (var i = 0; i < boxes.length; i++) {
      var sheet = innerSheet(boxes[i]);
      sheet.__uiRestH = sheet.offsetHeight;
      sheet.__uiRestScroll = sheet.scrollHeight > sheet.clientHeight + 1;
    }
  }

  function scheduleRest() {
    clearTimeout(restTimer);
    restTimer = setTimeout(captureRest, 140);
  }

  function engage() {
    if (open) return;
    /* 上一轮的「解除还原」还排在定时器里没执行：先立刻还原干净，再记这一轮的旧值。
       否则那个迟到的定时器会把这一轮刚锁上的样式抹掉（实测：快速连开两次键盘，
       第二次弹层就没锁住，而且内联样式会永久残留）。 */
    flushRestore();
    open = true;
    root.setAttribute('data-kb', 'open');
    if (!restVp) restVp = global.innerHeight;
    var boxes = floaters();
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      var sheet = innerSheet(box);
      var isLayer = box.tagName !== 'DIALOG';
      /* 没有静止时的记录（浮层刚开、键盘立刻弹出）：高度补上已经缩掉的那一截 */
      var kb = baseBottom >= 0 ? lastBottom - baseBottom : 0;
      var h = sheet.__uiRestH || (sheet.offsetHeight + Math.max(0, kb));
      var scrollable = typeof sheet.__uiRestScroll === 'boolean' ? sheet.__uiRestScroll : sheet.scrollHeight > sheet.clientHeight + 1;
      var rec = { box: box, sheet: sheet, isLayer: isLayer, boxProps: [], sheetProps: [] };
      if (isLayer) {
        setProp(rec, true, box, 'height', restVp + 'px');
        setProp(rec, true, box, 'bottom', 'auto');
        setProp(rec, true, box, 'transition', 'none');
      }
      setProp(rec, false, sheet, 'max-height', h + 'px');
      if (scrollable) setProp(rec, false, sheet, 'height', h + 'px');
      /* 把这两个属性也纳入记录：解除时能精确还原，不留内联残留 */
      setProp(rec, false, sheet, 'transform', 'none');
      setProp(rec, false, sheet, 'transition', 'none');
      locked.push(rec);
    }
  }

  /* 逐属性记录旧的内联值，解除时精确还原，不碰应用自己写的内联样式 */
  function setProp(rec, onBox, el, name, value) {
    (onBox ? rec.boxProps : rec.sheetProps).push([name, el.style.getPropertyValue(name), el.style.getPropertyPriority(name)]);
    el.style.setProperty(name, value);
  }

  function restore(rec) {
    var i;
    var p;
    for (i = 0; i < rec.boxProps.length; i++) {
      p = rec.boxProps[i];
      if (p[1]) rec.box.style.setProperty(p[0], p[1], p[2]); else rec.box.style.removeProperty(p[0]);
    }
    for (i = 0; i < rec.sheetProps.length; i++) {
      p = rec.sheetProps[i];
      if (p[1]) rec.sheet.style.setProperty(p[0], p[1], p[2]); else rec.sheet.style.removeProperty(p[0]);
    }
  }

  /* 键盘落定：把聚焦的输入框挪到键盘上方 */
  function reveal() {
    var el = doc.activeElement;
    if (!isTextEntry(el)) return;
    var limit = global.innerHeight - EDGE;
    var r = el.getBoundingClientRect();
    if (r.height <= 0) return;
    /* 单行输入框要整条露出来；多行文本域只要求最上面的两行露出来，
       否则一个大文本域会让整个弹层跳上去 */
    var needBottom = el.tagName === 'TEXTAREA' ? Math.min(r.bottom, r.top + 72) : r.bottom;
    if (needBottom <= limit && r.top >= EDGE) return;   /* 本来就看得见 */

    var over = needBottom + EDGE - limit;
    for (var i = 0; i < locked.length; i++) {
      var rec = locked[i];
      if (!rec.box.contains(el)) continue;
      var sheet = rec.sheet;
      /* 先用弹层自己的滚动；只有短弹层或已经滚到底才需要整体上移 */
      if (sheet.scrollHeight > sheet.clientHeight + 1) {
        var canScroll = sheet.scrollHeight - sheet.clientHeight - sheet.scrollTop;
        var scrolled = Math.min(over, canScroll);
        if (scrolled > 0) {
          sheet.scrollTop += scrolled;
          r = el.getBoundingClientRect();
          needBottom = el.tagName === 'TEXTAREA' ? Math.min(r.bottom, r.top + 72) : r.bottom;
          over = needBottom + EDGE - limit;
        }
      }
      if (over > 0) {
        var sr = sheet.getBoundingClientRect();
        var shift = Math.min(over, Math.max(0, sr.top - 8));
        if (shift > 0) {
          sheet.style.transition = 'transform 0.16s ease-out';
          sheet.style.transform = 'translateY(-' + Math.round(shift) + 'px)';
        }
      }
      return;
    }

    /* 输入框不在浮层里：让浏览器把它滚进可视区（弹层是 fixed 的，不会带动页面） */
    if (el.scrollIntoView) el.scrollIntoView({ block: 'center' });
  }

  function release() {
    if (!open) return;
    open = false;
    root.removeAttribute('data-kb');
    var i;
    for (i = 0; i < locked.length; i++) {
      if (locked[i].sheet.style.transform) {
        locked[i].sheet.style.transition = 'transform 0.16s ease-out';
        locked[i].sheet.style.transform = '';
      }
    }
    pendingRestore = locked;
    locked = [];
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(function () {
      flushRestore();
      captureRest();
    }, 200);
  }

  /* 把「解除后延迟还原」的样式立刻还原。键盘收起时先让上移的弹层滑回原位，再过 200ms 收掉内联样式。 */
  function flushRestore() {
    if (!pendingRestore) return;
    var list = pendingRestore;
    pendingRestore = null;
    clearTimeout(releaseTimer);
    for (var j = 0; j < list.length; j++) restore(list[j]);
  }

  var lastBottom = 0;

  function onBottom(bottom) {
    if (!(bottom >= 0)) return;
    lastBottom = bottom;
    if (baseBottom < 0) {
      /* 第一次就收到内边距。如果这时视口已经矮了一截，说明这一帧本身就是键盘，
         基准要倒推回去，否则会把「键盘高度」当成导航栏，之后永远判定不出弹出 */
      var shrink = restVp ? restVp - global.innerHeight : 0;
      baseBottom = shrink > OPEN_DELTA ? Math.max(0, bottom - shrink) : bottom;
    }
    if (!open && bottom < baseBottom) baseBottom = bottom;   /* 导航栏形态变化，基准取更小的 */

    if (!open && bottom > baseBottom + OPEN_DELTA) {
      engage();
    } else if (open && bottom <= baseBottom + CLOSE_DELTA) {
      release();
      return;
    } else if (!open) {
      return;
    }
    clearTimeout(settleTimer);
    settleTimer = setTimeout(function () {
      if (open) reveal();
    }, SETTLE_MS);
  }

  /* 信号一：原生推来的内边距（权威信号，含键盘动画的每一帧） */
  function hookNative(attempt) {
    var host = global.TodoNativeHost;
    if (host && typeof host.receiveInsets === 'function' && !host.__uiKbHooked) {
      var original = host.receiveInsets;
      host.receiveInsets = function (top, bottom) {
        var out = original.apply(this, arguments);
        try {
          onBottom(Number(bottom) || 0);
        } catch (err) { /* 稳定层自身出错不能影响原有逻辑 */ }
        return out;
      };
      host.__uiKbHooked = true;
      return true;
    }
    if (attempt < 40) setTimeout(function () { hookNative(attempt + 1); }, 100);
    return false;
  }

  /* 信号二：可视高度变化。没有原生内边距的环境靠它；有原生时它只是补充 */
  global.addEventListener('resize', function () {
    if (baseBottom >= 0) return;   /* 有原生信号时以原生为准 */
    var h = global.innerHeight;
    if (!restVp) { restVp = h; return; }
    if (!open && restVp - h > OPEN_DELTA) {
      lastBottom = h;
      engage();
    } else if (open && h >= restVp - CLOSE_DELTA) {
      release();
      return;
    } else {
      return;
    }
    clearTimeout(settleTimer);
    settleTimer = setTimeout(function () {
      if (open) reveal();
    }, SETTLE_MS);
  });

  /* 浮层开了又关是很频繁的：只在静止时（键盘没弹出）重新量尺寸 */
  function watchFloaters() {
    if (typeof global.MutationObserver !== 'function') return;
    var mo = new global.MutationObserver(function () {
      if (!open) scheduleRest();
    });
    mo.observe(doc.body, {
      attributes: true,
      attributeFilter: ['class', 'open', 'style'],
      subtree: true,
    });
  }

  /* 加载失败的图片：做个标记，样式层把它藏起来（登录页封面在所有包里都不存在）。
     用捕获阶段监听，能接住不冒泡的 error 事件；脚本执行前就已经失败的图要补扫一遍。 */
  function markBroken(img) {
    if (img && img.tagName === 'IMG' && img.complete && img.naturalWidth === 0) {
      img.setAttribute('data-broken', '1');
    }
  }
  doc.addEventListener('error', function (event) {
    markBroken(event.target);
  }, true);
  function sweepBroken() {
    var imgs = doc.images;
    for (var i = 0; i < imgs.length; i++) markBroken(imgs[i]);
  }

  /* 换主题时按钮不做渐变。
     样式层给所有按钮加了背景色 / 边框色过渡（按钮自身状态切换时配色不再「跳」）。
     但换主题会一次改掉页面上所有按钮的配色，一百多条过渡同时在主线程逐帧重算；
     连点换主题时主线程比原版多出三到六成。
     做法：根元素的主题属性一变，就挂上「正在换主题」标记（样式层据此临时关掉按钮过渡），
     等两帧画完再摘掉——这两帧里浏览器已经按新配色、无过渡地算过一遍样式，摘掉标记时数值不再变化，
     所以不会补跑过渡。按钮自身状态切换的渐变不受影响。
     效果：换主题时按钮配色即时切换（与原版一致），其余场合照常渐变。 */
  var RETHEME_CLASS = 'is-retheming';
  var rethemeFrames = 0;
  function rethemeTick() {
    rethemeFrames -= 1;
    if (rethemeFrames <= 0) root.classList.remove(RETHEME_CLASS);
    else global.requestAnimationFrame(rethemeTick);
  }
  function watchTheme() {
    if (typeof global.MutationObserver !== 'function' || typeof global.requestAnimationFrame !== 'function') return;
    new global.MutationObserver(function () {
      root.classList.add(RETHEME_CLASS);
      var idle = rethemeFrames <= 0;
      rethemeFrames = 2;                       /* 连点时续上，不重新计数 */
      if (idle) global.requestAnimationFrame(rethemeTick);
    }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  }

  function start() {
    hookNative(0);
    watchFloaters();
    watchTheme();
    sweepBroken();
    global.addEventListener('load', sweepBroken);
    scheduleRest();
  }
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window);
