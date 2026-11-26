/* ==========================================================================
   storage.js — 本机数据层
   统一封装浏览器本地存储的读写，任何一处存储失败都不会让页面崩溃。
   ========================================================================== */

(function (global) {
  'use strict';

  var PREFIX = 'today-todo:v1:';

  function fullKey(name) {
    return PREFIX + name;
  }

  function isAvailable() {
    try {
      /* 配额耗尽只会阻止写入，旧账号和正文仍可读，也应允许删除释放空间。 */
      global.localStorage.getItem(PREFIX + '__probe__');
      return true;
    } catch (err) {
      return false;
    }
  }

  function read(name, fallback) {
    try {
      var raw = global.localStorage.getItem(fullKey(name));
      if (raw === null || raw === undefined) return fallback;
      var parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (err) {
      return fallback;
    }
  }

  function write(name, value) {
    try {
      global.localStorage.setItem(fullKey(name), JSON.stringify(value));
      return true;
    } catch (err) {
      return false;
    }
  }

  function remove(name) {
    try {
      global.localStorage.removeItem(fullKey(name));
    } catch (err) {
      /* 忽略：清理失败不影响主流程 */
    }
  }

  global.AppStorage = {
    available: isAvailable(),
    read: read,
    write: write,
    remove: remove
  };
})(window);
