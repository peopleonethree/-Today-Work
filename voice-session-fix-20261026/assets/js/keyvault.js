/* ==========================================================================
   keyvault.js — API 密钥的托管入口（L5）

   以前密钥明文躺在 localStorage 里：`today-todo:v1:prefs` 一读就有 `sk-…`。
   手机上任何拿到 WebView 数据目录、或者用备份工具导一份的应用都能读走它。

   现在页面只持一个引用（`keyRef`），真钥匙由原生 Keystore 加密后存在
   SharedPreferences 里，密钥材料本身不出安全硬件。

   网页版没有 Keystore，退化成「跟随页面存储」——那种情况会在设置页明说，
   不会假装加密过。
   ========================================================================== */

(function (global) {
  'use strict';

  function api() {
    var n = global.TodoNative;
    return n && typeof n.vaultPut === 'function' ? n : null;
  }

  /** 这台设备有没有真正的加密仓库 */
  function available() {
    var n = api();
    if (!n) return false;
    try {
      return typeof n.vaultReady === 'function' ? !!n.vaultReady() : true;
    } catch (error) {
      return false;
    }
  }

  function mode() {
    return available() ? 'keystore' : 'plain';
  }

  function newRef() {
    return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function put(ref, secret) {
    var n = api();
    var id = String(ref || '');
    if (!n || !id || !secret) return false;
    try {
      return !!n.vaultPut(id, String(secret));
    } catch (error) {
      return false;
    }
  }

  function get(ref) {
    var n = api();
    var id = String(ref || '');
    if (!n || !id) return '';
    try {
      var value = n.vaultGet(id);
      return value == null ? '' : String(value);
    } catch (error) {
      return '';
    }
  }

  function remove(ref) {
    var n = api();
    var id = String(ref || '');
    if (!n || !id) return false;
    try {
      return !!n.vaultRemove(id);
    } catch (error) {
      return false;
    }
  }

  /** 明文串是不是长得像密钥（迁移时用来判断要不要搬走） */
  function looksLikeSecret(value) {
    var s = String(value || '').trim();
    if (s.length < 8) return false;
    return /^sk[-_]/i.test(s) || /^[A-Za-z0-9_\-]{24,}$/.test(s);
  }

  global.KeyVault = {
    available: available,
    mode: mode,
    newRef: newRef,
    put: put,
    get: get,
    remove: remove,
    looksLikeSecret: looksLikeSecret
  };
})(window);
