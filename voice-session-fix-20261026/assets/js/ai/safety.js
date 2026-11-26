/* ==========================================================================
   safety.js — 发送前的脱敏（L4）

   备忘录正文里出现手机号、身份证、银行卡、邮箱是常事，但那是「我记下来给
   自己看」的信息，不等于「我同意发给模型服务商」。所以出门前先按模式打码：

       13812345678        → [手机号]
       110101199001011234 → [身份证]
       6222 0212 3456 7890→ [银行卡]
       a@b.com            → [邮箱]

   只做「明显是这几类」的替换，不做模糊脱敏——宁可漏掉一个不规则的号码，
   也不要破坏用户正常的时间、金额、数量。用户可以在设置里关掉。
   ========================================================================== */

(function (global) {
  'use strict';

  var EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;

  /* 连续数字串（允许中间有空格或短横线分隔的银行卡写法） */
  var RUN_RE = /\d(?:[\d\- ]{5,})\d/g;

  function classify(digits) {
    var n = digits.length;
    if (n === 11 && digits.charAt(0) === '1' && digits.charAt(1) >= '3' && digits.charAt(1) <= '9') {
      return '[手机号]';
    }
    if (n === 18 && /^\d{17}[\dXx]$/.test(digits)) return '[身份证]';
    if (n >= 16 && n <= 19) return '[银行卡]';
    if (n === 15 && /^\d{15}$/.test(digits)) return '[身份证]';
    return '';
  }

  /**
   * 打码。返回 { text, hits } —— hits 给设置页/日志用，不含原文。
   */
  function maskPii(input) {
    var text = input == null ? '' : String(input);
    if (!text) return { text: text, hits: 0 };
    var hits = 0;

    var out = text.replace(EMAIL_RE, function () {
      hits += 1;
      return '[邮箱]';
    });

    out = out.replace(RUN_RE, function (match) {
      var digits = match.replace(/[\- ]/g, '');
      var label = classify(digits);
      if (!label) return match;
      hits += 1;
      return label;
    });

    return { text: out, hits: hits };
  }

  /** 把整组 messages 打码，返回新的数组（不修改入参） */
  function maskMessages(messages) {
    var list = messages || [];
    var out = [];
    var hits = 0;
    for (var i = 0; i < list.length; i++) {
      var m = list[i] || {};
      if (typeof m.content !== 'string') {
        out.push(m);
        continue;
      }
      var r = maskPii(m.content);
      hits += r.hits;
      out.push({ role: m.role, content: r.text });
    }
    return { messages: out, hits: hits };
  }

  global.AiSafety = {
    maskPii: maskPii,
    maskMessages: maskMessages
  };
})(window);
