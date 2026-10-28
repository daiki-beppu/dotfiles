// 完了したタスクを、takt の削除の操作と同じ手順で片付ける: run の報告書を main checkout の .takt/runs へ写し、
// クローン・worktree-session を消し、タスクの記録を消す（task-cleanup.mjs）。takt-sequence はマージした issue をこれで片付ける。
// rm -rf でクローンだけ消すと、記録が消えたクローンを指したまま残り、takt_list_tasks が
// "Worktree directory does not exist" で使えなくなる。
// 使い方: takt-node.sh takt-cleanup.mjs <issue番号|タスク名の一部>... | --missing（クローンが無いタスクの記録だけ消す）
// 番号・名前の指定は completed だけを消す（failed のクローンは積み直しに使うので残す）。--missing は pending / running 以外の全部が対象。
import { existsSync } from "node:fs";
import { cleanupTask } from "./task-cleanup.mjs";

const root = process.env.TAKT_ROOT;
const { TaskRunner } = await import(`${root}/dist/infra/task/index.js`);
const { deleteBranch } = await import(`${root}/dist/features/tasks/list/taskBranchLifecycleActions.js`);
const args = process.argv.slice(2);
if (args.length === 0) { console.error("usage: takt-cleanup.mjs <issue|name>... | --missing"); process.exit(2); }

const cwd = process.cwd();
const runner = new TaskRunner(cwd, {});
const all = runner.listAllTaskItems();
const missing = args.includes("--missing");
const targets = missing
  ? all.filter((t) => t.kind !== "pending" && t.kind !== "running" && t.worktreePath && !existsSync(t.worktreePath))
  : all.filter((t) => t.kind === "completed" && args.some((a) => String(t.issueNumber) === a.replace(/^#/, "") || t.name.includes(a)));
if (targets.length === 0) { console.log(missing ? "対象なし（クローンが消えたタスクは無い）" : "対象なし（completed のタスクだけが対象）"); process.exit(1); }
for (const t of targets) {
  if (!cleanupTask(cwd, t, { runner, deleteBranch })) { console.error(`クローンを消せなかった: ${t.name}`); continue; }
  console.log(`片付けた: ${t.name}`);
}
