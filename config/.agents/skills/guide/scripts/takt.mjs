// takt アダプタ。タスクの一覧を読み、takt-sequence を Orca の新しいターミナルタブで起動する（終わりは待たず、handle を返す）。
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listTasks } from "../../takt/scripts/takt-list.mjs";
import { SEQUENCE_DONE, sequenceTabTitle } from "./decide.mjs";
import { handleOf, runOrca } from "./orca-agent.mjs";

const TAKT_SCRIPTS = fileURLToPath(new URL("../../takt/scripts/", import.meta.url));
const q = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;

// takt list のタスクを、issue との対応づけ（takt-list.mjs と同じく issueNumber か data.issue）つきで正規化する。issue が整数にならないものは除く。
export function taktTasks(cwd, list = listTasks) {
  return list(cwd)
    .map((t) => ({
      issue: Number(t.issueNumber ?? t.data?.issue),
      kind: t.kind,
      createdAt: t.createdAt,
      step: t.failure?.step,
      error: t.failure?.error,
      worktreePath: t.worktreePath,
    }))
    .filter((t) => Number.isInteger(t.issue));
}

// takt-sequence の後に SEQUENCE_DONE の行を出す。タブは閉じずにシェルへ戻るので、終わったことはこの行で見分ける。
export function startTaktSequence({ cwd, repo, issues }, run = runOrca) {
  const sequence = [`${TAKT_SCRIPTS}takt-node.sh`, `${TAKT_SCRIPTS}takt-sequence.mjs`, ...issues.map(String)].map(q).join(" ");
  const command = `${sequence}; echo "${SEQUENCE_DONE}（exit $?）"`;
  const reply = run(["terminal", "create", "--worktree", `path:${cwd}`, "--title", sequenceTabTitle(repo), "--json", "--command", command], { cwd });
  return { handle: handleOf(reply, "orca terminal create", "result.terminal.handle") };
}

// 対象 issue の takt タスクの worktree にある `.takt/runs`（実在するものだけ）。knowledge に素材として渡す。
export function taktRunDirs(cwd, issues, list = listTasks) {
  const wanted = new Set(issues.map(Number));
  const dirs = list(cwd)
    .filter((t) => wanted.has(Number(t.issueNumber ?? t.data?.issue)) && t.worktreePath)
    .map((t) => join(t.worktreePath, ".takt", "runs"))
    .filter((d) => existsSync(d));
  return [...new Set(dirs)];
}
