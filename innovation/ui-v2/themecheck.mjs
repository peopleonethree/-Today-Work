// 主题切换专项探针：复现「多次切换后浅色卡约半秒」的问题，并给出逐次计时。
// 用法：node themecheck.mjs [--variant=patched|base] [--out=名字]
// 测三件事：
//   A 单次切换：点击 → data-theme 变更的延迟、is-retheming 挂上/摘掉的时间
//   B 连点：每 90ms 一次连点 12 次，看有没有点击被丢掉（点击事件数 vs DOM 变更数）
//   C 触屏命中：真实的 Input.dispatchTouchEvent 点在按钮中心，看命中率与延迟
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openSession, evaluate, sleep, HERE } from './lib/session.mjs';

const argOf = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.split('=').slice(1).join('=') : def;
};
const variant = argOf('variant', 'patched');
const outName = argOf('out', 'themecheck-' + variant);
const throttle = Number(argOf('throttle', '4'));
const unfix = process.argv.includes('--unfix');

const s = await openSession({ name: 'theme-' + Date.now() });
await s.load();
await s.enter();
if (throttle > 1) await s.cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
await s.tap('#user-btn');
await sleep(350);
await s.tap('#settings-btn');
if (!(await s.waitFor('#theme-pick', 4000))) throw new Error('设置面板没打开');

// ---- 页面内探针 ----
await evaluate(s.cdp, `(() => {
  const root = document.documentElement;
  const th = window.__th = { clicks: [], muts: [], classes: [], long: [], frames: [], anims: [] };
  const pick = document.getElementById('theme-pick');
  pick.addEventListener('click', (e) => {
    queueMicrotask(() => {
      try { th.anims.push({ t: performance.now(), n: document.getAnimations().length }); } catch (err) {}
    });
    const b = e.target.closest && e.target.closest('[data-mode]');
    th.clicks.push({ t: performance.now(), mode: b ? b.getAttribute('data-mode') : '(miss)', theme: root.getAttribute('data-theme') });
  }, true);
  new MutationObserver((recs) => {
    for (const r of recs) {
      if (r.attributeName === 'data-theme') th.muts.push({ t: performance.now(), v: root.getAttribute('data-theme') });
      if (r.attributeName === 'class') th.classes.push({ t: performance.now(), has: root.classList.contains('is-retheming') ? 1 : 0 });
    }
  }).observe(root, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => th.long.push({ t: e.startTime, d: e.duration }))).observe({ entryTypes: ['longtask'] });
  } catch (err) { th.longErr = String(err); }
  th.loaf = [];
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => th.loaf.push({
      t: e.startTime, d: e.duration,
      style: (e.styleAndLayoutStart || e.startTime) - e.startTime,
      render: e.renderStart ? e.startTime + e.duration - e.renderStart : null,
    }))).observe({ type: 'long-animation-frame' });
  } catch (err) { th.loafErr = String(err); }
  th.frameLoop = () => { th.frames.push(performance.now()); if (th.frames.length < 4000) requestAnimationFrame(th.frameLoop); };
  requestAnimationFrame(th.frameLoop);
  th.reset = () => { th.clicks.length = 0; th.muts.length = 0; th.classes.length = 0; th.long.length = 0; th.frames.length = 0; th.loaf.length = 0; th.anims.length = 0; requestAnimationFrame(th.frameLoop); };
  return 1;
})()`);

if (unfix) {
  await evaluate(s.cdp, `(() => {
    const st = document.createElement('style');
    st.textContent = 'html:root body button { transition: background-color .16s ease, color .16s ease, border-color .16s ease, box-shadow .16s ease, opacity .16s ease, transform .12s ease, filter .16s ease !important; }';
    document.head.appendChild(st);
    return 1;
  })()`);
}

const clickMode = (mode) => evaluate(s.cdp, `(() => { const b = document.querySelector('#theme-pick [data-mode="${mode}"]'); if (!b) return -1; const t = performance.now(); b.click(); return performance.now() - t; })()`);
const snapshot = () => evaluate(s.cdp, `(() => { const th = window.__th; return { clicks: th.clicks.slice(), muts: th.muts.slice(), classes: th.classes.slice(), long: th.long.slice(), loaf: th.loaf.slice(), anims: th.anims.slice(), frames: th.frames.slice(), now: performance.now(), theme: document.documentElement.getAttribute('data-theme'), active: [...document.querySelectorAll('#theme-pick [data-mode]')].map(b => b.getAttribute('data-mode') + ':' + b.classList.contains('is-active') + ':' + b.getAttribute('aria-checked')).join(' ') }; })()`);
const reset = () => evaluate(s.cdp, 'window.__th.reset(), 1');

// 只统计「点击之后」发生的事，把时间轴统一到每次点击
function analyse(snap, clicksTs) {
  const loafAll = snap.loaf || [];
  const out = [];
  for (const c of clicksTs) {
    const mut = snap.muts.find((m) => m.t > c.t - 1 && m.t - c.t < 2000);
    const cls = snap.classes.filter((x) => x.t >= c.t - 1 && x.t - c.t < 1200);
    const added = cls.find((x) => x.has === 1);
    const removed = cls.find((x) => x.has === 0 && added && x.t > added.t);
    out.push({
      mode: c.mode,
      clickToDom: mut ? +(mut.t - c.t).toFixed(1) : null,
      clsAdded: added ? +(added.t - c.t).toFixed(1) : null,
      clsRemoved: removed ? +(removed.t - c.t).toFixed(1) : null,
      themeAfter: mut ? mut.v : null,
      loafSum: +loafAll.filter((l) => l.t >= c.t - 2 && l.t - c.t < 900).reduce((a, l) => a + l.d, 0).toFixed(1),
      loafMax: +Math.max(0, ...loafAll.filter((l) => l.t >= c.t - 2 && l.t - c.t < 900).map((l) => l.d)).toFixed(1),
      loafStyle: +Math.max(0, ...loafAll.filter((l) => l.t >= c.t - 2 && l.t - c.t < 900).map((l) => l.style)).toFixed(1),
    });
  }
  return out;
}

// ---------- A：从浅色出发，逐个切 8 次（每次等 700ms） ----------
await clickMode('light');
await sleep(800);
await reset();
await sleep(100);
const aSteps = [];
for (let i = 0; i < 8; i++) {
  const mode = i % 2 === 0 ? 'dark' : 'light';
  const t0 = Date.now();
  await clickMode(mode);
  await sleep(700);
  const snap = await snapshot();
  const last = snap.clicks[snap.clicks.length - 1];
  const row = analyse({ muts: snap.muts, classes: snap.classes }, [last])[0];
  row.mode = mode;
  row.wall = Date.now() - t0;
  row.longDuring = snap.long.filter((l) => l.t >= last.t && l.t - last.t < 700).map((l) => Math.round(l.d));
  // 帧间隔：点击后 700ms 内的最大间隔
  const fr = snap.frames.filter((f) => f >= last.t && f - last.t < 700);
  let gap = 0;
  for (let k = 1; k < fr.length; k++) gap = Math.max(gap, fr[k] - fr[k - 1]);
  row.maxFrameGap = +gap.toFixed(1);
  aSteps.push(row);
  await reset();
  await sleep(80);
}

// ---------- B：连点 12 次（每 90ms），看丢点与延迟 ----------
await clickMode('light');
await sleep(900);
await reset();
await sleep(100);
const seq = [];
for (let i = 0; i < 12; i++) seq.push(i % 2 === 0 ? 'dark' : 'light');
const bStart = Date.now();
for (const m of seq) {
  await clickMode(m);
  await sleep(90);
}
await sleep(1200);
const snapB = await snapshot();
const bRows = analyse(snapB, snapB.clicks);
const bMuts = snapB.muts.length;
const bClicks = snapB.clicks.length;
const bLong = snapB.long.map((l) => Math.round(l.d));
const frB = snapB.frames;
let bGap = 0;
for (let k = 1; k < frB.length; k++) bGap = Math.max(bGap, frB[k] - frB[k - 1]);
// 连续点击时，每次点击到下一次点击之间有没有出现「半天没反应」：求相邻 DOM 变更的最大间隔
let maxMutGap = 0;
for (let k = 1; k < snapB.muts.length; k++) maxMutGap = Math.max(maxMutGap, snapB.muts[k].t - snapB.muts[k - 1].t);
const bMaxAnims = Math.max(0, ...snapB.anims.map((a) => a.n));
const bFinal = { clicks: bClicks, maxAnims: bMaxAnims, muts: bMuts, dropped: bClicks - bMuts, wall: Date.now() - bStart, maxMutGap: +maxMutGap.toFixed(1), maxFrameGap: +bGap.toFixed(1), longTasks: bLong, theme: snapB.theme, active: snapB.active };

// ---------- C：真实触屏命中（每次重新取 rect） ----------
await clickMode('light');
await sleep(900);
await evaluate(s.cdp, `(() => { const b = document.querySelector('#theme-pick'); if (b && b.scrollIntoView) b.scrollIntoView({ block: 'center' }); return 1; })()`);
await sleep(400);
await reset();
await sleep(100);
const cRows = [];
for (let i = 0; i < 6; i++) {
  const mode = i % 2 === 0 ? 'dark' : 'light';
  const before = (await snapshot()).clicks.length;
  const rect = await s.rect('#theme-pick [data-mode="' + mode + '"]');
  const base = { x: rect.x, y: rect.y, radiusX: 6, radiusY: 6, force: 1, id: 1 };
  await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [base] }, 20000);
  await sleep(26);
  await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, 20000);
  await sleep(420);
  const snap = await snapshot();
  const hit = snap.clicks.length > before;
  const lastClick = snap.clicks[snap.clicks.length - 1];
  const row = lastClick ? analyse({ muts: snap.muts, classes: snap.classes }, [lastClick])[0] : { clickToDom: null };
  cRows.push({ mode, hit, y: +rect.y.toFixed(1), clickToDom: row.clickToDom, theme: snap.theme });
  await reset();
  await sleep(80);
}

const report = { variant, at: new Date().toISOString(), single: aSteps, burst: bFinal, burstRows: bRows, touch: cRows };
mkdirSync(join(HERE, 'results'), { recursive: true });
writeFileSync(join(HERE, 'results', outName + '.json'), JSON.stringify(report, null, 2));

console.log('== A 单次切换（点击 → 主题属性变更 ms） ==');
for (const r of aSteps) console.log(`  ${r.mode.padEnd(5)} dom=${String(r.clickToDom).padStart(6)}  帧最大间隔=${String(r.maxFrameGap).padStart(6)}ms  LoAF合计=${String(r.loafSum).padStart(6)}ms 最大=${String(r.loafMax).padStart(6)}ms 样式布局=${String(r.loafStyle).padStart(6)}ms`);
console.log('== B 连点 12 次（90ms 间隔） ==');
console.log(`  点击事件 ${bFinal.clicks} 次，DOM 变更 ${bFinal.muts} 次，丢失 ${bFinal.dropped} 次；相邻变更最大间隔 ${bFinal.maxMutGap}ms；帧最大间隔 ${bFinal.maxFrameGap}ms`);
console.log(`  长任务 ${JSON.stringify(bFinal.longTasks)}  点击瞬间最多并行过渡 ${bFinal.maxAnims} 条`);
console.log(`  最终 theme=${bFinal.theme} 选中态=${bFinal.active}`);
console.log('  ' + bRows.map((r) => `${r.mode}:${r.clickToDom}`).join('  '));
console.log('== C 真实触屏 ==');
for (const r of cRows) console.log(`  点 ${r.mode.padEnd(5)} y=${r.y} 命中=${r.hit} dom=${r.clickToDom} 之后 theme=${r.theme}`);
await s.close();
