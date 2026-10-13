// issue の最新タスクの実行クローン（worktreePath）を 1 行で出す。`ls -d takt-worktrees/*-<n>-*` で探さずに済む。
// 実行クローンには remote が無いので、--push を付けると、repo root の origin へ push するコマンドを出す。
// 使い方（repo root で）: node takt-path.mjs <issue> [--push]
//   cd "$(node takt-path.mjs 713)"
//   eval "$(node takt-path.mjs 713 --push)"   # git -C <clone> push <origin の URL> HEAD:<branch>
import { spawnSync } from "node:child_process";
import { listTasks, tasksFor, issueOf } from "./takt-list.mjs";

const args = process.argv.slice(2);
const issue = args.find((a) => /^#?\d+$/.test(a));
if (!issue) { console.error("usage: takt-path.mjs <issue> [--push]"); process.exit(2); }

const t = tasksFor(listTasks(), issueOf(issue))[0];
if (!t) { console.error(`#${issueOf(issue)} のタスクが無い`); process.exit(1); }
if (!t.worktreePath) { console.error(`#${issueOf(issue)} のタスク ${t.name}（${t.kind}）にはまだクローンが無い`); process.exit(1); }

const q = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;
if (args.includes("--push")) {
  const origin = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).stdout.trim();
  if (!origin) { console.error("repo root の origin を読めない（repo root で実行する）"); process.exit(1); }
  console.log(`git -C ${q(t.worktreePath)} push ${q(origin)} HEAD:${q(t.branch ?? t.data?.branch)}`);
} else {
  console.log(t.worktreePath);
}
