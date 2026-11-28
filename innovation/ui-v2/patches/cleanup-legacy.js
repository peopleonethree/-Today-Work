/* ==========================================================================
   遗留功能清理层（2026-11-28 追加在 app.js 末尾，独立作用域，不改上面的逻辑）

   「常用人名」与「QQ／微信好友名单导入」已由常用词档案库（voice-archive.js）
   取代，本层把它们的界面残骸摘掉：

   1. 设置页「常用人名」行：输入框、从文本导入、保存常用人名、隐藏的文件选择框
      （联系人与通话按钮在同一个区块里，必须留下）。
      相关行为在 app.js 侧已由 build.mjs 的定点替换切断：
      识别纠错不再读 prefs.voiceNames，加载时把遗留值清成空串。
   2. 词库面板的「批量导入人名」整块，以及「导入通话记录」入口和格式说明——
      手动添加词条、管理联系人、同步到当前账号词库、查词都不受影响。
   3. 文案里「已导入的 QQ／微信名单」的提法同步收掉。

   只删 DOM，不动存储：旧数据（prefs.voiceNames、目录里的导入通话记录）变成
   无人读取的死字节，其中 prefs.voiceNames 会在下一次保存偏好时被空串覆盖。
   全部节点找不到时静默跳过，兼容 --base 版与测试环境。
   ========================================================================== */
(function (global) {
  'use strict';

  var doc = global.document;
  if (!doc) return;

  function removeId(id) {
    var el = doc.getElementById(id);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function run() {
    /* 一、设置页：常用人名行（保留联系人与通话按钮和区块本身） */
    removeId('voice-names');
    removeId('voice-names-help');
    removeId('import-voice-names');
    removeId('voice-names-file');
    removeId('save-voice-names');
    var label = doc.querySelector('label[for="voice-names"]');
    if (label && label.parentNode) label.parentNode.removeChild(label);

    /* 二、词库面板：批量导入人名 / 导入通话记录 */
    var pasteBox = doc.getElementById('word-names-text');
    var pasteDetails = pasteBox && pasteBox.closest ? pasteBox.closest('details') : null;
    if (pasteDetails && pasteDetails.parentNode) pasteDetails.parentNode.removeChild(pasteDetails);
    var callsLabel = doc.getElementById('word-calls-file');
    callsLabel = callsLabel && callsLabel.closest ? callsLabel.closest('label') : null;
    if (callsLabel && callsLabel.parentNode) callsLabel.parentNode.removeChild(callsLabel);
    removeId('word-calls-format');

    /* 三、联系人与通话记录块的说明文案：去掉 QQ／微信名单的提法 */
    var openContacts = doc.getElementById('word-open-contacts');
    var dirDetails = openContacts && openContacts.closest ? openContacts.closest('details') : null;
    if (dirDetails) {
      var ps = dirDetails.querySelectorAll('p');
      for (var i = 0; i < ps.length; i++) {
        if (ps[i].textContent.indexOf('已导入的') >= 0) {
          ps[i].textContent = '同步已确认的手机联系人，以及通过联系人页打开拨号盘或客户端的记录。';
        }
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})(window);
