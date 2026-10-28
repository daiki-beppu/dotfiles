import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { archiveRuns, cleanupTask } from "./task-cleanup.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "task-cleanup-"));
  const cwd = join(root, "repo");
  const clone = join(root, "clone");
  const run = join(clone, ".takt", "runs", "20261028-064744-issue-7-x");
  mkdirSync(join(run, "reports"), { recursive: true });
  writeFileSync(join(run, "trace.md"), "trace");
  writeFileSync(join(run, "reports", "review.md"), "## 結果: APPROVE");
  mkdirSync(join(cwd, ".takt", "runs", "20261028-064744-issue-7-x"), { recursive: true });
  writeFileSync(join(cwd, ".takt", "runs", "20261028-064744-issue-7-x", "interventions.jsonl"), "{}");
  return { cwd, clone };
}

test("archiveRuns: クローンの run を main checkout の同じ slug へ写し、main checkout にあったファイルも残す", () => {
  const { cwd, clone } = fixture();
  assert.deepEqual(archiveRuns(cwd, clone), ["20261028-064744-issue-7-x"]);
  const dest = join(cwd, ".takt", "runs", "20261028-064744-issue-7-x");
  assert.equal(readFileSync(join(dest, "reports", "review.md"), "utf8"), "## 結果: APPROVE");
  assert.equal(readFileSync(join(dest, "trace.md"), "utf8"), "trace");
  assert.ok(existsSync(join(dest, "interventions.jsonl")));
});

test("archiveRuns: クローンが無いか run が無ければ何も写さない", () => {
  const { cwd } = fixture();
  assert.deepEqual(archiveRuns(cwd, join(cwd, "nowhere")), []);
});

test("cleanupTask: run を写してからクローンを消し、タスクの記録を消す", () => {
  const { cwd, clone } = fixture();
  const calls = [];
  const ok = cleanupTask(cwd, { name: "t", kind: "completed", worktreePath: clone }, {
    deleteBranch: (_, t) => (calls.push(["deleteBranch", t.name, existsSync(join(cwd, ".takt", "runs", "20261028-064744-issue-7-x", "trace.md"))]), true),
    runner: { deleteTask: (name, kind) => calls.push(["deleteTask", name, kind]) },
  });
  assert.equal(ok, true);
  assert.deepEqual(calls, [["deleteBranch", "t", true], ["deleteTask", "t", "completed"]]);
});

test("cleanupTask: クローンを消せなければタスクの記録を残して false を返す", () => {
  const { cwd, clone } = fixture();
  const deleted = [];
  const ok = cleanupTask(cwd, { name: "t", kind: "completed", worktreePath: clone }, {
    deleteBranch: () => false,
    runner: { deleteTask: (name) => deleted.push(name) },
  });
  assert.equal(ok, false);
  assert.deepEqual(deleted, []);
});

test("cleanupTask: クローンの記録が無いタスクは deleteBranch を呼ばずに記録だけ消す", () => {
  const { cwd } = fixture();
  const calls = [];
  const ok = cleanupTask(cwd, { name: "m", kind: "failed" }, {
    deleteBranch: () => (calls.push("deleteBranch"), true),
    runner: { deleteTask: (name) => calls.push(`deleteTask ${name}`) },
  });
  assert.equal(ok, true);
  assert.deepEqual(calls, ["deleteTask m"]);
});
