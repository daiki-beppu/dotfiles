import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { taktRunDirs, taktTasks } from "./takt.mjs";

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
