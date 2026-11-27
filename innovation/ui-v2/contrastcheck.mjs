// 只读探针：量「浅色 / 深色 / 马卡龙」三块主题预览按钮在各状态下的文字对比度。
// 通过 CDP 强制伪类，拿到真实的 hover / active / focus-visible 计算样式；
// 再把全局 button 规则里的 brightness() 滤镜一并算进对比度，避免只看 color 得出假结论。
import { openSession, evaluate, sleep } from './lib/session.mjs';

const s = await openSession({ name: 'contrast' });
await s.load();
await s.enter();
await s.tap('#user-btn');
await sleep(350);
await s.tap('#settings-btn');
const ok = await s.waitFor('#theme-pick', 5000);
if (!ok) throw new Error('设置面板没打开');

await s.cdp.send('DOM.enable');
await s.cdp.send('CSS.enable');

// 对比度计算（WCAG 2.1）
const MATH = `
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); };
  const parse = (str) => (str.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
  const bri = (filterStr) => { const m = /brightness\\(([\\d.]+)\\)/.exec(filterStr || ''); return m ? parseFloat(m[1]) : 1; };
  const clamp = (v) => Math.min(255, Math.max(0, v));
  const applyK = (rgb, k) => rgb.map((v) => clamp(Math.round(v * k)));
`;

const measure = (mode, state) => evaluate(s.cdp, `(() => {
  ${MATH}
  const el = document.querySelector('#theme-pick [data-mode="light"]');
  const cs = getComputedStyle(el);
  const k = bri(cs.filter);
  const fg = applyK(parse(cs.color), k);
  const bg = applyK(parse(cs.backgroundColor), k);
  const rect = el.getBoundingClientRect();
  return {
    mode: ${JSON.stringify(mode)}, state: ${JSON.stringify(state)},
    color: cs.color, bg: cs.backgroundColor, filter: cs.filter, k,
    fgEffective: fg, bgEffective: bg,
    ratio: +ratio(fg, bg).toFixed(2),
    fontSize: cs.fontSize, fontWeight: cs.fontWeight,
    box: [Math.round(rect.width), Math.round(rect.height)],
  };
})()`);

// DOM.querySelector → nodeId，之后 forcePseudoState
const { root } = await s.cdp.send('DOM.getDocument', { depth: -1 });
const { nodeId } = await s.cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#theme-pick [data-mode="light"]' });

const STATES = { '默认': [], '悬停': ['hover'], '按下': ['active'], '键盘聚焦': ['focus-visible'] };
const THEMES = ['light', 'dark', 'macaron'];
const rows = [];
const boxes = {};

for (const theme of THEMES) {
  await evaluate(s.cdp, `document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); true`);
  await sleep(260);
  // 三块按钮的几何，用来证明布局没动
  boxes[theme] = await evaluate(s.cdp, `[...document.querySelectorAll('#theme-pick [data-mode]')].map(b => { const r = b.getBoundingClientRect(); return b.dataset.mode + ':' + [r.left, r.top, r.width, r.height].map(v => Math.round(v)).join(','); }).join(' | ')`);
  for (const [label, pseudo] of Object.entries(STATES)) {
    await s.cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: pseudo });
    await sleep(120);
    rows.push(await measure(theme, label));
  }
  await s.cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
}

await evaluate(s.cdp, `document.documentElement.setAttribute('data-theme', 'light'); true`);

// ---- 补测 1：桌面 hover 环境（触屏模拟下 @media (hover:hover) 不成立，hover 规则量不到）----
// 触屏模拟会把 hover/pointer 锁成 none/coarse，必须先关掉，媒体特性模拟才生效
await s.cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
await s.cdp.send('Emulation.setEmulatedMedia', {
  media: 'screen',
  features: [{ name: 'hover', value: 'hover' }, { name: 'pointer', value: 'fine' }],
});
await evaluate(s.cdp, `document.documentElement.setAttribute('data-theme', 'dark'); true`);
await sleep(200);
await s.cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
await sleep(150);
const hoverDark = await measure('dark', '悬停(桌面)');
await s.cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
await s.cdp.send('Emulation.setEmulatedMedia', { features: [] });

// ---- 补测 2：修复前的旧规则（color: var(--text)）在同一环境下是多少 ----
await evaluate(s.cdp, `(() => {
  const st = document.createElement('style');
  st.id = '__before';
  st.textContent = 'html:root body .themepick__btn[data-mode="light"] { color: var(--text) !important; }';
  document.head.appendChild(st);
  return 1;
})()`);
await sleep(200);
const beforeDark = await measure('dark', '修复前(默认)');
await evaluate(s.cdp, `document.getElementById('__before').remove(); true`);
await evaluate(s.cdp, `document.documentElement.setAttribute('data-theme', 'light'); true`);

const NAME = { light: '浅色模式', dark: '深色模式', macaron: '马卡龙' };
let last = '';
for (const r of rows) {
  if (r.mode !== last) { console.log(`\n【${NAME[r.mode]}】按钮 [浅色]  ${r.fontSize} / ${r.fontWeight} / ${r.box[0]}x${r.box[1]}`); last = r.mode; }
  const flag = r.ratio >= 7 ? 'AAA' : r.ratio >= 4.5 ? 'AA' : r.ratio >= 3 ? 'AA(大字)' : '不达标';
  console.log(`  ${r.state.padEnd(4)} 字 ${r.color.padEnd(20)} 底 ${r.bg.padEnd(18)} filter=${r.filter.padEnd(18)} 对比度 ${String(r.ratio).padStart(6)}:1  ${flag}`);
}

console.log('\n【布局】三块按钮的矩形（left,top,w,h）');
for (const t of THEMES) console.log(`  ${NAME[t]}: ${boxes[t]}`);

const worst = rows.filter((r) => r.mode === 'dark').reduce((a, r) => (r.ratio < a.ratio ? r : a));
console.log(`\n深色模式下最低对比度：${worst.state} ${worst.ratio}:1`);
console.log(`桌面临界（真实 hover）：字 ${hoverDark.color}  filter=${hoverDark.filter}  → ${hoverDark.ratio}:1`);
console.log(`修复前（旧规则 color:var(--text)）深色默认：字 ${beforeDark.color} 底 ${beforeDark.bg} → ${beforeDark.ratio}:1`);
console.log('JS 异常:', s.errors.length ? s.errors : '无', '| 资源失败:', s.failed.length ? s.failed : '无');
await s.close?.();
process.exit(0);
