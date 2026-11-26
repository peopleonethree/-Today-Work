// The caller reads both WeChat IDs from the profile cards at the start of a batch.
// Discard the binding on sign-out, account change or client restart.
export function bindWeChatSession({ mobileAccount, desktopAccount, window, recipient }) {
  const account = mobileAccount?.trim();
  if (!account || account !== desktopAccount?.trim()) {
    throw new Error("手机和电脑微信号未核对一致");
  }
  if (!window?.id || !window.app || !recipient?.trim()) {
    throw new Error("缺少已核对的微信窗口或收件人");
  }
  const { id, app } = window;
  const chat = recipient.trim();
  return async function resolveForSend(client) {
    const matches = (await client.list_windows()).filter(w => w.id === id && w.app === app);
    if (matches.length !== 1) throw new Error("已核对的微信窗口不可用，请重新比对账号");
    const options = { window: matches[0], include_text: true, include_screenshot: false };
    let state;
    try {
      state = await client.get_window_state(options);
    } catch (error) {
      if (!/window is minimized/i.test(error.message) || !client.activate_window) throw error;
      await client.activate_window({window: matches[0]});
      await new Promise(resolve => setTimeout(resolve, 500));
      const window = await client.get_window?.({id, app});
      if (!window || window.id !== id || window.app !== app) throw error;
      state = await client.get_window_state({...options, window});
    }
    if (state.window?.id !== id || state.window.app !== app) {
      throw new Error("读取到的聊天窗口与已核对的微信窗口不一致");
    }
    const tree = state.accessibility?.tree ?? "";
    const headers = tree.split(/\r?\n/).map(line => line.trim().match(
      /^\d+ text \([^)]*\) (.+?) ID: content_view\.top_content_view\.title_h_view\.[\w.]*\.current_chat_name_label$/u
    )).filter(Boolean).map(match => match[1]);
    if (!headers.length || headers.some(title => title !== chat)) {
      throw new Error("当前聊天标题与指定收件人不一致或不可读");
    }
    return state.window;
  };
}
