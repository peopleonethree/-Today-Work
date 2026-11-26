import { DatabaseSync } from "node:sqlite";

// A claim is written before calling the desktop client. An interrupted claim
// stays visible for reconciliation and cannot be replayed automatically.
export function openRelayQueue(filename) {
  const db = new DatabaseSync(filename, { timeout: 4000 });
  db.exec(`
    CREATE TABLE IF NOT EXISTS relay_parts (
      job_id TEXT NOT NULL, part TEXT NOT NULL,
      status TEXT NOT NULL, changed_at INTEGER NOT NULL,
      PRIMARY KEY (job_id, part)
    )
  `);
  return {
    close: () => db.close(),
    ready(now) {
      const rows = db.prepare(`
        SELECT id, payload FROM jobs WHERE due_at <= ? ORDER BY due_at, id
      `).all(now);
      return rows.map(row => JSON.parse(row.payload));
    },
    state(id, part) {
      return db.prepare("SELECT status FROM relay_parts WHERE job_id = ? AND part = ?")
        .get(id, part)?.status;
    },
    claim(id, part, now) {
      return db.prepare("INSERT OR IGNORE INTO relay_parts VALUES (?, ?, 'submitting', ?)")
        .run(id, part, now).changes === 1;
    },
    finish(id, part, status, now) {
      db.prepare(`
        UPDATE relay_parts SET status = ?, changed_at = ?
        WHERE job_id = ? AND part = ? AND status = 'submitting'
      `).run(status, now, id, part);
    },
  };
}

const TEST_DESTINATIONS = { qq: "我的手机", wechat: "文件传输助手" };

export async function dispatchDue(queue, clients, { clock = Date.now } = {}) {
  const report = [];
  for (const job of queue.ready(clock())) {
    const { id, plan } = job;
    if (!/^[a-f0-9]{32}$/.test(id) || TEST_DESTINATIONS[plan.platform] !== plan.recipient) continue;
    const client = clients[plan.platform];
    if (!client) continue;
    for (const part of ["text", "audio"]) {
      if (!plan[part]) continue;
      const previous = queue.state(id, part);
      if (previous === "submitted") continue;
      // A second worker or a prior crash may already have submitted this part.
      if (previous) break;
      let bound;
      try {
        bound = await client.verify(plan.recipient);
      } catch {
        report.push({ id, part, status: "waiting-for-client" });
        break;
      }
      if (!queue.claim(id, part, clock())) break;
      let status = "needs-review";
      try {
        if (await client.send(bound, job, part) === true) status = "submitted";
      } catch {
        // The desktop action may already have happened. Preserve the claim.
      }
      queue.finish(id, part, status, clock());
      report.push({ id, part, status });
      if (status !== "submitted") break;
    }
  }
  return report;
}
