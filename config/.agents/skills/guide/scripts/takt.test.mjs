import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SEQUENCE_DONE } from "./decide.mjs";
import { mergeTasks, startTaktSequence, taktRunDirs, taktTasks } from "./takt.mjs";

test("taktRunDirs: 対象 issue のタスクのうち、実在する run のディレクトリだけを重複なく返す", () => {
  const root = mkdtempSync(join(tmpdir(), "takt-run-dirs-"));
  const [a, b, c] = ["A", "B", "C"].map((n) => join(root, n));
  mkdirSync(join(a, ".takt", "runs"), { recursive: true });
  mkdirSync(join(c, ".takt", "runs"), { recursive: true });
  mkdirSync(b, { recursive: true });
  const tasks = [
    { issueNumber: 21, worktreePath: a },
    { data: { issue: 22 }, worktreePath: a },
    { issueNumber: 21, worktreePath: b },
    { issueNumber: 99, worktreePath: c },
    { issueNumber: 21 },
  ];
  assert.deepEqual(taktRunDirs("/x", [21, 22], (cwd) => (assert.equal(cwd, "/x"), tasks)), [join(a, ".takt", "runs")]);
});

test("taktTasks: タスクを issue・kind・createdAt・step・error・worktreePath・prUrl に正規化し、issue が整数にならないものは除く", () => {
  const raw = [
    { issueNumber: 21, kind: "failed", createdAt: "2026-10-16T10:00:00Z", worktreePath: "/w/21", prUrl: "https://github.com/o/r/pull/70", failure: { step: "implement", error: "blocked", last_message: "m" } },
    { data: { issue: 22 }, kind: "running", createdAt: "2026-10-16T11:00:00Z" },
    { kind: "completed", createdAt: "2026-10-16T12:00:00Z" },
    { issueNumber: "abc", kind: "failed", createdAt: "2026-10-16T12:00:00Z" },
  ];
  assert.deepEqual(taktTasks("/x", (cwd) => (assert.equal(cwd, "/x"), raw)), [
    { issue: 21, kind: "failed", createdAt: "2026-10-16T10:00:00Z", step: "implement", error: "blocked", worktreePath: "/w/21", prUrl: "https://github.com/o/r/pull/70" },
    { issue: 22, kind: "running", createdAt: "2026-10-16T11:00:00Z", step: undefined, error: undefined, worktreePath: undefined, prUrl: undefined },
  ]);
});

test("startTaktSequence: Orca の新しいタブで起動し、応答の result.terminal.handle を返す。takt-sequence の後に終わりの行を出す", () => {
  const calls = [];
  const run = (args, opts) => {
    calls.push({ args, opts });
    return JSON.stringify({ ok: true, result: { terminal: { handle: "term_seq", title: "takt sequence o/r" } } });
  };
  assert.deepEqual(startTaktSequence({ cwd: "/w", repo: "o/r", issues: [21, 22] }, run), { handle: "term_seq" });
  const [{ args, opts }] = calls;
  assert.deepEqual(args.slice(0, 7), ["terminal", "create", "--worktree", "path:/w", "--title", "takt sequence o/r", "--json"]);
  assert.equal(args[7], "--command");
  assert.match(args[8], /takt-sequence\.mjs' '21' '22'; echo "案内役: takt-sequence が終わった（exit \$\?）"$/);
  assert.ok(args[8].includes(SEQUENCE_DONE));
  assert.equal(opts.cwd, "/w");
});

test("startTaktSequence: 応答から handle が取れなければ、応答の頭を入れて例外にする", () => {
  assert.throws(() => startTaktSequence({ cwd: "/w", repo: "o/r", issues: [21] }, () => "not json"), /handle が取れない.*not json/);
  assert.throws(() => startTaktSequence({ cwd: "/w", repo: "o/r", issues: [21] }, () => JSON.stringify({ ok: true, result: {} })), /result\.terminal\.handle/);
});

// merge タスクの記録。TaskRunner の項目は takt list --format json に出ないので、takt-node.sh 経由のスクリプトの JSON を受け取る（実行は偽物を注入）。
const item = (over = {}, data = {}) => ({ kind: "failed", createdAt: "2026-10-17T00:30:00Z", runSlug: "run-1", data: { merge_task: true, pr_number: 70, merge_initial_head_sha: "a".repeat(40), merge_pushed_head_sha: "b".repeat(40), ...data }, ...over });

test("mergeTasks: merge タスクだけを残し、PR 番号・状態・作成時刻・head・レポートの場所（<cwd>/.takt/runs/<runSlug>）に正規化する", () => {
  const calls = [];
  const run = (args, opts) => (calls.push({ args, cwd: opts?.cwd }), JSON.stringify([item(), item({ kind: "completed", runSlug: undefined }, { merge_pushed_head_sha: undefined })]));
  assert.deepEqual(mergeTasks("/repo", run), [
    { prNumber: 70, kind: "failed", createdAt: "2026-10-17T00:30:00Z", initialHead: "a".repeat(40), pushedHead: "b".repeat(40), reports: join("/repo", ".takt", "runs", "run-1") },
    { prNumber: 70, kind: "completed", createdAt: "2026-10-17T00:30:00Z", initialHead: "a".repeat(40), pushedHead: undefined, reports: null },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, "/repo");
  assert.match(JSON.stringify(calls[0].args), /merge-tasks\.mjs/);
});

test("mergeTasks: merge_task が true でないタスクと、pr_number が整数でないタスクは除く", () => {
  const rows = [item({}, { merge_task: false }), item({ data: { pr_number: 7 } }), item({}, { pr_number: "abc" }), item({}, { pr_number: undefined }), item({}, { pr_number: 71 })];
  const result = mergeTasks("/repo", () => JSON.stringify(rows));
  assert.deepEqual(result.map((m) => m.prNumber), [71]);
});

test("mergeTasks: 実行が失敗したら例外を伝え、JSON でない出力は例外にする（黙って空にしない）", () => {
  assert.throws(() => mergeTasks("/repo", () => { throw new Error("takt-node.sh が失敗"); }), /takt-node\.sh が失敗/);
  assert.throws(() => mergeTasks("/repo", () => "not json"));
});
