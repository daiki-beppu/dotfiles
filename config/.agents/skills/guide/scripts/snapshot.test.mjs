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

const build = (issues, reactions = [{ emoji: "✅", userId: "U1" }], pullRequests = [], fromSpec) => {
  const reads = [];
  const read = createReadSnapshot({
    repo: "o/r", viewer: VIEWER, discordUserId: "U1", fromSpec,
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

test("fromSpec: 指定した番号をそのままスナップショットに入れ、無ければ undefined", async () => {
  assert.equal((await build([issue(12)], undefined, [], 30).read()).fromSpec, 30);
  assert.equal((await build([issue(12)]).read()).fromSpec, undefined);
});

// ---- 起動した工程のセッションの観測 ----

const T0 = "2026-10-17T00:00:00.000Z";
const NOW = new Date("2026-10-17T00:30:00.000Z");
const launched = (step, handle, at = T0) => ({ author: VIEWER, body: `案内役: ${step} を起動した（ターミナル ${handle} / ${at}）` });

const buildObserved = (issues, { pullRequests = [], observe, stallMinutes } = {}) => {
  const observed = [];
  const read = createReadSnapshot({
    repo: "o/r", viewer: VIEWER, discordUserId: "U1",
    github: { readIssues: () => issues, readPullRequests: () => pullRequests },
    discord: { readReactions: async () => [] },
    taktTasks: () => [],
    now: () => NOW,
    stallMinutes,
    observeSession: (arg) => { observed.push(arg.handle); return observe ? observe(arg) : { found: true, waiting: false, idle: true, tail: ["t"] }; },
  });
  return { read, observed };
};

test("sessions: 起動の印の handle ごとに観測を入れ、startedAt は印の時刻、now は注入した時刻の ISO 8601、stallMinutes も入れる", async () => {
  const { read, observed } = buildObserved([issue(12, { comments: [...sent, launched("to-tickets", "term_1")] })], { stallMinutes: 45 });
  const snap = await read();
  assert.deepEqual(observed, ["term_1"]);
  assert.deepEqual(snap.sessions, { term_1: { found: true, waiting: false, idle: true, startedAt: T0, tail: ["t"] } });
  assert.equal(snap.now, NOW.toISOString());
  assert.equal(snap.stallMinutes, 45);
});

test("sessions: 見つからない観測（found: false）も入れる。観測の取得が失敗したら例外にする", async () => {
  const gone = buildObserved([issue(12, { comments: [...sent, launched("to-tickets", "term_1")] })], { observe: () => ({ found: false, waiting: false, idle: false, tail: [] }) });
  assert.equal((await gone.read()).sessions.term_1.found, false);
  const failing = buildObserved([issue(12, { comments: [...sent, launched("to-tickets", "term_1")] })], { observe: () => { throw new Error("orca down"); } });
  await assert.rejects(failing.read(), /orca down/);
});

test("sessions: handle の無い印・結果が出た工程・承認依頼を送る前の仕様は観測しない（orca を呼ばない）", async () => {
  const legacy = { author: VIEWER, body: "案内役: to-tickets を起動した" };
  const parent = issue(20, { labels: [], body: "仕様: #12", subIssues: [{ number: 21, state: "OPEN" }] });
  const pr = [{ number: 50, state: "OPEN", author: VIEWER, body: "学びの元の仕様: #13", autoMerge: true }];
  const { read, observed } = buildObserved(
    [
      issue(12, { comments: [...sent, launched("to-tickets", "term_done")] }),
      parent,
      issue(13, { comments: [...sent, launched("knowledge", "term_pr")] }),
      issue(14, { comments: [...sent, legacy] }),
      issue(15, { comments: [{ author: VIEWER, body: SENDING }, launched("to-tickets", "term_unsent")] }),
    ],
    { pullRequests: pr },
  );
  const snap = await read();
  assert.deepEqual(observed, []);
  assert.deepEqual(snap.sessions, {});
});

test("sessions: 観測すべき工程が無くても now と空の sessions を返す（既存の呼び出しが observeSession なしでも壊れない）", async () => {
  const read = createReadSnapshot({
    repo: "o/r", viewer: VIEWER, discordUserId: "U1",
    github: { readIssues: () => [issue(12)], readPullRequests: () => [] },
    discord: { readReactions: async () => [] },
    taktTasks: () => [],
  });
  const snap = await read();
  assert.deepEqual(snap.sessions ?? {}, {});
});

test("sessions: takt-sequence の起動の印（handle つき）がある親で、渡した sub-issue が open なら、そのタブも観測する。古い形の親と、閉じきった親は観測しない", async () => {
  const handed = (...n) => ({ author: VIEWER, body: `案内役: takt-sequence に渡した ${n.map((x) => `#${x}`).join(" ")}` });
  const { read, observed } = buildObserved([
    issue(12, { comments: sent }),
    issue(20, { labels: [], body: "仕様: #12", comments: [handed(21), launched("takt-sequence", "term_seq")], subIssues: [{ number: 21, state: "OPEN" }] }),
    issue(30, { labels: [], body: "仕様: #12", comments: [handed(31)], subIssues: [{ number: 31, state: "OPEN" }] }),
    issue(40, { labels: [], body: "仕様: #12", comments: [handed(41), launched("takt-sequence", "term_closed")], subIssues: [{ number: 41, state: "CLOSED" }] }),
  ]);
  const snap = await read();
  assert.deepEqual(observed, ["term_seq"]);
  assert.deepEqual(snap.sessions, { term_seq: { found: true, waiting: false, idle: true, startedAt: T0, tail: ["t"] } });
});

// ---- wayfinder の ticket のセッションの観測 ----

const MT_CREATED = { author: VIEWER, body: "案内役: Discord に map のスレッドを立てた（スレッド 900）" };
const ticketIssue = (number, over = {}) =>
  issue(number, { labels: ["wayfinder:research"], assignees: [VIEWER], blockedBy: [], comments: [launched("wayfinder", "term_t")], ...over });
const mapIssue = (children, over = {}) =>
  issue(20, { labels: ["wayfinder:map"], comments: [MT_CREATED], subIssues: children.map((c) => ({ number: c.number, state: c.state })), ...over });

test("sessions: 起動の印（handle つき）がある open な wayfinder の ticket のセッションを、既存の observeSession で観測して入れる", async () => {
  const ticket = ticketIssue(21);
  const { read, observed } = buildObserved([mapIssue([ticket]), ticket]);
  const snap = await read();
  assert.deepEqual(observed, ["term_t"]);
  assert.deepEqual(snap.sessions, { term_t: { found: true, waiting: false, idle: true, startedAt: T0, tail: ["t"] } });
});

test("sessions: ticket の観測が失敗したら例外にする。見つからない観測（found: false）は入れる", async () => {
  const ticket = ticketIssue(21);
  const gone = buildObserved([mapIssue([ticket]), ticket], { observe: () => ({ found: false, waiting: false, idle: false, tail: [] }) });
  assert.equal((await gone.read()).sessions.term_t.found, false);
  const failing = buildObserved([mapIssue([ticket]), ticket], { observe: () => { throw new Error("orca down"); } });
  await assert.rejects(failing.read(), /orca down/);
});

test("sessions: 閉じた ticket・判断依頼の印が map にある ticket・起動前の印だけの ticket・閉じた map の子は観測しない（orca を呼ばない）", async () => {
  const closed = ticketIssue(21, { state: "CLOSED" });
  const decided = ticketIssue(22);
  const prelaunch = ticketIssue(23, { comments: [{ author: VIEWER, body: "案内役: wayfinder を起動する" }] });
  const underClosed = ticketIssue(41);
  const decision = { author: VIEWER, body: "案内役: Discord に判断依頼を送る（#22 research のセッションの停止）" };
  const { read, observed } = buildObserved([
    mapIssue([closed, decided, prelaunch], { comments: [MT_CREATED, decision] }),
    mapIssue([underClosed], { number: 40, state: "CLOSED" }),
    closed, decided, prelaunch, underClosed,
  ]);
  const snap = await read();
  assert.deepEqual(observed, []);
  assert.deepEqual(snap.sessions, {});
});

test("sessions: 仕様の工程と wayfinder の ticket が同じ周にあれば、両方の handle を観測する", async () => {
  const ticket = ticketIssue(21);
  const { read, observed } = buildObserved([issue(12, { comments: [...sent, launched("to-tickets", "term_1")] }), mapIssue([ticket]), ticket]);
  await read();
  assert.deepEqual([...observed].sort(), ["term_1", "term_t"]);
});
