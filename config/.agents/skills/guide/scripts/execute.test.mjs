// execute.mjs のテスト。コメント・起動は偽物を注入し、書かれたマーカーを次の起動のスナップショットに入れて再起動を再現する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { decide } from "./decide.mjs";
import { createDiscord } from "./discord.mjs";
import { createExecute } from "./execute.mjs";
import { runRound } from "./loop.mjs";
import { launchToTickets } from "./to-tickets.mjs";

const REPO = "o/r";
const VIEWER = "me";
// 承認依頼は送り済み（world は discord を渡さないので、マーカーが無いと承認依頼の行動が出てしまう）
const SENT_COMMENTS = [
  { author: VIEWER, body: "案内役: Discord に承認依頼を送る" },
  { author: VIEWER, body: "案内役: Discord に承認依頼を送った（スレッド 555 / メッセージ 777）" },
];
const issue = (number, over = {}) => ({ number, state: "OPEN", labels: [], body: "", comments: [], subIssues: [], ...over });

const LAUNCHED_AT = "2026-10-17T00:00:00.000Z";
const NOW = () => new Date(LAUNCHED_AT);
// 実際の `orca agent launch --json` の応答の形（handle は result.outcome.handle）
const launchReply = (handle = "term_1") =>
  JSON.stringify({ result: { outcome: { kind: "terminal", handle }, receipt: { detail: "launched" }, worktreeId: "wt_1" } });
// 偽の orca: 呼ばれた argv を calls に `orca <args>` で記録し、サブコマンドごとの応答（文字列）を返す。reply が Error なら投げる。
const fakeOrca = (calls, { launch = launchReply(), rename = "{}" } = {}) => (args) => {
  calls.push(`orca ${args.join(" ")}`);
  (calls.argvs ??= []).push(args);
  const reply = args[0] === "agent" ? launch : rename;
  if (reply instanceof Error) throw reply;
  return reply;
};
const orcaArgv = (calls) => calls.argvs ?? [];

// 偽の GitHub: comment が書いた内容を、次の読み出しで viewer のコメントとして返す。
const world = (issues, over = {}) => {
  const calls = [];
  const github = { comment: (n, body) => { calls.push(`comment #${n} ${body}`); issues.find((i) => i.number === n).comments.push({ author: VIEWER, body }); } };
  const deps = {
    github, cwd: "/x", repo: REPO,
    launchToTickets: (a) => launchToTickets(a, fakeOrca(calls)),
    now: NOW,
    startTaktSequence: ({ issues: is }) => { calls.push(`takt ${is.join(",")}`); },
    ...over,
  };
  const round = (dispatched = new Set()) =>
    runRound({ readSnapshot: async () => ({ repo: REPO, viewer: VIEWER, issues, taktIssues: [] }), execute: createExecute(deps), log: () => {} }, dispatched);
  return { calls, round };
};

const BEFORE = "comment #12 案内役: to-tickets を起動する";
const AFTER = `comment #12 案内役: to-tickets を起動した（ターミナル term_1 / ${LAUNCHED_AT}）`;

test("to-tickets: 起動前の印 → orca agent launch → タブ題名 → handle と時刻つきの印の順に実行し、新しい dispatched で再起動しても出ない", async () => {
  const issues = [issue(12, { labels: ["spec", "spec-approved"], comments: [...SENT_COMMENTS] })];
  const { calls, round } = world(issues);
  await round();
  assert.equal(calls.length, 4);
  assert.equal(calls[0], BEFORE);
  assert.ok(calls[1].startsWith("orca agent launch "), calls[1]);
  assert.ok(calls[2].startsWith("orca terminal rename "), calls[2]);
  assert.equal(calls[3], AFTER);
  await round(new Set());
  assert.equal(calls.length, 4);
});

test("to-tickets: orca agent launch に claude・main checkout の worktree・プロンプトを渡し、--allowedTools は渡さない", async () => {
  const issues = [issue(12, { labels: ["spec", "spec-approved"], comments: [...SENT_COMMENTS] })];
  const { calls, round } = world(issues);
  await round();
  const launch = orcaArgv(calls)[0];
  assert.deepEqual(launch.slice(0, 7), ["agent", "launch", "--agent", "claude", "--worktree", "path:/x", "--prompt"]);
  assert.equal(launch.at(-1), "--json");
  const prompt = launch[7];
  assert.equal(prompt.split("\n")[0], "/to-tickets #12");
  assert.match(prompt, /分割案の確認は省いて/);
  assert.match(prompt, /仕様: #12/);
  assert.match(prompt, /gh-subissues/);
  assert.ok(!launch.includes("--allowedTools"));
  assert.ok(!orcaArgv(calls).flat().includes("--allowedTools"));
});

test("to-tickets: 起動の応答の handle でタブの題名に工程と仕様の番号を入れる", async () => {
  const issues = [issue(12, { labels: ["spec", "spec-approved"], comments: [...SENT_COMMENTS] })];
  const { calls, round } = world(issues);
  await round();
  const rename = orcaArgv(calls)[1];
  assert.deepEqual(rename.slice(0, 4), ["terminal", "rename", "--terminal", "term_1"]);
  const title = rename[rename.indexOf("--title") + 1];
  assert.match(title, /to-tickets/);
  assert.match(title, /#12/);
});

test("to-tickets: 起動後の印の handle は応答から取り、時刻は注入した now の ISO 8601", async () => {
  const issues = [issue(12, { labels: ["spec", "spec-approved"], comments: [...SENT_COMMENTS] })];
  const { calls, round } = world(issues, {
    launchToTickets: (a) => launchToTickets(a, fakeOrca(calls, { launch: launchReply("term_99") })),
    now: () => new Date("2026-01-02T03:04:05.678Z"),
  });
  await round();
  assert.equal(calls.at(-1), "comment #12 案内役: to-tickets を起動した（ターミナル term_99 / 2026-01-02T03:04:05.678Z）");
});

test("to-tickets: 応答から handle が取れなければ例外で止まり、起動後の印は書かず、再起動で再度起動しない", async () => {
  for (const launch of ['{"result":{"outcome":{}}}', "launched OK (not json)", '{"result":{"outcome":{"handle":""}}}']) {
    const issues = [issue(12, { labels: ["spec", "spec-approved"], comments: [...SENT_COMMENTS] })];
    const { calls, round } = world(issues, { launchToTickets: (a) => launchToTickets(a, fakeOrca(calls, { launch })) });
    await assert.rejects(round(), /handle/, launch);
    assert.equal(calls[0], BEFORE, "印は起動より先");
    assert.equal(orcaArgv(calls).length, 1, "rename まで進まない");
    assert.ok(!calls.some((c) => c.startsWith("comment #12 案内役: to-tickets を起動した（")), launch);
    // 起動前の印は GitHub に残っている
    assert.ok(issues[0].comments.some((c) => c.body === "案内役: to-tickets を起動する"));
    const before = calls.length;
    await round(new Set());
    assert.equal(calls.length, before, "流し直しても再起動しない");
  }
});

test("to-tickets: orca agent launch 自体が失敗しても起動前の印は残り、再起動で再度起動しない", async () => {
  const issues = [issue(12, { labels: ["spec", "spec-approved"], comments: [...SENT_COMMENTS] })];
  const { calls, round } = world(issues, { launchToTickets: (a) => launchToTickets(a, fakeOrca(calls, { launch: new Error("orca down") })) });
  await assert.rejects(round(), /orca down/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0], BEFORE);
  await round(new Set());
  assert.equal(calls.length, 2);
});

test("to-tickets: タブ題名の変更が失敗したら例外で止まり、起動後の印は書かない", async () => {
  const issues = [issue(12, { labels: ["spec", "spec-approved"], comments: [...SENT_COMMENTS] })];
  const { calls, round } = world(issues, { launchToTickets: (a) => launchToTickets(a, fakeOrca(calls, { rename: new Error("rename failed") })) });
  await assert.rejects(round(), /rename failed|term_1/);
  assert.ok(!calls.some((c) => c.startsWith("comment #12 案内役: to-tickets を起動した（")));
  await round(new Set());
  assert.equal(orcaArgv(calls).filter((a) => a[1] === "launch").length, 1, "再起動しない");
});

test("takt-sequence: 渡したマーカーを起動より先に書き、再起動しても渡さない", async () => {
  const issues = [issue(12, { labels: ["spec", "spec-approved"], comments: [...SENT_COMMENTS] }), issue(20, { body: "仕様: #12", subIssues: [{ number: 21, state: "OPEN" }] })];
  const { calls, round } = world(issues);
  await round();
  assert.deepEqual(calls, ["comment #20 案内役: takt-sequence に渡した #21", "takt 21"]);
  await round(new Set());
  assert.equal(calls.length, 2);
});

test("takt-sequence の起動が失敗しても渡したマーカーは残り、再起動で二重に起動しない（成否不明のまま再実行しない）", async () => {
  const issues = [issue(12, { labels: ["spec", "spec-approved"], comments: [...SENT_COMMENTS] }), issue(20, { body: "仕様: #12", subIssues: [{ number: 21, state: "OPEN" }] })];
  const { calls, round } = world(issues, { startTaktSequence: () => { throw new Error("orca failed"); } });
  await assert.rejects(round(), /orca failed/);
  assert.deepEqual(decide({ repo: REPO, viewer: VIEWER, issues, taktIssues: [], dispatched: [] }), []);
  assert.equal(calls.length, 1);
});

// ---- 承認の遷移（Discord → GitHub への書き戻し） ----

const APPROVAL_REPO = "o/live-mindmap";
const OWNER = "U-owner";
const SENDING = "案内役: Discord に承認依頼を送る";

// 偽の GitHub（addLabel はラベルを issue に反映する）と偽の Discord を持つ世界。reactions は issue ごとに外から差し込む。
const approvalWorld = (issues, discordOver = {}) => {
  const calls = [];
  const byNumber = (n) => issues.find((i) => i.number === n);
  const github = {
    comment: (n, body) => { calls.push(`comment #${n} ${body}`); byNumber(n).comments.push({ author: VIEWER, body }); },
    addLabel: (n, label) => { calls.push(`label #${n} ${label}`); byNumber(n).labels.push(label); },
  };
  const discord = {
    ensureChannel: async (name) => { calls.push(`channel ${name}`); return "C1"; },
    sendApprovalRequest: async (req) => { calls.push(`send ${JSON.stringify(req)}`); return { threadId: "555", messageId: "777" }; },
    ...discordOver,
  };
  const deps = {
    github, discord, cwd: "/x", repo: APPROVAL_REPO,
    launchToTickets: (a) => launchToTickets(a, fakeOrca(calls)),
    now: NOW,
    startTaktSequence: ({ issues: is }) => { calls.push(`takt ${is.join(",")}`); },
  };
  const round = (dispatched = new Set()) =>
    runRound({
      readSnapshot: async () => ({ repo: APPROVAL_REPO, viewer: VIEWER, discordUserId: OWNER, issues, taktIssues: [] }),
      execute: createExecute(deps),
      log: () => {},
    }, dispatched);
  return { calls, round };
};
const unapproved = (over = {}) => issue(12, { title: "仕様A", labels: ["spec"], reactions: [], ...over });

test("承認依頼: チャンネル確保 → 「送る」マーカー → 送信 → ID 付きの「送った」マーカーの順に実行する", async () => {
  const issues = [unapproved()];
  const { calls, round } = approvalWorld(issues);
  await round();
  assert.equal(calls.length, 4);
  assert.equal(calls[0], "channel live-mindmap");
  assert.equal(calls[1], `comment #12 ${SENDING}`);
  const req = JSON.parse(calls[2].replace(/^send /, ""));
  assert.equal(req.channelId, "C1");
  assert.equal(req.spec, 12);
  assert.equal(req.title, "仕様A");
  assert.equal(req.url, "https://github.com/o/live-mindmap/issues/12");
  assert.equal(calls[3], "comment #12 案内役: Discord に承認依頼を送った（スレッド 555 / メッセージ 777）");
});

test("承認依頼: 新しい dispatched で回し直しても（再起動しても）再送しない", async () => {
  const issues = [unapproved()];
  const { calls, round } = approvalWorld(issues);
  await round();
  await round(new Set());
  assert.equal(calls.length, 4);
});

test("承認依頼: 送信が失敗しても「送る」マーカーは残り、再起動で二重に送らない", async () => {
  const issues = [unapproved()];
  const { calls, round } = approvalWorld(issues, { sendApprovalRequest: async () => { throw new Error("discord down"); } });
  await assert.rejects(round(), /discord down/);
  assert.deepEqual(calls, ["channel live-mindmap", `comment #12 ${SENDING}`]);
  await round(new Set()).catch(() => {});
  assert.equal(calls.length, 2);
});

test("承認依頼: チャンネルの確保が失敗したらマーカーを書かず、流し直せば送れる", async () => {
  const issues = [unapproved()];
  let fail = true;
  const { calls, round } = approvalWorld(issues, { ensureChannel: async () => { if (fail) throw new Error("discord down"); return "C1"; } });
  await assert.rejects(round(), /discord down/);
  assert.deepEqual(calls, []);
  fail = false;
  await round(new Set());
  assert.equal(calls.length, 3);
});

test("承認: 本人の ✅ で spec-approved ラベルを付け、コメントは書かない。次の周は to-tickets が拾う", async () => {
  const issues = [unapproved({
    comments: [{ author: VIEWER, body: SENDING }, { author: VIEWER, body: "案内役: Discord に承認依頼を送った（スレッド 555 / メッセージ 777）" }],
    reactions: [{ emoji: "✅", userId: OWNER }],
  })];
  const { calls, round } = approvalWorld(issues);
  await round();
  assert.deepEqual(calls, ["label #12 spec-approved"]);
  await round(new Set());
  assert.equal(calls.length, 5);
  assert.equal(calls[0], "label #12 spec-approved");
  assert.equal(calls[1], BEFORE);
  assert.ok(calls[2].startsWith("orca agent launch "));
  assert.ok(calls[3].startsWith("orca terminal rename "));
  assert.equal(calls[4], AFTER);
});

test("差し戻し: 本人の ❌ で issue にコメントを 1 件書き（ラベルは付けない）、再起動しても繰り返さない", async () => {
  const issues = [unapproved({
    comments: [{ author: VIEWER, body: SENDING }, { author: VIEWER, body: "案内役: Discord に承認依頼を送った（スレッド 555 / メッセージ 777）" }],
    reactions: [{ emoji: "❌", userId: OWNER }],
  })];
  const { calls, round } = approvalWorld(issues);
  await round();
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^comment #12 \S/);
  assert.ok(!calls[0].includes(SENDING));
  await round(new Set());
  await round(new Set());
  assert.equal(calls.length, 1);
});

// ---- knowledge: 起動マーカー → knowledge 起動 → PR の読み直し → 自動マージの予約 ----

const KNOWLEDGE_MARKER = "案内役: knowledge を起動した";
const closedIssue = (number) => issue(number, { state: "CLOSED" });

// 仕様 #12・親 #20（sub-issue #21 #22 が閉じている）の世界。runKnowledge が成功すると、viewer の学びの PR #50 が GitHub に現れる。
const knowledgeWorld = (over = {}) => {
  const calls = [];
  const issues = [
    issue(12, { labels: ["spec", "spec-approved"], comments: [...SENT_COMMENTS, { author: VIEWER, body: "案内役: to-tickets を起動した" }, { author: VIEWER, body: "案内役: to-tickets が終わった（exit 0）" }] }),
    issue(20, { body: "仕様: #12", subIssues: [{ number: 21, state: "CLOSED" }, { number: 22, state: "CLOSED" }] }),
    closedIssue(21),
    closedIssue(22),
  ];
  const pullRequests = [];
  const github = {
    comment: (n, body) => { calls.push(`comment #${n} ${body}`); issues.find((i) => i.number === n).comments.push({ author: VIEWER, body }); },
    readPullRequests: () => pullRequests.map((p) => ({ ...p })),
    mergeAuto: (n) => { calls.push(`merge #${n}`); pullRequests.find((p) => p.number === n).autoMerge = true; },
  };
  const deps = {
    github, cwd: "/x", repo: REPO, viewer: VIEWER,
    taktRunDirs: () => ["/w/a/.takt/runs"],
    runKnowledge: async (args) => {
      calls.push(`knowledge ${JSON.stringify(args)}`);
      pullRequests.push({ number: 50, state: "OPEN", author: VIEWER, body: "概要\n学びの元の仕様: #12\n", autoMerge: false });
      return { code: 0, logFile: "l" };
    },
    launchToTickets: async () => assert.fail("to-tickets は起動しない"),
    startTaktSequence: () => assert.fail("takt-sequence は起動しない"),
    ...over,
  };
  const round = (dispatched = new Set()) =>
    runRound({ readSnapshot: async () => ({ repo: REPO, viewer: VIEWER, issues, taktIssues: [], pullRequests: github.readPullRequests() }), execute: createExecute(deps), log: () => {} }, dispatched);
  return { calls, round, pullRequests };
};

test("knowledge: 起動マーカー → knowledge 起動（仕様・親・閉じた sub-issue・run を渡す）→ 作られた PR に自動マージを予約の順に実行する", async () => {
  const { calls, round } = knowledgeWorld();
  await round();
  assert.equal(calls.length, 3);
  assert.equal(calls[0], `comment #12 ${KNOWLEDGE_MARKER}`);
  assert.match(calls[1], /^knowledge /);
  const args = JSON.parse(calls[1].replace(/^knowledge /, ""));
  assert.equal(args.cwd, "/x");
  assert.equal(args.repo, REPO);
  assert.equal(args.spec, 12);
  assert.deepEqual(args.parents, [20]);
  assert.deepEqual(args.subIssues, [21, 22]);
  assert.deepEqual(args.runDirs, ["/w/a/.takt/runs"]);
  assert.equal(calls[2], "merge #50");
});

test("knowledge: 新しい dispatched で回し直しても（再起動しても）二度起動も予約もしない", async () => {
  const { calls, round } = knowledgeWorld();
  await round();
  await round(new Set());
  assert.equal(calls.length, 3);
});

test("knowledge: PR を作った後に exit 1 で止まっても、流し直すと予約だけを行い、予約後はさらに何もしない", async () => {
  let world;
  world = knowledgeWorld({
    runKnowledge: async () => {
      world.pullRequests.push({ number: 50, state: "OPEN", author: VIEWER, body: "学びの元の仕様: #12", autoMerge: false });
      return { code: 1, logFile: "l" };
    },
  });
  await assert.rejects(world.round(), /exit 1/);
  assert.equal(world.calls.length, 1);
  await world.round(new Set());
  assert.equal(world.calls.length, 2);
  assert.equal(world.calls[1], "merge #50");
  await world.round(new Set());
  assert.equal(world.calls.length, 2);
});

test("knowledge: exit が 0 でなければ予約せずに失敗し、起動マーカーは残り、再起動で再度起動しない", async () => {
  const { calls, round } = knowledgeWorld({ runKnowledge: async () => ({ code: 1, logFile: "l" }) });
  await assert.rejects(round(), /exit 1/);
  assert.deepEqual(calls, [`comment #12 ${KNOWLEDGE_MARKER}`]);
  await round(new Set());
  assert.equal(calls.length, 1);
});

test("knowledge: exit 0 でも学びの PR が見つからなければ予約せずに失敗し、再起動で再度起動しない", async () => {
  const { calls, round } = knowledgeWorld({ runKnowledge: async () => ({ code: 0, logFile: "l" }) });
  await assert.rejects(round(), /PR/);
  assert.equal(calls.some((c) => c.startsWith("merge ")), false);
  const before = calls.length;
  await round(new Set());
  assert.equal(calls.length, before);
});

test("knowledge: viewer 以外が作った同じ行の PR は学びの PR と見なさず、予約せずに失敗する", async () => {
  const { calls, round, pullRequests } = knowledgeWorld({ runKnowledge: async () => ({ code: 0, logFile: "l" }) });
  pullRequests.push({ number: 51, state: "OPEN", author: "someone", body: "学びの元の仕様: #12" });
  await assert.rejects(round(), /PR/);
  assert.equal(calls.some((c) => c.startsWith("merge ")), false);
});

test("knowledge: 学びの PR が既にあれば、起動も予約もしない", async () => {
  const { calls, round, pullRequests } = knowledgeWorld();
  pullRequests.push({ number: 49, state: "MERGED", author: VIEWER, body: "学びの元の仕様: #12" });
  await round();
  assert.deepEqual(calls, []);
});

// ---- 判断依頼: マーカーを送信より先に仕様へ書き、送信は既存スレッドへ。再起動しても二度送らない ----

const DECISION_MARKER = "案内役: Discord に判断依頼を送る（#21 takt の ABORT）";
const ABORT_TASK = { issue: 21, kind: "failed", createdAt: "2026-10-16T10:00:00Z", step: "implement", error: "blocked", worktreePath: "/w/21" };

const decisionWorld = (sendOver) => {
  const calls = [];
  const issues = [
    issue(12, { title: "仕様A", labels: ["spec", "spec-approved"], comments: [...SENT_COMMENTS, { author: VIEWER, body: "案内役: to-tickets を起動した" }, { author: VIEWER, body: "案内役: to-tickets が終わった（exit 0）" }] }),
    issue(20, { body: "仕様: #12", subIssues: [{ number: 21, state: "OPEN" }] , comments: [{ author: VIEWER, body: "案内役: takt-sequence に渡した #21" }] }),
    issue(21, { title: "実装A" }),
  ];
  const github = { comment: (n, body) => { calls.push(`comment #${n} ${body}`); issues.find((i) => i.number === n).comments.push({ author: VIEWER, body }); } };
  const discord = {
    sendDecisionRequest: sendOver ?? (async (req) => { calls.push(`decision ${JSON.stringify(req)}`); }),
    ensureChannel: async () => assert.fail("新しいチャンネルは確保しない"),
    sendApprovalRequest: async () => assert.fail("承認依頼は送らない"),
  };
  const deps = {
    github, discord, cwd: "/x", repo: REPO,
    launchToTickets: async () => assert.fail("to-tickets は起動しない"),
    startTaktSequence: () => assert.fail("takt-sequence は起動しない"),
  };
  const round = (dispatched = new Set()) =>
    runRound({ readSnapshot: async () => ({ repo: REPO, viewer: VIEWER, discordUserId: "U", issues, taktIssues: [21], taktTasks: [ABORT_TASK] }), execute: createExecute(deps), log: () => {} }, dispatched);
  return { calls, round };
};

test("判断依頼: 仕様に送信マーカーを書いてから、既存スレッドに止まった issue・理由・レポートの場所つきで送る", async () => {
  const { calls, round } = decisionWorld();
  await round();
  assert.equal(calls.length, 2);
  assert.equal(calls[0], `comment #12 ${DECISION_MARKER}`);
  const req = JSON.parse(calls[1].replace(/^decision /, ""));
  assert.equal(req.threadId, "555");
  assert.equal(req.spec, 12);
  assert.equal(req.issue, 21);
  assert.equal(req.title, "実装A");
  assert.equal(req.url, "https://github.com/o/r/issues/21");
  assert.match(req.reason, /ABORT/);
  assert.ok(req.reason.includes("blocked"));
  assert.equal(req.reports, "/w/21/.takt/runs");
});

test("判断依頼: 新しい dispatched で回し直しても（再起動しても）二度送らない", async () => {
  const { calls, round } = decisionWorld();
  await round();
  await round(new Set());
  await round(new Set());
  assert.equal(calls.length, 2);
});

test("判断依頼: 送信が失敗してもマーカーは残り、再起動で二重に送らない（成否不明のまま再送しない）", async () => {
  const { calls, round } = decisionWorld(async () => { throw new Error("discord down"); });
  await assert.rejects(round(), /discord down/);
  assert.deepEqual(calls, [`comment #12 ${DECISION_MARKER}`]);
  await round(new Set());
  assert.equal(calls.length, 1);
});

// ---- セッションの停止の判断依頼: マーカー → 送信の順。本文に工程・タブの名前・画面の数行・理由が入る ----


const STALL_MARKER = "案内役: Discord に判断依頼を送る（#12 to-tickets のセッションの停止）";
const SCREEN = ["Allow this command? (y/n)", "rm -rf build"];

const stallWorld = (fetchOver) => {
  const calls = [];
  const issues = [
    issue(12, { title: "仕様A", labels: ["spec", "spec-approved"], comments: [...SENT_COMMENTS, { author: VIEWER, body: "案内役: to-tickets を起動する" }, { author: VIEWER, body: AFTER.replace(/^comment #12 /, "") }] }),
  ];
  const github = { comment: (n, body) => { calls.push(`comment #${n} ${body}`); issues.find((i) => i.number === n).comments.push({ author: VIEWER, body }); } };
  const fetch = fetchOver ?? (async (url, init) => { calls.push(`discord ${init.method} ${new URL(url).pathname} ${JSON.parse(init.body).content}`); return { ok: true, status: 200, json: async () => ({ id: "M" }) }; });
  const discord = createDiscord({ token: "t", guildId: "g", userId: "U", fetch });
  const deps = {
    github, discord, cwd: "/x", repo: REPO,
    launchToTickets: async () => assert.fail("to-tickets は起動しない"),
    startTaktSequence: () => assert.fail("takt-sequence は起動しない"),
  };
  const snapshot = () => ({
    repo: REPO, viewer: VIEWER, discordUserId: "U", issues, taktIssues: [], now: "2026-10-17T00:10:00.000Z",
    sessions: { term_1: { found: true, waiting: true, idle: false, startedAt: LAUNCHED_AT, tail: SCREEN } },
  });
  const round = (dispatched = new Set()) => runRound({ readSnapshot: async () => snapshot(), execute: createExecute(deps), log: () => {} }, dispatched);
  return { calls, round };
};

test("セッション停止: 仕様に判断依頼のマーカーを書いてから、承認依頼のスレッドへ送る。本文に工程・仕様・タブの名前・画面の数行・理由が入る", async () => {
  const { calls, round } = stallWorld();
  await round();
  assert.equal(calls.length, 2);
  assert.equal(calls[0], `comment #12 ${STALL_MARKER}`);
  assert.ok(calls[1].startsWith("discord POST /api/v10/channels/555/messages "), calls[1]);
  const content = calls[1].replace(/^discord POST \S+ /, "");
  for (const part of ["to-tickets", "#12", "to-tickets #12", ...SCREEN, "入力待ち"]) assert.ok(content.includes(part), `本文に ${part} が無い: ${content}`);
  assert.ok(content.length <= 2000);
});

test("セッション停止: 新しい dispatched で回し直しても（再起動しても）二度送らない", async () => {
  const { calls, round } = stallWorld();
  await round();
  await round(new Set());
  await round(new Set());
  assert.equal(calls.length, 2);
});

test("セッション停止: 送信が失敗してもマーカーは残り、再起動で再送しない", async () => {
  const { calls, round } = stallWorld(async () => { throw new Error("discord down"); });
  await assert.rejects(round(), /discord down/);
  assert.deepEqual(calls, [`comment #12 ${STALL_MARKER}`]);
  await round(new Set());
  assert.equal(calls.length, 1);
});
