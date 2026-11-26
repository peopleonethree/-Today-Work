import { resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { bindWeChatSession } from "./wechat-relay-session.mjs";
import { createDesktopRelayClient } from "./desktop-relay-client.mjs";
import { dispatchDue, openRelayQueue } from "./desktop-relay-worker.mjs";

function elements(state) {
  return (state.accessibility?.tree ?? "").split(/\r?\n/).map(raw => ({
    depth: raw.length - raw.trimStart().length, text: raw.trim(),
  }));
}

const MAXIMIZE = /^(\d+) button \([^)]*\)(?: \([^)]*\))? (?:最大化|Maximize)$/u;
const RESTORE = /^\d+ button \([^)]*\)(?: \([^)]*\))? (?:还原|撤销最大化|Restore)$/u;

export async function makeRelayWindowVisible(sky, window) {
  await sky.activate_window({ window });
  const read = (include_screenshot = false) =>
    sky.get_window_state({ window, include_text: true, include_screenshot });
  async function waitForRestore() {
    for (let attempt = 0; attempt < 8; attempt++) {
      await wait(230);
      if (elements(await read()).some(({text}) => RESTORE.test(text))) return true;
    }
    return false;
  }
  const state = await read();
  if (elements(state).some(({text}) => RESTORE.test(text))) return;
  const buttons = elements(state).map(({text}) => text.match(MAXIMIZE)).filter(Boolean);
  if (buttons.length !== 1) throw new Error("Window controls are not identifiable");
  try {
    await sky.click({ window, element_index: Number(buttons[0][1]) });
  } catch (error) {
    if (!/geometry|off.screen|bounds/i.test(error.message)) throw error;
  }
  if (await waitForRestore()) return;
  let refreshed = await read(true);
  if (elements(refreshed).some(({text}) => RESTORE.test(text))) return;
  if (!elements(refreshed).some(({text}) => MAXIMIZE.test(text)) ||
      refreshed.screenshots.length !== 1 || refreshed.screenshots[0].width < 500) {
    throw new Error("A safe title-bar target could not be identified");
  }
  const image = refreshed.screenshots[0];
  await sky.click({window, screenshotId:image.id, x:Math.floor(image.width/2), y:15, click_count:2});
  if (!await waitForRestore()) {
    throw new Error("Desktop window was not restored to a full working area");
  }
}

function wxEditor(state) {
  const rows = elements(state).filter(({text}) => /\bID: chat_input_field(?:\s|$)/u.test(text));
  if (rows.length !== 1) throw new Error("WeChat editor was not uniquely identified");
  return rows[0].text;
}

function qqEditor(state) {
  const rows = elements(state);
  const matches = rows.flatMap(({text}, index) => /^\d+ group \([^)]*\) 我的手机$/u.test(text) ? [index] : []);
  if (matches.length !== 1) throw new Error("QQ editor was not uniquely identified");
  const start = matches[0];
  const contents = [];
  for (let n = start + 1; n < rows.length && rows[n].depth > rows[start].depth; n++) {
    contents.push(rows[n].text);
  }
  return { line: rows[start].text, contents };
}

export function relayDesktopClients({ sky, bindings, storageDirectory }) {
  const clients = {};
  const audioDirectory = resolve(storageDirectory, "relay-audio");
  // Qt may hide the native file chooser from the accessibility tree. Verify
  // its presence as a separate dialog, then use the file-name mnemonic. The
  // exact filename is checked again in the chat preview before any send.
  const confirmModal = async window => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const state = await sky.get_window_state({window, include_text:true, include_screenshot:true});
      const dialogs = state.screenshots.slice(1).filter(s => s.width >= 600 && s.height >= 350);
      const tree = state.accessibility?.tree;
      if (state.window.id === window.id && dialogs.length === 1 &&
          (!tree || /文件名|选择文件/u.test(tree))) return true;
      await wait(200);
    }
    return false;
  };
  if (bindings.wechat) {
    const resolveWindow = bindWeChatSession({ ...bindings.wechat, recipient: "文件传输助手" });
    clients.wechat = createDesktopRelayClient({
      sky, platform: "wechat", audioDirectory, confirmModal, geometryFallback: bindings.wechat.geometryFallback,
      resolveWindow: () => resolveWindow(sky),
      prepareWindow: async (window, recipient) => {
        await makeRelayWindowVisible(sky, window);
        const checked = await resolveWindow(sky);
        if (checked.id !== window.id || recipient !== '文件传输助手') throw new Error("WeChat binding changed");
      },
      writeDraft: (state, value) => {
        const field = wxEditor(state);
        if (!field.includes("(settable, string)")) throw new Error("WeChat editor is not writable");
        return sky.set_value({window:state.window, element_index:Number(field.match(/^\d+/u)[0]), value});
      },
      readDraft(state) {
        const field = wxEditor(state);
        const value = field.match(/\bValue:\s*(.*?)\s+ID: chat_input_field$/u);
        if (value) return value[1];
        return /\) 文件传输助手(?:长按鼠标\s+语音输入)? ID: chat_input_field$/u.test(field) ? "" : null;
      },
    });
  }
  if (bindings.qq) {
    const binding = bindings.qq;
    if (!binding.mobileAccount || binding.mobileAccount !== binding.desktopAccount) throw new Error("QQ accounts did not match");
    clients.qq = createDesktopRelayClient({
      sky, platform: "qq", audioDirectory, confirmModal, geometryFallback: binding.geometryFallback,
      prepareWindow: binding.prepareWindow || (window => makeRelayWindowVisible(sky, window)),
      editorFocused: state => /^\s*\d+ (?:document\b|group \([^)]*\) 我的手机$)/u.test(
        state.accessibility?.focused_element ?? "",
      ),
      async resolveWindow() {
        const windows = (await sky.list_windows()).filter(w => w.id === binding.window.id && w.app === binding.window.app);
        if (windows.length !== 1) throw new Error("Verified QQ window no longer available");
        const state = await sky.get_window_state({ window: windows[0], include_text: true, include_screenshot: false });
        const hasHeader = elements(state).some(({text}) => /^\d+ button \([^)]*\) 我的手机$/u.test(text));
        if (!hasHeader || !qqEditor(state)) throw new Error("QQ is outside the intended chat");
        return state.window;
      },
      // QQ's editor is often drawn without UIA input geometry. A caller can
      // supply a previously verified click location for the current window.
      focusEditor: (state) => binding.focusEditor
        ? binding.focusEditor(state.window)
        : sky.click({ window: state.window, element_index: Number(qqEditor(state).line.match(/^\d+/u)[0]) }),
      readDraft(state) {
        const contents = qqEditor(state).contents;
        if (!contents.length) return "";
        const text = contents.map(line => {
          const row = line.match(/^\d+ text \([^)]*\)(?: (.*))?$/u);
          return row ? (row[1] ?? "").replace(/[\u200b\ufeff]/g, "") : undefined;
        });
        return text.every(value => value !== undefined) ? text.join("\n") : null;
      },
    });
  }
  return clients;
}

export async function runRelay({ database, clients, signal, onResult = () => {} }) {
  const queue = openRelayQueue(database);
  try {
    while (!signal?.aborted) {
      for (const result of await dispatchDue(queue, clients)) onResult(result);
      await wait(500);
    }
  } finally {
    queue.close();
  }
}
