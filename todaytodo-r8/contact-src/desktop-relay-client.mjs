import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

function lines(state) {
  return (state.accessibility?.tree ?? "").split(/\r?\n/).map(line => line.trim());
}

function uniqueIndex(state, pattern) {
  const matches = lines(state).map(line => line.match(pattern)).filter(Boolean);
  if (matches.length !== 1) throw new Error("The required desktop control was missing or ambiguous");
  return Number(matches[0][1]);
}

const SEND = /^(\d+) button \([^)]*\)(?: \([^)]*\))? 发\s*送(?=\s+ID:|\s*\(|$)/u;
const FILE = {
  qq: /^(\d+) button \([^)]*\)(?: \([^)]*\))? 文件$/u,
  wechat: /^(\d+) button \([^)]*\)(?: \([^)]*\))? 发送文件(?=\s+ID:|\s*\(|$)/u,
};
const PICKER_NAME = /^(\d+) (?:edit|text field) \([^)]*\).*文件名/u;
const QQ_FILE_SEND = /^(\d+) button \([^)]*\)(?: \([^)]*\))? 发送\s*[（(]1[）)]/u;

export function createDesktopRelayClient({
  sky, platform, resolveWindow, focusEditor, readDraft, audioDirectory, confirmModal, prepareWindow,
  editorFocused = state => /chat_input_field|我的手机/u.test(state.accessibility?.focused_element ?? ""),
  geometryFallback, writeDraft,
}) {
  const read = window => sky.get_window_state({ window, include_text: true, include_screenshot: false });
  async function click(state, pattern, control) {
    try {
      await sky.click({ window: state.window, element_index: uniqueIndex(state, pattern) });
    } catch (error) {
      if (!geometryFallback || !/coordinate input geometry is unavailable/i.test(error.message)) throw error;
      await geometryFallback(state.window, control);
    }
  }

  async function verify(recipient) {
    return resolveWindow(recipient);
  }

  async function current(bound, recipient) {
    const window = await verify(recipient);
    if (window.id !== bound.id || window.app !== bound.app) throw new Error("Window binding changed");
    return read(window);
  }

  async function verifyHistory(bound, recipient, content) {
    let confirmedSince = 0;
    for (let attempt = 0; attempt < 10; attempt++) {
      const state = await current(bound, recipient);
      const rows = lines(state).filter(line => /\b(?:text|list item)\b/u.test(line) &&
        !/session_item_|chat_input_field|文件名/u.test(line) && line.includes(content));
      if (rows.some(line => /发送失败|传输失败|重新发送|重发/u.test(line))) {
        throw new Error("Desktop client reported a send failure");
      }
      if (readDraft(state) === "" && rows.length &&
          !rows.some(line => /发送中|上传中|传输中/u.test(line))) {
        confirmedSince ||= Date.now();
        if (Date.now() - confirmedSince >= 900) return true;
      } else {
        confirmedSince = 0;
      }
      await wait(300);
    }
    return false;
  }

  async function send(bound, job, part) {
    const { recipient } = job.plan;
    await prepareWindow?.(bound, recipient);
    const state = await current(bound, recipient);
    if (readDraft(state) !== "") throw new Error("The chat already contains a draft or its contents could not be verified");
    if (part === "text") {
      if (writeDraft) {
        await writeDraft(state, job.plan.text);
      } else {
        await focusEditor(state, recipient);
        const focused = await current(bound, recipient);
        if (!editorFocused(focused)) throw new Error("The chat editor did not gain focus");
        await sky.type_text({ window: bound, text: job.plan.text });
      }
      let prepared;
      for (let attempt = 0; attempt < 5; attempt++) {
        prepared = await current(bound, recipient);
        if (readDraft(prepared) === job.plan.text) break;
        await wait(220);
      }
      if (!prepared || readDraft(prepared) !== job.plan.text) throw new Error("Typed draft did not match the queued message");
      await click(prepared, SEND, "send");
      return verifyHistory(bound, recipient, job.plan.text);
    }

    const prefix = "data:audio/wav;base64,";
    if (!job.plan.audio.startsWith(prefix)) throw new Error("Expected WAV audio");
    const bytes = Buffer.from(job.plan.audio.slice(prefix.length), "base64");
    if (bytes.length < 44 || bytes.length > 524288 ||
        bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
      throw new Error("Invalid WAV attachment");
    }
    await mkdir(audioDirectory, { recursive: true });
    const filename = `TodayTodo-${job.id.slice(0, 12)}.wav`;
    const path = join(audioDirectory, filename);
    try {
      await writeFile(path, bytes, { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST" || !bytes.equals(await readFile(path))) throw error;
    }
    await click(state, FILE[platform], "file");
    const picker = await read(bound);
    const hasPickerFocus = lines(picker).some(line => PICKER_NAME.test(line)) &&
      /文件名/u.test(picker.accessibility?.focused_element ?? "");
    if (!hasPickerFocus && !await confirmModal?.(bound, "文件名")) throw new Error("File picker could not be identified");
    if (!hasPickerFocus) await sky.press_key({ window: bound, key: "Alt_L+n" });
    await sky.type_text({ window: bound, text: path });
    const filled = await read(bound);
    if (!lines(filled).some(line => line.includes(path)) && !await confirmModal?.(bound, filename)) {
      throw new Error("Attachment path not verified");
    }
    await sky.press_key({ window: bound, key: "Return" });
    let prepared;
    for (let attempt = 0; attempt < 5; attempt++) {
      await wait(250);
      try {
        prepared = await current(bound, recipient);
        if (lines(prepared).some(line => line.includes(filename))) break;
      } catch {
        // The native picker may still be closing. Do not send while the
        // original chat and attachment preview are unavailable.
      }
    }
    if (!prepared) throw new Error("The chat did not return after choosing a file");
    const draft = lines(prepared);
    if (draft.filter(line => line.includes(filename)).length === 0) throw new Error("Attachment preview not verified");
    if (platform === "qq") {
      if (!draft.some(line => /发送给\s*我的手机/u.test(line))) throw new Error("QQ attachment recipient not verified");
      await click(prepared, QQ_FILE_SEND, "file-confirm");
    } else {
      await click(prepared, SEND, "send");
    }
    return verifyHistory(bound, recipient, filename);
  }

  return { verify, send };
}
