/* ==========================================================================
   auth.js — 本机账号
   注册 / 登录 / 退出，密码以「随机盐 + PBKDF2-SHA256（12 万次迭代）」派生后存储，
   不保存明文密码。账号数据按浏览器隔离。
   ========================================================================== */

(function (global) {
  'use strict';

  var Store = global.AppStorage;

  var USERS_KEY = 'users';
  var SESSION_KEY = 'session';
  var PBKDF2_ITERATIONS = 120000;
  var KEY_BITS = 256;

  /* ------------------------------------------------------------ 工具函数 */

  function toHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    }
    return out;
  }

  function fromHex(hex) {
    var len = Math.floor(hex.length / 2);
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  function randomSalt() {
    var bytes = new Uint8Array(16);
    if (global.crypto && typeof global.crypto.getRandomValues === 'function') {
      global.crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < bytes.length; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    return toHex(bytes);
  }

  function supportsWebCrypto() {
    return !!(
      global.crypto &&
      global.crypto.subtle &&
      typeof global.crypto.subtle.importKey === 'function' &&
      typeof global.TextEncoder === 'function'
    );
  }

  /* ------------------------------------------------------------ 口令派生 */

  function deriveWithWebCrypto(password, saltHex) {
    var encoder = new global.TextEncoder();
    return global.crypto.subtle
      .importKey('raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits'])
      .then(function (baseKey) {
        return global.crypto.subtle.deriveBits(
          {
            name: 'PBKDF2',
            salt: fromHex(saltHex),
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256'
          },
          baseKey,
          KEY_BITS
        );
      })
      .then(function (bits) {
        return toHex(new Uint8Array(bits));
      });
  }

  /* 降级实现：当浏览器不提供 WebCrypto 时使用，安全性弱于 PBKDF2，
     仅在非安全上下文（如直接用 file:// 打开）下启用。 */
  function deriveFallback(password, saltHex) {
    var input = saltHex + '::' + password;
    var h1 = 0x811c9dc5;
    var h2 = 0xc2b2ae35;
    for (var round = 0; round < 4000; round++) {
      for (var i = 0; i < input.length; i++) {
        var code = input.charCodeAt(i) + round;
        h1 = (h1 ^ code) >>> 0;
        h1 = Math.imul(h1, 16777619) >>> 0;
        h2 = (h2 + h1) >>> 0;
        h2 = ((h2 << 13) | (h2 >>> 19)) >>> 0;
        h2 = (h2 ^ (h1 >>> 7)) >>> 0;
      }
    }
    function pad(n) {
      var s = (n >>> 0).toString(16);
      while (s.length < 8) s = '0' + s;
      return s;
    }
    return pad(h1) + pad(h2) + pad((h1 ^ h2) >>> 0) + pad((h1 + h2) >>> 0);
  }

  function currentAlgo() {
    return supportsWebCrypto() ? 'pbkdf2' : 'fallback';
  }

  function derive(algo, password, saltHex) {
    if (algo === 'fallback') {
      return Promise.resolve(deriveFallback(password, saltHex));
    }
    if (!supportsWebCrypto()) {
      return Promise.reject(new Error('WEBCRYPTO_UNAVAILABLE'));
    }
    return deriveWithWebCrypto(password, saltHex);
  }

  /* ------------------------------------------------------------ 校验规则 */

  var NAME_PATTERN = /^[\u4e00-\u9fa5A-Za-z0-9_]+$/;

  function validateName(name) {
    if (!name) return '请输入用户名';
    if (name.length < 2 || name.length > 20) return '用户名需要 2–20 个字符';
    if (!NAME_PATTERN.test(name)) return '用户名只能包含中文、字母、数字和下划线';
    return '';
  }

  function validatePassword(password) {
    if (!password) return '请输入密码';
    if (password.length < 6) return '密码至少 6 位';
    if (password.length > 64) return '密码最多 64 位';
    return '';
  }

  /* ------------------------------------------------------------ 账号读写 */

  function loadUsers() {
    var users = Store.read(USERS_KEY, {});
    return users && typeof users === 'object' ? users : {};
  }

  function saveSession(key, name) {
    var ok = Store.write(SESSION_KEY, {
      key: key,
      name: name,
      signedInAt: Date.now()
    });
    if (ok) Store.write('lastName', name);
    return ok;
  }

  function register(rawName, rawPassword) {
    return new Promise(function (resolve) {
      var name = String(rawName == null ? '' : rawName).trim();
      var password = String(rawPassword == null ? '' : rawPassword);

      var nameError = validateName(name);
      if (nameError) return resolve({ ok: false, error: nameError });

      var passwordError = validatePassword(password);
      if (passwordError) return resolve({ ok: false, error: passwordError });

      var users = loadUsers();
      var key = name.toLowerCase();
      if (users[key]) {
        return resolve({ ok: false, error: '该用户名已被注册，请直接登录' });
      }

      var salt = randomSalt();
      var algo = currentAlgo();

      derive(algo, password, salt).then(
        function (hash) {
          users[key] = {
            name: name,
            key: key,
            salt: salt,
            hash: hash,
            algo: algo,
            createdAt: Date.now()
          };
          if (!Store.write(USERS_KEY, users)) {
            return resolve({ ok: false, error: '浏览器存储不可用，无法创建账号' });
          }
          if (!saveSession(key, name)) {
            return resolve({ ok: false, error: '账号已创建，但登录状态保存失败，请释放存储空间后登录' });
          }
          resolve({ ok: true, user: { name: name, key: key } });
        },
        function () {
          resolve({ ok: false, error: '当前环境无法安全处理密码，请改用 https 或更新浏览器后重试' });
        }
      );
    });
  }

  function login(rawName, rawPassword) {
    return new Promise(function (resolve) {
      var name = String(rawName == null ? '' : rawName).trim();
      var password = String(rawPassword == null ? '' : rawPassword);

      if (!name) return resolve({ ok: false, error: '请输入用户名' });
      if (!password) return resolve({ ok: false, error: '请输入密码' });

      var users = loadUsers();
      var record = users[name.toLowerCase()];
      if (!record) return resolve({ ok: false, error: '用户名或密码不正确' });

      derive(record.algo || 'pbkdf2', password, record.salt).then(
        function (hash) {
          if (hash !== record.hash) {
            return resolve({ ok: false, error: '用户名或密码不正确' });
          }
          if (!saveSession(record.key, record.name)) {
            return resolve({ ok: false, error: '浏览器存储不可用，无法登录' });
          }
          resolve({ ok: true, user: { name: record.name, key: record.key } });
        },
        function () {
          resolve({ ok: false, error: '当前环境无法校验密码，请改用 https 或更新浏览器后重试' });
        }
      );
    });
  }

  function currentUser() {
    var session = Store.read(SESSION_KEY, null);
    if (!session || !session.key) return null;
    var users = loadUsers();
    var record = users[session.key];
    if (!record) {
      Store.remove(SESSION_KEY);
      return null;
    }
    return { name: record.name, key: record.key, guest: !!record.guest };
  }

  function logout() {
    Store.remove(SESSION_KEY);
  }

  /* ------------------------------------------------------------ 游客登录

     游客是「本机一次性身份」：没有密码，key 随机，随时可以退出。
     它的数据同样按 key 隔离，卸载应用或清除数据就一并没了。 */

  function startGuest() {
    var users = loadUsers();
    var key;
    do {
      key = 'guest-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    } while (users[key]);

    var name = '游客' + String(Math.floor(Math.random() * 9000) + 1000);
    users[key] = {
      name: name,
      key: key,
      salt: '',
      hash: '',
      algo: 'guest',
      guest: true,
      createdAt: Date.now()
    };

    if (!Store.write(USERS_KEY, users)) {
      return { ok: false, error: '本机存储不可用，无法以游客身份进入' };
    }
    if (!saveSession(key, name)) {
      return { ok: false, error: '本机存储不可用，无法保存登录状态' };
    }
    Store.write('lastName', name);
    return { ok: true, user: { name: name, key: key, guest: true } };
  }

  /* ------------------------------------------------------ 账号是否在本机 */

  function findRecord(rawName) {
    var name = String(rawName == null ? '' : rawName).trim();
    if (!name) return null;
    var users = loadUsers();
    var lowered = name.toLowerCase();

    var direct = users[lowered];
    if (direct) return direct;

    /* 游客这类账号的 key 是随机串、不是用户名，只能按名字再扫一遍 */
    for (var k in users) {
      if (!Object.prototype.hasOwnProperty.call(users, k)) continue;
      var row = users[k];
      if (row && String(row.name || '').toLowerCase() === lowered) return row;
    }
    return null;
  }

  function userExists(rawName) {
    return !!findRecord(rawName);
  }

  /* -------------------------------------------------------------- 修改密码 */

  /**
   * 改密码必须给对原密码：这是本机账号，原密码是唯一凭证。
   * 游客账号没有密码，直接拒绝。
   */
  function changePassword(rawName, rawCurrent, rawNext) {
    return new Promise(function (resolve) {
      var name = String(rawName == null ? '' : rawName).trim();
      var current = String(rawCurrent == null ? '' : rawCurrent);
      var next = String(rawNext == null ? '' : rawNext);

      if (!name) return resolve({ ok: false, error: '请输入用户名' });
      if (!current) return resolve({ ok: false, error: '请输入原密码' });

      var nextError = validatePassword(next);
      if (nextError) return resolve({ ok: false, error: nextError });

      var record = findRecord(name);
      if (!record) return resolve({ ok: false, error: '这台设备上没有这个账号' });
      if (record.guest) {
        return resolve({ ok: false, error: '游客账号没有密码，不需要修改' });
      }

      derive(record.algo || 'pbkdf2', current, record.salt).then(
        function (hash) {
          if (hash !== record.hash) {
            return resolve({ ok: false, error: '原密码不正确' });
          }
          var salt = randomSalt();
          var algo = currentAlgo();
          derive(algo, next, salt).then(
            function (nextHash) {
              var users = loadUsers();
              var fresh = users[record.key];
              if (!fresh) return resolve({ ok: false, error: '账号已不存在' });
              fresh.salt = salt;
              fresh.hash = nextHash;
              fresh.algo = algo;
              fresh.updatedAt = Date.now();
              if (!Store.write(USERS_KEY, users)) {
                return resolve({ ok: false, error: '本机存储不可用，密码没有保存' });
              }
              resolve({ ok: true });
            },
            function () {
              resolve({ ok: false, error: '当前环境无法安全处理密码' });
            }
          );
        },
        function () {
          resolve({ ok: false, error: '当前环境无法校验密码' });
        }
      );
    });
  }

  /**
   * 忘记密码后的重设入口。
   * 调用方必须先用手机系统凭证（指纹 / 面容 / PIN）验证过身份 ——
   * 本机账号没有服务器可以发验证码，设备凭证是唯一可用的「本人证明」。
   */
  function resetPassword(rawName, rawNext) {
    return new Promise(function (resolve) {
      var name = String(rawName == null ? '' : rawName).trim();
      var next = String(rawNext == null ? '' : rawNext);

      var nextError = validatePassword(next);
      if (nextError) return resolve({ ok: false, error: nextError });

      var record = findRecord(name);
      if (!record) return resolve({ ok: false, error: '这台设备上没有这个账号' });
      if (record.guest) {
        return resolve({ ok: false, error: '游客账号没有密码，无需重设' });
      }

      var salt = randomSalt();
      var algo = currentAlgo();
      derive(algo, next, salt).then(
        function (hash) {
          var users = loadUsers();
          var fresh = users[record.key];
          if (!fresh) return resolve({ ok: false, error: '账号已不存在' });
          fresh.salt = salt;
          fresh.hash = hash;
          fresh.algo = algo;
          fresh.updatedAt = Date.now();
          if (!Store.write(USERS_KEY, users)) {
            return resolve({ ok: false, error: '本机存储不可用，密码没有保存' });
          }
          resolve({ ok: true, name: fresh.name });
        },
        function () {
          resolve({ ok: false, error: '当前环境无法安全处理密码' });
        }
      );
    });
  }

  /* -------------------------------------------------------------- 注销账号 */

  /** 连账号带数据一起删：账号记录、待办、已办、头像、登录态 */
  function deleteAccount(rawName) {
    var record = findRecord(rawName);
    if (!record) return { ok: false, error: '这台设备上没有这个账号' };

    var users = loadUsers();
    delete users[record.key];
    if (!Store.write(USERS_KEY, users)) {
      return { ok: false, error: '本机存储不可用，账号没有删除' };
    }

    Store.remove('todos:' + record.key);
    Store.remove('avatar:' + record.key);

    var session = Store.read(SESSION_KEY, null);
    if (session && session.key === record.key) Store.remove(SESSION_KEY);

    return { ok: true, name: record.name, key: record.key };
  }

  global.AppAuth = {
    register: register,
    login: login,
    logout: logout,
    currentUser: currentUser,
    validateName: validateName,
    validatePassword: validatePassword,
    startGuest: startGuest,
    userExists: userExists,
    changePassword: changePassword,
    resetPassword: resetPassword,
    deleteAccount: deleteAccount
  };
})(window);
