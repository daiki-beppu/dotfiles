// takt-wait.mjs と takt-path.mjs が使う、タスク一覧の読み出し。
// `takt list --format json` はパイプに流すと 64KB 付近で切れる（0.68.0）ので、一時ファイルに書いてから読む。
import { spawnSync } from "node:child_process";
import { mkdtempSync, openSync, closeSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// cwd（repo root）の全タスクを返す。読めなければ例外を投げる。
export function listTasks(cwd = process.cwd()) {
  const dir = mkdtempSync(join(tmpdir(), "takt-list-"));
  const file = join(dir, "list.json");
  try {
    const fd = openSync(file, "w");
    const r = spawnSync("takt", ["list", "--non-interactive", "--format", "json"], { cwd, stdio: ["ignore", fd, "pipe"] });
    closeSync(fd);
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(`takt list が ${r.status} で終了: ${String(r.stderr).trim()}`);
    return JSON.parse(readFileSync(file, "utf8")).tasks ?? [];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const issueOf = (arg) => arg.replace(/^#/, "");

// その issue のタスクを新しい順に返す（古い failed の記録が残っていても、最新の投入を先頭に置く）。
export function tasksFor(tasks, issue) {
  return tasks
    .filter((t) => String(t.issueNumber ?? t.data?.issue) === issue)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
