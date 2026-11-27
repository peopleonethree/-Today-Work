// 重载压力测试：基线版（--base 产物）与优化版（默认产物）各跑一遍同样的脚本，逐场景对比。
// 用法：node build.mjs --base && node stress.mjs --variant base
//       node build.mjs        && node stress.mjs --variant patched
// 每次运行都用一个全新的独立配置目录（不删除任何旧目录），并灌入同一批数据，保证两个版本起点一致。
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openSession, seedTodos, sleep, evaluate, HERE } from './lib/session.mjs';

const variant = (() => {
  const i = process.argv.indexOf('--variant');
  const v = i >= 0 ? process.argv[i + 1] : (process.argv.find((a) => a.startsWith('--variant=')) || '').split('=')[1];
  if (v !== 'base' && v !== 'patched') throw new Error('--variant 必须是 base 或 patched');
  if (!process.env.BISECT && (v === 'base') === /html:root body button/.test(readFileSync(join(HERE, 'assets', 'styles.css'), 'utf8'))) throw new Error('版本与当前 assets 不一致：' + v + ' 请先 node build.mjs --base 或 node build.mjs');
  return v;
})();
const quick = process.argv.includes('--quick');
// 配置目录名精确到秒再加随机尾缀：旧写法只到分钟，同一分钟内连跑两次会共用同一个目录（第二次会带着上一次灌的 20 条待办，变成 40 条）
const RUN = 'stress-' + variant + '-' + new Date().toISOString().replace(/[-:T]/g, '').slice(4, 14) + '-' + Math.floor(Math.random() * 1e4);
mkdirSync(join(HERE, 'results'), { recursive: true });

const s = await openSession({ name: RUN });
// 看门狗：某条调试指令超过 8 秒没回来，就把最后一条指令打印出来
let lastOp = '', lastAt = Date.now(), stuckPrinted = 0;
const rawSend = s.cdp.send.bind(s.cdp);
s.cdp.send = (method, params) => { lastOp = method + ' ' + JSON.stringify(params || {}).slice(0, 90); lastAt = Date.now(); return rawSend(method, params); };
setInterval(() => {
  const idle = Math.round((Date.now() - lastAt) / 1000);
  if (idle >= 8 && stuckPrinted !== idle) { stuckPrinted = idle; process.stdout.write(`\n[已卡 ${idle}s] 最后指令: ${lastOp}\n`); }
}, 1000).unref();
await s.load();
await s.enter();
if (!(await s.waitFor('#view-todo', 3000))) throw new Error('未进入主界面');

const TITLES = [
  '给妈妈回电话', '整理下季度的预算表，把市场部和研发部的数据分开核对一遍再发给财务', '买牛奶、鸡蛋、番茄、青椒',
  '下午三点和小王开会', '读书 30 分钟', '回复客户的邮件，确认交付时间和验收标准', '取快递', '预约体检',
  '把阳台的花浇了', '写周报', '练习英语口语 20 分钟', '修厨房漏水的水龙头，先关总阀再拆', '订周末的电影票',
  '整理电脑桌面的文件', '给植物换盆', '备份手机照片到移动硬盘', '学一首新歌', '洗车', '去银行办理业务', '准备明天的演示材料',
];
await seedTodos(s, TITLES);
await s.pushRestInsets();
// 主线程降速 4 倍，让桌面版 Chromium 的渲染开销接近中低端手机（真机是 400x869 @3x）
await s.cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
// 实验：NOTRANS=1 关掉优化层给按钮加的颜色过渡；NOTRANS=colors 只保留纯颜色过渡（去掉阴影、滤镜、位移）
if (process.env.NOTRANS) {
  const css = process.env.NOTRANS === 'colors'
    ? 'button, html:root body button { transition: background-color 0.16s ease, border-color 0.16s ease, color 0.16s ease, transform 0.12s ease, opacity 0.16s ease !important; }'
    : 'button, html:root body button { transition: transform 0.12s ease, opacity 0.16s ease !important; }';
  await evaluate(s.cdp, '(() => { const st = document.createElement(\'style\'); st.textContent = ' + JSON.stringify(css) + '; document.head.appendChild(st); return 0; })()');
}
// 实验：INJECT="<一段 CSS>" 额外注入一条样式，用来二分定位「主题切换变重」是哪类绘制开销
//      也可以用 --injectfile=路径 从文件读（避免在命令行里传中文 / 引号）
const INJECT_TEXT = process.env.INJECT || ((process.argv.find((a) => a.startsWith('--injectfile=')) || '').slice(13) ? readFileSync((process.argv.find((a) => a.startsWith('--injectfile='))).slice(13), 'utf8') : '');
if (INJECT_TEXT) {
  await evaluate(s.cdp, '(() => { const st = document.createElement(\'style\'); st.textContent = ' + JSON.stringify(INJECT_TEXT) + '; document.head.appendChild(st); return 0; })()');
}
await evaluate(s.cdp, `(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); return 0; })()`);

// ---- 页面内探针：逐帧时间戳、布局位移记录、状态快照 ----
await evaluate(s.cdp, `(() => {
  const vis = (el) => el && !el.classList.contains('is-hidden') && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
  const top = (el) => el ? Math.round(el.getBoundingClientRect().top * 10) / 10 : null;
  const st = window.__st = { ft: [], ls: [], loaf: [] };
  (function loop(t) { st.ft.push(t); requestAnimationFrame(loop); })(performance.now());
  // 长动画帧：主线程一帧的渲染工作超过 50ms 的那些帧，不依赖屏幕刷新率
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) st.loaf.push([Math.round(e.startTime), Math.round(e.duration), Math.round(e.blockingDuration), Math.round(e.startTime + e.duration - e.styleAndLayoutStart)]);
    }).observe({ type: 'long-animation-frame', buffered: false });
  } catch (e) { st.loaf = null; }
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      const src = (e.sources || []).map((x) => { const n = x.node; if (!n) return '?'; return (n.id ? '#' + n.id : '.' + String(n.className || n.nodeName).split(' ')[0]); }).slice(0, 3).join(' ');
      st.ls.push([Math.round(e.startTime), Math.round(e.value * 10000) / 10000, e.hadRecentInput ? 1 : 0, src]);
    }
  }).observe({ type: 'layout-shift', buffered: false });
  st.mark = () => ({ i: st.ft.length, l: st.ls.length, f: st.loaf ? st.loaf.length : 0 });
  st.stats = (a, b) => {
    const d = [];
    for (let i = a.i + 1; i < b.i; i++) d.push(st.ft[i] - st.ft[i - 1]);
    const sorted = d.slice().sort((x, y) => x - y);
    const q = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0);
    let ls = 0, lsNoInput = 0;
    for (let i = a.l; i < st.ls.length; i++) { ls += st.ls[i][1]; if (!st.ls[i][2]) lsNoInput += st.ls[i][1]; }
    const lo = st.loaf ? st.loaf.slice(a.f, st.loaf.f) : [];
    return {
      frames: d.length, fps: d.length ? Math.round(d.length * 1000 / (st.ft[b.i - 1] - st.ft[a.i] || 1) * 10) / 10 : 0,
      p50: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted[sorted.length - 1] || 0,
      over50: d.filter((x) => x > 50).length, over100: d.filter((x) => x > 100).length, over200: d.filter((x) => x > 200).length,
      cls: Math.round(ls * 1000) / 1000, clsNoInput: Math.round(lsNoInput * 1000) / 1000,
      loafN: lo.length, loafTotal: lo.reduce((x, y) => x + y[1], 0), loafMax: lo.reduce((x, y) => Math.max(x, y[1]), 0), loafStyleLayout: lo.reduce((x, y) => x + y[3], 0),
    };
  };
  st.shifts = (a, b) => st.ls.slice(a.l, b.l).sort((x, y) => y[1] - x[1]).slice(0, 5).map((x) => x[1] + ':' + x[3] + (x[2] ? '(输入后)' : ''));
  st.snap = () => {
    const de = document.documentElement;
    const sheets = [...document.querySelectorAll('.sheet-layer')].filter(vis).map((l) => {
      const sh = l.querySelector('.sheet');
      return { id: l.id, top: top(sh), h: sh ? Math.round(sh.getBoundingClientRect().height) : 0, inlineTransform: sh ? sh.style.transform : '', inlineHeight: sh ? sh.style.height : '', layerHeight: l.style.height };
    });
    let todos = 0, bad = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!/^today-todo:v1:todos/.test(k)) continue;
      try { const v = JSON.parse(localStorage.getItem(k)); todos += Array.isArray(v) ? v.length : 1; } catch (e) { bad++; }
    }
    const ae = document.activeElement;
    const residue = [...document.querySelectorAll('.sheet-layer, .sheet-layer .sheet')].filter((el) => /translateY|(^|[^-])height:|bottom: (auto|\d)/.test(el.getAttribute('style') || '')).map((el) => (el.id || el.className) + ' => ' + el.getAttribute('style'));
    return {
      residue,
      vp: [innerWidth, innerHeight], kb: de.getAttribute('data-kb') || '', insetBottom: de.style.getPropertyValue('--inset-bottom').trim(),
      overflowX: Math.max(0, de.scrollWidth - innerWidth), scrollY: Math.round(scrollY),
      active: [...document.querySelectorAll('.view')].filter(vis).map((v) => v.id),
      theme: de.getAttribute('data-theme') || '', focus: ae ? (ae.id || ae.tagName) : '', todos, bad,
      dialog: !!document.querySelector('dialog[open]'), sheets,
      visibleTodoCount: document.querySelectorAll('#todo-list .todo').length,
    };
  };
  return 0;
})()`);

const focusAndKeyboard = async (sel, steps = 8) => {
  await s.tap(sel, 16); await sleep(40);
  if (steps) await s.keyboard(true, 336, steps);
};
/** 输入框可见性：单行框要求整条露出；多行文本域要求最上面两行露出（设计如此，避免大文本域把弹层顶飞） */
const inputVisible = async (sel) => {
  const v = await evaluate(s.cdp, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); const need = el.tagName === 'TEXTAREA' ? Math.min(r.bottom, r.top + 72) : r.bottom; return { top: Math.round(r.top), needBottom: Math.round(need), visible: r.top >= 0 && need <= innerHeight - 8, focused: document.activeElement === el, vh: innerHeight }; })()`);
  return v && { ...v, ok: v.visible && v.focused };
};
const focusLog = [];
let misses = 0;   // 点按因为目标不可见而落空的次数
/** 点按前先等元素真的可见可用（降速 4 倍后，菜单/弹层出现得慢，盲点会点空） */
const T = async (sel, hold = 8) => {
  if (!(await s.waitFor(sel, 1500))) { misses++; focusLog.push('等不到 ' + sel); return null; }
  return s.tap(sel, hold);
};
/** 把弹层里的输入框滚到干净位置再聚焦，并确认焦点真的落上去了。
    注意：很高的文本域中心点在键盘下面（视口外），必须点它顶部露出来的那一截。 */
const focusInput = async (sel) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    await evaluate(s.cdp, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el) el.scrollIntoView({ block: 'center' }); return 0; })()`);
    await sleep(200);
    const pt = await evaluate(s.cdp, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return { why: '不存在' }; const r = el.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + Math.min(28, r.height / 2); if (y > innerHeight - 24 || r.top < 0) return { why: '不在可视区 ' + Math.round(r.top) + '~' + Math.round(r.bottom) + '/' + innerHeight }; const h = document.elementFromPoint(x, y); if (!(h === el || el.contains(h))) return { why: '被 ' + (h ? h.id || h.tagName + '.' + h.className : 'null') + ' 遮挡' }; return { x, y }; })()`);
    if (pt.why) { focusLog.push(sel + ' ' + pt.why); await sleep(250); continue; }
    await s.tap(pt, 16);
    /* 降速后，触屏点按到焦点落定有延迟：最多等 600ms */
    let foc = false;
    for (let k = 0; k < 12 && !foc; k++) { await sleep(50); foc = await evaluate(s.cdp, `document.activeElement === document.querySelector(${JSON.stringify(sel)})`); }
    if (foc) return 'ok' + (attempt ? `(重试${attempt})` : '');
    focusLog.push(sel + ' 未聚焦');
    await sleep(200);
  }
  return '失败';
};
/** 连续采样某个表达式，返回 {min,max,first,last,n} */
async function sampleNumbers(expr, ms, gap = 30) {
  const out = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await evaluate(s.cdp, expr); if (typeof v === 'number') out.push(v); await sleep(gap); }
  if (!out.length) return { n: 0 };
  return { n: out.length, min: Math.min(...out), max: Math.max(...out), first: out[0], last: out[out.length - 1] };
}
const settle = async (ms = 420) => { await s.keyboard(false, 336, 4); await sleep(ms); };
const wheel = async (y, times, gap = 16, x = 200) => {
  for (let i = 0; i < times; i++) { await s.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: 600 }); await sleep(gap); }
};

const PM = { LayoutCount: 'layouts', LayoutDuration: 'layoutMs', RecalcStyleCount: 'restyles', RecalcStyleDuration: 'restyleMs', TaskDuration: 'taskMs', ScriptDuration: 'scriptMs' };
const pm = async () => {
  const { metrics } = await s.cdp.send('Performance.getMetrics');
  const out = {};
  // 时长类指标原始单位是秒，换成毫秒、保留一位小数；次数类指标本来就是整数，原样保留。
  // （旧写法是 Math.round(m.value * 1000) / 1000：时长结果其实是秒，却被当成毫秒写进了日志和对比表——
  //   即以前日志里的「主线程任务 11.5ms」实际是 11.5 秒。两边单位相同，所以大小关系不受影响。）
  for (const m of metrics) if (PM[m.name]) out[PM[m.name]] = /Count$/.test(m.name) ? m.value : Math.round(m.value * 10000) / 10;
  return out;
};
const residueBase = (await evaluate(s.cdp, '__st.snap()')).residue;
console.log('起始内联残留基线:', residueBase.join(' | ') || '无');

const results = [];
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '--only=').slice(7).split(',').filter(Boolean);
async function scenario(name, fn) {
  if (ONLY.length && !ONLY.some((o) => name.startsWith(o))) return null;
  process.stdout.write('>> ' + name + ' … ');
  await settle();
  const before = await evaluate(s.cdp, '__st.snap()');
  const e0 = s.errors.length, f0 = s.failed.length;
  const m0 = await evaluate(s.cdp, '__st.mark()');
  const p0 = await pm();
  const fL0 = focusLog.length, ms0 = misses;
  const t0 = Date.now();
  let extra = {};
  let failure = '';
  // 实验：--trace 或 --trace=S4a 只给匹配的场景抓 Chrome 时间线，写到 results/trace-<版本>-<场景>.json
  const traceArg = process.argv.find((a) => a === '--trace' || a.startsWith('--trace='));
  const tracing = traceArg && (traceArg === '--trace' || name.startsWith(traceArg.slice(8)));
  if (tracing) {
    await s.cdp.send('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { recordMode: 'recordContinuously', includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'blink.user_timing'] } });
  }
  try { extra = (await fn()) || {}; } catch (err) { failure = String(err && err.message || err) + ' @ ' + String(err && err.stack || '').split('\n').slice(1, 3).map((x) => x.trim().replace(/^at /, '').replace(/file:\/\/\/[^ )]*stress\.mjs/, 'stress.mjs')).join(' <- '); }
  if (tracing) {
    const done = Promise.race([
      s.cdp.once('Tracing.tracingComplete'),
      new Promise((resolve) => setTimeout(() => resolve({ stream: null }), 60000)),
    ]);
    /* 降速状态下 Tracing.end 一直不返回（疑似主线程被降速后，时间线刷不出来），先恢复原速再收 */
    await s.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await s.cdp.send('Tracing.end');
    process.stdout.write('\n    [Tracing.end 已返回]');
    const { stream } = await done;
    await s.cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    if (!stream) { failure = '时间线 60 秒内没有吐完'; }
    let text = '', chunks = 0;
    for (;;) { if (!stream) break; const chunk = await s.cdp.send('IO.read', { handle: stream, size: 1 << 20 }); text += chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString('utf8') : chunk.data; chunks++; if (chunk.eof) break; }
    if (stream) await s.cdp.send('IO.close', { handle: stream });
    const file = `trace-${variant}-${name.split(' ')[0]}.json`;
    if (text) {
      writeFileSync(join(HERE, 'results', file), text);
      console.log(`\n    时间线已写入 results/${file}（${Math.round(text.length / 1024)} KB，${chunks} 块）`);
    }
  }
  const m1 = await evaluate(s.cdp, '__st.mark()');
  await settle();
  const after = await evaluate(s.cdp, '__st.snap()');
  const perf = await evaluate(s.cdp, `__st.stats(${JSON.stringify(m0)}, ${JSON.stringify(m1)})`);
  const shifts = await evaluate(s.cdp, `__st.shifts(${JSON.stringify(m0)}, ${JSON.stringify(m1)})`);
  const p1 = await pm();
  const work = {};
  for (const k of Object.keys(p0)) work[k] = Math.round((p1[k] - p0[k]) * 10) / 10;
  const residue = after.residue.filter((x) => !residueBase.includes(x));
  const row = {
    name, wallMs: Date.now() - t0, ...perf,
    errors: s.errors.length - e0, failed: s.failed.length - f0,
    kbFlagStuck: after.kb, insetBottom: after.insetBottom, overflowX: after.overflowX,
    residue: residue.join(' '), failure, work, focusLog: focusLog.slice(fL0).join(' ; ').slice(0, 600), missedTaps: misses - ms0,
    todosDelta: after.todos - before.todos, badJson: after.bad,
    ...extra,
  };
  if (shifts.length) row.shifts = shifts.slice(0, 4);
  results.push(row);
  console.log(`[${name}]\n    帧间隔 p95 ${row.p95} / p99 ${row.p99} / 最大 ${row.max}ms，>50ms ${row.over50} 帧；长帧(>50ms) ${row.loafN} 个 共 ${row.loafTotal}ms；布局 ${row.work.layouts} 次 ${row.work.layoutMs}ms，重算样式 ${row.work.restyles} 次 ${row.work.restyleMs}ms，主线程任务 ${row.work.taskMs}ms；CLS ${row.cls}；异常 ${row.errors}\n    内联残留 ${row.residue || '无'}${row.failure ? ' || 失败: ' + row.failure : ''}`);
  return row;
}

// ======================================================================
// S1 主输入框：快速反复开关键盘（含半途打断）
// ======================================================================
await scenario('S1 主输入框键盘反复开关', async () => {
  await T('#new-todo', 16); await sleep(60);
  const drift = await sampleNumbers(`(() => { const r = document.querySelector('#view-todo .addbar').getBoundingClientRect(); return Math.round(r.top * 10) / 10; })()`, 10);
  let visibleOk = 0, visibleTotal = 0;
  const cycles = quick ? 6 : 14;
  for (let i = 0; i < cycles; i++) {
    const steps = 3 + (i % 6);                 // 帧数随机：快到 3 帧走完整个动画
    await s.keyboard(true, 336, steps);
    if (i % 3 === 0) {                          // 打断：开到一半马上收
      await s.keyboard(true, 336, Math.max(1, steps >> 1));
      await s.keyboard(false, 336, 2);
      await s.keyboard(true, 336, 2);
    }
    await s.type('压力' + i + ' ');
    await sleep(60);
    const v = await inputVisible('#new-todo');
    visibleTotal++; if (v.ok) visibleOk++;
    await s.keyboard(false, 336, i % 2 ? 2 : 5);
    await sleep(i % 4 === 0 ? 0 : 40);
  }
  await s.type('待办');
  const addbarAfter = await evaluate(s.cdp, `Math.round(document.querySelector('#view-todo .addbar').getBoundingClientRect().top * 10) / 10`);
  const draft = await evaluate(s.cdp, `document.querySelector('#new-todo').value`);
  return { addbarRange: `${drift.min}~${drift.max}`, addbarAfter, inputVisibleDuringKb: `${visibleOk}/${visibleTotal}`, draftLen: draft.length, add: 'no' };
});

// 把 S1 留下的草稿加进去（否则会一直占着输入框）
await T('#add-btn', 16); await sleep(250);

// ======================================================================
// S2 连续滚动（静止 / 键盘开着 / 输入中）
// ======================================================================
await scenario('S2a 连续滚动 60 次', async () => {
  await wheel(500, 60);
  await sleep(300);
  return {};
});
await scenario('S2b 键盘开着连续滚动', async () => {
  await T('#new-todo', 16); await sleep(60);
  await s.keyboard(true, 336, 6);
  await sleep(250);
  await wheel(300, 50);
  await sleep(300);
  const pos = await evaluate(s.cdp, `({ inputTop: Math.round(document.querySelector('#new-todo').getBoundingClientRect().top), scrollY: Math.round(scrollY) })`);
  await s.type('滚动时不丢字');
  const val = await evaluate(s.cdp, `document.querySelector('#new-todo').value`);
  await evaluate(s.cdp, 'scrollTo(0,0); 0');
  return { scrollYAfterWheel: pos.scrollY, inputMinusScroll: pos.inputTop + pos.scrollY, expect: 129, draftLen: val.length };
});
await scenario('S2c 上下猛甩 40 次', async () => {
  for (let i = 0; i < 40; i++) {
    await wheel(i % 2 ? 120 : 700, 4, 8);
    await sleep(10);
  }
  await sleep(300);
  return {};
});
await settle();

// ======================================================================
// S3 频繁点击
// ======================================================================
await scenario('S3a 空输入连点添加 30 次', async () => {
  for (let i = 0; i < 30; i++) await T('#add-btn', 8);
  await sleep(400);
  return { todosDeltaExpected: 0 };
});
await scenario('S3b 完成勾选 + 取消确认 ×10', async () => {
  const cancelSel = '#confirm-cancel';
  let cancels = 0;
  for (let i = 0; i < 10; i++) {
    await evaluate(s.cdp, 'scrollTo(0,0); 0');
    await T('.todo:nth-child(2) .todo__check', 10);
    await sleep(90);
    if (await s.waitFor(cancelSel, 800)) { await T(cancelSel, 8); cancels++; }
    await sleep(70);
  }
  return { cancels, confirmClosed: !(await evaluate(s.cdp, `!document.querySelector('#confirm-layer').classList.contains('is-hidden')`)) };
});
await scenario('S3c 时间胶囊 / 排序 / 清理 连点', async () => {
  for (let i = 0; i < 8; i++) { await T('#time-chip', 8); await sleep(60); await T('#time-pop-cancel', 8); }
  for (let i = 0; i < 10; i++) await T('#sort-btn-active', 8);
  await sleep(300);
  return {};
});

// ======================================================================
// S4 快速切换页面
// ======================================================================
await scenario('S4a 三页快速轮切 60 次', async () => {
  const tabs = ['#tab-archive', '#tab-memos', '#tab-todos'];
  for (let i = 0; i < 60; i++) await T(tabs[i % 3], 6);
  await sleep(500);
  const active = await evaluate(s.cdp, `__st.snap().active.join(',')`);
  return { finalActive: active, expected: '#view-todo' };
});
await scenario('S4b 键盘开着切页再回来 ×12', async () => {
  await T('#new-todo', 16); await sleep(50);
  await s.keyboard(true, 336, 5);
  for (let i = 0; i < 12; i++) {
    await T('#tab-archive', 6); await sleep(35);
    await T('#tab-memos', 6); await sleep(35);
    await T('#tab-todos', 6); await sleep(35);
    if (i % 4 === 3) { await s.keyboard(false, 336, 2); await s.keyboard(true, 336, 2); }
  }
  await sleep(350);
  const v = await inputVisible('#new-todo');
  return { inputVisible: v && v.visible, focused: v && v.focused };
});

// ======================================================================
// S5 弹层：快速开合 + 键盘
// ======================================================================
/** 打开设置：先关掉挡路的弹层，再「头像 → 设置」。弹层关出的那一下点按会被遮罩吃掉，所以要点到真的打开为止 */
const openSettings = async () => {
  for (let k = 0; k < 4; k++) {
    if (await s.waitFor('#settings-layer .sheet__close', 120)) return true;
    if (await s.waitFor('#settings-layer:not(.is-hidden)', 60)) { await T('#settings-layer .sheet__close', 6); await sleep(200); continue; }
    await T('#user-btn', 6); await sleep(50);
    await T('#settings-btn', 6); await sleep(120);
  }
  const ok = await s.waitFor('#settings-layer .sheet__close', 800);
  // 看一眼 user-btn 位置上到底是什么（换成不含模板占位的写法，避免调试语句自己出语法错）

  if (!ok) focusLog.push('设置打不开: ' + await evaluate(s.cdp, `(() => { const r = document.querySelector('#user-btn').getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); const um = document.querySelector('#user-menu'); return '[user-btn 处命中 ' + (h ? h.id || h.tagName + '.' + h.className : 'null') + '，菜单 display=' + getComputedStyle(um).display + ' opacity=' + getComputedStyle(um).opacity + '，键盘标记=' + (document.documentElement.getAttribute('data-kb') || '无') + '，视口高=' + innerHeight + '，可见弹层=' + __st.snap().sheets.map((x) => x.id).join(',') + ']'; })()`));
  return ok;
};
const closeAllSheets = async () => {
  await settle(300);
  for (const sel of ['#settings-layer .sheet__close', '#memo-close', '#qa-close', '#time-pop-close', '#confirm-cancel']) {
    if (await s.waitFor(sel, 300)) await T(sel, 8);
  }
  await evaluate(s.cdp, `(() => { const d = document.getElementById('message-workbench'); if (d.open) d.close(); const um = document.getElementById('user-menu'); if (um) um.classList.add('is-hidden'); return 0; })()`);
  await sleep(350);
};
await scenario('S5a 设置面板开合 15 次', async () => {
  for (let i = 0; i < 15; i++) {
    await openSettings();
    await sleep(i % 3 === 0 ? 20 : 140);
    await T('#settings-layer .sheet__close', 6);
    await sleep(30);
  }
  await sleep(400);
  return {};
});
await scenario('S5b 设置·人名文本域 + 键盘快速开关 12 轮', async () => {
  await openSettings(); await sleep(200);
  await evaluate(s.cdp, `document.querySelector('#settings-layer .sheet').scrollTop = 0; 0`); await sleep(250);
  const sel = '#voice-names';
  const base = await evaluate(s.cdp, `(() => { const sh = document.querySelector('#settings-layer .sheet'); return { sheetTop: Math.round(sh.getBoundingClientRect().top), sheetH: Math.round(sh.getBoundingClientRect().height) }; })()`);
  const foc = await focusInput(sel);
  await s.keyboard(true, 336, 6);
  await sleep(320);
  const during = await sampleNumbers(`Math.round(document.querySelector('#settings-layer .sheet').getBoundingClientRect().top * 10) / 10`, 10);
  let ok = 0; const tops = [];
  for (let i = 0; i < 12; i++) {
    await s.type(i % 2 ? '张三、' : '李四，');
    await s.keyboard(false, 336, 2 + (i % 3));
    await sleep(i % 3 === 0 ? 0 : 50);
    await s.keyboard(true, 336, 2 + (i % 4));
    await sleep(520);
    const v = await inputVisible(sel);
    if (v.ok) ok++;
    tops.push(await evaluate(s.cdp, `Math.round(document.querySelector('#settings-layer .sheet').getBoundingClientRect().top)`));
  }
  await s.type('王五');
  const val = await evaluate(s.cdp, `document.querySelector('#voice-names').value`);
  await s.keyboard(false, 336, 4); await sleep(400);
  const back = await evaluate(s.cdp, `Math.round(document.querySelector('#settings-layer .sheet').getBoundingClientRect().top)`);
  await closeAllSheets();
  return { focus: foc, sheetTopAtRest: base.sheetTop, sheetTopDuringAnimation: `${during.min}~${during.max}`, sheetTopWhileKbOpen: `${Math.min(...tops)}~${Math.max(...tops)}`, inputVisibleAfterSettle: `${ok}/12`, sheetTopAfterClose: back, typedLen: val.length };
});
await scenario('S5c 笔记编辑：标题/正文切换 + 键盘打断 10 轮', async () => {
  await T('#tab-memos', 8); await sleep(200);
  await T('#memo-new', 8); await sleep(250);
  const sheetTop = `(() => { const sh = document.querySelector('#memo-layer .sheet'); return sh ? Math.round(sh.getBoundingClientRect().top * 10) / 10 : -1; })()`;
  const rest = await evaluate(s.cdp, sheetTop);
  const seen = [];
  let visTitle = 0, visBody = 0;
  for (let i = 0; i < 10; i++) {
    const target = i % 2 ? '#memo-body-input' : '#memo-title-input';
    focusLog.push('#' + i + ' ' + (await focusInput(target)));
    await s.keyboard(true, 336, 3 + (i % 4));
    if (i % 3 === 0) { await s.keyboard(false, 336, 2); await s.keyboard(true, 336, 3); }   // 打断
    await s.type('笔记' + i + ' ');
    await sleep(520);
    const v = await inputVisible(target);
    if (v.ok) { if (i % 2) visBody++; else visTitle++; }
    seen.push(await evaluate(s.cdp, sheetTop));
    await sleep(40);
  }
  await s.keyboard(false, 336, 4); await sleep(450);
  const after = await evaluate(s.cdp, sheetTop);
  const lengths = await evaluate(s.cdp, `({ t: document.querySelector('#memo-title-input').value.length, b: document.querySelector('#memo-body-input').value.length })`);
  await closeAllSheets();
  await T('#tab-todos', 8); await sleep(200);
  return { sheetTopAtRest: rest, sheetTopSeen: `${Math.min(...seen)}~${Math.max(...seen)}`, sheetTopAfter: after, titleVisible: `${visTitle}/5`, bodyVisible: `${visBody}/5`, typed: `${lengths.t}/${lengths.b}` };
});
await scenario('S5d 问一篇：输入 + 键盘快速开关 10 轮', async () => {
  await T('#tab-memos', 8); await sleep(200);
  await T('#memo-ask', 8); await sleep(250);
  const sheetTop = `(() => { const sh = document.querySelector('#qa-layer .sheet'); return sh ? Math.round(sh.getBoundingClientRect().top * 10) / 10 : -1; })()`;
  const rest = await evaluate(s.cdp, sheetTop);
  const seen = [];
  let ok = 0;
  const foc = await focusInput('#qa-input');
  for (let i = 0; i < 10; i++) {
    await s.keyboard(true, 336, 2 + (i % 5));
    await s.type('问' + i);
    await sleep(520);
    const v = await inputVisible('#qa-input');
    if (v.ok) ok++;
    seen.push(await evaluate(s.cdp, sheetTop));
    await s.keyboard(false, 336, 2);
    await sleep(i % 2 ? 0 : 60);
  }
  await s.keyboard(false, 336, 4); await sleep(450);
  const after = await evaluate(s.cdp, sheetTop);
  await closeAllSheets();
  await T('#tab-todos', 8); await sleep(200);
  return { focus: foc, sheetTopAtRest: rest, sheetTopSeen: `${Math.min(...seen)}~${Math.max(...seen)}`, sheetTopAfter: after, inputVisible: `${ok}/10` };
});
await scenario('S5e 词库对话框快速开合 12 次', async () => {
  for (let i = 0; i < 12; i++) {
    await T('#open-message-workbench', 6);
    await sleep(i % 3 === 0 ? 30 : 160);
    await evaluate(s.cdp, `(() => { const d = document.getElementById('message-workbench'); if (d.open) d.close(); return 0; })()`);
    await sleep(30);
  }
  await sleep(400);
  return { dialogLeftOpen: await evaluate(s.cdp, `!!document.querySelector('dialog[open]')`) };
});

// ======================================================================
// S6 主题快速切换
// ======================================================================
await scenario('S6 三主题快速轮切 36 次', async () => {
  await openSettings(); await sleep(250);
  const modes = ['light', 'dark', 'macaron'];
  // 上一个场景把设置面板滚到了下面（主题按钮贴在粘性标题栏底下会被点不中），先回到顶部
  await evaluate(s.cdp, `document.querySelector('#settings-layer .sheet').scrollTop = 0; 0`); await sleep(300);
  if (process.env.LOAFFULL) await evaluate(s.cdp, '(() => { window.__loafFull = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__loafFull.push({ d: Math.round(e.duration), sl: Math.round(e.startTime + e.duration - e.styleAndLayoutStart), rs: Math.round(e.renderStart - e.startTime), scripts: (e.scripts || []).map((x) => [x.invoker, x.sourceFunctionName, (x.sourceURL || "").split("/").pop().slice(-10) + ":" + x.sourceCharPosition, Math.round(x.duration), x.forcedStyleAndLayoutDuration]) }); }).observe({ type: "long-animation-frame" }); return 0; })()');
  for (let i = 0; i < 36; i++) {
    if (process.env.LOAFFULL) await evaluate(s.cdp, '(() => { window.__loafFull = []; return 0; })()');
    await T(`.themepick__btn[data-mode="${modes[i % 3]}"]`, 6);
    if (process.env.LOAFFULL && i >= 3 && i < 7) { await sleep(200); console.log('\n   [切换 ' + i + '] ' + String(await evaluate(s.cdp, 'JSON.stringify(window.__loafFull)')).slice(0, 1500)); }
  }
  await sleep(500);
  const theme = await evaluate(s.cdp, `document.documentElement.getAttribute('data-theme')`);
  for (let i = 0; i < 3; i++) await T(`.themepick__btn[data-mode="${modes[i]}"]`, 6);
  await sleep(400);
  await closeAllSheets();
  return { perSwitchLoafMs: '见场景统计', finalTheme: theme, expected: 'macaron', resetTo: await evaluate(s.cdp, `document.documentElement.getAttribute('data-theme')`) };
});

// ======================================================================
// S7 随机混合操作（同一种子，两个版本动作序列完全一致）
// ======================================================================
let rngState = 20261126;
const rnd = () => { rngState = (rngState + 0x6D2B79F5) | 0; let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
await scenario('S7 随机混合操作（约 150 步）', async () => {
  const steps = quick ? 50 : 150;
  const counters = {}; let slow; const slowActions = [];
  const kbOpen = () => evaluate(s.cdp, `document.documentElement.getAttribute('data-kb') === 'open' || innerHeight < 800`);
  const acts = {
    async 键盘开() { await s.keyboard(true, 336, 2 + Math.floor(rnd() * 7)); await sleep(rnd() < 0.5 ? 0 : 120); },
    async 键盘收() { await s.keyboard(false, 336, 2 + Math.floor(rnd() * 5)); await sleep(rnd() < 0.5 ? 0 : 120); },
    async 键盘打断() { await s.keyboard(true, 336, 3); await s.keyboard(false, 336, 2); await s.keyboard(true, 336, 2); },
    async 切页() { await T(pick(['#tab-archive', '#tab-memos', '#tab-todos']), 6); await sleep(rnd() < 0.7 ? 0 : 150); },
    async 输入() { await s.type(pick(['买', '东西', 'abc', '开会', '12', '，', '提醒我'])); },
    async 聚焦输入框() { await T(pick(['#new-todo', '#memo-search', '#new-todo', '#memo-title-input', '#memo-body-input', '#voice-names', '#qa-input']), 12); await sleep(20); },
    async 滚动() { await wheel(300 + rnd() * 300, 3 + Math.floor(rnd() * 8)); },
    async 开设置() { await openSettings(); },
    async 关弹层() { for (const sel of ['#settings-layer .sheet__close', '#memo-close', '#qa-close', '#confirm-cancel', '#time-pop-close']) if (await s.waitFor(sel, 60)) { await T(sel, 6); break; } },
    async 主题() { const b = pick(['light', 'dark', 'macaron']); await T(`.themepick__btn[data-mode="${b}"]`, 6); },
    async 词库面板() { await T('#open-message-workbench', 6); await sleep(40); await evaluate(s.cdp, `(() => { const d = document.getElementById('message-workbench'); if (d.open) d.close(); return 0; })()`); },
    async 新笔记() { await T('#memo-new', 6); },
    async 勾选() { await T('.todo:nth-child(' + (2 + Math.floor(rnd() * 8)) + ') .todo__check', 6); await sleep(40); },
    async 添加() { await T('#add-btn', 6); },
  };
  const names = Object.keys(acts);
  for (let i = 0; i < steps; i++) {
    // 调整权重：键盘相关动作要占一半左右
    const r = rnd();
    const name = r < 0.40 ? pick(['键盘开', '键盘收', '键盘打断']) : pick(names);
    counters[name] = (counters[name] || 0) + 1;
    const a0 = await evaluate(s.cdp, '__st.mark()');
    try { await acts[name](); } catch (err) { counters['ERR ' + name] = (counters['ERR ' + name] || 0) + 1; }
    const a1 = await evaluate(s.cdp, '__st.mark()');
    slow = await evaluate(s.cdp, `(() => { if (!__st.loaf) return []; const out = []; for (let k = ${a0.f}; k < ${a1.f}; k++) out.push(${JSON.stringify(name)} + ' ' + __st.loaf[k][1] + 'ms'); return out; })()`);
    if (slow.length) slowActions.push(...slow);
    if (i % 25 === 24) process.stdout.write(` (${i + 1}/${steps}: ${slowActions.slice(-2).join(',').slice(-90)}) `);
    await sleep(rnd() < 0.6 ? 0 : 60);
  }
  // 收尾：键盘收起、所有弹层关闭、失焦
  await settle(300);
  await evaluate(s.cdp, `(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); return 0; })()`);
  await closeAllSheets();
  await T('#tab-todos', 8); await sleep(400);
  await evaluate(s.cdp, 'scrollTo(0,0); 0');
  await sleep(300);
  await s.shot(`stress-${variant}-post.png`);
  const st = await evaluate(s.cdp, `({ sheetsVisible: __st.snap().sheets.map((x) => x.id), todos: __st.snap().todos })`);
  return { counters: JSON.stringify(counters), slowActions: slowActions.join(' , ').slice(0, 600), focusLog: focusLog.slice(-12).join(' ; ').slice(0, 500), ...st };
});

// ======================================================================
// 收尾：整体不变量
// ======================================================================
const mem = await s.cdp.send('Runtime.getHeapUsage').catch(() => ({ usedSize: 0 }));
const final = await evaluate(s.cdp, '__st.snap()');
const total = await evaluate(s.cdp, `__st.stats({ i: 1, l: 0 }, __st.mark())`);
/* 构建指纹：把这次实际跑的三个资源哈希写进结果。以前只记 variant 名，
   事后无法确认"浏览器里跑的"与"装进手机的"是不是同一份字节。 */
function buildFingerprint() {
  const files = {};
  for (const line of readFileSync(join(HERE, 'assets.sha256'), 'utf8').split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/);
    if (m) files['assets/' + m[2].trim()] = m[1];
  }
  return { variant, capturedAt: new Date().toISOString(), files };
}

const out = {
  build: buildFingerprint(),
  variant, quick, total: {
    jsErrors: s.errors, requestFailed: [...new Set(s.failed)], browserEvents: s.events, heapMB: Math.round(mem.usedSize / 1048576 * 10) / 10,
    finalState: final, wholeRun: total,
  },
  scenarios: results,
};
// 可选：--out=后缀  → 结果另存为 results/stress-<版本>-<后缀>.json，不覆盖默认的 stress-<版本>.json（多轮交替对照时用）
const OUT = ((process.argv.find((a) => a.startsWith('--out=')) || '').slice(6) || '').replace(/[^\w.-]/g, '_');
writeFileSync(join(HERE, 'results', `stress-${variant}${quick ? '-quick' : ''}${OUT ? '-' + OUT : ''}.json`), JSON.stringify(out, null, 2));
console.log('\n==== 汇总（' + variant + '）====');
console.log('JS 异常:', s.errors.length, s.errors.slice(0, 5));
if (s.events.length) console.log('浏览器/页面事件:', s.events);
console.log('请求失败:', [...new Set(s.failed)]);
console.log('全程帧:', `p50 ${total.p50}ms p95 ${total.p95}ms p99 ${total.p99}ms max ${total.max}ms >100ms ${total.over100}`, '堆内存', out.total.heapMB + 'MB');
console.log('收尾状态:', JSON.stringify({ active: final.active, theme: final.theme, kb: final.kb, insetBottom: final.insetBottom, overflowX: final.overflowX, todos: final.todos, bad: final.bad, sheets: final.sheets }));
await s.close();
