import assert from "node:assert/strict";
import test from "node:test";
import {makeRelayWindowVisible} from "./desktop-relay-run.mjs";

test("a clipped maximize button falls back to the title bar and verifies restored controls", async () => {
  const window = {id:1};
  let maximized = false;
  let fallbackClicked = false;
  const sky = {
    async activate_window() {},
    async get_window_state({ include_screenshot }) {
      return {
        accessibility: {tree: maximized ? "20 button (按钮) (settable, string) 还原" : "12 button (按钮) 最大化"},
        screenshots: include_screenshot ? [{id:"window",width:812,height:641}] : [],
      };
    },
    async click(input) {
      if (input.element_index === 12) throw new Error("coordinate input geometry is unavailable");
      assert.equal(input.screenshotId, "window");
      assert.equal(input.click_count, 2);
      fallbackClicked = true;
      maximized = true;
    },
  };
  await makeRelayWindowVisible(sky, window);
  assert.equal(fallbackClicked, true);
});

test("already maximized QQ does not click anything", async () => {
  await makeRelayWindowVisible({
    activate_window: async () => {},
    get_window_state: async () => ({accessibility:{tree:"191 button (按钮) 撤销最大化"}}),
    click: () => assert.fail(),
  }, {id:2});
});
