// 終わったタスクの片付け。takt-cleanup.mjs と takt-sequence.mjs が使う。
// run の報告書（.takt/runs/<slug>）はクローンの中にしか無く、開発ログの素材になる。クローンを消す前に main checkout の
// .takt/runs/<slug> へ写す（main checkout にも同じ slug のディレクトリがあり、interventions.jsonl だけが入っている）。
import { cpSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// クローンの run を cwd（main checkout）の .takt/runs へ写し、写した slug を返す。クローンに run が無ければ空。
export function archiveRuns(cwd, worktreePath) {
  const from = join(worktreePath, ".takt", "runs");
  if (!existsSync(from)) return [];
  const slugs = readdirSync(from, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const slug of slugs) cpSync(join(from, slug), join(cwd, ".takt", "runs", slug), { recursive: true });
  return slugs;
}

// takt の削除の操作と同じ手順で、run を写してからクローン・worktree-session・タスクの記録を消す。
// クローンを消せなければ記録も残し（記録が消えたクローンを指したまま残らないように）、false を返す。
// クローンの記録（worktreePath）が無いタスクに deleteBranch を呼ぶと、そのブランチを git branch -D するので呼ばない。
// 記録があれば、クローンが消えていても呼ぶ（worktree-session・clone-meta・ブランチを消す）。
export function cleanupTask(cwd, task, { runner, deleteBranch }) {
  if (task.worktreePath) {
    archiveRuns(cwd, task.worktreePath);
    if (!deleteBranch(cwd, task, { quiet: true })) return false;
  }
  runner.deleteTask(task.name, task.kind);
  return true;
}
