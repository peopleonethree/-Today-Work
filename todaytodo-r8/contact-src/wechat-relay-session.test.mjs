import assert from "node:assert/strict";
import test from "node:test";
import { bindWeChatSession } from "./wechat-relay-session.mjs";

const verified = { id: 20, app: "Weixin" };
const other = { id: 10, app: "Weixin" };
const options = { mobileAccount: "fixture-a", desktopAccount: "fixture-a", window: verified, recipient: "文件传输助手" };
const resolve = bindWeChatSession(options);
const header = "93 text (文本) 文件传输助手 ID: content_view.top_content_view.title_h_view.left_ui_.big_title_line_h_view.current_chat_name_label";

function client(windows, tree, replacement) {
  return {
    list_windows: async () => windows,
    get_window_state: async ({ window }) => ({ window: replacement ?? window, accessibility: { tree } }),
  };
}

test("拒绝两端不同号或未获取到账号", () => {
  assert.throws(() => bindWeChatSession({ ...options, desktopAccount: "fixture-b" }));
  assert.throws(() => bindWeChatSession({ ...options, mobileAccount: "", desktopAccount: "" }));
});
test("两个同名会话同时打开时，只使用已经核对的账号窗口", async () => {
  assert.equal(await resolve(client([other, verified], header)), verified);
});
test("原窗口关闭后，即使另一窗口同名也停止发送", async () => {
  await assert.rejects(resolve(client([other], header)));
});
test("读取期间窗口发生变化时停止发送", async () => {
  await assert.rejects(resolve(client([verified], header, other)));
});
test("最小化时恢复窗口，再核对返回的窗口和聊天标题", async () => {
  let active = false;
  const desktop = {
    list_windows: async () => [verified],
    get_window_state: async ({window}) => {
      if (!active) throw new Error("window is minimized");
      return {window, accessibility:{tree:header}};
    },
    activate_window: async ({window}) => { assert.equal(window, verified); active = true; },
    get_window: async ({id, app}) => id === verified.id && app === verified.app ? verified : null,
  };
  assert.equal(await resolve(desktop), verified);
});
test("列表中出现目标名称不能代替当前聊天标题", async () => {
  await assert.rejects(resolve(client([verified], "61 list item (文本) 文件传输助手 ID: session_item_x")));
});
test("切换收件人或标题不唯一且相互矛盾时停止发送", async () => {
  const different = header.replace("文件传输助手", "其他聊天");
  await assert.rejects(resolve(client([verified], different)));
  await assert.rejects(resolve(client([verified], header + "\n" + different)));
});
