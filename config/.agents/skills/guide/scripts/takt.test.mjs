import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { taktRunDirs } from "./takt.mjs";

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
