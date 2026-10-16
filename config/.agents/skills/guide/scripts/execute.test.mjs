// execute.mjs のテスト。コメント・起動は偽物を注入し、書かれたマーカーを次の起動のスナップショットに入れて再起動を再現する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { decide } from "./decide.mjs";
import { createExecute } from "./execute.mjs";
import { runRound } from "./loop.mjs";

const REPO = "o/r";
const VIEWER = "me";
const issue = (number, over = {}) => ({ number, state: "OPEN", labels: [], body: "", comments: [], subIssues: [], ...over });

// 偽の GitHub: comment が書いた内容を、次の読み出しで viewer のコメントとして返す。
const world = (issues, over = {}) => {
  const calls = [];
  const github = { comment: (n, body) => { calls.push(`comment #${n} ${body}`); issues.find((i) => i.number === n).comments.push({ author: VIEWER, body }); } };
  const deps = {
    github, cwd: "/x", repo: REPO,
    runToTickets: async ({ spec }) => { calls.push(`to-tickets #${spec}`); return { code: 0, logFile: "l" }; },
    startTaktSequence: ({ issues: is }) => { calls.push(`takt ${is.join(",")}`); },
    ...over,
  };
  const round = (dispatched = new Set()) =>
    runRound({ readSnapshot: async () => ({ repo: REPO, viewer: VIEWER, issues, taktIssues: [] }), execute: createExecute(deps), log: () => {} }, dispatched);
  return { calls, round };
};

test("to-tickets: 起動マーカー → 起動 → 終了マーカーの順に実行し、新しい dispatched で再起動しても出ない", async () => {
  const issues = [issue(12, { labels: ["spec", "spec-approved"] })];
  const { calls, round } = world(issues);
  await round();
  assert.deepEqual(calls, ["comment #12 案内役: to-tickets を起動した", "to-tickets #12", "comment #12 案内役: to-tickets が終わった（exit 0）"]);
  await round(new Set());
  assert.equal(calls.length, 3);
});

test("to-tickets が失敗しても、起動・終了マーカーは残り、再起動で再度起動しない", async () => {
  const issues = [issue(12, { labels: ["spec", "spec-approved"] })];
  const { calls, round } = world(issues, { runToTickets: async () => ({ code: 1, logFile: "l" }) });
  await assert.rejects(round(), /exit 1/);
  assert.equal(calls.length, 2);
  await round(new Set());
  assert.equal(calls.length, 2);
});

test("takt-sequence: 渡したマーカーを起動より先に書き、再起動しても渡さない", async () => {
  const issues = [issue(12, { labels: ["spec", "spec-approved"] }), issue(20, { body: "仕様: #12", subIssues: [{ number: 21, state: "OPEN" }] })];
  const { calls, round } = world(issues);
  await round();
  assert.deepEqual(calls, ["comment #20 案内役: takt-sequence に渡した #21", "takt 21"]);
  await round(new Set());
  assert.equal(calls.length, 2);
});

test("takt-sequence の起動が失敗しても渡したマーカーは残り、再起動で二重に起動しない（成否不明のまま再実行しない）", async () => {
  const issues = [issue(12, { labels: ["spec", "spec-approved"] }), issue(20, { body: "仕様: #12", subIssues: [{ number: 21, state: "OPEN" }] })];
  const { calls, round } = world(issues, { startTaktSequence: () => { throw new Error("orca failed"); } });
  await assert.rejects(round(), /orca failed/);
  assert.deepEqual(decide({ repo: REPO, viewer: VIEWER, issues, taktIssues: [], dispatched: [] }), []);
  assert.equal(calls.length, 1);
});
