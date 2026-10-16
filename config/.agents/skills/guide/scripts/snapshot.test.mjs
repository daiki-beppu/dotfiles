// snapshot.mjs のテスト。GitHub・Discord は偽物。
import assert from "node:assert/strict";
import { test } from "node:test";
import { createReadSnapshot } from "./snapshot.mjs";

const VIEWER = "me";
const SENDING = "案内役: Discord に承認依頼を送る";
const SENT = "案内役: Discord に承認依頼を送った（スレッド 555 / メッセージ 777）";
const issue = (number, over = {}) => ({ number, title: "t", state: "OPEN", labels: ["spec"], body: "", comments: [], subIssues: [], ...over });
const sent = [{ author: VIEWER, body: SENDING }, { author: VIEWER, body: SENT }];

const TASKS = [
  { issue: 3, kind: "failed", createdAt: "2026-10-16T10:00:00Z", step: "implement", error: "blocked", worktreePath: "/w/3" },
  { issue: 4, kind: "running", createdAt: "2026-10-16T10:00:00Z" },
];

const build = (issues, reactions = [{ emoji: "✅", userId: "U1" }], pullRequests = []) => {
  const reads = [];
  const read = createReadSnapshot({
    repo: "o/r", viewer: VIEWER, discordUserId: "U1",
    github: { readIssues: () => issues, readPullRequests: () => pullRequests },
    discord: { readReactions: async (ref) => { reads.push(ref); return reactions; } },
    taktTasks: () => TASKS,
  });
  return { read, reads };
};

test("送り済みの OPEN な仕様（承認済みでも）だけ、マーカーの ID でリアクションを読んで reactions に入れる", async () => {
  const { read, reads } = build([
    issue(12, { comments: sent }),
    issue(13),
    issue(14, { comments: [{ author: VIEWER, body: SENDING }] }),
    issue(15, { comments: sent, labels: ["spec", "spec-approved"] }),
    issue(16, { comments: sent, state: "CLOSED" }),
    issue(17, { comments: sent, labels: [] }),
    issue(18, { comments: [{ author: "someone", body: SENT }] }),
  ]);
  const snap = await read();
  assert.deepEqual(reads, [{ threadId: "555", messageId: "777" }, { threadId: "555", messageId: "777" }]);
  assert.deepEqual(snap.issues.find((i) => i.number === 12).reactions, [{ emoji: "✅", userId: "U1" }]);
  assert.deepEqual(snap.issues.find((i) => i.number === 15).reactions, [{ emoji: "✅", userId: "U1" }]);
  for (const n of [13, 14, 16, 17, 18]) assert.equal(snap.issues.find((i) => i.number === n).reactions, undefined);
  assert.equal(snap.discordUserId, "U1");
  assert.deepEqual(snap.taktIssues, [3, 4]);
  assert.deepEqual(snap.taktTasks, TASKS);
});

test("リアクションの取得が失敗したら例外にする", async () => {
  const read = createReadSnapshot({
    repo: "o/r", viewer: VIEWER, discordUserId: "U1",
    github: { readIssues: () => [issue(12, { comments: sent })], readPullRequests: () => [] },
    discord: { readReactions: async () => { throw new Error("Discord GET が 404"); } },
    taktTasks: () => [],
  });
  await assert.rejects(read(), /404/);
});

test("pullRequests: github.readPullRequests の結果をそのままスナップショットに入れる", async () => {
  const prs = [{ number: 50, state: "MERGED", author: VIEWER, body: "学びの元の仕様: #12" }];
  const { read } = build([issue(12)], undefined, prs);
  const snap = await read();
  assert.deepEqual(snap.pullRequests, prs);
});
