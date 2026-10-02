// 完了したタスクを、takt の削除の操作と同じ手順で片付ける: クローン・worktree-session を消し、タスクの記録を消す。
// rm -rf でクローンだけ消すと、記録が消えたクローンを指したまま残り、takt_list_tasks が
// "Worktree directory does not exist" で使えなくなる。開発ログ（/knowledge）を書き終えてから使う。
// 使い方: takt-node.sh takt-cleanup.mjs <issue番号|タスク名の一部>... | --missing（クローンが無い完了タスクの記録だけ消す）
import { existsSync } from "node:fs";

const root = process.env.TAKT_ROOT;
const { TaskRunner } = await import(`${root}/dist/infra/task/index.js`);
const { deleteBranch } = await import(`${root}/dist/features/tasks/list/taskBranchLifecycleActions.js`);
const args = process.argv.slice(2);
if (args.length === 0) { console.error("usage: takt-cleanup.mjs <issue|name>... | --missing"); process.exit(2); }

const cwd = process.cwd();
const runner = new TaskRunner(cwd, {});
const done = runner.listAllTaskItems().filter((t) => t.kind === "completed");
const targets = args.includes("--missing")
  ? done.filter((t) => t.worktreePath && !existsSync(t.worktreePath))
  : done.filter((t) => args.some((a) => String(t.issueNumber) === a.replace(/^#/, "") || t.name.includes(a)));
if (targets.length === 0) { console.log("対象なし（completed のタスクだけが対象）"); process.exit(1); }
for (const t of targets) {
  if (!deleteBranch(cwd, t)) { console.error(`クローンを消せなかった: ${t.name}`); continue; }
  runner.deleteTask(t.name, t.kind);
  console.log(`片付けた: ${t.name}`);
}
