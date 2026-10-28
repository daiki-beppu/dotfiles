// snapshot.mjs のテスト。GitHub・Discord は偽物。
import assert from "node:assert/strict";
import { test } from "node:test";
import { closedTabMarker, decide, mainRerunMarker, NO_QUESTION, QUESTION_HEADING } from "./decide.mjs";
import { createReadSnapshot } from "./snapshot.mjs";
import { REVIEW_FAILED, fixLaunchedMarker, redoMarker } from "../../takt/scripts/review-stage.mjs";

const VIEWER = "me";
const NO_MAIN = () => ({ sha: "0".repeat(40), rules: [], checks: [], comments: [] });
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
    github: { readMain: NO_MAIN, readIssues: () => issues, readPullRequests: () => pullRequests },
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
    github: { readMain: NO_MAIN, readIssues: () => [issue(12, { comments: sent })], readPullRequests: () => [] },
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
    github: { readMain: NO_MAIN, readIssues: () => issues, readPullRequests: () => pullRequests },
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

test("sessions: handle の無い印・結果が出て閉じた工程・承認依頼を送る前の仕様は観測しない（orca を呼ばない）", async () => {
  const legacy = { author: VIEWER, body: "案内役: to-tickets を起動した" };
  const parent = issue(20, { labels: [], body: "仕様: #12", subIssues: [{ number: 21, state: "OPEN" }] });
  const pr = [{ number: 50, state: "OPEN", author: VIEWER, body: "学びの元の仕様: #13", autoMerge: true }];
  const { read, observed } = buildObserved(
    [
      issue(12, { comments: [...sent, launched("to-tickets", "term_done"), { author: VIEWER, body: closedTabMarker("to-tickets", "term_done") }] }),
      parent,
      issue(13, { comments: [...sent, launched("knowledge", "term_pr"), { author: VIEWER, body: closedTabMarker("knowledge", "term_pr") }] }),
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
    github: { readMain: NO_MAIN, readIssues: () => [issue(12)], readPullRequests: () => [] },
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
    issue(40, { labels: [], body: "仕様: #12", comments: [handed(41), launched("takt-sequence", "term_closed"), { author: VIEWER, body: closedTabMarker("takt-sequence", "term_closed") }], subIssues: [{ number: 41, state: "CLOSED" }] }),
  ]);
  const snap = await read();
  assert.deepEqual(observed, ["term_seq"]);
  assert.deepEqual(snap.sessions, { term_seq: { found: true, waiting: false, idle: true, startedAt: T0, tail: ["t"] } });
});

test("sessions: 結果が出て閉じた印が無い工程のタブも観測する（閉じるかどうかを見るため）。閉じた印があれば観測しない", async () => {
  const parent = issue(20, { labels: [], body: "仕様: #12", subIssues: [{ number: 21, state: "OPEN" }] });
  const { read, observed } = buildObserved([issue(12, { comments: [...sent, launched("to-tickets", "term_done")] }), parent]);
  assert.deepEqual((await read(), observed), ["term_done"]);
  const closed = { author: VIEWER, body: closedTabMarker("to-tickets", "term_done") };
  const after = buildObserved([issue(12, { comments: [...sent, launched("to-tickets", "term_done"), closed] }), parent]);
  await after.read();
  assert.deepEqual(after.observed, []);
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

test("sessions: タブを閉じた ticket・判断依頼の印が map にある ticket・起動前の印だけの ticket・閉じた map の子は観測しない（orca を呼ばない）", async () => {
  const closed = ticketIssue(21, { state: "CLOSED", comments: [launched("wayfinder", "term_t"), { author: VIEWER, body: closedTabMarker("wayfinder", "term_t") }] });
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

test("sessions: 閉じた ticket の、閉じた印が無いタブは観測する（閉じるかどうかを見るため）", async () => {
  const ticket = ticketIssue(21, { state: "CLOSED" });
  const { read, observed } = buildObserved([mapIssue([ticket]), ticket]);
  assert.deepEqual((await read(), observed), ["term_t"]);
});

test("sessions: 仕様の工程と wayfinder の ticket が同じ周にあれば、両方の handle を観測する", async () => {
  const ticket = ticketIssue(21);
  const { read, observed } = buildObserved([issue(12, { comments: [...sent, launched("to-tickets", "term_1")] }), mapIssue([ticket]), ticket]);
  await read();
  assert.deepEqual([...observed].sort(), ["term_1", "term_t"]);
});

// ---- to-spec のセッションの観測（map に書かれた起動後の印の handle） ----

const clearMap = (comments, over = {}) =>
  issue(20, { labels: ["wayfinder:map"], body: "## Not yet specified\n", comments, subIssues: [{ number: 21, state: "CLOSED" }], ...over });
const closedTicket = issue(21, { state: "CLOSED", labels: ["wayfinder:research"], assignees: [VIEWER], blockedBy: [] });

test("sessions: map に起動後の印がある to-spec のセッションを、既存の observeSession で観測して入れる", async () => {
  const { read, observed } = buildObserved([clearMap([MT_CREATED, launched("to-spec", "term_s")]), closedTicket]);
  const snap = await read();
  assert.deepEqual(observed, ["term_s"]);
  assert.deepEqual(snap.sessions, { term_s: { found: true, waiting: false, idle: true, startedAt: T0, tail: ["t"] } });
});

test("sessions: to-spec の観測が失敗したら例外にする。見つからない観測（found: false）は入れる", async () => {
  const issues = [clearMap([MT_CREATED, launched("to-spec", "term_s")]), closedTicket];
  const gone = buildObserved(issues, { observe: () => ({ found: false, waiting: false, idle: false, tail: [] }) });
  assert.equal((await gone.read()).sessions.term_s.found, false);
  const failing = buildObserved(issues, { observe: () => { throw new Error("orca down"); } });
  await assert.rejects(failing.read(), /orca down/);
});

test("sessions: 結果の仕様ができた map の、閉じた印が無い to-spec のタブは観測する（閉じるかどうかを見るため）", async () => {
  const done = clearMap([launched("to-spec", "term_s")], { number: 40 });
  const result = issue(50, { labels: ["spec"], body: "概要\n元の map: #40" });
  const { read, observed } = buildObserved([done, result, closedTicket]);
  assert.deepEqual((await read(), observed), ["term_s"]);
});

test("sessions: 起動前の印だけの map・結果の仕様ができてタブを閉じた map・保留の map は to-spec を観測しない（orca を呼ばない）", async () => {
  const prelaunch = clearMap([{ author: VIEWER, body: "案内役: to-spec を起動する" }]);
  const done = clearMap([launched("to-spec", "term_s"), { author: VIEWER, body: closedTabMarker("to-spec", "term_s") }], { number: 40 });
  const result = issue(50, { labels: ["spec"], body: "概要\n元の map: #40" });
  const hold = clearMap([launched("to-spec", "term_h")], { number: 60, labels: ["wayfinder:map", "wayfinder:on-hold"] });
  const { read, observed } = buildObserved([prelaunch, done, result, hold, closedTicket]);
  await read();
  assert.deepEqual(observed, []);
});

// ---- grilling の判断依頼への返信の読み取り ----

const G_SENT = (t, message, thread = "T900") => ({ author: VIEWER, body: `案内役: Discord に判断依頼を送った（#${t} grilling の問い 1760000000000 / スレッド ${thread} / メッセージ ${message}）` });
const G_WRITTEN = (t) => ({ author: VIEWER, body: `案内役: Discord の回答を書き戻した（#${t} grilling の問い 1760000000000）\n\n答え` });
const grillingTicket = (number, over = {}) => ticketIssue(number, { labels: ["wayfinder:grilling"], ...over });

const buildReplies = (issues, { readReplies = async () => [] } = {}) => {
  const reads = [];
  const commentsOf = (n) => issues.find((i) => i.number === n).comments;
  const read = createReadSnapshot({
    repo: "o/r", viewer: VIEWER, discordUserId: "U1",
    github: { readMain: NO_MAIN, readIssues: () => issues, readPullRequests: () => [], readComments: commentsOf },
    discord: { readReactions: async () => [], readReplies: async (ref) => { reads.push(ref); return readReplies(ref); } },
    taktTasks: () => [],
    now: () => NOW,
    observeSession: () => ({ found: true, waiting: true, waitSource: "hook", waitSince: "1760000000000", idle: false, tail: ["t"] }),
  });
  return { read, reads };
};

test("decisionReplies: 判断依頼を送り済みで書き戻し前の grilling ticket だけ、スレッドとメッセージの ID で返信を読み、メッセージの ID をキーに入れる", async () => {
  const replies = [{ userId: "U1", content: "B 案" }];
  const waiting = grillingTicket(21, { comments: [launched("wayfinder", "term_t"), G_SENT(21, "M1")] });
  const written = grillingTicket(22, { comments: [launched("wayfinder", "term_t"), G_SENT(22, "M2"), G_WRITTEN(22)] });
  const unsent = grillingTicket(23);
  const research = ticketIssue(24, { comments: [launched("wayfinder", "term_t"), G_SENT(24, "M4")] });
  const { read, reads } = buildReplies([mapIssue([waiting, written, unsent, research]), waiting, written, unsent, research], { readReplies: async () => replies });
  const snap = await read();
  assert.deepEqual(reads, [{ threadId: "T900", messageId: "M1" }]);
  assert.deepEqual(snap.decisionReplies, { M1: replies });
});

test("decisionReplies: 読む対象が無ければ返信を読まず（discord を呼ばない）、空にする", async () => {
  const ticket = grillingTicket(21);
  const { read, reads } = buildReplies([mapIssue([ticket]), ticket]);
  const snap = await read();
  assert.deepEqual(reads, []);
  assert.deepEqual(snap.decisionReplies ?? {}, {});
});

test("decisionReplies: 返信の取得が失敗したら例外にする（リアクションと同じ。黙って空にしない）", async () => {
  const ticket = grillingTicket(21, { comments: [launched("wayfinder", "term_t"), G_SENT(21, "M1")] });
  const { read } = buildReplies([mapIssue([ticket]), ticket], { readReplies: async () => { throw new Error("Discord GET が 500"); } });
  await assert.rejects(read(), /500/);
});

test("sessions: 判断依頼の停止の印が map にある grilling ticket も、後の hook の入力待ちを見るために観測し、waitSource・waitSince を保つ", async () => {
  const ticket = grillingTicket(22);
  const decision = { author: VIEWER, body: "案内役: Discord に判断依頼を送る（#22 grilling のセッションの停止）" };
  const { read, reads } = buildReplies([mapIssue([ticket], { comments: [MT_CREATED, decision] }), ticket]);
  const snap = await read();
  assert.deepEqual(snap.sessions.term_t, { found: true, waiting: true, waitSource: "hook", waitSince: "1760000000000", idle: false, startedAt: T0, tail: ["t"] });
  assert.deepEqual(reads, []);
});

// ---- hook の入力待ちの観測の後で、ticket のコメントを読み直す ----

const G_QUESTION = (text) => ({ author: VIEWER, body: `${QUESTION_HEADING}\n${text}` });
const S1 = "1760000000000";
const buildRefresh = (ticket, { later, readComments, waitSince = S1 }) => {
  const stale = [...ticket.comments];
  const latest = [...stale, ...later];
  const calls = [];
  const read = createReadSnapshot({
    repo: "o/r", viewer: VIEWER, discordUserId: "U1",
    github: { readMain: NO_MAIN,
      readIssues: () => [mapIssue([ticket]), { ...ticket, comments: stale }],
      readPullRequests: () => [],
      readComments: readComments ?? ((n) => { calls.push(n); return latest; }),
    },
    discord: { readReactions: async () => [], readReplies: async () => [] },
    taktTasks: () => [],
    now: () => NOW,
    observeSession: () => ({ found: true, waiting: true, waitSource: "hook", waitSince, idle: false, tail: ["t"] }),
  });
  return { read, calls };
};
const requestOf = (snap) => decide(snap).find((a) => a.kind === "request-grilling-decision");

test("refresh: 最初の読み取りの後、観測の前に書かれた1件目の問いを、判断依頼の question に入れる", async () => {
  const { read, calls } = buildRefresh(grillingTicket(21), { later: [G_QUESTION("新しい問い")] });
  const snap = await read();
  assert.deepEqual(calls, [21]);
  assert.equal(requestOf(snap).question, "新しい問い");
});

test("refresh: 前の問いと前の停止の印があっても、新しい問いを入れる（古い問いは入れない）", async () => {
  const S0 = "1750000000000";
  const old = [
    launched("wayfinder", "term_t"), G_QUESTION("古い問い"),
    { author: VIEWER, body: `案内役: Discord に判断依頼を送る（#21 grilling の問い ${S0}）` },
    { ...G_SENT(21, "M0"), body: G_SENT(21, "M0").body.replace("1760000000000", S0) },
    { author: VIEWER, body: `案内役: Discord の回答を書き戻した（#21 grilling の問い ${S0}）\n\n答え` },
    { author: VIEWER, body: `案内役: 回答をタブに流し込む（#21 grilling の問い ${S0}）` },
  ];
  const { read } = buildRefresh(grillingTicket(21, { comments: old }), { later: [G_QUESTION("新しい問い")] });
  const question = requestOf(await read()).question;
  assert.equal(question, "新しい問い");
  assert.notEqual(question, NO_QUESTION);
});

test("refresh: 送り済みの停止の grilling と、hook の入力待ちの research では読み直さない。印の無い grilling では1回読み直す", async () => {
  const sentTicket = grillingTicket(21, { comments: [launched("wayfinder", "term_t"), G_SENT(21, "M1")] });
  const sentRun = buildRefresh(sentTicket, { later: [] });
  await sentRun.read();
  assert.deepEqual(sentRun.calls, []);
  const research = buildRefresh(ticketIssue(22), { later: [] });
  await research.read();
  assert.deepEqual(research.calls, []);
  const fresh = buildRefresh(grillingTicket(23), { later: [] });
  await fresh.read();
  assert.deepEqual(fresh.calls, [23]);
});

test("refresh: 読み直しの取得が失敗したら例外にする", async () => {
  const { read } = buildRefresh(grillingTicket(21), { later: [], readComments: () => { throw new Error("gh が 502"); } });
  await assert.rejects(read(), /502/);
});

// ---- 仮決めの差し戻しのリアクションの読み取り ----

const PD_SENT_C = (t, n, message, thread = "T900") => ({ author: VIEWER, body: `案内役: Discord に仮決めを流した（#${t} 仮決め ${n} / スレッド ${thread} / メッセージ ${message}）` });
const PD_REJECTED_C = (t, n) => ({ author: VIEWER, body: `案内役: Discord で仮決めが差し戻された（#${t} 仮決め ${n}）\n\n- 問い: q\n- 答え: a` });
const pdTicket = (number, over = {}) => ticketIssue(number, { state: "CLOSED", labels: ["wayfinder:grilling"], assignees: [], comments: [], ...over });

const buildReactions = (issues, { readReactions } = {}) => {
  const reads = [];
  const read = createReadSnapshot({
    repo: "o/r", viewer: VIEWER, discordUserId: "U1",
    github: { readMain: NO_MAIN, readIssues: () => issues, readPullRequests: () => [], readComments: (n) => issues.find((i) => i.number === n).comments },
    discord: { readReactions: async (ref) => { reads.push(ref); return readReactions ? readReactions(ref) : []; }, readReplies: async () => [] },
    taktTasks: () => [],
    now: () => NOW,
    observeSession: () => ({ found: true, waiting: false, idle: true, tail: ["t"] }),
  });
  return { read, reads };
};

test("provisionalReactions: 閉じた ticket の、流した印があり書き戻し前の仮決めだけ、スレッドとメッセージの ID でリアクションを読み、メッセージの ID をキーに入れる", async () => {
  const mine = [{ emoji: "❌", userId: "U1" }];
  const pending = pdTicket(21, { comments: [PD_SENT_C(21, 1, "M1"), PD_SENT_C(21, 2, "M2"), PD_REJECTED_C(21, 2)] });
  const open = pdTicket(22, { state: "OPEN", comments: [PD_SENT_C(22, 1, "M3")] });
  const unsent = pdTicket(23);
  const { read, reads } = buildReactions([mapIssue([pending, open, unsent]), pending, open, unsent], { readReactions: async () => mine });
  const snap = await read();
  assert.deepEqual(reads, [{ threadId: "T900", messageId: "M1" }]);
  assert.deepEqual(snap.provisionalReactions, { M1: mine });
});

test("provisionalReactions: 読む対象が無ければ discord を呼ばず空にする。取得が失敗したら例外にする（黙って空にしない）", async () => {
  const none = pdTicket(21);
  const a = buildReactions([mapIssue([none]), none]);
  const snap = await a.read();
  assert.deepEqual(a.reads, []);
  assert.deepEqual(snap.provisionalReactions ?? {}, {});
  const pending = pdTicket(21, { comments: [PD_SENT_C(21, 1, "M1")] });
  const b = buildReactions([mapIssue([pending]), pending], { readReactions: async () => { throw new Error("Discord GET が 500"); } });
  await assert.rejects(b.read(), /500/);
});

test("provisionalReactions: 読んだ本人の ❌ から、decide が書き戻しと開き直しの行動を 1 件出す（読み取りから判定までの配線）", async () => {
  const pending = pdTicket(21, { comments: [PD_SENT_C(21, 1, "M1")] });
  const { read } = buildReactions([mapIssue([pending]), pending], { readReactions: async () => [{ emoji: "❌", userId: "U1" }] });
  const actions = decide(await read()).filter((a) => a.kind === "reject-provisional-decision");
  assert.equal(actions.length, 1);
  assert.equal(actions[0].ticket, 21);
});

// ---- takt のレビューが失敗した PR（review-fix）の読み取り ----

const RF_HEAD = "a".repeat(40);
const prRow = (number, state = "OPEN", over = {}) => ({ number, state, author: VIEWER, body: "", autoMerge: false, head: RF_HEAD, headBranch: `feat/${number}`, ...over });
const taskOf = (issueNumber, pr, over = {}) => ({ issue: issueNumber, kind: "completed", createdAt: "2026-10-17T00:00:00Z", prUrl: pr === undefined ? undefined : `https://github.com/o/r/pull/${pr}`, ...over });
const handedFor = (...n) => ({ author: VIEWER, body: `案内役: takt-sequence に渡した ${n.map((x) => `#${x}`).join(" ")}` });
const MERGE = { prNumber: 70, kind: "failed", createdAt: "2026-10-17T00:30:00Z", initialHead: RF_HEAD, pushedHead: null, reports: "/repo/.takt/runs/run-1" };

// 仕様 #12 の親 #20 が #21 #22 #23 を渡して起動済み。#21 は PR #70 が OPEN、#22 は PR なし、#23 は PR #71 が CLOSED。
// #30 は渡していない issue で、PR #80 が OPEN。読み取りの回数は reads と merges に記録する。
const reviewWorld = ({ tasks, prs, mergeRows = [MERGE] } = {}) => {
  const reads = { comments: [], merges: 0 };
  const issues = [
    issue(12, { comments: sent }),
    issue(20, { labels: [], body: "仕様: #12", comments: [handedFor(21, 22, 23), launched("takt-sequence", "term_seq")], subIssues: [21, 22, 23].map((number) => ({ number, state: "OPEN" })) }),
    issue(21, { labels: [] }), issue(22, { labels: [] }), issue(23, { labels: [] }), issue(30, { labels: [] }),
  ];
  const read = createReadSnapshot({
    repo: "o/r", viewer: VIEWER, discordUserId: "U1",
    github: { readMain: NO_MAIN,
      readIssues: () => issues,
      readPullRequests: () => prs ?? [prRow(70), prRow(71, "CLOSED"), prRow(80)],
      readComments: (n) => { reads.comments.push(n); return [{ author: VIEWER, body: `TAKT evaluation failed for head ${RF_HEAD}: x` }]; },
    },
    discord: { readReactions: async () => [] },
    taktTasks: () => tasks ?? [taskOf(21, 70), taskOf(22), taskOf(23, 71), taskOf(30, 80)],
    mergeTasks: async () => { reads.merges += 1; return mergeRows; },
    observeSession: async () => ({ found: true, waiting: false, idle: true, tail: [] }),
    now: () => new Date(T0),
  });
  return { read, reads };
};

test("reviewPullRequests: 渡した sub-issue の OPEN な PR だけを読み、番号・state・head・head ブランチ・コメントを入れる。merge タスクの記録も入れる", async () => {
  const { read, reads } = reviewWorld();
  const snap = await read();
  assert.deepEqual(snap.reviewPullRequests, [
    { spec: 12, issue: 21, number: 70, state: "OPEN", head: RF_HEAD, headBranch: "feat/70", comments: [{ author: VIEWER, body: `TAKT evaluation failed for head ${RF_HEAD}: x` }] },
  ]);
  assert.deepEqual(snap.mergeTasks, [MERGE]);
  assert.deepEqual(reads.comments, [70]);
  assert.equal(reads.merges, 1);
});

test("reviewPullRequests: PR を持たない issue・閉じた PR・渡していない issue の PR のコメントは読まない（読み取りが増えない）", async () => {
  const { read, reads } = reviewWorld();
  await read();
  for (const n of [22, 23, 30, 71, 80]) assert.ok(!reads.comments.includes(n), `#${n} のコメントを読んだ`);
  assert.equal(reads.comments.length, 1);
});

test("reviewPullRequests: 読む PR が 1 件も無ければ、コメントも merge タスクも読まず、どちらも空にする", async () => {
  const { read, reads } = reviewWorld({ tasks: [taskOf(22), taskOf(30, 80)] });
  const snap = await read();
  assert.deepEqual(reads.comments, []);
  assert.equal(reads.merges, 0);
  assert.deepEqual(snap.reviewPullRequests, []);
  assert.deepEqual(snap.mergeTasks, []);
});

test("reviewPullRequests: 読んだ結果から decide が review-fix を 1 件出す（スナップショットから判定まで通る）", async () => {
  const { read } = reviewWorld();
  const actions = decide({ ...(await read()), dispatched: [] }).filter((a) => a.kind === "review-fix");
  assert.deepEqual(actions, [
    { kind: "review-fix", key: `review-fix:70:${RF_HEAD}`, issue: 21, pr: 70, head: RF_HEAD, branch: "feat/70", reports: "/repo/.takt/runs/run-1" },
  ]);
});

test("reviewPullRequests: merge タスクの読み取りが失敗したら例外にする（黙って空にしない）", async () => {
  const read = createReadSnapshot({
    repo: "o/r", viewer: VIEWER, discordUserId: "U1",
    github: { readMain: NO_MAIN, readIssues: () => reviewIssues(), readPullRequests: () => [prRow(70)], readComments: () => [] },
    discord: { readReactions: async () => [] },
    taktTasks: () => [taskOf(21, 70)],
    mergeTasks: async () => { throw new Error("takt-node.sh が失敗"); },
    observeSession: async () => ({ found: true, waiting: false, idle: true, tail: [] }),
  });
  await assert.rejects(read(), /takt-node\.sh が失敗/);
});
function reviewIssues() {
  return [
    issue(12, { comments: sent }),
    issue(20, { labels: [], body: "仕様: #12", comments: [handedFor(21), launched("takt-sequence", "term_seq")], subIssues: [{ number: 21, state: "OPEN" }] }),
    issue(21, { labels: [] }),
  ];
}

// ---- 修正のセッション（review-fix）の停止の観測 ----
// 修正の起動の印（2 段目）の handle で Orca を観測し、sessions[handle] に入れる。結果（head の変化・やり直しの印）が出たものは観測しない。

const H2 = "b".repeat(40);
// takt-sequence のタブ（term_seq）は既存の観測の対象なので、修正のセッションの handle だけを数える。
const fixWorld = ({ comments, head = RF_HEAD, state = "OPEN", observed = [] } = {}) => {
  const issues = [
    issue(12, { comments: sent }),
    issue(20, { labels: [], body: "仕様: #12", comments: [handedFor(21), launched("takt-sequence", "term_seq")], subIssues: [{ number: 21, state: "OPEN" }] }),
    issue(21, { labels: [] }),
  ];
  const read = createReadSnapshot({
    repo: "o/r", viewer: VIEWER, discordUserId: "U1",
    github: { readMain: NO_MAIN,
      readIssues: () => issues,
      readPullRequests: () => [prRow(70, state, { head })],
      readComments: () => comments,
    },
    discord: { readReactions: async () => [] },
    taktTasks: () => [taskOf(21, 70)],
    mergeTasks: async () => [],
    observeSession: async ({ handle }) => { if (handle !== "term_seq") observed.push(handle); return { found: true, waiting: true, idle: false, tail: ["Allow? (y/n)"] }; },
    now: () => new Date(T0),
  });
  return { read, observed };
};
const fixLaunched = (head, handle, at = T0) => ({ author: VIEWER, body: fixLaunchedMarker(head, handle, at) });
const failedAt = (head) => ({ author: VIEWER, body: `${REVIEW_FAILED} for head ${head}: x` });

test("修正のセッション: 結果が無ければ、修正の起動の印の handle を観測して sessions に入れ、起動時刻は印の時刻にする", async () => {
  const { read, observed } = fixWorld({ comments: [failedAt(RF_HEAD), fixLaunched(RF_HEAD, "term_f", "2026-10-16T23:30:00.000Z")] });
  const snap = await read();
  assert.deepEqual(observed, ["term_f"]);
  assert.deepEqual(snap.sessions.term_f, { found: true, waiting: true, idle: false, tail: ["Allow? (y/n)"], startedAt: "2026-10-16T23:30:00.000Z" });
});

test("修正のセッション: 現在の head が印の head から変わった PR、印の head にやり直しの印がある PR、起動の印が viewer 以外のものは観測しない", async () => {
  const changed = fixWorld({ head: H2, comments: [failedAt(RF_HEAD), fixLaunched(RF_HEAD, "term_f")] });
  await changed.read();
  const redone = fixWorld({ comments: [failedAt(RF_HEAD), fixLaunched(RF_HEAD, "term_f"), { author: VIEWER, body: redoMarker(RF_HEAD) }] });
  await redone.read();
  const stranger = fixWorld({ comments: [failedAt(RF_HEAD), { author: "someone", body: fixLaunchedMarker(RF_HEAD, "term_f", T0) }] });
  await stranger.read();
  assert.deepEqual([changed.observed, redone.observed, stranger.observed], [[], [], []]);
});

test("修正のセッション: 判断依頼を送り済みの PR（仕様に停止の印がある）は観測しない。1 段目の印だけ（handle が無い）の PR も観測しない", async () => {
  const issues = [
    issue(12, { comments: [...sent, { author: VIEWER, body: "案内役: Discord に判断依頼を送る（#70 review-fix のセッションの停止）" }] }),
    issue(20, { labels: [], body: "仕様: #12", comments: [handedFor(21), launched("takt-sequence", "term_seq")], subIssues: [{ number: 21, state: "OPEN" }] }),
    issue(21, { labels: [] }),
  ];
  const observed = [];
  const read = createReadSnapshot({
    repo: "o/r", viewer: VIEWER, discordUserId: "U1",
    github: { readMain: NO_MAIN, readIssues: () => issues, readPullRequests: () => [prRow(70)], readComments: () => [fixLaunched(RF_HEAD, "term_f")] },
    discord: { readReactions: async () => [] },
    taktTasks: () => [taskOf(21, 70)],
    mergeTasks: async () => [],
    observeSession: async ({ handle }) => { if (handle !== "term_seq") observed.push(handle); return { found: true, waiting: true, idle: false, tail: [] }; },
    now: () => new Date(T0),
  });
  await read();
  assert.deepEqual(observed, []);
  const launching = fixWorld({ comments: [{ author: VIEWER, body: `案内役: review-fix を起動する（head ${RF_HEAD}）` }] });
  await launching.read();
  assert.deepEqual(launching.observed, []);
});

test("修正のセッション: 観測の結果から decide が、原因 review-fix のセッションの停止の判断依頼を 1 件出す（スナップショットから判定まで通る）", async () => {
  const { read } = fixWorld({ comments: [failedAt(RF_HEAD), fixLaunched(RF_HEAD, "term_f")] });
  const stalls = decide({ ...(await read()), dispatched: [] }).filter((a) => a.kind === "request-decision" && a.cause === "review-fix のセッションの停止");
  assert.equal(stalls.length, 1);
  assert.equal(stalls[0].spec, 12);
  assert.equal(stalls[0].issue, 70);
  assert.equal(stalls[0].threadId, "555");
});

// ---- 判断依頼の答えの読み取り ----

test("decisionAnswers: 送った印があり答えた印の無い判断依頼だけ、本人の返信とリアクションを読み、メッセージの ID をキーに入れる", async () => {
  const c = (body) => ({ author: VIEWER, body });
  const spec = issue(12, {
    comments: [
      c("案内役: Discord に判断依頼を送る（#21 takt の ABORT）"), c("案内役: Discord に判断依頼を送った（#21 takt の ABORT / スレッド 555 / メッセージ M1）"),
      c("案内役: Discord に判断依頼を送る（#22 takt の ABORT）"), c("案内役: Discord に判断依頼を送った（#22 takt の ABORT / スレッド 555 / メッセージ M2）"), c("案内役: 判断依頼に答えた（#22 takt の ABORT）"),
      c("案内役: Discord に判断依頼を送る（#12 formal-spec の検証失敗）"),
    ],
  });
  const closed = issue(13, { state: "CLOSED", comments: [c("案内役: Discord に判断依頼を送る（#23 takt の ABORT）"), c("案内役: Discord に判断依頼を送った（#23 takt の ABORT / スレッド 555 / メッセージ M3）")] });
  const replyReads = [];
  const reactionReads = [];
  const replies = [{ userId: "U1", content: "流し直す" }];
  const reactions = [{ emoji: "✅", userId: "U1" }];
  const read = createReadSnapshot({
    repo: "o/r", viewer: VIEWER, discordUserId: "U1",
    github: { readMain: NO_MAIN, readIssues: () => [spec, closed], readPullRequests: () => [], readComments: () => [] },
    discord: {
      readReactions: async (ref) => { reactionReads.push(ref); return reactions; },
      readReplies: async (ref) => { replyReads.push(ref); return replies; },
    },
    taktTasks: () => [],
    now: () => NOW,
    observeSession: () => assert.fail("観測しない"),
  });
  const snap = await read();
  assert.deepEqual(replyReads, [{ threadId: "555", messageId: "M1" }]);
  assert.deepEqual(reactionReads, [{ threadId: "555", messageId: "M1" }]);
  assert.deepEqual(snap.decisionAnswers, { M1: { replies, reactions } });
  assert.deepEqual(decide(snap).filter((a) => a.kind === "record-decision-answer").map((a) => a.issue), [21]);
});

test("main: main の最新の commit の必須チェック（名前は ruleset の応答から読む）・check-runs・commit comment をスナップショットに入れる", async () => {
  const SHA = "c".repeat(40);
  const rules = [
    { type: "deletion" },
    { type: "required_status_checks", parameters: { required_status_checks: [{ context: "Nix flake evaluation", integration_id: 15368 }, { context: "ShellCheck (severity=error)", integration_id: 15368 }] } },
  ];
  const checks = [
    { id: 1, name: "Nix flake evaluation", status: "completed", conclusion: "failure", runId: 777 },
    { id: 2, name: "ShellCheck (severity=error)", status: "completed", conclusion: "success", runId: 778 },
  ];
  const comments = [{ author: VIEWER, body: mainRerunMarker(777), createdAt: "2026-10-28T00:00:00Z" }];
  const read = createReadSnapshot({
    repo: "o/r", viewer: VIEWER, discordUserId: "U1",
    github: { readMain: () => ({ sha: SHA, rules, checks, comments }), readIssues: () => [], readPullRequests: () => [] },
    discord: { readReactions: async () => [] },
    taktTasks: () => [],
  });
  const snap = await read();
  assert.deepEqual(snap.main, { sha: SHA, required: ["Nix flake evaluation", "ShellCheck (severity=error)"], checks, comments });
  assert.deepEqual(decide(snap).filter((a) => a.kind === "rerun-main"), []);
  const unmarked = await createReadSnapshot({
    repo: "o/r", viewer: VIEWER, discordUserId: "U1",
    github: { readMain: () => ({ sha: SHA, rules, checks, comments: [] }), readIssues: () => [], readPullRequests: () => [] },
    discord: { readReactions: async () => [] },
    taktTasks: () => [],
  })();
  assert.deepEqual(decide(unmarked).filter((a) => a.kind === "rerun-main").map((a) => a.runs), [[777]]);
});
