// 会话助手：登录、灌数据、点按、输入、键盘模拟、截图、布局测量。
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, evaluate, sleep } from './cdp.mjs';
import { startServer } from './serve.mjs';

export const HERE = fileURLToPath(new URL('../', import.meta.url));
export const W = 400;
export const H = 869;
export const DPR = 3;
export const KB = 336; // 键盘高度（dp），约等于 400x869 设备上中文九宫格/全键盘的典型值

mkdirSync(join(HERE, 'shots'), { recursive: true });

/** 页面内的测量脚本：取关键锚点的位置，以及页面整体的滚动/溢出状态。 */
const MEASURE = `(() => {
  const q = (s) => document.querySelector(s);
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return [Math.round(b.left * 10) / 10, Math.round(b.top * 10) / 10, Math.round(b.width * 10) / 10, Math.round(b.height * 10) / 10];
  };
  const de = document.documentElement;
  const vis = (el) => el && !el.classList.contains('is-hidden') && getComputedStyle(el).display !== 'none';
  return {
    vp: [innerWidth, innerHeight],
    scrollY: Math.round(window.scrollY * 10) / 10,
    scrollH: de.scrollHeight,
    overflowX: Math.max(0, de.scrollWidth - innerWidth),
    anchors: {
      topbar: r(q('#view-todo .topbar')),
      segbar: r(q('#view-todo .segbar')),
      addbar: r(q('#view-todo .addbar')),
      input: r(q('#new-todo')),
      addBtn: r(q('#add-btn')),
      timechip: r(q('#time-chip')),
      summary: r(q('#view-todo .summary')),
      list: r(q('#todo-list')),
    },
    openSheets: [...document.querySelectorAll('.sheet-layer')].filter(vis).map((s) => s.id),
    activeView: [...document.querySelectorAll('.view')].filter(vis).map((v) => v.id),
  };
})()`;

export async function openSession(opts = {}) {
  const { name = 'main', reset = false } = opts;
  const server = await startServer();
  const { cdp, close } = await launch({ profile: join(HERE, 'profile', name) });

  const errors = [];
  const failed = [];
  const events = [];
  cdp.on((m) => {
    // 浏览器 / 页面出事的记录：崩溃、连接被替换、目标销毁。以前不记，出事后只能看到「卡住」。
    if (/^(Inspector\.targetCrashed|Target\.targetDestroyed|Target\.targetCrashed|Inspector\.detached)/.test(m.method)) {
      events.push(new Date().toTimeString().slice(0, 8) + ' ' + m.method + (m.params && m.params.reason ? '（' + m.params.reason + '）' : ''));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push(((d.exception && d.exception.description) || d.text || '').split('\n').slice(0, 2).join(' | '));
    }
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
      failed.push(m.params.response.status + ' ' + m.params.response.url.split('/').pop());
    }
  });

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const api = {
    cdp,
    server,
    errors,
    failed,
    events,
    async load(query = '') {
      await cdp.send('Page.navigate', { url: server.url + query });
      await sleep(2600);
      if (reset) {
        await evaluate(cdp, 'localStorage.clear(); sessionStorage.clear(); true');
        await cdp.send('Page.reload');
        await sleep(2600);
      }
      await api.pushRestInsets();
    },
    async rect(sel) {
      return evaluate(cdp, `(() => {
        const el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height, top: b.top, left: b.left };
      })()`);
    },
    /** 真实的触屏点按（按下 → 抬起），会触发浏览器的合成点击。 */
    async tap(sel, hold = 28) {
      const r = typeof sel === 'string' ? await api.rect(sel) : sel;
      if (!r) throw new Error('找不到元素: ' + sel);
      const base = { x: r.x, y: r.y, radiusX: 6, radiusY: 6, force: 1, id: 1 };
      // 输入指令加 20 秒超时：浏览器不回执时报错，而不是让整个测试永远挂住
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [base] }, 20000);
      await sleep(hold);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, 20000);
      return r;
    },
    async type(text) {
      await cdp.send('Input.insertText', { text });
    },
    /** 模拟原生在启动时推一次「无键盘」的内边距（状态栏 28dp + 手势条 20dp） */
    async pushRestInsets() {
      await evaluate(cdp, 'window.TodoNativeHost && TodoNativeHost.receiveInsets(28, 20); true');
    },
    /**
     * 键盘开关，按原生实际行为模拟：每一帧既推内边距（receiveInsets），又给根视图加内边距
     * （WebView 变矮 = 视口变小）。steps 帧走完，约等于系统键盘动画的时长。
     */
    async keyboard(open, kb = KB, steps = 10) {
      const top = 28;
      const nav = 20;
      for (let i = 1; i <= steps; i++) {
        const p = open ? i / steps : 1 - (i - 1) / steps;
        const lift = kb * p;
        await cdp.send('Runtime.evaluate', { expression: `window.TodoNativeHost && TodoNativeHost.receiveInsets(${top}, ${Math.round(nav + lift)}); 0` });
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: Math.max(240, Math.round(H - lift)), deviceScaleFactor: DPR, mobile: true });
        await sleep(14);
      }
      if (!open) {
        await cdp.send('Runtime.evaluate', { expression: `window.TodoNativeHost && TodoNativeHost.receiveInsets(${top}, ${nav}); 0` });
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: true });
      }
    },
    async measure() {
      return evaluate(cdp, MEASURE);
    },
    async shot(file) {
      const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const p = join(HERE, 'shots', file.endsWith('.png') ? file : file + '.png');
      writeFileSync(p, Buffer.from(s.data, 'base64'));
      return p;
    },
    /** 裁剪放大：x/y/w/h 是 CSS 像素，scale 是放大倍数 */
    async shotClip(file, x, y, w, h, scale = 3) {
      const s = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x, y, width: w, height: h, scale },
      });
      const p = join(HERE, 'shots', file.endsWith('.png') ? file : file + '.png');
      writeFileSync(p, Buffer.from(s.data, 'base64'));
      return p;
    },
    async waitFor(sel, timeout = 4000) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        const ok = await evaluate(cdp, `(() => {
          const el = document.querySelector(${JSON.stringify(sel)});
          if (!el) return false;
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || el.classList.contains('is-hidden')) return false;
          const b = el.getBoundingClientRect();
          return b.width > 0 && b.height > 0;
        })()`);
        if (ok) return true;
        await sleep(60);
      }
      return false;
    },
    /** 登录页 → 游客登录 → 主界面。已登录则直接返回。 */
    async enter() {
      if (await api.waitFor('#view-todo', 1500)) return '已登录';
      if (!(await api.waitFor('#guest-btn', 5000))) throw new Error('既没进主界面，也没有登录页');
      await api.tap('#guest-btn');
      if (!(await api.waitFor('#view-todo', 6000))) throw new Error('游客登录后未进入主界面');
      await sleep(600);
      // 首次登录会先弹全屏「口袋指南」，要先跳过才能操作主界面。
      if (await api.waitFor('#guide-layer', 1500)) {
        await api.tap('#guide-skip');
        if (await api.waitFor('#guide-layer', 600)) throw new Error('口袋指南没有关闭');
      }
      return '游客登录';
    },
    async close() {
      await close();
      await server.close();
    },
  };
  return api;
}

/** 往列表里灌 n 条待办（经真实 UI 输入，不直接写存储）。 */
export async function seedTodos(api, titles) {
  let added = 0;
  for (const t of titles) {
    await api.tap('#new-todo', 16);
    await sleep(90);
    await api.type(t);
    await sleep(40);
    await api.tap('#add-btn', 16);
    await sleep(170);
    added++;
  }
  return added;
}

export { sleep, evaluate };
