import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { dispatchDue, openRelayQueue } from "./desktop-relay-worker.mjs";

function fixture(t, platform, scheduledAt = 100) {
  const directory = mkdtempSync(join(tmpdir(), "todaytodo-relay-test-"));
  const database = join(directory, "queue.sqlite");
  const db = new DatabaseSync(database);
  db.exec("CREATE TABLE jobs (id TEXT PRIMARY KEY, due_at INTEGER, payload TEXT)");
  const id = "1".repeat(32);
  const recipient = platform === "qq" ? "我的手机" : "文件传输助手";
  db.prepare("INSERT INTO jobs VALUES (?, ?, ?)")
    .run(id, scheduledAt, JSON.stringify({ id, plan: {platform, recipient, text: "QA", audio: "WAV"} }));
  db.close();
  const queue = openRelayQueue(database);
  t.after(() => { queue.close(); rmSync(directory, { recursive: true }); });
  return { id, database, queue };
}

for (const platform of ["qq", "wechat"]) {
  test(`${platform} only runs at due time and each part is sent once`, async t => {
    const {queue} = fixture(t, platform);
    const seen = [];
    const clients = {[platform]: { verify: async () => ({}), send: async (_, __, part) => (seen.push(part), true) }};
    assert.deepEqual(await dispatchDue(queue, clients, { clock: () => 99 }), []);
    await dispatchDue(queue, clients, { clock: () => 100 });
    await dispatchDue(queue, clients, { clock: () => 200 });
    assert.deepEqual(seen, ["text", "audio"]);
  });
}

test("wrong window holds the job without marking it attempted", async t => {
  const {id, queue} = fixture(t, "wechat");
  const clients = {wechat: { verify: async () => { throw new Error("wrong account"); }, send: () => assert.fail() }};
  const [result] = await dispatchDue(queue, clients);
  assert.equal(result.status, "waiting-for-client");
  assert.equal(queue.state(id, "text"), undefined);
});

test("an ambiguous send survives a restart and is never replayed", async t => {
  const {id, queue, database} = fixture(t, "qq");
  let submits = 0;
  const clients = {qq: { verify: async () => ({}), send: async () => { submits++; throw new Error("timeout"); } }};
  await dispatchDue(queue, clients);
  const restarted = openRelayQueue(database);
  try {
    await dispatchDue(restarted, clients);
    assert.equal(restarted.state(id, "text"), "needs-review");
    assert.equal(restarted.state(id, "audio"), undefined);
    assert.equal(submits, 1);
  } finally { restarted.close(); }
});

test("two workers cannot submit the same job part", async t => {
  const {queue, database} = fixture(t, "wechat");
  const other = openRelayQueue(database);
  const sent = [];
  const clients = {wechat: { verify: async () => ({}), send: async (_, __, part) => (sent.push(part), true) }};
  try {
    await Promise.all([dispatchDue(queue, clients),dispatchDue(other, clients)]);
    assert.deepEqual(sent, ["text", "audio"]);
  } finally { other.close(); }
});
