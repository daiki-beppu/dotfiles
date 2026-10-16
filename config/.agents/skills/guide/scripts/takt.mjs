// takt アダプタ。タスクのある issue 番号を読み、takt-sequence を Orca の新しいターミナルタブで起動する（終わりは待たない）。
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listTasks } from "../../takt/scripts/takt-list.mjs";

const TAKT_SCRIPTS = fileURLToPath(new URL("../../takt/scripts/", import.meta.url));
const q = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;

// takt list にタスクがある issue の番号。takt-list.mjs と同じく issueNumber か data.issue で対応づける。
export function taktIssueNumbers(cwd) {
  return listTasks(cwd)
    .map((t) => Number(t.issueNumber ?? t.data?.issue))
    .filter(Number.isInteger);
}

export function startTaktSequence({ cwd, repo, issues }) {
  const command = [`${TAKT_SCRIPTS}takt-node.sh`, `${TAKT_SCRIPTS}takt-sequence.mjs`, ...issues.map(String)].map(q).join(" ");
  execFileSync("orca", ["terminal", "create", "--worktree", `path:${cwd}`, "--title", `takt sequence ${repo}`, "--json", "--command", command], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  });
}
