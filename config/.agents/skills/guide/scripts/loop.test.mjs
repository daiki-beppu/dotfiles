// loop.mjs のテスト。readSnapshot / execute / sleep は偽物を注入し、GitHub・takt・Discord・子プロセスは呼ばない。
import assert from "node:assert/strict";
import { test } from "node:test";
import { runLoop, runRound } from "./loop.mjs";

const REPO = "daiki-beppu/live-mindmap";
const VIEWER = "daiki-beppu";

const issue = (number, over = {}) => ({
  number,
  title: `issue ${number}`,
  state: "OPEN",
  labels: [],
  body: "",
  comments: [],
  subIssues: [],
  ...over,
});
// 承認依頼は送り済み（承認依頼の行動を出さず、to-tickets の流れだけを見る）
const SENDING = "案内役: Discord に承認依頼を送る";
const SENT = "案内役: Discord に承認依頼を送った（スレッド 555 / メッセージ 777）";
const sentComments = [{ author: VIEWER, body: SENDING }, { author: VIEWER, body: SENT }];
// formal-spec は起動済みで passed（to-tickets の流れだけを見る）
const formalSpecDone = [{ author: VIEWER, body: "案内役: formal-spec を起動する" }, { author: VIEWER, body: "## Formal Spec（takt 0.71.0 の検証器で passed）" }];
const spec = (number) => issue(number, { labels: ["spec", "spec-approved"], comments: [...sentComments, ...formalSpecDone] });

// GitHub 上の状態が周をまたいで変わらない固定のスナップショット（dispatched はループが足す）。
const fixed = () => ({
  repo: REPO,
  viewer: VIEWER,
  issues: [spec(12), spec(30)],
  taktIssues: [],
});

const fakes = (over = {}) => {
  const calls = { read: 0, executed: [], logs: [] };
  return {
    calls,
    deps: {
      readSnapshot: async () => {
        calls.read += 1;
        return fixed();
      },
      execute: async (action) => {
        calls.executed.push(action.key);
      },
      log: (line) => calls.logs.push(String(line)),
      ...over,
    },
  };
};

test("二重にしない: 同じスナップショットで 2 周しても、行動ごとに execute は 1 回だけ", async () => {
  const { calls, deps } = fakes();
  const dispatched = new Set();
  await runRound(deps, dispatched);
  await runRound(deps, dispatched);
  assert.deepEqual(calls.executed, ["to-tickets:12", "to-tickets:30"]);
});

test("二重にしない: 3 周目以降も増えない", async () => {
  const { calls, deps } = fakes();
  const dispatched = new Set();
  for (let i = 0; i < 5; i += 1) await runRound(deps, dispatched);
  assert.deepEqual(calls.executed, ["to-tickets:12", "to-tickets:30"]);
});

test("毎周読み直す: 周ごとに readSnapshot を呼ぶ", async () => {
  const { calls, deps } = fakes();
  const dispatched = new Set();
  await runRound(deps, dispatched);
  await runRound(deps, dispatched);
  assert.equal(calls.read, 2);
});

test("何もない: 何も出ない周では execute を呼ばない", async () => {
  const { calls, deps } = fakes({ readSnapshot: async () => ({ repo: REPO, viewer: VIEWER, issues: [], taktIssues: [] }) });
  await runRound(deps, new Set());
  assert.deepEqual(calls.executed, []);
});

test("実行に成功した key だけを dispatched に加える", async () => {
  const { deps } = fakes();
  const dispatched = new Set();
  await runRound(deps, dispatched);
  assert.deepEqual([...dispatched].sort(), ["to-tickets:12", "to-tickets:30"]);
});

test("execute が失敗したら周を止め（reject）、その key を dispatched に加えない", async () => {
  const { calls, deps } = fakes({
    execute: async (action) => {
      calls.executed.push(action.key);
      throw new Error("claude failed");
    },
  });
  const dispatched = new Set();
  await assert.rejects(runRound(deps, dispatched), /claude failed/);
  assert.deepEqual(calls.executed, ["to-tickets:12"]);
  assert.equal(dispatched.has("to-tickets:12"), false);
});

test("入力のスナップショットには dispatched が反映される（実行済みの key は次周で出ない）", async () => {
  const { calls, deps } = fakes();
  const dispatched = new Set(["to-tickets:12"]);
  await runRound(deps, dispatched);
  assert.deepEqual(calls.executed, ["to-tickets:30"]);
});

test("dry-run: execute を呼ばず、dispatched も更新せず、出た行動を log に表示する", async () => {
  const { calls, deps } = fakes();
  const dispatched = new Set();
  await runRound({ ...deps, dryRun: true }, dispatched);
  assert.deepEqual(calls.executed, []);
  assert.equal(dispatched.size, 0);
  const out = calls.logs.join("\n");
  assert.match(out, /to-tickets:12/);
  assert.match(out, /to-tickets:30/);
});

test("ループ: maxRounds 周だけ回り、周の間に interval 秒ぶん sleep する", async () => {
  const { calls, deps } = fakes();
  const sleeps = [];
  await runLoop({ ...deps, sleep: async (ms) => sleeps.push(ms) }, { intervalSec: 7, maxRounds: 3 });
  assert.equal(calls.read, 3);
  assert.deepEqual(calls.executed, ["to-tickets:12", "to-tickets:30"]);
  assert.deepEqual(sleeps, [7000, 7000]);
});

test("ループ: スナップショットの取得が 3 回続けて失敗したら止まる", async () => {
  let reads = 0;
  const { deps } = fakes({
    readSnapshot: async () => {
      reads += 1;
      throw new Error("gh unavailable");
    },
  });
  await assert.rejects(
    runLoop({ ...deps, sleep: async () => {} }, { intervalSec: 1, maxRounds: 10 }),
    /gh unavailable/,
  );
  assert.equal(reads, 3);
});

test("ループ: 取得失敗が途中で回復すれば連続カウントは戻り、続行する", async () => {
  let reads = 0;
  const { calls, deps } = fakes({
    readSnapshot: async () => {
      reads += 1;
      if (reads === 1 || reads === 2 || reads === 4 || reads === 5) throw new Error("transient");
      return fixed();
    },
  });
  await runLoop({ ...deps, sleep: async () => {} }, { intervalSec: 1, maxRounds: 6 });
  assert.equal(reads, 6);
  assert.deepEqual(calls.executed, ["to-tickets:12", "to-tickets:30"]);
});

test("ループ: execute の失敗は再試行せず即座に止まる", async () => {
  let executes = 0;
  const { deps } = fakes({
    execute: async () => {
      executes += 1;
      throw new Error("orca failed");
    },
  });
  await assert.rejects(
    runLoop({ ...deps, sleep: async () => {} }, { intervalSec: 1, maxRounds: 10 }),
    /orca failed/,
  );
  assert.equal(executes, 1);
});

// ---- 承認の行動（Discord）----

const approvalSnapshot = async () => ({
  repo: REPO,
  viewer: VIEWER,
  discordUserId: "U1",
  taktIssues: [],
  issues: [
    issue(12, { labels: ["spec"] }),
    issue(13, { labels: ["spec"], comments: [...sentComments, ...formalSpecDone], reactions: [{ emoji: "✅", userId: "U1" }] }),
    issue(14, { labels: ["spec"], comments: [...sentComments, ...formalSpecDone], reactions: [{ emoji: "❌", userId: "U1" }] }),
  ],
});

test("dry-run: 承認の 3 種類の行動も execute を呼ばず、key を含めて log に表示する（例外にしない）", async () => {
  const { calls, deps } = fakes({ readSnapshot: approvalSnapshot });
  const dispatched = new Set();
  await runRound({ ...deps, dryRun: true }, dispatched);
  assert.deepEqual(calls.executed, []);
  assert.equal(dispatched.size, 0);
  const out = calls.logs.join("\n");
  assert.match(out, /request-approval:12/);
  assert.match(out, /approve-spec:13/);
  assert.match(out, /reject-spec:14/);
});

test("承認の行動も同じスナップショットで 2 周しても、行動ごとに execute は 1 回だけ", async () => {
  const { calls, deps } = fakes({ readSnapshot: approvalSnapshot });
  const dispatched = new Set();
  await runRound(deps, dispatched);
  await runRound(deps, dispatched);
  assert.deepEqual(calls.executed, ["request-approval:12", "approve-spec:13", "reject-spec:14"]);
});

test("dry-run: knowledge の行動も例外にせず、key を含めて log に表示する", async () => {
  const closed = (number) => issue(number, { state: "CLOSED" });
  const deps = {
    readSnapshot: async () => ({
      repo: REPO,
      viewer: VIEWER,
      issues: [
        issue(12, { labels: ["spec", "spec-approved"], comments: sentComments }),
        issue(20, { body: "仕様: #12", subIssues: [{ number: 21, state: "CLOSED" }] }),
        closed(21),
      ],
      taktIssues: [],
      pullRequests: [],
    }),
    execute: async () => assert.fail("dry-run では execute を呼ばない"),
    log: (m) => logs.push(m),
  };
  const logs = [];
  await runRound({ ...deps, dryRun: true }, new Set());
  assert.match(logs.join("\n"), /knowledge:12/);
});

test("dry-run: merge-auto の行動も例外にせず、key を含めて log に表示する", async () => {
  const logs = [];
  await runRound(
    {
      readSnapshot: async () => ({
        repo: REPO,
        viewer: VIEWER,
        issues: [
          issue(12, { labels: ["spec", "spec-approved"], comments: sentComments }),
          issue(20, { body: "仕様: #12", subIssues: [{ number: 21, state: "CLOSED" }] }),
          issue(21, { state: "CLOSED" }),
        ],
        taktIssues: [],
        pullRequests: [{ number: 50, state: "OPEN", author: VIEWER, body: "学びの元の仕様: #12", autoMerge: false }],
      }),
      execute: async () => assert.fail("dry-run では execute を呼ばない"),
      log: (m) => logs.push(m),
      dryRun: true,
    },
    new Set(),
  );
  assert.match(logs.join("\n"), /merge-auto:50/);
});

test("dry-run: 判断依頼の行動を説明つきで表示し、例外にならない", async () => {
  const logs = [];
  const readSnapshot = async () => ({ repo: "o/r", viewer: "me", issues: [{ number: 12, title: "t", state: "OPEN", labels: ["spec", "spec-approved"], body: "", comments: [{ author: "me", body: "案内役: Discord に承認依頼を送る" }, { author: "me", body: "案内役: Discord に承認依頼を送った（スレッド 555 / メッセージ 777）" }, { author: "me", body: "案内役: to-tickets が終わった（exit 0）" }], subIssues: [] }, { number: 20, state: "OPEN", labels: [], body: "仕様: #12", comments: [], subIssues: [{ number: 21, state: "OPEN" }] }, { number: 21, title: "x", state: "OPEN", labels: [], body: "", comments: [], subIssues: [] }], taktIssues: [21], taktTasks: [{ issue: 21, kind: "failed", createdAt: "2026-10-16T10:00:00Z", step: "s", error: "e", worktreePath: "/w" }] });
  const actions = await runRound({ readSnapshot, execute: async () => assert.fail("dry-run は実行しない"), log: (l) => logs.push(l), dryRun: true }, new Set());
  assert.ok(actions.some((a) => a.kind === "request-decision" && a.spec === 12 && a.issue === 21));
  assert.ok(logs.some((l) => l.includes("#12") && l.includes("#21")), logs.join("\n"));
});

test("formal-spec: 承認依頼を送った仕様では execute に formal-spec の行動を渡し、2 周しても 1 回だけ。dry-run の表示にも仕様の番号と formal-spec が出る", async () => {
  const sentOnly = () => ({ repo: REPO, viewer: VIEWER, issues: [issue(12, { labels: ["spec"], comments: sentComments })], taktIssues: [] });
  const { calls, deps } = fakes({ readSnapshot: async () => sentOnly() });
  const dispatched = new Set();
  await runRound(deps, dispatched);
  await runRound(deps, dispatched);
  assert.deepEqual(calls.executed, ["formal-spec:12"]);
  assert.ok(calls.logs.some((l) => l.includes("formal-spec:12")));

  const dry = fakes({ readSnapshot: async () => sentOnly() });
  await runRound({ ...dry.deps, dryRun: true }, new Set());
  assert.deepEqual(dry.calls.executed, []);
  const line = dry.calls.logs.find((l) => l.includes("formal-spec:12"));
  assert.ok(line, dry.calls.logs.join("\n"));
  assert.match(line, /#12/);
});

test("dry-run: wayfinder の行動も例外にせず、key・map・ticket・type を log に表示する", async () => {
  const { calls, deps } = fakes({
    readSnapshot: async () => ({
      repo: REPO,
      viewer: VIEWER,
      issues: [
        issue(20, { labels: ["wayfinder:map"], subIssues: [{ number: 23, state: "OPEN" }] }),
        issue(23, { labels: ["wayfinder:task"], assignees: [], blockedBy: [] }),
      ],
      taktIssues: [],
    }),
    execute: async () => assert.fail("dry-run では execute を呼ばない"),
  });
  await runRound({ ...deps, dryRun: true }, new Set());
  const out = calls.logs.join("\n");
  assert.match(out, /wayfinder:23/);
  assert.match(out, /#20/);
  assert.match(out, /task/);
});

test("dry-run: to-spec の行動も例外にせず、key と map の番号を log に表示する", async () => {
  const { calls, deps } = fakes({
    readSnapshot: async () => ({
      repo: REPO,
      viewer: VIEWER,
      issues: [
        issue(20, { labels: ["wayfinder:map"], body: "## Not yet specified\n<!-- x -->\n", subIssues: [{ number: 23, state: "CLOSED" }] }),
        issue(23, { state: "CLOSED", labels: ["wayfinder:task"], assignees: [], blockedBy: [] }),
      ],
      taktIssues: [],
    }),
    execute: async () => assert.fail("dry-run では execute を呼ばない"),
  });
  const actions = await runRound({ ...deps, dryRun: true }, new Set());
  assert.deepEqual(actions.filter((a) => a.kind === "to-spec").map((a) => a.key), ["to-spec:20"]);
  const line = calls.logs.find((l) => l.includes("to-spec:20"));
  assert.ok(line, calls.logs.join("\n"));
  assert.match(line, /#20/);
  assert.match(line, /to-spec/);
});

test("to-spec: 実行すると execute に to-spec の行動を 1 度だけ渡し、dispatched に key を入れる。2 周目は出さない", async () => {
  const { calls, deps } = fakes({
    readSnapshot: async () => ({
      repo: REPO,
      viewer: VIEWER,
      issues: [
        issue(20, { labels: ["wayfinder:map"], body: "", subIssues: [{ number: 23, state: "CLOSED" }] }),
        issue(23, { state: "CLOSED", labels: ["wayfinder:task"], assignees: [], blockedBy: [] }),
      ],
      taktIssues: [],
    }),
  });
  const dispatched = new Set();
  await runRound(deps, dispatched);
  await runRound(deps, dispatched);
  assert.deepEqual(calls.executed.filter((k) => k.startsWith("to-spec:")), ["to-spec:20"]);
  assert.ok(dispatched.has("to-spec:20"));
});

// ---- map のスレッド・人が見る ticket・ticket の停止（dry-run の表示） ----
const mapDry = async (issues, extra = {}) => {
  const { calls, deps } = fakes({
    readSnapshot: async () => ({ repo: REPO, viewer: VIEWER, issues, taktIssues: [], ...extra }),
    execute: async () => assert.fail("dry-run では execute を呼ばない"),
  });
  await runRound({ ...deps, dryRun: true }, new Set());
  return calls.logs.join("\n");
};
const mapOf = (comments, children) => issue(20, { title: "地図", labels: ["wayfinder:map"], comments, subIssues: children.map((n) => ({ number: n, state: "OPEN" })) });
const proto = (n) => issue(n, { labels: ["wayfinder:prototype"], assignees: [], blockedBy: [] });

test("dry-run: map のスレッドを立てる行動も例外にせず、key と map の番号を log に表示する", async () => {
  const out = await mapDry([mapOf([], [21]), proto(21)]);
  assert.match(out, /create-map-thread:20/);
  assert.match(out, /#20/);
});

test("dry-run: 人が見る ticket の通知も例外にせず、key・map・ticket の番号を log に表示する", async () => {
  const out = await mapDry([mapOf([{ author: VIEWER, body: "案内役: Discord に map のスレッドを立てた（スレッド 900）" }], [21]), proto(21)]);
  assert.match(out, /notify-human-ticket:20:21/);
  assert.match(out, /#20/);
  assert.match(out, /#21/);
});

test("dry-run: ticket の停止の判断依頼も例外にせず、key・map・ticket の番号を log に表示する", async () => {
  const ticket = issue(21, {
    labels: ["wayfinder:research"], assignees: ["x"], blockedBy: [],
    comments: [{ author: VIEWER, body: "案内役: wayfinder を起動した（ターミナル term_1 / 2026-10-17T00:00:00.000Z）" }],
  });
  const out = await mapDry(
    [mapOf([{ author: VIEWER, body: "案内役: Discord に map のスレッドを立てた（スレッド 900）" }], [21]), ticket],
    { now: "2026-10-17T00:01:00.000Z", sessions: { term_1: { found: false, waiting: false, idle: false, tail: [] } } },
  );
  assert.match(out, /request-map-decision:20:21:/);
  assert.match(out, /#20/);
  assert.match(out, /#21/);
});

test("map の行動も同じスナップショットで 2 周しても、行動ごとに execute は 1 回だけ", async () => {
  const { calls, deps } = fakes({ readSnapshot: async () => ({ repo: REPO, viewer: VIEWER, issues: [mapOf([], [21]), proto(21)], taktIssues: [] }) });
  const dispatched = new Set();
  await runRound(deps, dispatched);
  await runRound(deps, dispatched);
  assert.deepEqual(calls.executed, ["create-map-thread:20"]);
});

// ---- grilling の判断依頼・書き戻し・流し込み（dry-run の表示） ----

const G_SINCE = "1760000000000";
const gTicket = (comments) =>
  issue(21, {
    title: "公開 API の名前", labels: ["wayfinder:grilling"], assignees: [VIEWER], blockedBy: [],
    comments: [{ author: VIEWER, body: "案内役: wayfinder を起動した（ターミナル term_1 / 2026-10-17T00:00:00.000Z）" }, ...comments.map((body) => ({ author: VIEWER, body }))],
  });
const G_THREAD = { author: VIEWER, body: "案内役: Discord に map のスレッドを立てた（スレッド 900）" };
const gDry = (comments, extra = {}) =>
  mapDry([mapOf([G_THREAD], [21]), gTicket(comments)], {
    now: "2026-10-17T00:01:00.000Z", discordUserId: "U1",
    sessions: { term_1: { found: true, waiting: true, waitSource: "hook", waitSince: G_SINCE, idle: false, tail: ["x"] } },
    ...extra,
  });

test("dry-run: grilling の判断依頼も例外にせず、key・map・ticket の番号を log に表示する", async () => {
  const out = await gDry([]);
  assert.match(out, /request-grilling-decision:20:21:/);
  assert.match(out, /#20/);
  assert.match(out, /#21/);
  assert.doesNotMatch(out, /request-map-decision/);
});

test("dry-run: 本人の回答の書き戻しも例外にせず、key と ticket の番号を log に表示する", async () => {
  const sent = [`案内役: Discord に判断依頼を送る（#21 grilling の問い ${G_SINCE}）`, `案内役: Discord に判断依頼を送った（#21 grilling の問い ${G_SINCE} / スレッド 900 / メッセージ M1）`];
  const out = await gDry(sent, { decisionReplies: { M1: [{ userId: "U1", content: "B 案" }] } });
  assert.match(out, /write-back-answer:21:/);
  assert.match(out, /#21/);
});

test("dry-run: 回答の流し込みも例外にせず、key・ticket の番号・タブの handle を log に表示する", async () => {
  const sent = [`案内役: Discord に判断依頼を送る（#21 grilling の問い ${G_SINCE}）`, `案内役: Discord に判断依頼を送った（#21 grilling の問い ${G_SINCE} / スレッド 900 / メッセージ M1）`, `案内役: Discord の回答を書き戻した（#21 grilling の問い ${G_SINCE}）\n\nB 案`];
  const out = await gDry(sent);
  assert.match(out, /inject-answer:21:/);
  assert.match(out, /#21/);
  assert.match(out, /term_1/);
});

test("dry-run: 仮決めの掲載の行動も例外にせず、execute を呼ばず、key を含めて log に表示する", async () => {
  const body = "## 仮決め\n\n### どの parser？\n- 答え: 既存\n- 振り分け: ⓪\n- 理由: 後で替えられる\n- 根拠: なし\n";
  const logs = [];
  const deps = {
    readSnapshot: async () => ({
      repo: REPO, viewer: VIEWER, taktIssues: [],
      issues: [
        issue(20, { title: "地図", labels: ["wayfinder:map"], subIssues: [{ number: 21, state: "CLOSED" }], comments: [{ author: VIEWER, body: "案内役: Discord に map のスレッドを立てた（スレッド 900）" }] }),
        issue(21, { title: "parser を選ぶ", state: "CLOSED", labels: ["wayfinder:grilling"], assignees: [], blockedBy: [], comments: [{ author: VIEWER, body }] }),
      ],
    }),
    execute: async () => assert.fail("dry-run では execute を呼ばない"),
    log: (line) => logs.push(String(line)),
    dryRun: true,
  };
  await runRound(deps, new Set());
  assert.ok(logs.some((l) => l.includes("post-provisional-decision:20:21:1")), logs.join("\n"));
});

test("dry-run: 仮決めの差し戻しの行動も例外にせず、execute を呼ばず、key を含めて log に表示する", async () => {
  const logs = [];
  const sent = "案内役: Discord に仮決めを流した（#21 仮決め 1 / スレッド 900 / メッセージ M1）";
  const body = "## 仮決め\n\n### どの parser？\n- 答え: 既存\n- 振り分け: ⓪\n- 理由: 後で替えられる\n- 根拠: なし\n";
  const deps = {
    readSnapshot: async () => ({
      repo: REPO, viewer: VIEWER, taktIssues: [], discordUserId: "U-owner",
      provisionalReactions: { M1: [{ emoji: "❌", userId: "U-owner" }] },
      issues: [
        issue(20, { title: "地図", labels: ["wayfinder:map"], subIssues: [{ number: 21, state: "CLOSED" }], comments: [{ author: VIEWER, body: "案内役: Discord に map のスレッドを立てた（スレッド 900）" }] }),
        issue(21, { title: "parser を選ぶ", state: "CLOSED", labels: ["wayfinder:grilling"], assignees: [VIEWER], blockedBy: [], comments: [{ author: VIEWER, body }, { author: VIEWER, body: sent }] }),
      ],
    }),
    execute: async () => assert.fail("dry-run では execute を呼ばない"),
    log: (line) => logs.push(String(line)),
    dryRun: true,
  };
  await runRound(deps, new Set());
  assert.ok(logs.some((l) => l.includes("reject-provisional-decision:20:21:1") && l.includes("#21")), logs.join("\n"));
});

test("dry-run: review-fix の行動も例外にせず、key と PR・issue の番号を含めて log に表示する", async () => {
  const head = "a".repeat(40);
  const logs = [];
  const snap = {
    repo: REPO, viewer: VIEWER,
    issues: [
      issue(12, { labels: ["spec", "spec-approved"], comments: [...sentComments, ...formalSpecDone] }),
      issue(20, { body: "仕様: #12", comments: [{ author: VIEWER, body: "案内役: takt-sequence に渡した #21" }, { author: VIEWER, body: "案内役: takt-sequence を起動した（ターミナル term_s / 2026-10-17T00:00:00.000Z）" }], subIssues: [{ number: 21, state: "OPEN" }] }),
      issue(21),
    ],
    taktIssues: [21],
    taktTasks: [{ issue: 21, kind: "completed", createdAt: "2026-10-17T00:00:00Z", prUrl: "https://github.com/o/r/pull/70" }],
    pullRequests: [{ number: 70, state: "OPEN", author: VIEWER, body: "", autoMerge: false, head, headBranch: "feat/21" }],
    reviewPullRequests: [{ issue: 21, number: 70, state: "OPEN", head, headBranch: "feat/21", comments: [{ author: VIEWER, body: `TAKT evaluation failed for head ${head}: x` }] }],
    mergeTasks: [],
  };
  const actions = await runRound({ readSnapshot: async () => snap, execute: async () => assert.fail("dry-run では execute を呼ばない"), log: (l) => logs.push(l), dryRun: true }, new Set());
  assert.ok(actions.some((a) => a.kind === "review-fix"));
  assert.ok(logs.some((l) => l.includes(`review-fix:70:${head}`) && l.includes("#70") && l.includes("#21")), logs.join("\n"));
});

test("dry-run: レビュー失敗の判断依頼の行動も例外にせず、key と PR・sub-issue の番号を含めて log に表示する（実行はしない）", async () => {
  const head = "a".repeat(40);
  const logs = [];
  const launching = (h) => ({ author: VIEWER, body: `案内役: review-fix を起動する（head ${h}）` });
  const snap = {
    repo: REPO, viewer: VIEWER,
    issues: [
      issue(12, { labels: ["spec", "spec-approved"], comments: [...sentComments, ...formalSpecDone] }),
      issue(20, { body: "仕様: #12", comments: [{ author: VIEWER, body: "案内役: takt-sequence に渡した #21" }, { author: VIEWER, body: "案内役: takt-sequence を起動した（ターミナル term_s / 2026-10-17T00:00:00.000Z）" }], subIssues: [{ number: 21, state: "OPEN" }] }),
      issue(21),
    ],
    taktIssues: [21],
    taktTasks: [{ issue: 21, kind: "completed", createdAt: "2026-10-17T00:00:00Z", prUrl: "https://github.com/o/r/pull/70" }],
    pullRequests: [{ number: 70, state: "OPEN", author: VIEWER, body: "", autoMerge: false, head, headBranch: "feat/21" }],
    reviewPullRequests: [{ spec: 12, issue: 21, number: 70, state: "OPEN", head, headBranch: "feat/21", comments: [launching("b".repeat(40)), launching("c".repeat(40)), { author: VIEWER, body: `TAKT evaluation failed for head ${head}: x` }] }],
    mergeTasks: [],
  };
  const actions = await runRound({ readSnapshot: async () => snap, execute: async () => assert.fail("dry-run では execute を呼ばない"), log: (l) => logs.push(l), dryRun: true }, new Set());
  assert.ok(actions.some((a) => a.kind === "request-review-decision"));
  assert.ok(logs.some((l) => l.includes("request-decision:12:70:") && l.includes("#70") && l.includes("#21")), logs.join("\n"));
});
