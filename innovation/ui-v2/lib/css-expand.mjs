// 把 CSS 里的 :is(…) 按参数展开成普通的选择器列表。build.mjs 和 stylebench.mjs 共用。
const must = (cond, message) => { if (!cond) throw new Error(message); };
/* 把优化层里的 :is(…) 按参数展开成普通的选择器列表。
   原因（实测，见 stylebench.mjs）：Chromium 把「右端是 :is()」的规则放进「全量桶」，页面里每一个元素
   都要逐条去试，22 条这样的规则让「渲染 20 条待办」的样式重算多花了一倍多时间。
   展开成普通类选择器后，只有带着对应类名的元素才会去看这条规则。
   源文件 patches/ui-v2.css 保持 :is() 写法（可读、好维护），只在产出时展开。
   注意：展开后各分支的特异性等于它自己的；源文件里 :is() 的各参数特异性要保持一致
   （已经是这样：除了登录页那条只设「点按高亮」的规则，该属性没有别处再设）。 */
function expandIs(css) {
  const splitTop = (sel) => {
    const out = []; let cur = '', d = 0;
    for (const ch of sel) {
      if (ch === '(') d++; else if (ch === ')') d--;
      if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  const expandSelector = (sel) => {
    const sels = [sel];
    for (let guard = 0; guard < 20; guard++) {
      let did = false;
      const next = [];
      for (const s of sels) {
        const at = s.lastIndexOf(':is(');
        if (at < 0) { next.push(s); continue; }
        let depth = 0, end = -1; const args = []; let cur = '';
        for (let i = at + 4; i < s.length; i++) {
          const ch = s[i];
          if (ch === '(') depth++;
          else if (ch === ')') { if (depth === 0) { end = i; break; } depth--; }
          if (ch === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
          cur += ch;
        }
        must(end > 0, 'expandIs：:is( 括号不配对：' + s);
        args.push(cur.trim());
        for (const a of args) next.push(s.slice(0, at) + a + s.slice(end + 1));
        did = true;
      }
      sels.splice(0, sels.length, ...next);
      if (!did) break;
    }
    return sels;
  };
  // 递归处理：@media 里的规则也要展开，其余文本原样保留
  function walk(text) {
    let out = '', i = 0;
    for (;;) {
      const open = text.indexOf('{', i);
      if (open < 0) return out + text.slice(i);
      const prelude = text.slice(i, open);
      let d = 1, j = open + 1;
      while (j < text.length && d) { if (text[j] === '{') d++; else if (text[j] === '}') d--; j++; }
      must(d === 0, 'expandIs：花括号不配对');
      const body = text.slice(open + 1, j - 1);
      const firstNonspace = prelude.search(/\S/);
      const isAt = firstNonspace >= 0 && prelude[firstNonspace] === '@';
      if (isAt) {
        const nested = /^@media\b/.test(prelude.slice(firstNonspace));
        out += prelude + '{' + (nested ? walk(body) : body) + '}';
      } else {
        // 前导的注释和空白原样保留，选择器部分展开
        let head = '', rest = prelude;
        for (;;) {
          const k = rest.search(/\S/);
          if (k < 0 || !rest.startsWith('/*', k)) break;
          const e = rest.indexOf('*/', k);
          must(e > 0, 'expandIs：注释不闭合');
          head += rest.slice(0, e + 2); rest = rest.slice(e + 2);
        }
        const p = rest.search(/\S/);
        const ws = rest.slice(0, p < 0 ? rest.length : p);   // 注释和选择器之间的换行/空行，原样保留
        const sel = rest.trim();
        must(sel.length > 0, 'expandIs：规则没有选择器：' + prelude.slice(0, 60));
        const list = splitTop(sel).flatMap((x) => expandSelector(x));
        out += head + ws + list.join(',\n') + ' {' + body + '}';
      }
      i = j;
    }
  }
  return walk(css);
}

// 逐条规则做改写（实验用）：fn(选择器列表文本, 声明块文本) 返回要放回原位的 [选择器, 声明块] 数组；
// 返回空数组表示删掉这条规则。@media 里的规则同样会被处理，包裹层原样保留。
function walkRules(css, fn) {
  let out = "", i = 0;
  for (;;) {
    const open = css.indexOf("{", i);
    if (open < 0) return out + css.slice(i);
    const prelude = css.slice(i, open);
    let d = 1, j = open + 1;
    while (j < css.length && d) { if (css[j] === "{") d++; else if (css[j] === "}") d--; j++; }
    must(d === 0, "walkRules：花括号不配对");
    const body = css.slice(open + 1, j - 1);
    const k = prelude.search(/\S/);
    if (k >= 0 && prelude[k] === "@") {
      out += prelude + "{" + (/^@media\b/.test(prelude.slice(k)) ? walkRules(body, fn) : body) + "}";
    } else {
      const got = fn(prelude.replace(/\/\*[\s\S]*?\*\//g, "").trim(), body);
      if (got && got.length) out += prelude.trimEnd() + "{\n" + got.map(([s, b]) => (s ? s + " {\n" + b + "\n}" : b)).join("\n") + "\n}";
    }
    i = j;
  }
}

export { expandIs, walkRules };
