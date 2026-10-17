import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SEQUENCE_DONE } from "./decide.mjs";
import { startTaktSequence, taktRunDirs, taktTasks } from "./takt.mjs";

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

test("taktTasks: タスクを issue・kind・createdAt・step・error・worktreePath に正規化し、issue が整数にならないものは除く", () => {
  const raw = [
    { issueNumber: 21, kind: "failed", createdAt: "2026-10-16T10:00:00Z", worktreePath: "/w/21", failure: { step: "implement", error: "blocked", last_message: "m" } },
    { data: { issue: 22 }, kind: "running", createdAt: "2026-10-16T11:00:00Z" },
    { kind: "completed", createdAt: "2026-10-16T12:00:00Z" },
    { issueNumber: "abc", kind: "failed", createdAt: "2026-10-16T12:00:00Z" },
  ];
  assert.deepEqual(taktTasks("/x", (cwd) => (assert.equal(cwd, "/x"), raw)), [
    { issue: 21, kind: "failed", createdAt: "2026-10-16T10:00:00Z", step: "implement", error: "blocked", worktreePath: "/w/21" },
    { issue: 22, kind: "running", createdAt: "2026-10-16T11:00:00Z", step: undefined, error: undefined, worktreePath: undefined },
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
