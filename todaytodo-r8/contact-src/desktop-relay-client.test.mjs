import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDesktopRelayClient } from "./desktop-relay-client.mjs";

for (const [platform, recipient] of [["wechat", "文件传输助手"], ["qq", "我的手机"]]) {
  test(`${platform} adapter verifies the editor and submits text and the selected WAV`, async t => {
    const storage = await mkdtemp(join(tmpdir(), "todaytodo-relay-client-"));
    t.after(() => rm(storage, { recursive: true }));
    const bound = {id: 1, app: platform};
    const id = "a".repeat(32);
    const audioFile = `TodayTodo-${id.slice(0, 12)}.wav`;
    const audioPath = join(storage, audioFile);
    const wav = Buffer.alloc(44);
    wav.write("RIFF");
    wav.write("WAVE", 8);
    const job = {id, plan: {recipient, text: "TEST-UNIQUE", audio: `data:audio/wav;base64,${wav.toString("base64")}`}};
    let draft = "", picker = false, path = "", attachment = false, sends = 0, failNextSend = false;
    const history = [];
    const sky = {
      async get_window_state() {
        const file = platform === "qq" ? "文件" : "发送文件";
        const controls = ["5 button (按钮) " + file, "6 button (按钮) 发送"];
        if (picker) controls.push("7 edit (编辑) 文件名 " + path);
        if (attachment) controls.push("8 text (文本) " + audioFile);
        if (attachment && platform === "qq") controls.push("9 text (文本) 发送给 我的手机", "10 button (按钮) 发送(1)");
        if (draft) controls.push("11 text field (编辑) " + draft + " ID: chat_input_field");
        for (const value of history) controls.push("12 text (文本) " + value);
        return {window:bound, draft, accessibility:{
          tree:controls.join("\n"),
          focused_element:picker ? "7 edit (编辑) 文件名" : "11 text field (编辑) ID: chat_input_field",
        }};
      },
      async click({element_index}) {
        if (element_index === 5) picker = true;
        if (element_index === 6 || element_index === 10) {
          sends++;
          history.push((attachment ? audioFile : draft) + (failNextSend ? " 发送失败" : ""));
          draft = "";
          attachment = false;
        }
      },
      async type_text({text}) { if (picker) path = text; else draft = text; },
      async press_key() { assert.equal(path,audioPath); picker = false; attachment = true; },
    };
    const client = createDesktopRelayClient({
      sky, platform, audioDirectory:storage, focusEditor:async () => {},
      resolveWindow:async target => (assert.equal(target,recipient),bound),
      readDraft:state => state.draft,
    });
    assert.equal(await client.send(bound,job,"text"),true);
    assert.equal(await client.send(bound,job,"audio"),true);
    assert.deepEqual(await readFile(audioPath),wav);
    assert.equal(sends,2);
    draft = "existing draft";
    await assert.rejects(client.send(bound,job,"text"));
    assert.equal(sends,2);
    draft = "";
    failNextSend = true;
    await assert.rejects(client.send(bound,{ ...job, plan:{...job.plan,text:"FAIL-UNIQUE"} },"text"), /send failure/);
  });
}
