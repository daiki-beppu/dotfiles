// execute.mjs のテスト。コメント・起動は偽物を注入し、書かれたマーカーを次の起動のスナップショットに入れて再起動を再現する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { decide, fogTicketMarker } from "./decide.mjs";
import { createDiscord } from "./discord.mjs";
import { createExecute } from "./execute.mjs";
import { runRound } from "./loop.mjs";
import { launchFormalSpec } from "./formal-spec.mjs";
import { launchKnowledge } from "./knowledge.mjs";
import { launchToSpec } from "./to-spec.mjs";
import { launchToTickets } from "./to-tickets.mjs";
import { launchWayfinder } from "./wayfinder.mjs";
import { REVIEW_FAILED, fixLaunchedMarker, fixLaunchingMarker, redoMarker } from "../../takt/scripts/review-stage.mjs";
import { launchReviewFix } from "./review-fix.mjs";
// readReviewReport（新しい公開物）は名前空間で読む（未実装でも他のテストは動かす）。
import * as T from "./takt.mjs";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = "o/r";
const VIEWER = "me";
// 承認依頼は送り済み（world は discord を渡さないので、マーカーが無いと承認依頼の行動が出てしまう）
const SENT_ONLY = [
  { author: VIEWER, body: "案内役: Discord に承認依頼を送る" },
  { author: VIEWER, body: "案内役: Discord に承認依頼を送った（スレッド 555 / メッセージ 777）" },
];
// formal-spec は起動済みで passed。to-tickets・takt-sequence を見るテストは、この状態から始める。
const FS_DONE = [
  { author: VIEWER, body: "案内役: formal-spec を起動する" },
  { author: VIEWER, body: "## Formal Spec（takt 0.71.0 の検証器で passed）" },
];
const SENT_COMMENTS = [...SENT_ONLY, ...FS_DONE];
const issue = (number, over = {}) => ({ number, state: "OPEN", labels: [], body: "", comments: [], subIssues: [], ...over });

const LAUNCHED_AT = "2026-10-17T00:00:00.000Z";
const NOW = () => new Date(LAUNCHED_AT);
// 実際の `orca agent launch --json` の応答の形（handle は result.outcome.handle）
const launchReply = (handle = "term_1") =>
  JSON.stringify({ result: { outcome: { kind: "terminal", handle }, receipt: { detail: "launched" }, worktreeId: "wt_1" } });
// 偽の orca: 呼ばれた argv を calls に `orca <args>` で記録し、サブコマンドごとの応答（文字列）を返す。reply が Error なら投げる。
const fakeOrca = (calls, { launch = launchReply(), rename = "{}", worktree = JSON.stringify({ ok: true, result: { worktree: { path: "/wt/new" } } }) } = {}) => (args) => {
  calls.push(`orca ${args.join(" ")}`);
  (calls.argvs ??= []).push(args);
  const reply = args[0] === "agent" ? launch : args[0] === "worktree" ? worktree : rename;
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
    launchToSpec: (a) => launchToSpec(a, fakeOrca(calls)),
    launchToTickets: (a) => launchToTickets(a, fakeOrca(calls)),
    launchFormalSpec: (a) => launchFormalSpec(a, fakeOrca(calls)),
    launchWayfinder: (a) => launchWayfinder(a, fakeOrca(calls), (cwd) => calls.push(`git fetch origin @${cwd}`)),
    now: NOW,
    startTaktSequence: ({ issues: is }) => { calls.push(`takt ${is.join(",")}`); return { handle: "term_seq" }; },
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

// ---- formal-spec: 承認依頼を送った仕様に、印 → orca で起動 → handle と時刻の印 ----

const FS_BEFORE = "comment #12 案内役: formal-spec を起動する";
const FS_AFTER = `comment #12 案内役: formal-spec を起動した（ターミナル term_1 / ${LAUNCHED_AT}）`;
const sentOnlyWorld = (over = {}, specOver = {}) => {
  const issues = [issue(12, { labels: ["spec", "spec-approved"], comments: [...SENT_ONLY], ...specOver })];
  return { issues, ...world(issues, over) };
};

test("formal-spec: 起動前の印 → orca agent launch → タブ題名 → handle と時刻つきの印の順に実行し、新しい dispatched で再起動しても出ない", async () => {
  const { calls, round } = sentOnlyWorld();
  await round();
  assert.equal(calls.length, 4);
  assert.equal(calls[0], FS_BEFORE);
  assert.ok(calls[1].startsWith("orca agent launch "), calls[1]);
  assert.ok(calls[2].startsWith("orca terminal rename "), calls[2]);
  assert.equal(calls[3], FS_AFTER);
  await round(new Set());
  assert.equal(calls.length, 4, "to-tickets も出ない（Formal Spec コメントがまだ無い）");
});

test("formal-spec: orca agent launch に claude・main checkout の worktree・プロンプトを渡し、--allowedTools は渡さない", async () => {
  const { calls, round } = sentOnlyWorld();
  await round();
  const launch = orcaArgv(calls)[0];
  assert.deepEqual(launch.slice(0, 7), ["agent", "launch", "--agent", "claude", "--worktree", "path:/x", "--prompt"]);
  assert.equal(launch.at(-1), "--json");
  assert.ok(!launch.includes("--allowedTools"));
  assert.ok(!launch.includes("-p"));
  assert.ok(!orcaArgv(calls).flat().includes("--allowedTools"));
});

test("formal-spec: プロンプトは /formal-spec #仕様 で始まり、確認待ちにせず結果のコメントまで進めること・矛盾なら failed のコメントを書いて終えることを含む", async () => {
  const { calls, round } = sentOnlyWorld();
  await round();
  const prompt = orcaArgv(calls)[0][7];
  assert.equal(prompt.split("\n")[0], "/formal-spec #12");
  assert.match(prompt, /確認待ちにせず/);
  assert.match(prompt, /手順 1/);
  assert.match(prompt, /結果のコメント/);
  assert.match(prompt, /手順 3/);
  assert.match(prompt, /failed/);
});

test("formal-spec: 起動の応答の handle でタブの題名に工程と仕様の番号を入れ、印の handle と時刻は応答と注入した now から取る", async () => {
  const { calls, round } = sentOnlyWorld({
    launchFormalSpec: (a) => launchFormalSpec(a, fakeOrca(calls, { launch: launchReply("term_99") })),
    now: () => new Date("2026-01-02T03:04:05.678Z"),
  });
  await round();
  const rename = orcaArgv(calls)[1];
  assert.deepEqual(rename.slice(0, 4), ["terminal", "rename", "--terminal", "term_99"]);
  const title = rename[rename.indexOf("--title") + 1];
  assert.match(title, /formal-spec/);
  assert.match(title, /#12/);
  assert.equal(calls.at(-1), "comment #12 案内役: formal-spec を起動した（ターミナル term_99 / 2026-01-02T03:04:05.678Z）");
});

test("formal-spec: 応答から handle が取れなければ例外で止まり、起動後の印は書かず、再起動で再度起動しない", async () => {
  for (const launch of ['{"result":{"outcome":{}}}', "launched OK (not json)"]) {
    const { calls, issues, round } = sentOnlyWorld({ launchFormalSpec: (a) => launchFormalSpec(a, fakeOrca(calls, { launch })) });
    await assert.rejects(round(), /handle/, launch);
    assert.equal(calls[0], FS_BEFORE, "印は起動より先");
    assert.ok(!calls.some((c) => c.startsWith("comment #12 案内役: formal-spec を起動した（")), launch);
    assert.ok(issues[0].comments.some((c) => c.body === "案内役: formal-spec を起動する"));
    const before = calls.length;
    await round(new Set());
    assert.equal(calls.length, before, "流し直しても再起動しない");
  }
});

test("formal-spec: orca agent launch 自体が失敗しても起動前の印は残り、再起動で再度起動しない", async () => {
  const { calls, round } = sentOnlyWorld({ launchFormalSpec: (a) => launchFormalSpec(a, fakeOrca(calls, { launch: new Error("orca down") })) });
  await assert.rejects(round(), /orca down/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0], FS_BEFORE);
  await round(new Set());
  assert.equal(calls.length, 2);
});

test("formal-spec: 承認依頼を送る前の仕様では起動しない", async () => {
  const { calls, round } = sentOnlyWorld({}, { comments: [{ author: VIEWER, body: "案内役: Discord に承認依頼を送る" }] });
  await round();
  assert.deepEqual(calls, []);
});

test("formal-spec: 結果が passed になった次の周で to-tickets を起動し、その周では formal-spec を再び起動しない", async () => {
  const { calls, issues, round } = sentOnlyWorld();
  await round();
  assert.equal(calls.length, 4);
  issues[0].comments.push({ author: VIEWER, body: "## Formal Spec（takt 0.71.0 の検証器で passed）" });
  await round(new Set());
  assert.equal(calls.length, 8);
  assert.equal(calls[4], BEFORE);
  assert.equal(orcaArgv(calls).filter((a) => a[1] === "launch").length, 2);
});

test("takt-sequence: 渡した印 → 起動 → handle と起動時刻の印の順に書き、再起動しても渡さない", async () => {
  const issues = [issue(12, { labels: ["spec", "spec-approved"], comments: [...SENT_COMMENTS] }), issue(20, { body: "仕様: #12", subIssues: [{ number: 21, state: "OPEN" }] })];
  const { calls, round } = world(issues);
  await round();
  assert.deepEqual(calls, [
    "comment #20 案内役: takt-sequence に渡した #21",
    "takt 21",
    `comment #20 案内役: takt-sequence を起動した（ターミナル term_seq / ${LAUNCHED_AT}）`,
  ]);
  await round(new Set());
  assert.equal(calls.length, 3);
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
    launchFormalSpec: (a) => launchFormalSpec(a, fakeOrca(calls)),
    now: NOW,
    startTaktSequence: ({ issues: is }) => { calls.push(`takt ${is.join(",")}`); return { handle: "term_seq" }; },
  };
  const round = (dispatched = new Set()) =>
    runRound({
      readSnapshot: async () => ({ repo: APPROVAL_REPO, viewer: VIEWER, discordUserId: OWNER, issues, taktIssues: [] }),
      execute: createExecute(deps),
      log: () => {},
    }, dispatched);
  return { calls, round };
};
// 承認の周の fixture: formal-spec は起動済みで passed（formal-spec の遷移は別のテストで見る）
const SENT_COMMENTS_FOR_APPROVAL = [{ author: VIEWER, body: SENDING }, { author: VIEWER, body: "案内役: Discord に承認依頼を送った（スレッド 555 / メッセージ 777）" }, ...FS_DONE];
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
  // 2 周目は formal-spec を起動するだけで、承認依頼は再送しない
  assert.equal(calls.filter((c) => c.startsWith("send ") || c.startsWith("channel ")).length, 2);
  assert.equal(calls.filter((c) => c.includes(SENDING)).length, 1);
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
    comments: [...SENT_COMMENTS_FOR_APPROVAL],
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
    comments: [...SENT_COMMENTS_FOR_APPROVAL],
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

// ---- knowledge: 起動前の印 → orca で起動 → handle と時刻の印。PR は待たず、予約は次の周の merge-auto が行う ----

const KNOWLEDGE_BEFORE = "comment #12 案内役: knowledge を起動する";
const KNOWLEDGE_AFTER = `comment #12 案内役: knowledge を起動した（ターミナル term_1 / ${LAUNCHED_AT}）`;
const closedIssue = (number) => issue(number, { state: "CLOSED" });

// 仕様 #12・親 #20（sub-issue #21 #22 が閉じている）の世界。pullRequests は GitHub 上の PR で、テストが後から足す。
// readPullRequests は周の頭のスナップショット用に呼ばれ、execute の knowledge からは呼ばれない。
const knowledgeWorld = (over = {}) => {
  const calls = [];
  const issues = [
    issue(12, { labels: ["spec", "spec-approved"], comments: [...SENT_COMMENTS, { author: VIEWER, body: "案内役: to-tickets を起動した" }, { author: VIEWER, body: "案内役: to-tickets が終わった（exit 0）" }] }),
    issue(20, { body: "仕様: #12", subIssues: [{ number: 21, state: "CLOSED" }, { number: 22, state: "CLOSED" }] }),
    closedIssue(21),
    closedIssue(22),
  ];
  const pullRequests = [];
  let inExecute = false;
  const github = {
    comment: (n, body) => { calls.push(`comment #${n} ${body}`); issues.find((i) => i.number === n).comments.push({ author: VIEWER, body }); },
    readPullRequests: () => {
      if (inExecute) assert.fail("execute は PR を読まない");
      return pullRequests.map((p) => ({ ...p }));
    },
    mergeAuto: (n) => { calls.push(`merge #${n}`); pullRequests.find((p) => p.number === n).autoMerge = true; },
  };
  const deps = {
    github, cwd: "/x", repo: REPO,
    now: NOW,
    taktRunDirs: () => ["/w/a/.takt/runs"],
    launchKnowledge: (a) => launchKnowledge(a, fakeOrca(calls)),
    launchToTickets: async () => assert.fail("to-tickets は起動しない"),
    launchFormalSpec: async () => assert.fail("formal-spec は起動しない"),
    startTaktSequence: () => assert.fail("takt-sequence は起動しない"),
    ...over,
  };
  const execute = createExecute(deps);
  const guardedExecute = async (a) => {
    inExecute = true;
    try { return await execute(a); } finally { inExecute = false; }
  };
  const round = (dispatched = new Set()) =>
    runRound({ readSnapshot: async () => ({ repo: REPO, viewer: VIEWER, issues, taktIssues: [], pullRequests: github.readPullRequests() }), execute: guardedExecute, log: () => {} }, dispatched);
  return { calls, round, pullRequests, issues };
};

test("knowledge: 起動前の印 → orca agent launch → タブ題名 → handle と時刻つきの印の順に実行し、PR を待たずに戻る", async () => {
  const { calls, round } = knowledgeWorld();
  await round();
  assert.equal(calls.length, 4);
  assert.equal(calls[0], KNOWLEDGE_BEFORE);
  assert.ok(calls[1].startsWith("orca agent launch "), calls[1]);
  assert.ok(calls[2].startsWith("orca terminal rename "), calls[2]);
  assert.ok(calls[2].includes("--terminal term_1"), calls[2]);
  assert.ok(calls[2].includes("--title knowledge #12"), calls[2]);
  assert.equal(calls[3], KNOWLEDGE_AFTER);
  assert.ok(!calls.some((c) => c.startsWith("merge ")), "execute は予約しない");
});

test("knowledge: 起動後の印の handle は応答から取り、時刻は注入した now の ISO 8601", async () => {
  const { calls, round } = knowledgeWorld({
    launchKnowledge: (a) => launchKnowledge(a, fakeOrca(calls, { launch: launchReply("term_99") })),
    now: () => new Date("2026-01-02T03:04:05.678Z"),
  });
  await round();
  assert.equal(calls.at(-1), "comment #12 案内役: knowledge を起動した（ターミナル term_99 / 2026-01-02T03:04:05.678Z）");
});

test("knowledge: claude をメインの checkout で対話起動し、--allowedTools を渡さない。プロンプトは devlog から knowledge へ進み、仕様・親・sub-issue・run の場所を含む", async () => {
  const { calls, round } = knowledgeWorld();
  await round();
  const launch = orcaArgv(calls).find((a) => a[0] === "agent");
  assert.deepEqual(launch.slice(0, 7), ["agent", "launch", "--agent", "claude", "--worktree", "path:/x", "--prompt"]);
  assert.ok(!launch.includes("--allowedTools"));
  assert.ok(!launch.includes("-p"));
  const prompt = launch[7];
  assert.equal(prompt.split("\n")[0], "/devlog");
  assert.match(prompt, /仕様 #12/);
  assert.match(prompt, /親 issue: #20/);
  assert.match(prompt, /#21 #22/);
  assert.match(prompt, /\/w\/a\/\.takt\/runs/);
  assert.match(prompt, /学びの元の仕様: #12/);
  assert.match(prompt, /knowledge スキル/);
  assert.match(prompt, /1 本の PR/);
  assert.match(prompt, /エントリがすでにあれば、新しく書かずにそれを素材にする/);
  assert.match(prompt, /自動マージの予約は呼び出し側が行う/);
});

test("knowledge: 新しい dispatched で回し直しても（再起動しても）二度起動しない", async () => {
  const { calls, round } = knowledgeWorld();
  await round();
  await round(new Set());
  await round(new Set());
  assert.equal(calls.length, 4);
});

test("knowledge: 起動前の印の後に orca agent launch が失敗しても印は残り、再起動で再度起動しない", async () => {
  const { calls, round, issues } = knowledgeWorld({ launchKnowledge: (a) => launchKnowledge(a, fakeOrca(calls, { launch: new Error("orca down") })) });
  await assert.rejects(round(), /orca down/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0], KNOWLEDGE_BEFORE);
  assert.ok(issues[0].comments.some((c) => c.body === "案内役: knowledge を起動する"));
  await round(new Set());
  assert.equal(calls.length, 2);
});

test("knowledge: 応答から handle が取れなければ例外で止まり、起動後の印は書かず、再起動で再度起動しない", async () => {
  const { calls, round } = knowledgeWorld({ launchKnowledge: (a) => launchKnowledge(a, fakeOrca(calls, { launch: '{"result":{"outcome":{}}}' })) });
  await assert.rejects(round(), /handle/);
  assert.ok(!calls.some((c) => c.startsWith("comment #12 案内役: knowledge を起動した（")));
  const before = calls.length;
  await round(new Set());
  assert.equal(calls.length, before);
});

test("knowledge: 起動した周には PR が無くても例外にならず、PR ができた次の周で予約だけを行い、その次の周は何もしない", async () => {
  const { calls, round, pullRequests } = knowledgeWorld();
  await round();
  assert.equal(calls.length, 4);
  pullRequests.push({ number: 50, state: "OPEN", author: VIEWER, body: "概要\n学びの元の仕様: #12\n", autoMerge: false });
  await round(new Set());
  assert.equal(calls.length, 5);
  assert.equal(calls[4], "merge #50");
  await round(new Set());
  assert.equal(calls.length, 5);
});

test("knowledge: 起動の印がある仕様に、viewer 以外が作った同じ行の PR があっても予約しない。例外にもしない", async () => {
  const { calls, round, pullRequests } = knowledgeWorld();
  await round();
  pullRequests.push({ number: 51, state: "OPEN", author: "someone", body: "学びの元の仕様: #12", autoMerge: false });
  await round(new Set());
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

const decisionWorld = (sendOver, decisionAnswers = {}) => {
  const calls = [];
  const issues = [
    issue(12, { title: "仕様A", labels: ["spec", "spec-approved"], comments: [...SENT_COMMENTS, { author: VIEWER, body: "案内役: to-tickets を起動した" }, { author: VIEWER, body: "案内役: to-tickets が終わった（exit 0）" }] }),
    issue(20, { body: "仕様: #12", subIssues: [{ number: 21, state: "OPEN" }] , comments: [{ author: VIEWER, body: "案内役: takt-sequence に渡した #21" }] }),
    issue(21, { title: "実装A" }),
  ];
  const github = { comment: (n, body) => { calls.push(`comment #${n} ${body}`); issues.find((i) => i.number === n).comments.push({ author: VIEWER, body }); } };
  const discord = {
    sendDecisionRequest: sendOver ?? (async (req) => { calls.push(`decision ${JSON.stringify(req)}`); return { messageId: "M1" }; }),
    ensureChannel: async () => assert.fail("新しいチャンネルは確保しない"),
    sendApprovalRequest: async () => assert.fail("承認依頼は送らない"),
  };
  const deps = {
    github, discord, cwd: "/x", repo: REPO,
    launchToTickets: async () => assert.fail("to-tickets は起動しない"),
    launchFormalSpec: async () => assert.fail("formal-spec は起動しない"),
    startTaktSequence: () => assert.fail("takt-sequence は起動しない"),
  };
  const round = (dispatched = new Set()) =>
    runRound({ readSnapshot: async () => ({ repo: REPO, viewer: VIEWER, discordUserId: "U", issues, taktIssues: [21], taktTasks: [ABORT_TASK], decisionAnswers }), execute: createExecute(deps), log: () => {} }, dispatched);
  return { calls, round };
};

test("判断依頼: 仕様に送信マーカーを書いてから、既存スレッドに止まった issue・理由・レポートの場所つきで送り、送った後にスレッドとメッセージの ID つきの印を仕様に書く", async () => {
  const { calls, round } = decisionWorld();
  await round();
  assert.equal(calls.length, 3);
  assert.equal(calls[0], `comment #12 ${DECISION_MARKER}`);
  assert.equal(calls[2], "comment #12 案内役: Discord に判断依頼を送った（#21 takt の ABORT / スレッド 555 / メッセージ M1）");
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
  assert.equal(calls.length, 3);
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
    launchFormalSpec: async () => assert.fail("formal-spec は起動しない"),
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
  assert.equal(calls.length, 3);
  assert.equal(calls[0], `comment #12 ${STALL_MARKER}`);
  assert.equal(calls[2], "comment #12 案内役: Discord に判断依頼を送った（#12 to-tickets のセッションの停止 / スレッド 555 / メッセージ M）");
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
  assert.equal(calls.length, 3);
});

test("セッション停止: 送信が失敗してもマーカーは残り、再起動で再送しない", async () => {
  const { calls, round } = stallWorld(async () => { throw new Error("discord down"); });
  await assert.rejects(round(), /discord down/);
  assert.deepEqual(calls, [`comment #12 ${STALL_MARKER}`]);
  await round(new Set());
  assert.equal(calls.length, 1);
});

// ---- wayfinder: frontier の ticket にセッションを起動する ----
const WF_BEFORE = (n) => `comment #${n} 案内役: wayfinder を起動する`;
const WF_AFTER = (n) => `comment #${n} 案内役: wayfinder を起動した（ターミナル term_1 / ${LAUNCHED_AT}）`;
const wfTicket = (number, type, over = {}) => issue(number, { labels: [`wayfinder:${type}`], assignees: [], blockedBy: [], ...over });
const wfIssues = (...children) => [
  issue(20, { labels: ["wayfinder:map"], subIssues: children.map((c) => ({ number: c.number, state: c.state })) }),
  ...children,
];

test("wayfinder: ticket に起動前の印 → orca agent launch → タブ題名 → handle と時刻つきの印の順に書く。新しい dispatched で 2 周しても起動は 1 回", async () => {
  const issues = wfIssues(wfTicket(21, "research"));
  const { calls, round } = world(issues);
  await round();
  assert.equal(calls.length, 4);
  assert.equal(calls[0], WF_BEFORE(21));
  assert.ok(calls[1].startsWith("orca agent launch "), calls[1]);
  assert.ok(calls[2].startsWith("orca terminal rename "), calls[2]);
  assert.equal(calls[3], WF_AFTER(21));
  await round(new Set());
  await round();
  assert.equal(calls.length, 4);
});

test("wayfinder: 印は ticket に書く（map には書かない）", async () => {
  const issues = wfIssues(wfTicket(21, "grilling"));
  const { calls, round } = world(issues);
  await round();
  assert.ok(calls.filter((c) => c.startsWith("comment ")).every((c) => c.startsWith("comment #21 ")), calls.join("\n"));
});

test("wayfinder: frontier の 3 件に、同じ周でそれぞれ別のセッションを起動する（1 ticket 1 セッション）", async () => {
  const issues = wfIssues(wfTicket(21, "research"), wfTicket(22, "grilling"), wfTicket(23, "research"));
  const { calls, round } = world(issues);
  await round();
  const launches = orcaArgv(calls).filter((a) => a[0] === "agent");
  assert.equal(launches.length, 3);
  const prompts = launches.map((a) => a[a.indexOf("--prompt") + 1].split("\n")[0]);
  assert.deepEqual(prompts, ["/wayfinder #20 #21", "/wayfinder #20 #22", "/wayfinder #20 #23"]);
});

test("wayfinder: 起動が失敗したら 2 段目の印を書かずに例外になり、再起動しても起動前の印があるので起動し直さない", async () => {
  const issues = wfIssues(wfTicket(21, "research"));
  const calls = [];
  const down = {
    launchWayfinder: (a) => launchWayfinder(a, fakeOrca(calls, { launch: new Error("orca down") }), () => {}),
  };
  const { round } = world(issues, down);
  await assert.rejects(round(), /orca down/);
  assert.equal(issues.find((i) => i.number === 21).comments.length, 1);
  assert.equal(issues.find((i) => i.number === 21).comments[0].body, "案内役: wayfinder を起動する");
  const again = world(issues);
  await again.round(new Set());
  assert.deepEqual(again.calls, []);
});

test("wayfinder: task の ticket は origin/main から作った worktree で起動し、research は main checkout で起動する", async () => {
  const issues = wfIssues(wfTicket(21, "research"), wfTicket(23, "task"));
  const { calls, round } = world(issues);
  await round();
  const create = orcaArgv(calls).filter((a) => a[0] === "worktree");
  assert.equal(create.length, 1);
  assert.ok(create[0].includes("origin/main"));
  const launches = orcaArgv(calls).filter((a) => a[0] === "agent");
  assert.equal(launches[0][launches[0].indexOf("--worktree") + 1], "path:/x");
  assert.equal(launches[1][launches[1].indexOf("--worktree") + 1], "path:/wt/new");
});

// ---- to-spec: 晴れた map に起動前の印 → orca agent launch → 起動後の印を map に書く ----
const TS_BEFORE = "comment #20 案内役: to-spec を起動する";
const TS_AFTER = `comment #20 案内役: to-spec を起動した（ターミナル term_1 / ${LAUNCHED_AT}）`;
const clearMap = () => [
  issue(20, { labels: ["wayfinder:map"], body: "## Not yet specified\n\n<!-- 説明 -->\n\n## Out of scope\n", subIssues: [{ number: 21, state: "CLOSED" }] }),
  issue(21, { state: "CLOSED", labels: ["wayfinder:research"], assignees: [], blockedBy: [] }),
];

test("to-spec: map に起動前の印 → orca agent launch → タブ題名 → handle と時刻つきの印の順に書き、新しい dispatched で 2 周しても起動は 1 回", async () => {
  const issues = clearMap();
  const { calls, round } = world(issues);
  await round();
  assert.equal(calls.length, 4, calls.join("\n"));
  assert.equal(calls[0], TS_BEFORE);
  assert.ok(calls[1].startsWith("orca agent launch "), calls[1]);
  assert.ok(calls[2].startsWith("orca terminal rename "), calls[2]);
  assert.equal(calls[3], TS_AFTER);
  await round(new Set());
  await round();
  assert.equal(calls.length, 4);
});

test("to-spec: orca agent launch に map の番号つきのプロンプトを渡し、印は map にだけ書く", async () => {
  const issues = clearMap();
  const { calls, round } = world(issues);
  await round();
  const launch = orcaArgv(calls)[0];
  assert.deepEqual(launch.slice(0, 7), ["agent", "launch", "--agent", "claude", "--worktree", "path:/x", "--prompt"]);
  assert.equal(launch[7].split("\n")[0], "/to-spec #20");
  assert.ok(calls.filter((c) => c.startsWith("comment ")).every((c) => c.startsWith("comment #20 ")), calls.join("\n"));
  const rename = orcaArgv(calls)[1];
  assert.equal(rename[rename.indexOf("--title") + 1], "to-spec #20");
});

test("to-spec: 起動後の印の handle は応答から、時刻は注入した now から取る", async () => {
  const issues = clearMap();
  const { calls, round } = world(issues, {
    launchToSpec: (a) => launchToSpec(a, fakeOrca(calls, { launch: launchReply("term_99") })),
    now: () => new Date("2026-01-02T03:04:05.678Z"),
  });
  await round();
  assert.equal(calls.at(-1), "comment #20 案内役: to-spec を起動した（ターミナル term_99 / 2026-01-02T03:04:05.678Z）");
});

test("to-spec: 起動が失敗したら 2 段目の印を書かずに例外になり、再起動しても起動前の印があるので起動し直さない", async () => {
  const issues = clearMap();
  const w = world(issues, { launchToSpec: (a) => launchToSpec(a, fakeOrca(w.calls, { launch: new Error("orca down") })) });
  await assert.rejects(w.round(), /orca down/);
  assert.equal(w.calls[0], TS_BEFORE, "印は起動より先");
  assert.deepEqual(issues[0].comments.map((c) => c.body), ["案内役: to-spec を起動する"]);
  const again = world(issues);
  await again.round(new Set());
  assert.deepEqual(again.calls, []);
});

test("to-spec: handle が取れない応答でも、起動前の印だけが残り、再起動しても起動し直さない", async () => {
  const issues = clearMap();
  const calls = [];
  const { round } = world(issues, { launchToSpec: (a) => launchToSpec(a, fakeOrca(calls, { launch: '{"result":{"outcome":{}}}' })) });
  await assert.rejects(round(), /handle/);
  assert.deepEqual(issues[0].comments.map((c) => c.body), ["案内役: to-spec を起動する"]);
  const again = world(issues);
  await again.round(new Set());
  assert.deepEqual(again.calls, []);
});

test("to-spec: 霧が残る map・開いた子がある map では起動しない", async () => {
  const fog = clearMap();
  fog[0].body = "## Not yet specified\n- 認証方式\n";
  fog[0].comments = [byViewer(fogTicketMarker(0)), byViewer("案内役: Discord に判断依頼を送る（#20 霧の残り）")];
  const open = clearMap();
  open[1].state = "OPEN";
  open[1].assignees = ["someone"];
  open[0].subIssues = [{ number: 21, state: "OPEN" }];
  for (const issues of [fog, open]) {
    const { calls, round } = world(issues);
    await round();
    assert.deepEqual(calls, []);
  }
});

// ---- wayfinder の map のスレッド・人が見る ticket・ticket のセッションの停止 ----
const MT_CREATING = "案内役: Discord に map のスレッドを立てる";
const MT_CREATED = "案内役: Discord に map のスレッドを立てた（スレッド T900）";
const HUMAN_MARKER = "案内役: Discord に人が見る ticket を知らせる（#21）";
const TICKET_STALL_MARKER = "案内役: Discord に判断依頼を送る（#21 research のセッションの停止）";
const byViewer = (body) => ({ author: VIEWER, body });

// 偽の GitHub（書いたコメントを次の読み出しで viewer のコメントにする）と偽の Discord。calls に順序つきで記録する。
const mapNoticeWorld = (issues, { discordOver = {}, sessions, now = "2026-10-17T00:10:00.000Z" } = {}) => {
  const calls = [];
  const byNumber = (n) => issues.find((i) => i.number === n);
  const github = {
    comment: (n, body) => { calls.push(`comment #${n} ${body}`); byNumber(n).comments.push(byViewer(body)); },
    // 起こした ticket は open な子として次の読み出しに出る（起動前に claim 済みにして、wayfinder の起動は出さない）。
    createSubIssue: (parent, req) => {
      calls.push(`sub-issue #${parent} ${JSON.stringify(req)}`);
      issues.push(wfTicket(99, "grilling", { title: req.title, assignees: [VIEWER] }));
      byNumber(parent).subIssues.push({ number: 99, state: "OPEN" });
      return 99;
    },
  };
  const discord = {
    ensureChannel: async (name) => { calls.push(`channel ${name}`); return "C1"; },
    createMapThread: async (req) => { calls.push(`thread ${JSON.stringify(req)}`); return { threadId: "T900" }; },
    sendHumanTicket: async (req) => { calls.push(`human ${JSON.stringify(req)}`); },
    sendDecisionRequest: async (req) => { calls.push(`decision ${JSON.stringify(req)}`); return { messageId: "M1" }; },
    ...discordOver,
  };
  const deps = {
    github, discord, cwd: "/x", repo: REPO,
    launchWayfinder: async () => assert.fail("prototype・停止した ticket ではセッションを起動しない"),
    launchToTickets: async () => assert.fail("to-tickets は起動しない"),
    launchFormalSpec: async () => assert.fail("formal-spec は起動しない"),
    now: NOW,
    startTaktSequence: () => assert.fail("takt-sequence は起動しない"),
  };
  const round = (dispatched = new Set()) =>
    runRound({ readSnapshot: async () => ({ repo: REPO, viewer: VIEWER, issues, taktIssues: [], now, sessions }), execute: createExecute(deps), log: () => {} }, dispatched);
  return { calls, round };
};
// 霧が残る map（子がすべて閉じても to-spec を起動しない）。ここで見たいのは map の通知なので、晴れた map にしない。
// 霧の ticket は起こし済みで進まず、霧の残りの判断依頼も送り済みにしておく（その流れは別のテストで見る）。
const FOGGY = "## Not yet specified\n- 残っている問い\n";
const FOG_MARKER = "案内役: Discord に判断依頼を送る（#20 霧の残り）";
const FOG_STUCK = (children) => [byViewer(fogTicketMarker(children - 1)), byViewer(FOG_MARKER)];
const mapIssues = (children, mapComments = []) => [
  issue(20, { title: "地図", labels: ["wayfinder:map"], body: FOGGY, comments: [...FOG_STUCK(children.length), ...mapComments], subIssues: children.map((c) => ({ number: c.number, state: c.state })) }),
  ...children,
];
const protoTicket = (over = {}) => wfTicket(21, "prototype", { title: "見た目の試作", ...over });
const stalledTicket = (over = {}) =>
  wfTicket(21, "research", { title: "調べる ticket", assignees: [VIEWER], comments: [byViewer("案内役: wayfinder を起動する"), byViewer(`案内役: wayfinder を起動した（ターミナル term_1 / ${LAUNCHED_AT}）`)], ...over });
const SCREEN_10 = Array.from({ length: 10 }, (_, i) => `画面 ${i + 1} 行目`);
const gone = { term_1: { found: false, waiting: false, idle: false, tail: [] } };

test("map のスレッド: repo 名のチャンネル確保 → 「立てる」印を map に → スレッド作成（map の題名つき）→ ID つきの「立てた」印を map に、の順に実行する", async () => {
  const { calls, round } = mapNoticeWorld(mapIssues([protoTicket()]));
  await round();
  assert.equal(calls.length, 4);
  assert.equal(calls[0], "channel r");
  assert.equal(calls[1], `comment #20 ${MT_CREATING}`);
  assert.deepEqual(JSON.parse(calls[2].replace(/^thread /, "")), { channelId: "C1", map: 20, title: "地図" });
  assert.equal(calls[3], `comment #20 ${MT_CREATED}`);
});

test("map のスレッド: 新しい dispatched で回し直しても（再起動しても）二重に立てず、次の周から通知を map のスレッドへ送る", async () => {
  const { calls, round } = mapNoticeWorld(mapIssues([protoTicket()]));
  await round();
  await round(new Set());
  await round(new Set());
  assert.equal(calls.filter((c) => c.startsWith("thread ")).length, 1);
  assert.equal(calls.filter((c) => c.startsWith("channel ")).length, 1);
  assert.equal(calls.filter((c) => c.startsWith("human ")).length, 1);
});

test("map のスレッド: 作成が失敗しても「立てる」印は残り、再起動で立て直さない（成否不明のまま再作成しない）", async () => {
  const { calls, round } = mapNoticeWorld(mapIssues([protoTicket()]), { discordOver: { createMapThread: async () => { throw new Error("discord down"); } } });
  await assert.rejects(round(), /discord down/);
  assert.deepEqual(calls, ["channel r", `comment #20 ${MT_CREATING}`]);
  await round(new Set());
  assert.equal(calls.length, 2);
});

test("map のスレッド: チャンネルの確保が失敗したら印を書かず、流し直せば立てられる", async () => {
  let fail = true;
  const { calls, round } = mapNoticeWorld(mapIssues([protoTicket()]), { discordOver: { ensureChannel: async () => { if (fail) throw new Error("no channel"); return "C1"; } } });
  await assert.rejects(round(), /no channel/);
  assert.deepEqual(calls, []);
  fail = false;
  await round(new Set());
  assert.ok(calls.some((c) => c === `comment #20 ${MT_CREATING}`));
});

test("人が見る ticket: 通知の印を map に書いてから、map のスレッドへ ticket の題名とリンクつきで送る。セッションは起動しない", async () => {
  const { calls, round } = mapNoticeWorld(mapIssues([protoTicket()], [byViewer(MT_CREATED)]));
  await round();
  assert.equal(calls.length, 2);
  assert.equal(calls[0], `comment #20 ${HUMAN_MARKER}`);
  assert.deepEqual(JSON.parse(calls[1].replace(/^human /, "")), {
    threadId: "T900", map: 20, ticket: 21, title: "見た目の試作", url: "https://github.com/o/r/issues/21",
  });
});

test("人が見る ticket: 新しい dispatched で回し直しても（再起動しても）二度送らない", async () => {
  const { calls, round } = mapNoticeWorld(mapIssues([protoTicket()], [byViewer(MT_CREATED)]));
  await round();
  await round(new Set());
  await round(new Set());
  assert.equal(calls.length, 2);
});

test("人が見る ticket: 送信が失敗しても印は残り、再起動で再送しない", async () => {
  const { calls, round } = mapNoticeWorld(mapIssues([protoTicket()], [byViewer(MT_CREATED)]), { discordOver: { sendHumanTicket: async () => { throw new Error("discord down"); } } });
  await assert.rejects(round(), /discord down/);
  assert.deepEqual(calls, [`comment #20 ${HUMAN_MARKER}`]);
  await round(new Set());
  assert.equal(calls.length, 1);
});

test("人が見る ticket: 印は ticket ではなく map に書く", async () => {
  const { calls, round } = mapNoticeWorld(mapIssues([protoTicket()], [byViewer(MT_CREATED)]));
  await round();
  assert.ok(calls.filter((c) => c.startsWith("comment ")).every((c) => c.startsWith("comment #20 ")), calls.join("\n"));
});

test("ticket の停止: 判断依頼の印を map に書いてから、map のスレッドへ ticket・タブ・画面・理由つきで送る。印は map に書き、ticket には書かない", async () => {
  const { calls, round } = mapNoticeWorld(mapIssues([stalledTicket()], [byViewer(MT_CREATED)]), { sessions: gone });
  await round();
  assert.equal(calls.length, 3);
  assert.equal(calls[0], `comment #20 ${TICKET_STALL_MARKER}`);
  assert.equal(calls[2], "comment #20 案内役: Discord に判断依頼を送った（#21 research のセッションの停止 / スレッド T900 / メッセージ M1）");
  const req = JSON.parse(calls[1].replace(/^decision /, ""));
  assert.equal(req.threadId, "T900");
  assert.equal(req.map, 20);
  assert.equal(req.issue, 21);
  assert.equal(req.title, "調べる ticket");
  assert.equal(req.url, "https://github.com/o/r/issues/21");
  assert.equal(req.step, "wayfinder");
  assert.equal(req.tab, "wayfinder #21");
  assert.deepEqual(req.tail, []);
  assert.match(req.reason, /見つから/);
  assert.equal(req.spec, undefined);
});

test("ticket の停止: 新しい dispatched で回し直しても（再起動しても）二度送らない", async () => {
  const { calls, round } = mapNoticeWorld(mapIssues([stalledTicket()], [byViewer(MT_CREATED)]), { sessions: gone });
  await round();
  await round(new Set());
  await round(new Set());
  assert.equal(calls.length, 3);
});

test("ticket の停止: 送信が失敗しても印は残り、再起動で再送しない", async () => {
  const { calls, round } = mapNoticeWorld(mapIssues([stalledTicket()], [byViewer(MT_CREATED)]), {
    sessions: gone, discordOver: { sendDecisionRequest: async () => { throw new Error("discord down"); } },
  });
  await assert.rejects(round(), /discord down/);
  assert.deepEqual(calls, [`comment #20 ${TICKET_STALL_MARKER}`]);
  await round(new Set());
  assert.equal(calls.length, 1);
});

test("ticket の停止: スレッドが無い map では、まずスレッドを立て、次の周で判断依頼を新しいスレッドへ送る", async () => {
  const { calls, round } = mapNoticeWorld(mapIssues([stalledTicket()]), { sessions: gone });
  await round();
  assert.deepEqual(calls.map((c) => c.split(" ")[0]), ["channel", "comment", "thread", "comment"]);
  await round(new Set());
  assert.equal(JSON.parse(calls.at(-2).replace(/^decision /, "")).threadId, "T900");
});

test("ticket の停止（Discord アダプタ経由）: 入力待ちの画面の最後の 10 行・理由・ticket・タブの名前が map のスレッドのメッセージに入る", async () => {
  const posts = [];
  const fetch = async (url, init) => { posts.push({ path: new URL(url).pathname, content: JSON.parse(init.body).content }); return { ok: true, status: 200, json: async () => ({ id: "M" }) }; };
  const discord = createDiscord({ token: "t", guildId: "g", userId: "U", fetch });
  const { round } = mapNoticeWorld(mapIssues([stalledTicket()], [byViewer(MT_CREATED)]), {
    discordOver: { sendDecisionRequest: (req) => discord.sendDecisionRequest(req) },
    sessions: { term_1: { found: true, waiting: true, idle: false, tail: SCREEN_10 } },
  });
  await round();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].path, "/api/v10/channels/T900/messages");
  for (const part of ["map #20", "#21", "調べる ticket", "wayfinder #21", "入力待ち", ...SCREEN_10]) assert.ok(posts[0].content.includes(part), `本文に ${part} が無い: ${posts[0].content}`);
});

test("人が見る ticket（Discord アダプタ経由）: スレッドのメッセージに ticket の題名とリンクが入る", async () => {
  const posts = [];
  const fetch = async (url, init) => { posts.push({ path: new URL(url).pathname, content: JSON.parse(init.body).content }); return { ok: true, status: 200, json: async () => ({ id: "M" }) }; };
  const discord = createDiscord({ token: "t", guildId: "g", userId: "U", fetch });
  const { round } = mapNoticeWorld(mapIssues([protoTicket()], [byViewer(MT_CREATED)]), { discordOver: { sendHumanTicket: (req) => discord.sendHumanTicket(req) } });
  await round();
  assert.equal(posts[0].path, "/api/v10/channels/T900/messages");
  assert.ok(posts[0].content.includes("見た目の試作") && posts[0].content.includes("https://github.com/o/r/issues/21"), posts[0].content);
});

test("map のスレッド → 通知 → 停止の流れ: 各行動の印が GitHub に残り、再起動しても同じ行動を繰り返さない", async () => {
  const issues = mapIssues([protoTicket({ number: 22 }), stalledTicket()]);
  const { calls, round } = mapNoticeWorld(issues, { sessions: gone });
  await round();
  await round(new Set());
  await round(new Set());
  const kinds = calls.map((c) => c.split(" ")[0]);
  assert.equal(kinds.filter((k) => k === "thread").length, 1);
  assert.equal(kinds.filter((k) => k === "human").length, 1);
  assert.equal(kinds.filter((k) => k === "decision").length, 1);
});

// ---- grilling の判断依頼 → 書き戻し → 流し込み ----
// 偽の GitHub（書いたコメントを次の読み出しで viewer のコメントにする）・Discord・orca terminal send を同じ calls に順序つきで記録し、
// 実際の decide を通して、行動の順序と、再起動（新しい dispatched）で繰り返さないことを見る。
const OWNER_ID = "U-owner";
const SINCE = "1760000000000";
const GRILLING_SEND = `案内役: Discord に判断依頼を送る（#21 grilling の問い ${SINCE}）`;
const GRILLING_SENT = `案内役: Discord に判断依頼を送った（#21 grilling の問い ${SINCE} / スレッド T900 / メッセージ M1）`;
const GRILLING_WRITTEN = (answer) => `案内役: Discord の回答を書き戻した（#21 grilling の問い ${SINCE}）\n\n${answer}`;
const GRILLING_INJECT = `案内役: 回答をタブに流し込む（#21 grilling の問い ${SINCE}）`;
const QUESTION_COMMENT = "## 判断の問い\n公開 API の名前を v2 にするか？\n- A: する\n- B: しない（推奨）";
const GRILLING_SCREEN = ["❯ 1. A", "  2. B"];
const hookObs = (since = SINCE) => ({ found: true, waiting: true, waitSource: "hook", waitSince: since, idle: false, tail: GRILLING_SCREEN });

const grillingExecWorld = ({ replies = {}, discordOver = {}, sendOver, ticketComments = [], sessions = { term_1: hookObs() } } = {}) => {
  const calls = [];
  const issues = mapIssues(
    [wfTicket(21, "grilling", {
      title: "公開 API の名前", assignees: [VIEWER],
      comments: [byViewer("案内役: wayfinder を起動する"), byViewer(`案内役: wayfinder を起動した（ターミナル term_1 / ${LAUNCHED_AT}）`), byViewer(QUESTION_COMMENT), ...ticketComments],
    })],
    [byViewer(MT_CREATED)],
  );
  const ticket = issues.find((i) => i.number === 21);
  const github = { comment: (n, body) => { calls.push(`comment #${n} ${body}`); issues.find((i) => i.number === n).comments.push(byViewer(body)); } };
  const discord = {
    sendDecisionRequest: async (req) => { calls.push(`decision ${JSON.stringify(req)}`); return { messageId: "M1" }; },
    ...discordOver,
  };
  const deps = {
    github, discord, cwd: "/x", repo: REPO,
    launchWayfinder: async () => assert.fail("grilling のセッションは作り直さない"),
    launchToTickets: async () => assert.fail("to-tickets は起動しない"),
    launchFormalSpec: async () => assert.fail("formal-spec は起動しない"),
    now: NOW,
    startTaktSequence: () => assert.fail("takt-sequence は起動しない"),
    sendToSession: sendOver ?? (async (req) => { calls.push(`send ${JSON.stringify(req)}`); }),
  };
  const state = { replies, sessions };
  const round = (dispatched = new Set()) =>
    runRound({
      readSnapshot: async () => ({ repo: REPO, viewer: VIEWER, discordUserId: OWNER_ID, issues, taktIssues: [], now: "2026-10-17T00:10:00.000Z", sessions: state.sessions, decisionReplies: state.replies }),
      execute: createExecute(deps), log: () => {},
    }, dispatched);
  return { calls, round, state, ticket };
};

test("grilling の判断依頼: 「送る」の印を ticket に → Discord に問いつきで送る → スレッドとメッセージの ID つきの「送った」印を ticket に、の順に実行する", async () => {
  const { calls, round } = grillingExecWorld();
  await round();
  assert.equal(calls.length, 3, calls.join("\n"));
  assert.equal(calls[0], `comment #21 ${GRILLING_SEND}`);
  const req = JSON.parse(calls[1].replace(/^decision /, ""));
  assert.deepEqual([req.threadId, req.map, req.issue, req.title, req.url, req.tab], ["T900", 20, 21, "公開 API の名前", "https://github.com/o/r/issues/21", "wayfinder #21"]);
  assert.deepEqual(req.tail, GRILLING_SCREEN);
  assert.ok(req.question.includes("公開 API の名前を v2 にするか？") && req.question.includes("B: しない（推奨）"), req.question);
  assert.equal(calls[2], `comment #21 ${GRILLING_SENT}`);
});

test("grilling の判断依頼（Discord アダプタ経由）: スレッドのメッセージに ticket の題名・リンク・問いの中身・画面の最後の行が入る。停止の判断依頼は重ならない", async () => {
  const posts = [];
  const fetch = async (url, init) => { posts.push({ path: new URL(url).pathname, content: JSON.parse(init.body).content }); return { ok: true, status: 200, json: async () => ({ id: "M1" }) }; };
  const discord = createDiscord({ token: "t", guildId: "g", userId: OWNER_ID, fetch });
  const { calls, round } = grillingExecWorld({ discordOver: { sendDecisionRequest: (req) => discord.sendDecisionRequest(req) } });
  await round();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].path, "/api/v10/channels/T900/messages");
  for (const part of ["公開 API の名前", "https://github.com/o/r/issues/21", "公開 API の名前を v2 にするか？", "B: しない（推奨）", ...GRILLING_SCREEN]) {
    assert.ok(posts[0].content.includes(part), `本文に ${part} が無い: ${posts[0].content}`);
  }
  assert.ok(calls.includes(`comment #21 ${GRILLING_SENT}`), calls.join("\n"));
  assert.ok(!calls.some((c) => c.includes("grilling のセッションの停止")));
});

test("grilling の判断依頼: 新しい dispatched で回し直しても（再起動しても）二度送らない", async () => {
  const { calls, round } = grillingExecWorld();
  await round();
  await round(new Set());
  await round(new Set());
  assert.equal(calls.filter((c) => c.startsWith("decision ")).length, 1);
  assert.equal(calls.length, 3);
});

test("grilling の判断依頼: 送信が失敗しても「送る」の印は残り、再起動で再送しない（停止の判断依頼にも切り替わらない）", async () => {
  const { calls, round } = grillingExecWorld({ discordOver: { sendDecisionRequest: async () => { throw new Error("discord down"); } } });
  await assert.rejects(round(), /discord down/);
  assert.deepEqual(calls, [`comment #21 ${GRILLING_SEND}`]);
  await round(new Set());
  assert.deepEqual(calls, [`comment #21 ${GRILLING_SEND}`]);
});

test("grilling の書き戻し: 本人の返信を ticket のコメントに書く（1 行目に印、空行、回答）。再起動しても二度書かない", async () => {
  const { calls, round } = grillingExecWorld({ ticketComments: [byViewer(GRILLING_SEND), byViewer(GRILLING_SENT)], replies: { M1: [{ userId: OWNER_ID, content: "B 案で行く" }] } });
  await round();
  assert.deepEqual(calls.filter((c) => !c.startsWith("send ")), [`comment #21 ${GRILLING_WRITTEN("B 案で行く")}`]);
  await round(new Set());
  assert.equal(calls.filter((c) => c.startsWith("comment ") && c.includes("回答を書き戻した")).length, 1);
});

test("grilling の書き戻し: 本人以外の返信だけなら、ticket に何も書かず、タブにも何も送らない", async () => {
  const { calls, round } = grillingExecWorld({ ticketComments: [byViewer(GRILLING_SEND), byViewer(GRILLING_SENT)], replies: { M1: [{ userId: "U-other", content: "勝手な答え" }] } });
  await round();
  await round(new Set());
  assert.deepEqual(calls, []);
});

test("grilling の流し込み: 「流し込む」の印を ticket に → 起動の印の handle のタブへ回答を送る、の順。回答の改行は空白にして 1 行で送る。再起動しても二度送らない", async () => {
  const { calls, round } = grillingExecWorld({ ticketComments: [byViewer(GRILLING_SEND), byViewer(GRILLING_SENT), byViewer(GRILLING_WRITTEN("1 行目\n2 行目"))] });
  await round();
  assert.equal(calls.length, 2, calls.join("\n"));
  assert.equal(calls[0], `comment #21 ${GRILLING_INJECT}`);
  assert.deepEqual(JSON.parse(calls[1].replace(/^send /, "")), { handle: "term_1", text: "1 行目 2 行目" });
  await round(new Set());
  await round(new Set());
  assert.equal(calls.length, 2);
});

test("grilling の流し込み: タブへの送信が失敗しても印は残り、再起動で再送しない", async () => {
  const { calls, round } = grillingExecWorld({
    ticketComments: [byViewer(GRILLING_SEND), byViewer(GRILLING_SENT), byViewer(GRILLING_WRITTEN("B"))],
    sendOver: async () => { throw new Error("orca down"); },
  });
  await assert.rejects(round(), /orca down/);
  assert.deepEqual(calls, [`comment #21 ${GRILLING_INJECT}`]);
  await round(new Set());
  assert.deepEqual(calls, [`comment #21 ${GRILLING_INJECT}`]);
});

test("grilling の流し込み: 書き戻し前は、本人の返信があっても流し込まない（GitHub の書き戻しだけを読む）", async () => {
  const { calls, round, state } = grillingExecWorld({ ticketComments: [byViewer(GRILLING_SEND), byViewer(GRILLING_SENT)], replies: { M1: [{ userId: OWNER_ID, content: "B" }] } });
  await round();
  assert.ok(!calls.some((c) => c.startsWith("send ")), calls.join("\n"));
  assert.equal(state.replies.M1.length, 1);
});

test("grilling の 3 段の流れ: 判断依頼 → 書き戻し → 流し込みを、周ごとに 1 度ずつ。次の入力待ち（別の since）には新しい判断依頼が 1 度出る", async () => {
  const { calls, round, state } = grillingExecWorld();
  const kind = (c) => (c.startsWith("comment ") ? c.split(" ")[2] : c.split(" ")[0]);
  await round();
  assert.deepEqual(calls.map(kind), ["案内役:", "decision", "案内役:"]);
  state.replies = { M1: [{ userId: OWNER_ID, content: "B 案" }] };
  await round(new Set());
  await round(new Set());
  await round(new Set());
  assert.equal(calls.filter((c) => c.includes("回答を書き戻した")).length, 1);
  assert.equal(calls.filter((c) => c.startsWith("send ")).length, 1);
  assert.equal(calls.filter((c) => c.startsWith("decision ")).length, 1);
  const before = calls.length;
  state.sessions = { term_1: hookObs("1760000500000") };
  await round(new Set());
  assert.equal(calls.length, before + 3);
  assert.equal(calls.filter((c) => c.startsWith("decision ")).length, 2);
});

test("霧の残り: 起こす印を map に書いてから、霧の行を本文に持つ grilling の ticket を map の sub-issue に起こす。新しい dispatched で回し直しても二度起こさない", async () => {
  const issues = mapIssues([wfTicket(21, "research", { state: "CLOSED" })], [byViewer(MT_CREATED)]);
  issues[0].comments = issues[0].comments.filter((c) => !FOG_STUCK(1).some((m) => m.body === c.body));
  const { calls, round } = mapNoticeWorld(issues);
  await round();
  assert.equal(calls.length, 2, calls.join("\n"));
  assert.equal(calls[0], `comment #20 ${fogTicketMarker(1)}`);
  const [, parent, req] = /^sub-issue #(\d+) (.*)$/.exec(calls[1]);
  assert.equal(parent, "20");
  const { title, body, labels } = JSON.parse(req);
  assert.equal(title, "残った霧を晴らす（地図）");
  assert.deepEqual(labels, ["wayfinder:grilling"]);
  assert.match(body, /霧:\n- 残っている問い$/);
  await round(new Set());
  assert.equal(calls.length, 2);
});

test("霧の残り: 霧の ticket だけが閉じて霧が残れば、判断依頼の印を map に書いてから、map のスレッドへ霧の行つきで送る。二度送らない", async () => {
  const issues = mapIssues([wfTicket(21, "grilling", { state: "CLOSED" })], [byViewer(MT_CREATED)]);
  issues[0].comments = issues[0].comments.filter((c) => c.body !== FOG_MARKER);
  const { calls, round } = mapNoticeWorld(issues);
  await round();
  assert.equal(calls.length, 3, calls.join("\n"));
  assert.equal(calls[0], `comment #20 ${FOG_MARKER}`);
  assert.equal(calls[2], "comment #20 案内役: Discord に判断依頼を送った（#20 霧の残り / スレッド T900 / メッセージ M1）");
  const req = JSON.parse(calls[1].replace(/^decision /, ""));
  assert.deepEqual({ ...req, reason: undefined }, { threadId: "T900", map: 20, issue: 20, title: "地図", url: `https://github.com/${REPO}/issues/20`, reason: undefined });
  assert.match(req.reason, /霧:\n- 残っている問い$/);
  await round(new Set());
  assert.equal(calls.length, 3);
});

// ---- 仮決めの掲載: 送る前の印 → 送信 → スレッドとメッセージの ID つきの印（印は ticket に書く）----
const PD_BODY = "## 仮決め\n\n### どの parser？\n- 答え: 既存\n- 振り分け: ⓪\n- 理由: 後で替えられる\n- 根拠: [ADR](docs/adr/1.md)\n";
const PD_SENDING_MARKER = "案内役: Discord に仮決めを流す（#21 仮決め 1）";
const PD_SENT_MARKER = "案内役: Discord に仮決めを流した（#21 仮決め 1 / スレッド T900 / メッセージ M42）";
const pdTicket = (over = {}) => wfTicket(21, "grilling", { title: "parser を選ぶ", state: "CLOSED", comments: [byViewer(PD_BODY)], ...over });
// 送信は world の calls（コメントと同じ順序つきの記録）に載せる。
const pdWorld = (issues, { fail = false, reply = "M42" } = {}) => {
  const w = mapNoticeWorld(issues, {
    discordOver: {
      sendProvisionalDecision: async (req) => {
        w.calls.push(`provisional ${JSON.stringify(req)}`);
        if (fail) throw new Error("discord down");
        return { messageId: reply };
      },
    },
  });
  return w;
};
const pdReq = (call) => JSON.parse(call.replace(/^provisional /, ""));

test("仮決め: 送る前の印を ticket に書く → map のスレッドへ題名・リンク・判断・理由・根拠つきで送る → スレッドとメッセージの ID つきの印を ticket に書く、の順に実行する", async () => {
  const { calls, round } = pdWorld(mapIssues([pdTicket()], [byViewer(MT_CREATED)]));
  await round();
  assert.equal(calls.length, 3, calls.join("\n"));
  assert.equal(calls[0], `comment #21 ${PD_SENDING_MARKER}`);
  assert.deepEqual(pdReq(calls[1]), {
    threadId: "T900", map: 20, ticket: 21, title: "parser を選ぶ", url: "https://github.com/o/r/issues/21",
    question: "どの parser？", answer: "既存", reason: "後で替えられる", evidence: "[ADR](docs/adr/1.md)",
  });
  assert.equal(calls[2], `comment #21 ${PD_SENT_MARKER}`);
});

test("仮決め: 仮決めが 2 件なら、1 件ずつ「印 → 送信 → ID つきの印」を実行し、番号ごとの印を書く", async () => {
  const body = `${PD_BODY}\n### 名前は？\n- 答え: foo\n- 振り分け: ③\n- 理由: 内部名\n- 根拠: なし\n`;
  const { calls, round } = pdWorld(mapIssues([pdTicket({ comments: [byViewer(body)] })], [byViewer(MT_CREATED)]));
  await round();
  assert.equal(calls.filter((c) => c.startsWith("provisional ")).length, 2);
  assert.ok(calls.includes("comment #21 案内役: Discord に仮決めを流す（#21 仮決め 2）"), calls.join("\n"));
  assert.ok(calls.includes("comment #21 案内役: Discord に仮決めを流した（#21 仮決め 2 / スレッド T900 / メッセージ M42）"), calls.join("\n"));
  const first = calls.findIndex((c) => c === `comment #21 ${PD_SENDING_MARKER}`);
  assert.ok(first >= 0 && calls[first + 1].startsWith("provisional "), calls.join("\n"));
});

test("仮決め: 新しい dispatched で回し直しても（再起動しても）二度送らない", async () => {
  const { calls, round } = pdWorld(mapIssues([pdTicket()], [byViewer(MT_CREATED)]));
  await round();
  await round(new Set());
  await round(new Set());
  assert.equal(calls.filter((c) => c.startsWith("provisional ")).length, 1);
  assert.equal(calls.length, 3);
});

test("仮決め: 送信が失敗したら ID つきの印は書かず、送る前の印は残り、再起動で再送しない", async () => {
  const { calls, round } = pdWorld(mapIssues([pdTicket()], [byViewer(MT_CREATED)]), { fail: true });
  await assert.rejects(round(), /discord down/);
  assert.ok(!calls.some((c) => c.startsWith("comment #21 案内役: Discord に仮決めを流した")), calls.join("\n"));
  assert.equal(calls[0], `comment #21 ${PD_SENDING_MARKER}`);
  await round(new Set());
  assert.equal(calls.filter((c) => c.startsWith("provisional ")).length, 1);
});

test("仮決め: 印は map ではなく ticket に書く。仮決めの無い resolution では何も送らず何も書かない", async () => {
  const w = pdWorld(mapIssues([pdTicket()], [byViewer(MT_CREATED)]));
  await w.round();
  assert.ok(w.calls.filter((c) => c.startsWith("comment ")).every((c) => c.startsWith("comment #21 ")), w.calls.join("\n"));
  const none = pdWorld(mapIssues([pdTicket({ comments: [byViewer("## 結果\n\n調べた。")] })], [byViewer(MT_CREATED)]));
  await none.round();
  assert.deepEqual(none.calls, []);
});

test("仮決め: map のスレッドが無ければ、先にスレッドを立て、次の周で掲載する", async () => {
  const { calls, round } = pdWorld(mapIssues([pdTicket()]));
  await round();
  assert.ok(!calls.some((c) => c.startsWith("provisional ")));
  assert.ok(calls.some((c) => c.startsWith("thread ")), calls.join("\n"));
  await round(new Set());
  assert.equal(calls.filter((c) => c.startsWith("provisional ")).length, 1);
  assert.equal(pdReq(calls.find((c) => c.startsWith("provisional "))).threadId, "T900");
});

// ---- 仮決めの差し戻し: ticket に書き戻す → 開き直す → claim を外す。開き直した ticket は次の周で新しい回として 1 度だけ起動する ----
const RJ_OWNER = "U-owner";
const RJ_SENT = byViewer("案内役: Discord に仮決めを流した（#21 仮決め 1 / スレッド T900 / メッセージ M42）");
const RJ_MARKER = "案内役: Discord で仮決めが差し戻された（#21 仮決め 1）";
// 偽の GitHub は reopen・removeAssignees の結果を次の読み出しに反映する（開き直した ticket が frontier に戻る流れを周をまたいで再現する）。
const rejectWorld = ({ failOn, mapBody = FOGGY } = {}) => {
  const ticket = wfTicket(21, "grilling", {
    title: "parser を選ぶ", state: "CLOSED", assignees: [VIEWER],
    comments: [byViewer(PD_BODY), byViewer(PD_SENDING_MARKER), RJ_SENT, byViewer("案内役: wayfinder を起動する"), byViewer(`案内役: wayfinder を起動した（ターミナル term_old / ${LAUNCHED_AT}）`)],
  });
  const issues = [issue(20, { title: "地図", labels: ["wayfinder:map"], body: mapBody, comments: [...FOG_STUCK(1), byViewer(MT_CREATED)], subIssues: [] }), ticket];
  const calls = [];
  const github = {
    comment: (n, body) => { calls.push(`comment #${n} ${body}`); issues.find((i) => i.number === n).comments.push(byViewer(body)); },
    reopen: (n) => { calls.push(`reopen #${n}`); if (failOn === "reopen") throw new Error("gh down"); ticket.state = "OPEN"; },
    removeAssignees: (n, logins) => { calls.push(`unassign #${n} ${logins.join(",")}`); ticket.assignees = []; },
  };
  const deps = {
    github, cwd: "/x", repo: REPO,
    launchWayfinder: (a) => launchWayfinder(a, fakeOrca(calls), () => {}),
    launchToSpec: (a) => launchToSpec(a, fakeOrca(calls)),
    now: NOW,
    discord: {},
  };
  const round = (dispatched = new Set()) => {
    issues[0].subIssues = [{ number: 21, state: ticket.state }];
    return runRound(
      {
        readSnapshot: async () => ({
          repo: REPO, viewer: VIEWER, issues: structuredClone(issues), taktIssues: [], discordUserId: RJ_OWNER,
          provisionalReactions: { M42: [{ emoji: "❌", userId: RJ_OWNER }] },
        }),
        execute: createExecute(deps), log: () => {},
      },
      dispatched,
    );
  };
  return { calls, round, ticket, issues };
};
const rjKinds = (calls) => calls.map((c) => c.split(" ")[0] + (c.startsWith("comment ") ? ` ${c.split(" ")[1]}` : ""));

test("差し戻し: 書き戻しのコメント → 開き直し → assignee の解除、の順に 1 度だけ実行する。書き戻しは ticket に問いと答えつきで書く", async () => {
  const w = rejectWorld();
  await w.round();
  const first = w.calls.slice(0, 3);
  assert.ok(first[0].startsWith(`comment #21 ${RJ_MARKER}`), first[0]);
  assert.ok(first[0].includes("- 問い: どの parser？") && first[0].includes("- 答え: 既存"), first[0]);
  assert.deepEqual(first.slice(1), ["reopen #21", `unassign #21 ${VIEWER}`]);
});

test("差し戻し: 周をまとめて回しても、書き戻し・開き直しは 1 度だけ。開き直した ticket には次の周で新しい回の起動が 1 度だけ出る（新しい dispatched でも二重にならない）", async () => {
  const w = rejectWorld();
  await w.round();
  await w.round();
  await w.round(new Set());
  await w.round(new Set());
  assert.equal(w.calls.filter((c) => c.startsWith(`comment #21 ${RJ_MARKER}`)).length, 1, w.calls.join("\n"));
  assert.equal(w.calls.filter((c) => c === "reopen #21").length, 1);
  assert.equal(w.calls.filter((c) => c.startsWith("unassign ")).length, 1);
  assert.equal(orcaArgv(w.calls).filter((a) => a[0] === "agent").length, 1, w.calls.join("\n"));
  // 書き戻しの後に書かれた印は、新しい回の起動前と起動後の 2 件だけ。
  const bodies = w.ticket.comments.map((c) => c.body);
  assert.deepEqual(bodies.slice(bodies.findIndex((b) => b.startsWith(RJ_MARKER)) + 1), ["案内役: wayfinder を起動する", `案内役: wayfinder を起動した（ターミナル term_1 / ${LAUNCHED_AT}）`]);
});

test("差し戻し × to-spec: 開き直される子を持つ晴れた map には、同じ周で to-spec の印も起動も出ない。子が再び閉じた周で 1 度だけ起動する", async () => {
  const w = rejectWorld({ mapBody: "## Not yet specified\n\n<!-- 説明 -->\n" });
  const mapComments = () => w.issues[0].comments.map((c) => c.body);
  await w.round();
  assert.deepEqual(rjKinds(w.calls).slice(0, 3), ["comment #21", "reopen", "unassign"], w.calls.join("\n"));
  assert.ok(!w.calls.some((c) => c.startsWith("comment #20 案内役: to-spec")), w.calls.join("\n"));
  assert.ok(!orcaArgv(w.calls).some((a) => a[0] === "agent" && String(a[a.indexOf("--prompt") + 1]).startsWith("/to-spec")));
  assert.ok(!mapComments().some((b) => b.startsWith("案内役: to-spec")));
  // 開き直した子が再び閉じる（書き戻しの印は残る）。
  w.ticket.state = "CLOSED";
  await w.round(new Set());
  assert.equal(w.calls.filter((c) => c.startsWith("comment #20 案内役: to-spec を起動する")).length, 1, w.calls.join("\n"));
  assert.equal(w.calls.filter((c) => c.startsWith("comment #20 案内役: to-spec を起動した")).length, 1);
  assert.equal(orcaArgv(w.calls).filter((a) => a[0] === "agent" && String(a[a.indexOf("--prompt") + 1]).startsWith("/to-spec #20")).length, 1);
});

test("差し戻し: 開き直しが失敗したら例外になり、書き戻しの印は残るので、再起動しても書き戻しをやり直さない", async () => {
  const w = rejectWorld({ failOn: "reopen" });
  await assert.rejects(w.round(), /gh down/);
  assert.equal(w.calls.filter((c) => c.startsWith(`comment #21 ${RJ_MARKER}`)).length, 1);
  assert.equal(rjKinds(w.calls)[0], "comment #21");
  await w.round(new Set());
  assert.equal(w.calls.filter((c) => c.startsWith(`comment #21 ${RJ_MARKER}`)).length, 1, w.calls.join("\n"));
});

// ---- review-fix: 失敗した PR に修正のセッションを起動する ----


const RF_HEAD = "c".repeat(40);
const rfIssues = () => {
  const pr = { issue: 21, number: 70, state: "OPEN", head: RF_HEAD, headBranch: "feat/21", comments: [{ author: VIEWER, body: `${REVIEW_FAILED} for head ${RF_HEAD}: 指摘が残っている` }] };
  const issues = [
    issue(12, { labels: ["spec", "spec-approved"], comments: SENT_COMMENTS }),
    issue(20, { body: "仕様: #12", comments: [{ author: VIEWER, body: "案内役: takt-sequence に渡した #21" }, { author: VIEWER, body: `案内役: takt-sequence を起動した（ターミナル term_s / ${LAUNCHED_AT}）` }], subIssues: [{ number: 21, state: "OPEN" }] }),
    issue(21),
  ];
  return { issues, pr };
};
// PR #70 は issues の外にあるので、comment の書き込みは PR のコメント列に足す。
const rfWorld = (over = {}) => {
  const { issues, pr } = rfIssues();
  const calls = [];
  const git = (args, opts) => calls.push(`git ${args.join(" ")} @${opts?.cwd}`);
  const github = { comment: (n, body) => { calls.push(`comment #${n} ${body}`); if (n === 70) pr.comments.push({ author: VIEWER, body }); } };
  const deps = {
    github, cwd: "/x", repo: REPO, now: NOW,
    launchReviewFix: (a) => launchReviewFix(a, fakeOrca(calls), git),
    ...over,
  };
  const round = (dispatched = new Set()) =>
    runRound(
      {
        readSnapshot: async () => ({
          repo: REPO, viewer: VIEWER, issues, taktIssues: [21],
          taktTasks: [{ issue: 21, kind: "completed", createdAt: "2026-10-17T00:00:00Z", prUrl: "https://github.com/o/r/pull/70" }],
          pullRequests: [{ number: 70, state: "OPEN", author: VIEWER, body: "", autoMerge: false, head: RF_HEAD, headBranch: "feat/21" }],
          reviewPullRequests: [{ ...pr, comments: [...pr.comments] }],
          mergeTasks: [],
        }),
        execute: createExecute(deps),
        log: () => {},
      },
      dispatched,
    );
  return { calls, round, pr };
};
const RF_BEFORE = `comment #70 ${fixLaunchingMarker(RF_HEAD)}`;
const RF_AFTER = `comment #70 ${fixLaunchedMarker(RF_HEAD, "term_1", LAUNCHED_AT)}`;
const rfLaunchIndex = (calls) => calls.findIndex((c) => c.startsWith("orca agent launch "));

test("review-fix: PR に起動前の印 → 起動 → handle と時刻つきの印の順に書く（#360 の文言）。新しい dispatched で 2 周しても起動は 1 回", async () => {
  const { calls, round } = rfWorld();
  await round();
  assert.equal(calls[0], RF_BEFORE);
  const launch = rfLaunchIndex(calls);
  assert.ok(launch > 0, calls.join("\n"));
  assert.equal(calls.at(-1), RF_AFTER);
  assert.ok(calls.indexOf(RF_BEFORE) < launch && launch < calls.indexOf(RF_AFTER));
  const count = calls.length;
  await round(new Set());
  await round();
  assert.equal(calls.length, count);
});

test("review-fix: 印は PR に書く（sub-issue・親・仕様には書かない）", async () => {
  const { calls, round } = rfWorld();
  await round();
  const comments = calls.filter((c) => c.startsWith("comment "));
  assert.equal(comments.length, 2);
  assert.ok(comments.every((c) => c.startsWith("comment #70 ")), comments.join("\n"));
});

test("review-fix: 起動は PR の head ブランチの worktree で行う（origin/<ブランチ> を base にして worktree を作る）", async () => {
  const { calls, round } = rfWorld();
  await round();
  assert.ok(calls.some((c) => c.startsWith("orca worktree create ") && c.includes("--base-branch origin/feat/21")), calls.join("\n"));
  const launch = calls[rfLaunchIndex(calls)];
  assert.ok(launch.includes("--worktree path:/wt/new"), launch);
});

test("review-fix: 起動が失敗したら 2 段目の印を書かずに例外になり、再起動しても起動前の印があるので起動し直さない", async () => {
  const { calls, round, pr } = rfWorld({ launchReviewFix: (a) => launchReviewFix(a, fakeOrca([], { launch: new Error("orca down") }), () => {}) });
  await assert.rejects(round(), /orca down/);
  assert.deepEqual(calls, [RF_BEFORE]);
  assert.equal(pr.comments.at(-1).body, fixLaunchingMarker(RF_HEAD));
  const again = rfWorld();
  // 前の世界の PR のコメント（起動前の印）を引き継いだ状態で、新しい案内役が周回する
  again.pr.comments.push({ author: VIEWER, body: fixLaunchingMarker(RF_HEAD) });
  await again.round(new Set());
  assert.deepEqual(again.calls, []);
});

// ---- takt のレビュー失敗の判断依頼: 仕様に印 → 送信の順。本文に PR・sub-issue・判定・判定できなかった理由・レポートの場所が入る ----
// 実物の readReviewReport（偽のレポートを置いた一時ディレクトリを読む）と、実物の createDiscord（偽の fetch）を通して、Discord に届く本文を見る。

const RD_HEAD = "d".repeat(40);
const RD_OTHER = ["e".repeat(40), "f".repeat(40)];
const RD_MARKER = "案内役: Discord に判断依頼を送る（#70 takt のレビュー失敗）";
const rdRunDir = (resolution) => {
  const dir = mkdtempSync(join(tmpdir(), "rd-run-"));
  if (resolution !== undefined) {
    mkdirSync(join(dir, "reports", "call-1"), { recursive: true });
    writeFileSync(join(dir, "reports", "call-1", "review-resolution.md"), resolution);
  }
  return dir;
};
const BLOCKED_REPORT = "# 最終検証結果\n\n## 結果: BLOCKED\n\n## 判定不能の理由（BLOCKED の場合）\n- 実機の結果が無い\n";
const rdCommentOf = (body, createdAt) => ({ author: VIEWER, body, createdAt });
// path: limit（修正の起動が上限）/ redo（やり直しの後にまた失敗）/ crash（レビューそのものが落ちた）。どれも同じ実行経路を通る。
const rdWorld = ({ path = "limit", runDir, fetchResult = { ok: true }, sessions, mergeHead } = {}) => {
  const calls = [];
  const posts = [];
  const failedComment = rdCommentOf(`${REVIEW_FAILED} for head ${RD_HEAD}: 指摘が残っている`, "2026-10-17T00:10:00Z");
  const prComments = {
    limit: [rdCommentOf(fixLaunchingMarker(RD_OTHER[0])), rdCommentOf(fixLaunchingMarker(RD_OTHER[1])), failedComment],
    redo: [failedComment, rdCommentOf(redoMarker(RD_HEAD), "2026-10-17T00:20:00Z"), { ...failedComment, createdAt: "2026-10-17T00:30:00Z" }],
    crash: [],
    stall: [failedComment, rdCommentOf(fixLaunchingMarker(RD_HEAD)), rdCommentOf(fixLaunchedMarker(RD_HEAD, "term_f", LAUNCHED_AT))],
  }[path];
  const failedMerge = (createdAt) => ({ prNumber: 70, kind: "failed", createdAt, initialHead: RD_HEAD, pushedHead: null, reports: runDir });
  const mergeRows = { limit: [failedMerge("2026-10-17T00:11:00Z")], redo: [failedMerge("2026-10-17T00:31:00Z")], crash: [failedMerge("2026-10-17T00:11:00Z"), failedMerge("2026-10-17T00:21:00Z")], stall: [failedMerge("2026-10-17T00:11:00Z"), ...(mergeHead === undefined ? [] : [{ ...failedMerge("2026-10-17T00:12:00Z"), initialHead: mergeHead }])] }[path];
  const issues = [
    issue(12, { title: "仕様A", labels: ["spec", "spec-approved"], comments: [...SENT_COMMENTS] }),
    issue(20, { body: "仕様: #12", comments: [{ author: VIEWER, body: "案内役: takt-sequence に渡した #21" }, { author: VIEWER, body: `案内役: takt-sequence を起動した（ターミナル term_s / ${LAUNCHED_AT}）` }], subIssues: [{ number: 21, state: "OPEN" }] }),
    issue(21, { title: "実装A" }),
  ];
  const fetch = async (url, init) => {
    const content = JSON.parse(init.body).content;
    calls.push(`post ${new URL(url).pathname}`);
    posts.push(content);
    if (fetchResult.ok) return { ok: true, status: 200, json: async () => ({ id: "M" }) };
    return { ok: false, status: 500, json: async () => ({}) };
  };
  const discord = createDiscord({ token: "t", guildId: "g", userId: "U", fetch });
  const github = {
    comment: (n, body) => {
      calls.push(`comment #${n} ${body}`);
      if (n === 12) issues[0].comments.push({ author: VIEWER, body });
    },
  };
  const round = (dispatched = new Set()) =>
    runRound(
      {
        readSnapshot: async () => ({
          repo: REPO, viewer: VIEWER, issues: issues.map((i) => ({ ...i, comments: [...i.comments] })), taktIssues: [21],
          taktTasks: [{ issue: 21, kind: "completed", createdAt: "2026-10-17T00:00:00Z", prUrl: "https://github.com/o/r/pull/70" }],
          pullRequests: [{ number: 70, state: "OPEN", author: VIEWER, body: "", autoMerge: false, head: RD_HEAD, headBranch: "feat/21" }],
          reviewPullRequests: [{ spec: 12, issue: 21, number: 70, state: "OPEN", head: RD_HEAD, headBranch: "feat/21", comments: [...prComments] }],
          mergeTasks: mergeRows,
          sessions,
        }),
        execute: createExecute({ github, discord, cwd: "/x", repo: REPO, now: NOW, readReviewReport: T.readReviewReport }),
        log: () => {},
      },
      dispatched,
    );
  return { calls, posts, round };
};
for (const path of ["limit", "redo", "crash"]) {
  test(`レビュー失敗の判断依頼（${path}）: 仕様に印を書いてから、仕様の承認依頼のスレッドへ、PR・sub-issue・判定・判定できなかった理由・PR の URL・レポートの場所つきで送る`, async () => {
    const runDir = rdRunDir(BLOCKED_REPORT);
    const { calls, posts, round } = rdWorld({ path, runDir });
    await round();
    assert.deepEqual(calls, [`comment #12 ${RD_MARKER}`, "post /api/v10/channels/555/messages", "comment #12 案内役: Discord に判断依頼を送った（#70 takt のレビュー失敗 / スレッド 555 / メッセージ M）"]);
    assert.equal(posts.length, 1);
    for (const part of ["#12", "#70", "#21", "実装A", "判定: BLOCKED", "実機の結果が無い", "https://github.com/o/r/pull/70", runDir]) {
      assert.ok(posts[0].includes(part), `本文に ${part} が無い: ${posts[0]}`);
    }
    assert.ok(posts[0].length <= 2000);
  });
}

test("レビュー失敗の判断依頼: 他のレポートの判定や .takt-report-internal の履歴を判定にしない。判定できなかった理由が無ければ記録なしの文言を本文に入れる", async () => {
  const dir = rdRunDir();
  mkdirSync(join(dir, "reports", "call-1"), { recursive: true });
  writeFileSync(join(dir, "reports", "call-1", "architecture-review.md"), "## 結果: APPROVE\n");
  mkdirSync(join(dir, "reports", ".takt-report-internal"), { recursive: true });
  writeFileSync(join(dir, "reports", ".takt-report-internal", "review-resolution.md"), "## 結果: REJECT\n");
  const { posts, round } = rdWorld({ path: "limit", runDir: dir });
  await round();
  assert.ok(posts[0].includes("判定: （レポートに判定が無い）"), posts[0]);
  assert.ok(posts[0].includes("（判定不能の理由の記録なし）"), posts[0]);
  assert.ok(!posts[0].includes("APPROVE") && !posts[0].includes("REJECT"), posts[0]);
});

test("レビュー失敗の判断依頼: run のレポートが読めなくても（ディレクトリが無い）例外にせず、印を書いて、記録なしの文言で送る", async () => {
  const { calls, posts, round } = rdWorld({ path: "crash", runDir: join(tmpdir(), "rd-run-not-exist") });
  await round();
  assert.equal(calls[0], `comment #12 ${RD_MARKER}`);
  assert.equal(posts.length, 1);
  assert.ok(posts[0].includes("（レポートに判定が無い）"), posts[0]);
});

test("レビュー失敗の判断依頼: 新しい dispatched で何周しても（再起動しても）二度送らない。印は 1 件", async () => {
  const { calls, posts, round } = rdWorld({ path: "redo", runDir: rdRunDir(BLOCKED_REPORT) });
  await round();
  await round(new Set());
  await round(new Set());
  assert.equal(posts.length, 1);
  assert.equal(calls.filter((c) => c === `comment #12 ${RD_MARKER}`).length, 1);
});

test("レビュー失敗の判断依頼: 送信が失敗しても印は残り、再起動で二重に送らない（成否不明のまま再送しない）", async () => {
  const { calls, round } = rdWorld({ path: "limit", runDir: rdRunDir(BLOCKED_REPORT), fetchResult: { ok: false } });
  await assert.rejects(round(), /500/);
  assert.equal(calls[0], `comment #12 ${RD_MARKER}`);
  const count = calls.length;
  await round(new Set());
  assert.equal(calls.length, count);
});

test("レビュー失敗の判断依頼: 印は仕様に書く（PR・sub-issue・親には書かない）", async () => {
  const { calls, round } = rdWorld({ path: "limit", runDir: rdRunDir(BLOCKED_REPORT) });
  await round();
  const comments = calls.filter((c) => c.startsWith("comment "));
  assert.equal(comments.length, 2);
  assert.ok(comments.every((c) => c.startsWith("comment #12 ")), comments.join("\n"));
});

// ---- 修正のセッションの停止の判断依頼: 同じ本文の項目（PR・sub-issue・判定・判定できなかった理由・レポートの場所）に、工程・タブ・画面の行が加わる ----
const RD_STALL_MARKER = "案内役: Discord に判断依頼を送る（#70 review-fix のセッションの停止）";
const stallSessions = (tail) => ({ term_f: { found: true, waiting: true, waitSource: "hook", tail } });

test("修正のセッションの停止の判断依頼: 仕様に印を書いてから、PR・sub-issue・判定・判定できなかった理由・レポートの場所・工程・タブ・画面の行つきで 2000 文字以内に送る", async () => {
  const runDir = rdRunDir(BLOCKED_REPORT);
  const { calls, posts, round } = rdWorld({ path: "stall", runDir, sessions: stallSessions(["許可を待っている", "y/n"]) });
  await round();
  assert.deepEqual(calls, [`comment #12 ${RD_STALL_MARKER}`, "post /api/v10/channels/555/messages", "comment #12 案内役: Discord に判断依頼を送った（#70 review-fix のセッションの停止 / スレッド 555 / メッセージ M）"]);
  for (const part of ["PR: #70", "sub-issue: #21", "判定: BLOCKED", "実機の結果が無い", runDir, "review-fix #70", "工程: review-fix", "許可を待っている", "入力待ち"]) {
    assert.ok(posts[0].includes(part), `本文に ${part} が無い: ${posts[0]}`);
  }
  assert.ok(posts[0].length <= 2000);
});

test("修正のセッションの停止の判断依頼: 理由・判定できなかった理由・画面が長くても 2000 文字以内で、PR・sub-issue・判定・レポートの場所は残る", async () => {
  const runDir = rdRunDir(`## 結果: BLOCKED\n\n## 判定不能の理由\n${"あ".repeat(5000)}\n`);
  const { posts, round } = rdWorld({ path: "stall", runDir, sessions: stallSessions(Array.from({ length: 10 }, () => "画".repeat(500))) });
  await round();
  assert.ok(posts[0].length <= 2000, String(posts[0].length));
  for (const part of ["PR: #70", "sub-issue: #21", "判定: BLOCKED", runDir, "review-fix #70"]) assert.ok(posts[0].includes(part), `本文に ${part} が無い`);
});

test("修正のセッションの停止の判断依頼: H を扱った merge タスクが無ければ記録なしの文言で、別の head の run は本文に出ない", async () => {
  const other = rdRunDir(BLOCKED_REPORT);
  const { calls, posts, round } = rdWorld({ path: "stall", runDir: undefined, mergeHead: RD_OTHER[0], sessions: stallSessions(["x"]) });
  await round();
  assert.equal(calls[0], `comment #12 ${RD_STALL_MARKER}`);
  assert.ok(posts[0].includes("（レポートに判定が無い）") && posts[0].includes("（判定不能の理由の記録なし）"), posts[0]);
  assert.ok(!posts[0].includes(other));
});

test("修正のセッションの停止の判断依頼: 新しい dispatched で何周しても二度送らない。印は 1 件", async () => {
  const w = rdWorld({ path: "stall", runDir: rdRunDir(BLOCKED_REPORT), sessions: stallSessions(["x"]) });
  await w.round();
  await w.round(new Set());
  await w.round(new Set());
  assert.equal(w.posts.length, 1);
  assert.equal(w.calls.filter((c) => c === `comment #12 ${RD_STALL_MARKER}`).length, 1);
});

test("close-tab: タブを閉じてから、閉じた印を工程の印と同じ issue に書く。見つからないタブ（gone）は close せず印だけ書く", async () => {
  const calls = [];
  const execute = createExecute({
    github: { comment: (n, body) => calls.push(`comment #${n} ${body}`) },
    cwd: "/x", repo: REPO,
    closeTab: ({ cwd, handle }) => calls.push(`close ${handle} ${cwd}`),
  });
  await execute({ kind: "close-tab", key: "close-tab:term_1", issue: 12, step: "to-tickets", handle: "term_1", gone: false });
  await execute({ kind: "close-tab", key: "close-tab:term_s", issue: 20, step: "takt-sequence", handle: "term_s", gone: true });
  assert.deepEqual(calls, [
    "close term_1 /x",
    "comment #12 案内役: to-tickets のタブを閉じた（ターミナル term_1）",
    "comment #20 案内役: takt-sequence のタブを閉じた（ターミナル term_s）",
  ]);
});

test("close-tab: close が失敗したら印を書かずに例外にする（次に流し直したときに閉じ直す）", async () => {
  const calls = [];
  const execute = createExecute({
    github: { comment: (n, body) => calls.push(`comment #${n} ${body}`) },
    cwd: "/x", repo: REPO,
    closeTab: () => { throw new Error("orca down"); },
  });
  await assert.rejects(execute({ kind: "close-tab", key: "close-tab:term_1", issue: 12, step: "to-tickets", handle: "term_1", gone: false }), /orca down/);
  assert.deepEqual(calls, []);
});

test("record-decision-answer: 判断依頼の印と同じ issue（仕様か map）に答えた印だけを書き、Discord には送らない", async () => {
  const calls = [];
  const execute = createExecute({
    github: { comment: (n, body) => calls.push(`comment #${n} ${body}`) },
    discord: new Proxy({}, { get: () => () => assert.fail("Discord は呼ばない") }),
    cwd: "/x", repo: REPO,
  });
  await execute({ kind: "record-decision-answer", key: "k1", spec: 12, issue: 21, cause: "takt の ABORT" });
  await execute({ kind: "record-decision-answer", key: "k2", map: 30, issue: 30, cause: "霧の残り" });
  assert.deepEqual(calls, ["comment #12 案内役: 判断依頼に答えた（#21 takt の ABORT）", "comment #30 案内役: 判断依頼に答えた（#30 霧の残り）"]);
});

test("判断依頼の答え（往復）: 送った後の印のメッセージに本人が返信すると、次の周で答えた印を仕様に書き、その後は何周しても書き直さない", async () => {
  const { calls, round } = decisionWorld(undefined, { M1: { replies: [{ userId: "U", content: "直して流し直す" }], reactions: [] } });
  await round();
  await round(new Set());
  await round(new Set());
  assert.deepEqual(calls.filter((c) => c.startsWith("comment ")).slice(-1), ["comment #12 案内役: 判断依頼に答えた（#21 takt の ABORT）"]);
  assert.equal(calls.filter((c) => c.includes("判断依頼に答えた")).length, 1);
  assert.equal(calls.filter((c) => c.startsWith("decision ")).length, 1);
});

test("archive-thread: スレッドをアーカイブしてから、アーカイブした印をその issue に書く", async () => {
  const calls = [];
  const execute = createExecute({
    github: { comment: (n, body) => calls.push(`comment #${n} ${body}`) },
    discord: { archiveThread: async ({ threadId }) => calls.push(`archive ${threadId}`) },
    cwd: "/x", repo: REPO,
  });
  await execute({ kind: "archive-thread", key: "archive-thread:555", issue: 12, threadId: "555", subject: "仕様" });
  assert.deepEqual(calls, ["archive 555", "comment #12 案内役: Discord のスレッドをアーカイブした（スレッド 555）"]);
});

test("archive-thread: アーカイブが失敗したら印を書かずに例外にする（次に流し直したときにやり直す）", async () => {
  const calls = [];
  const execute = createExecute({
    github: { comment: (n, body) => calls.push(`comment #${n} ${body}`) },
    discord: { archiveThread: async () => { throw new Error("Discord PATCH /channels/555 が 403"); } },
    cwd: "/x", repo: REPO,
  });
  await assert.rejects(execute({ kind: "archive-thread", key: "archive-thread:555", issue: 12, threadId: "555", subject: "仕様" }), /403/);
  assert.deepEqual(calls, []);
});
