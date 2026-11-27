/* ==========================================================================
   paste-import.js — 常用人名「粘贴昵称」入口
   --------------------------------------------------------------------------
   为什么需要：设置页原来只有「从文本导入」，点开是系统文件选择器，要求用户先有
   一份 UTF-8 的 txt。微信 / QQ 都不提供好友名单导出，所以这个入口等于死路。

   本补丁在不碰 dex、不碰 HTML 的前提下，加一个「粘贴昵称」按钮 + 一个 <dialog>：
   在微信 / QQ 里长按复制昵称，粘进来，点「导入」即追加到 #voice-names。
   归一化与去重完全交给原有的「保存常用人名」流程（app.js 的 normalizeVoiceNames），
   这里不复制那套规则，避免两处规则漂移。

   注意：app.js 整体在 (function (global) { … })(window) 里，本补丁拼接在其后，
   拿不到闭包内的 toast / normalizeVoiceNames，因此 toast 复用页面上的 #toast 元素，
   样式只使用 :root 里的主题令牌，跟随三套主题自动变色。
   ========================================================================== */
(function (global) {
  'use strict';

  var doc = global.document;
  var BTN_ID = 'paste-voice-names';
  var DLG_ID = 'paste-voice-names-dialog';
  var STYLE_ID = 'paste-voice-names-style';

  var CSS = [
    '#' + DLG_ID + '{width:min(92vw,32rem);max-height:86vh;overflow:auto;padding:16px;',
    '  border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);color:var(--text);}',
    '#' + DLG_ID + '::backdrop{background:rgba(20,26,44,.42);}',
    '#' + DLG_ID + ' header{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:0 0 10px;}',
    '#' + DLG_ID + ' header h2{margin:0;font-size:16px;color:var(--text);}',
    '#' + DLG_ID + ' p{margin:0 0 10px;color:var(--text-2);font-size:13px;line-height:1.65;}',
    '#' + DLG_ID + ' textarea{width:100%;min-height:9em;padding:10px;border:1px solid var(--line);',
    '  border-radius:var(--radius-sm);background:var(--bg);color:var(--text);font:inherit;font-size:14px;resize:vertical;}',
    '#' + DLG_ID + ' .paste-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}',
    '#' + DLG_ID + ' button{min-height:40px;padding:0 14px;border:1px solid var(--line);',
    '  border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font:inherit;font-size:14px;}',
    '#' + DLG_ID + ' button[data-apply]{background:var(--primary);border-color:var(--primary);color:#fff;}',
  ].join('\n');

  function $(id) {
    return doc.getElementById(id);
  }

  /* 复用页面自带的 #toast，样式与 App 内部提示一致 */
  function tip(message) {
    var el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('is-show');
    if (tip.timer) global.clearTimeout(tip.timer);
    tip.timer = global.setTimeout(function () {
      el.classList.remove('is-show');
    }, 2600);
  }

  /* 一行一个为主流粘贴格式；顿号 / 逗号 / 分号 / 竖线也当分隔符。
     顺序很关键：必须**先按行剥掉行首序号，再切分隔符**。
     反例（真机实测）：`3、测试丙、测试丁` 若先按顿号切，会切出孤立的 `3`，
     序号正则匹配不到它，`3` 就被当成一个昵称导入了（提示「已加入 7 条」而非 6 条）。
     纯数字条目再兜底丢掉，避免序号以任何形式残留。 */
  function splitNames(text) {
    return String(text == null ? '' : text)
      .split(/\r?\n/)
      .map(function (line) {
        return line.replace(/^\s*\d+\s*[.、)．]\s*/, '').trim();
      })
      .join('\n')
      .split(/[\r\n、，,；;|]+/)
      .map(function (item) {
        return item.trim();
      })
      .filter(function (item) {
        return item.length > 0 && !/^\d+$/.test(item);
      });
  }

  function buildDialog() {
    var dlg = doc.createElement('dialog');
    dlg.id = DLG_ID;
    dlg.setAttribute('aria-labelledby', DLG_ID + '-title');
    dlg.innerHTML = [
      '<header>',
      '  <h2 id="' + DLG_ID + '-title">粘贴昵称</h2>',
      '  <button type="button" data-close>关闭</button>',
      '</header>',
      '<p>在微信 / QQ 里长按昵称或备注复制，粘到下面。一行一个，或用顿号、逗号分隔，行首序号（1. / 3、）会自动去掉。<br>',
      '  点「读取剪贴板」没反应时，长按输入框选「粘贴」即可。<br>',
      '  点「导入」只是追加到「常用人名」，核对无误后再点「保存常用人名」；保存时只保留 2–4 个汉字，',
      '  昵称里的表情、字母、数字行会被忽略。</p>',
      '<textarea id="' + DLG_ID + '-text" placeholder="李娜&#10;欧阳明宇"></textarea>',
      '<div class="paste-row">',
      '  <button type="button" data-clip>读取剪贴板</button>',
      '  <button type="button" data-close>取消</button>',
      '  <button type="button" data-apply>导入</button>',
      '</div>',
    ].join('\n');
    return dlg;
  }

  function area() {
    return $('voice-names');
  }

  function doImport(dlg) {
    var target = area();
    var box = $(DLG_ID + '-text');
    if (!target || !box) return;
    var names = splitNames(box.value);
    if (!names.length) {
      tip('没有可导入的内容');
      return;
    }
    var head = target.value.replace(/[、，,\s]+$/, '');
    target.value = (head ? head + '、' : '') + names.join('、');
    /* 值是被脚本改的，通知一下可能监听 input/change 的逻辑 */
    target.dispatchEvent(new global.Event('input', { bubbles: true }));
    dlg.close();
    tip('已加入 ' + names.length + ' 条，请核对后点「保存常用人名」');
  }

  /* 真机实测：待办 App 的 WebView 没处理 onPermissionRequest，readText() 必被拒
     （NotAllowedError），所以这里的失败分支是常态而不是例外。失败时把焦点放到输入框，
     让「长按 → 粘贴」这条系统菜单路径一步可达。 */
  function guideManualPaste(message) {
    var box = $(DLG_ID + '-text');
    tip(message);
    if (box) box.focus();
  }

  function readClipboard() {
    var box = $(DLG_ID + '-text');
    var clip = global.navigator && global.navigator.clipboard;
    if (!box) return;
    if (!clip || typeof clip.readText !== 'function') {
      guideManualPaste('长按输入框，选「粘贴」即可');
      return;
    }
    clip.readText().then(function (text) {
      if (!text) {
        tip('剪贴板是空的');
        return;
      }
      box.value = box.value ? box.value.replace(/\s+$/, '') + '\n' + text : text;
    }).catch(function () {
      guideManualPaste('长按输入框，选「粘贴」即可');
    });
  }

  function bind(dlg) {
    dlg.addEventListener('click', function (event) {
      var node = event.target;
      var btn = node && typeof node.closest === 'function' ? node.closest('button') : null;
      if (!btn) {
        /* 点遮罩关闭：event.target 就是 dialog 本身 */
        if (event.target === dlg) dlg.close();
        return;
      }
      if (btn.hasAttribute('data-close')) dlg.close();
      else if (btn.hasAttribute('data-clip')) readClipboard();
      else if (btn.hasAttribute('data-apply')) doImport(dlg);
    });
  }

  function mount() {
    if ($(BTN_ID)) return;
    var anchor = $('import-voice-names');
    if (!anchor || !anchor.parentNode) return;

    if (!$(STYLE_ID)) {
      var style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      doc.head.appendChild(style);
    }

    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.id = BTN_ID;
    btn.className = anchor.className;
    btn.textContent = '粘贴昵称';
    anchor.parentNode.insertBefore(btn, anchor.nextSibling);

    var dlg = buildDialog();
    doc.body.appendChild(dlg);
    bind(dlg);

    btn.addEventListener('click', function () {
      var box = $(DLG_ID + '-text');
      if (box) box.value = '';
      dlg.showModal();
      if (box) box.focus();
      readClipboard();
    });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})(window);
