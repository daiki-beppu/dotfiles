// TaskRunner の全タスクのうち、merge タスクの判定に要る項目を JSON で出す。判定は持たない（絞り込みは案内役の takt.mjs）。
// merge_task・pr_number・runSlug は takt list --format json に出ないので、takt-node.sh 経由で TaskRunner を直接読む。
// 使い方（repo の root で）: takt-node.sh merge-tasks.mjs
const root = process.env.TAKT_ROOT;
const { TaskRunner } = await import(`${root}/dist/infra/task/index.js`);

const items = new TaskRunner(process.cwd(), {}).listAllTaskItems().map((t) => ({
  kind: t.kind,
  createdAt: t.createdAt,
  runSlug: t.runSlug,
  data: {
    merge_task: t.data?.merge_task,
    pr_number: t.data?.pr_number,
    merge_initial_head_sha: t.data?.merge_initial_head_sha,
    merge_pushed_head_sha: t.data?.merge_pushed_head_sha,
  },
}));
console.log(JSON.stringify(items));
