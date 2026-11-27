// 零依赖的 CDP 驱动：用 Node 22 自带的 WebSocket 直连 Chromium 调试协议。
// 不安装任何 npm 包。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CANDIDATES = [
  process.env.CHROME_EXE,
  join(process.env.LOCALAPPDATA || '', 'ms-playwright/chromium-1247/chrome-win64/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

export function findChrome() {
  return CANDIDATES.find((p) => existsSync(p)) || null;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    const listeners = [];
    ws.onopen = () => resolve({
      send,
      on: (f) => listeners.push(f),
      /** 等某条事件下一次出现，并取回它的参数 */
      once: (method) => new Promise((resolve) => {
        const f = (m) => { if (m.method !== method) return; const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); resolve(m.params); };
        listeners.push(f);
      }),
      close: () => ws.close(),
    });
    ws.onerror = () => reject(new Error('CDP 连接失败'));
    // 连接断开（浏览器退出、页面崩溃、目标被销毁）时，所有还没回来的指令都必须立刻报错。
    // 以前这里没有处理：断开以后等待中的指令会永远挂着，整个测试看起来像「卡死」。
    let closed = '';
    ws.onclose = () => {
      closed = 'CDP 连接已断开（浏览器已退出，或页面已崩溃）';
      for (const p of pending.values()) p.reject(new Error(closed));
      pending.clear();
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (!p) return;
        if (m.error) p.reject(new Error(m.error.message));
        else p.resolve(m.result);
        return;
      }
      for (const f of listeners) f(m);
    };
    function send(method, params = {}, timeoutMs = 0) {
      return new Promise((res, rej) => {
        if (closed) { rej(new Error(closed)); return; }
        const i = ++id;
        pending.set(i, { resolve: res, reject: rej });
        // 可选的单条指令超时（毫秒）：touchEnd / touchStart 这类输入指令在浏览器不回执时会永远不返回
        const t = timeoutMs ? setTimeout(() => { if (pending.delete(i)) rej(new Error(`CDP 指令超时（${timeoutMs}ms）：${method}`)); }, timeoutMs) : null;
        Promise.resolve().then(() => ws.send(JSON.stringify({ id: i, method, params }))).catch((e) => { clearTimeout(t); if (pending.delete(i)) rej(e); });
        pending.get(i).reject = (e) => { clearTimeout(t); rej(e); };
        pending.get(i).resolve = (v) => { clearTimeout(t); res(v); };
      });
    }
  });
}

/**
 * 启动一个独立配置的 Chromium 并连上它的页面目标。
 * profile 目录隔离在测试工作区内，不会碰用户日常浏览器的数据。
 */
export async function launch(opts = {}) {
  const {
    port = 9333 + Math.floor(Math.random() * 400),
    profile,
    headless = true,
  } = opts;
  const exe = findChrome();
  if (!exe) throw new Error('未找到 Chromium/Edge 可执行文件');
  mkdirSync(profile, { recursive: true });

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--mute-audio',
    '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required',
    // 浏览器自己的日志写到配置目录下的 browser.log：浏览器中途自己退出时，能从里面看到原因
    '--enable-logging=stderr',
    '--disable-features=Translate,CalculateNativeWinOcclusion',
    headless ? '--headless=new' : '',
    '--window-size=420,900',
    'about:blank',
  ].filter(Boolean);

  const logFd = openSync(join(profile, 'browser.log'), 'a');
  const proc = spawn(exe, args, { stdio: ['ignore', 'ignore', logFd], windowsHide: true });
  const base = `http://127.0.0.1:${port}`;

  let target = null;
  for (let i = 0; i < 150 && !target; i++) {
    try {
      const list = await (await fetch(`${base}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch {
      /* 浏览器还没起来 */
    }
    if (!target) await sleep(100);
  }
  if (!target) {
    proc.kill();
    throw new Error('浏览器启动超时');
  }

  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');

  return {
    cdp,
    exe,
    async close() {
      /* 必须让浏览器正常退出：直接杀进程时，localStorage 最后几秒的写入还没落盘，会丢。
         这一条曾经让 26 条测试数据在两次运行之间消失，查了很久才发现是工具的问题。 */
      let exited = false;
      try {
        const ver = await (await fetch(`${base}/json/version`)).json();
        const browser = await connect(ver.webSocketDebuggerUrl);
        browser.send('Browser.close').catch(() => {});
        const t0 = Date.now();
        while (!exited && Date.now() - t0 < 4000) {
          exited = proc.exitCode !== null;
          if (!exited) await sleep(50);
        }
      } catch {
        /* 已断开 */
      }
      try { cdp.close(); } catch { /* 已断开 */ }
      if (!exited) proc.kill();
      await sleep(300);
    },
  };
}

/** 在页面里求值并取回 JSON 结果。 */
export async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error('页面求值异常: ' + ((d.exception && d.exception.description) || d.text));
  }
  return r.result.value;
}

export { sleep };
