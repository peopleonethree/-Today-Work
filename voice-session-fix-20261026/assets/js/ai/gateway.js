/* ==========================================================================
   gateway.js — AI 请求的唯一出口（L4）

   以前页面里到处能发网络请求，谁都能拼个 URL 出去，出了问题也找不到「一共
   发了几次、花了多少、为什么失败」。现在所有模型调用都必须经过这里：

     · 地址校验：只允许 https（本机调试地址除外），防止密钥走明文
     · 超时分级：抽取短、问答中、摘要长，按任务给，不再一个 20 秒打天下
     · 退避重试：429 / 5xx 退 200 → 600 → 1800ms，其余错误立刻返回
     · 熔断：同一个域名连续失败 3 次就停 30 秒，别让用户连点把额度烧光
     · 计量：每次调用落一条 usage，页面能看到今日调用数 / token / 失败率
     · 预算：日上限到了就拦，只放行最便宜的抽取类任务

   对外两个入口：send() 是原始请求（等价于原来的 netRequest），
   run() 是带幂等与预算的高层调用（后续 memo/摘要/问答都走它）。
   ========================================================================== */

(function (global) {
  'use strict';

  var VERSION = 1;

  /* 每个任务的超时与重试次数。抽取类要快，摘要类必须给够时间。 */
  var TASK_POLICY = {
    parse: { timeout: 12000, retries: 1 },
    assistant: { timeout: 20000, retries: 1 },
    polish: { timeout: 20000, retries: 1 },
    reason: { timeout: 30000, retries: 1 },
    chat: { timeout: 30000, retries: 1 },
    summarize: { timeout: 30000, retries: 1 },
    extract: { timeout: 15000, retries: 1 },
    probe: { timeout: 15000, retries: 0 },
    catalog: { timeout: 12000, retries: 0 },
    compare: { timeout: 30000, retries: 1 },
    transcribe: { timeout: 45000, retries: 1 }
  };

  var RETRY_STATUS = { 429: 1, 500: 1, 502: 1, 503: 1, 504: 1 };
  var BACKOFF = [200, 600, 1800];
  var BREAK_AFTER = 3;        /* 连续失败几次开闸 */
  var BREAK_MS = 30000;       /* 开闸后停多久 */
  var IDEM_TTL = 5 * 60000;   /* 同一份内容的结果缓存多久 */
  var IDEM_MAX = 40;

  /* 预算见底时仍然放行的任务：抽时间这类最低成本的，不能因为额度卡住主流程 */
  var CHEAP_TASKS = { parse: 1, probe: 1, catalog: 1 };

  var seq = 0;
  var pending = {};       /* id -> {job} */
  var breaker = {};       /* host -> {fails, openedAt, lastError} */
  var idem = {};          /* key -> {at, value} */
  var idemOrder = [];
  var stats = { sent: 0, retried: 0, failed: 0, blocked: 0, usage: 0 };

  function now() {
    return Date.now();
  }

  function hostOf(url) {
    var m = String(url || '').match(/^https?:\/\/([^/?#]+)/i);
    return m ? m[1].toLowerCase() : '';
  }

  /** 只让 https 出网；本机地址（调试 / 局域网网关）破例 */
  function urlAllowed(url) {
    var s = String(url || '');
    if (/^https:\/\//i.test(s)) return true;
    if (/^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?(\/|$)/i.test(s)) return true;
    return false;
  }

  function policyOf(task) {
    return TASK_POLICY[task] || { timeout: 20000, retries: 1 };
  }

  /** 从响应体里抠 token 用量，各家字段名不完全一样 */
  function usageOf(body) {
    if (!body || typeof body !== 'string' || body.length < 8) return null;
    if (body.indexOf('usage') === -1) return null;
    try {
      var data = JSON.parse(body);
      var u = data && data.usage;
      if (!u || typeof u !== 'object') return null;
      var inTok = Number(u.prompt_tokens != null ? u.prompt_tokens : u.input_tokens);
      var outTok = Number(u.completion_tokens != null ? u.completion_tokens : u.output_tokens);
      if (!isFinite(inTok) && !isFinite(outTok)) return null;
      return {
        tokensIn: isFinite(inTok) ? inTok : 0,
        tokensOut: isFinite(outTok) ? outTok : 0
      };
    } catch (error) {
      return null;
    }
  }

  function meter(job, status, body, error) {
    if (!global.AiUsage || typeof global.AiUsage.record !== 'function') return;
    var u = usageOf(body) || { tokensIn: 0, tokensOut: 0 };
    var ok = !error && status >= 200 && status < 300;
    try {
      global.AiUsage.record({
        task: job.task || 'chat',
        modelId: job.modelId || '',
        tokensIn: u.tokensIn,
        tokensOut: u.tokensOut,
        ms: now() - job.started,
        ok: ok
      });
      stats.usage += 1;
    } catch (err) {
      /* 计量失败绝不影响主流程 */
    }
  }

  /* ------------------------------------------------ 传输：原生优先，其次 fetch */

  function dispatch(job) {
    var req = job.req;
    var api = global.TodoNative;
    if (api && typeof api.llmHttp === 'function') {
      try {
        if (api.llmHttp(job.id, req.method || 'POST', req.url,
          req.headers || {}, req.body || null, job.timeout)) {
          /* 原生线程万一不回调，这里兜一个看门狗，别让调用方永远等 */
          job.watchdog = global.setTimeout(function () {
            job._settle('请求没有响应，检查网络后重试', 0, '');
          }, job.timeout + 5000);
          return;
        }
      } catch (error) {
        /* 落到 fetch */
      }
    }
    fetchDispatch(job);
  }

  function fetchDispatch(job) {
    var req = job.req;
    var done = job._settle;
    if (typeof global.fetch !== 'function') {
      done('这个环境不支持联网请求', 0, '');
      return;
    }
    var finished = false;
    var timer = global.setTimeout(function () {
      if (finished) return;
      finished = true;
      done('请求超时，检查网络或接口地址', 0, '');
    }, job.timeout);

    function settle(err, status, body) {
      if (finished) return;
      finished = true;
      global.clearTimeout(timer);
      done(err, status, body);
    }

    try {
      var init = { method: req.method || 'POST', headers: req.headers || {} };
      if (req.body) init.body = JSON.stringify(req.body);
      global.fetch(req.url, init).then(function (res) {
        return res.text().then(function (text) {
          return { status: res.status, body: text };
        });
      }).then(function (r) {
        settle(null, r.status, r.body);
      }).catch(function () {
        settle('连不上这个地址，检查网络和 API 地址', 0, '');
      });
    } catch (error) {
      settle('请求发不出去，检查 API 地址', 0, '');
    }
  }

  /* ------------------------------------------------------------ 对外：send */

  /**
   * 发一次请求（对外签名和老的 netRequest 一致），额外支持：
   * req.task / req.modelId / req.retries / req.timeout
   */
  function send(req, cb) {
    var r = req || {};
    var task = r.task ? String(r.task) : '';
    var policy = policyOf(task);
    var done = typeof cb === 'function' ? cb : function () {};

    if (!r.url) {
      done('地址还不完整', 0, '');
      return null;
    }
    if (!urlAllowed(r.url)) {
      stats.blocked += 1;
      done('这个地址不是 https，密钥会在网络里裸奔，已拦下。改成 https 地址再试', 0, '');
      return null;
    }

    /* 预算：只拦贵的那几类，抽取类永远放行 */
    if (task && !CHEAP_TASKS[task] && global.AiUsage && global.AiUsage.exceeded()) {
      stats.blocked += 1;
      done('今天的 AI 用量到上限了，明天自动恢复；到「设置 · AI 用量」可以把上限调高', 0, '');
      return null;
    }

    var host = hostOf(r.url);
    var b = breaker[host];
    if (b && b.openedAt && now() - b.openedAt < BREAK_MS) {
      stats.blocked += 1;
      var wait = Math.ceil((BREAK_MS - (now() - b.openedAt)) / 1000);
      done('这个接口刚连续失败了几次，先停 ' + wait + ' 秒再试（' + (b.lastError || '连不上') + '）', 0, '');
      return null;
    }

    var job = {
      id: 'g' + (++seq),
      req: r,
      task: task,
      modelId: r.modelId ? String(r.modelId) : '',
      timeout: Math.max(3000, Number(r.timeout) || policy.timeout),
      retries: typeof r.retries === 'number' ? r.retries : policy.retries,
      attempt: 0,
      started: now(),
      cb: done
    };

    pending[job.id] = job;
    stats.sent += 1;
    attempt(job);
    return job.id;
  }

  function attempt(job) {
    job.attempt += 1;

    /* 每次尝试一个独立的 settle：原生回调和 fetch 回调都从这里进来，
       保证一次尝试只会结算一次（迟到的回调被 job._settled 挡掉）。 */
    job._settled = false;
    job._settle = function (err, status, body) {
      if (job._settled) return;
      job._settled = true;
      delete pending[job.id];
      if (job.watchdog) {
        global.clearTimeout(job.watchdog);
        job.watchdog = 0;
      }

      var host = hostOf(job.req.url);
      var retryable = !err && RETRY_STATUS[status] > 0 && job.attempt <= job.retries;

      if (retryable) {
        stats.retried += 1;
        job.id = 'g' + (++seq);
        pending[job.id] = job;
        var wait = BACKOFF[Math.min(job.attempt - 1, BACKOFF.length - 1)];
        global.setTimeout(function () { attempt(job); }, wait);
        return;
      }

      /* 熔断计数：连不上、5xx、429 都算失败，正常回包立刻清零 */
      var ok = !err && status >= 200 && status < 300;
      if (ok) {
        breaker[host] = { fails: 0, openedAt: 0, lastError: '' };
      } else {
        var rec = breaker[host] || { fails: 0, openedAt: 0, lastError: '' };
        rec.fails += 1;
        rec.lastError = err || ('HTTP ' + status);
        if (rec.fails >= BREAK_AFTER) rec.openedAt = now();
        breaker[host] = rec;
        stats.failed += 1;
      }

      meter(job, status, body, err);
      job.cb(err, status, body);
    };

    dispatch(job);
  }

  /* ------------------------------------------------------ 原生回调汇入点 */

  function onDone(id, status, body) {
    var job = pending[id];
    if (!job) return false;
    job._settle(null, Number(status) || 0, String(body == null ? '' : body));
    return true;
  }

  function onError(id, message) {
    var job = pending[id];
    if (!job) return false;
    job._settle(message || '网络请求失败', 0, '');
    return true;
  }

  /* ------------------------------------------------------------ 对外：run */

  function idemKeyOf(req) {
    return [req.task || '', req.refId || '', req.rev || 0, req.promptVer || 0].join('|');
  }

  function idemGet(key) {
    var hit = idem[key];
    if (!hit) return null;
    if (now() - hit.at > IDEM_TTL) {
      delete idem[key];
      return null;
    }
    return hit.value;
  }

  function idemPut(key, value) {
    idem[key] = { at: now(), value: value };
    idemOrder.push(key);
    while (idemOrder.length > IDEM_MAX) {
      var old = idemOrder.shift();
      if (old && old !== key) delete idem[old];
    }
  }

  /**
   * 高层调用：同内容同任务只跑一次（幂等缓存），结果统一形状。
   * run({ task, refId, rev, promptVer, model, messages, temperature, timeout, retries, maxTokensOut }, cb)
   * cb(err, { text, usage, modelId, ms, cached })
   */
  function run(req, cb) {
    var r = req || {};
    var done = typeof cb === 'function' ? cb : function () {};
    var key = idemKeyOf(r);
    if (r.refId) {
      var hit = idemGet(key);
      if (hit) {
        global.setTimeout(function () {
          done(null, { text: hit.text, usage: hit.usage, modelId: hit.modelId, ms: 0, cached: true });
        }, 0);
        return;
      }
    }

    var model = r.model || {};
    var started = now();

    /** withTemp=false 时不带 temperature：有的模型只认固定值，传了就 400 */
    function attempt(withTemp) {
      var payload = {
        model: model.model || r.modelId || 'gpt-6.1-sol',
        messages: r.messages || [],
        stream: false
      };
      if (withTemp && typeof r.temperature === 'number') payload.temperature = r.temperature;
      if (typeof r.maxTokensOut === 'number' && r.maxTokensOut > 0) {
        payload.max_tokens = r.maxTokensOut;
      }

      send({
        method: 'POST',
        url: model.endpoint || r.endpoint || '',
        headers: r.headers || {},
        body: payload,
        task: r.task,
        modelId: model.model || r.modelId || '',
        timeout: r.timeout,
        retries: r.retries
      }, function (err, status, body) {
        var ms = now() - started;
        if (err) { done(err, { ms: ms }); return; }
        /* Kimi K3 系列只收 temperature=1：被 400 教育一次就记住，之后不带温度参数 */
        if (status === 400 && withTemp && /invalid temperature/i.test(String(body || ''))) {
          model.tempFixed = true;
          attempt(false);
          return;
        }
        if (status < 200 || status >= 300) {
          done('接口返回 ' + status, { ms: ms, status: status, raw: body });
          return;
        }
        var parsed = null;
        try { parsed = JSON.parse(body); } catch (e) { parsed = null; }
        var text = '';
        if (parsed && parsed.choices && parsed.choices[0]) {
          var msg = parsed.choices[0].message || {};
          text = typeof msg.content === 'string' ? msg.content : '';
        }
        if (!text) { done('接口没返回内容，检查模型名是否正确', { ms: ms, raw: body }); return; }
        var value = {
          text: text,
          usage: (parsed && parsed.usage) || null,
          modelId: (parsed && parsed.model) || payload.model,
          ms: ms
        };
        if (r.refId) idemPut(key, value);
        done(null, value);
      });
    }

    attempt(!model.tempFixed);
  }

  function reset() {
    pending = {};
    breaker = {};
    idem = {};
    idemOrder = [];
    stats = { sent: 0, retried: 0, failed: 0, blocked: 0, usage: 0 };
  }

  global.AiGateway = {
    VERSION: VERSION,
    TASK_POLICY: TASK_POLICY,
    send: send,
    run: run,
    onDone: onDone,
    onError: onError,
    policyOf: policyOf,
    urlAllowed: urlAllowed,
    usageOf: usageOf,
    stats: function () { return stats; },
    breakerState: function () { return breaker; },
    pendingCount: function () { return Object.keys(pending).length; },
    reset: reset
  };
})(window);
