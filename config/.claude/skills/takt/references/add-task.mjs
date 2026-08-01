#!/usr/bin/env node
/**
 * takt のタスクキューへ非対話でタスクを積む。
 *
 * `takt add` は対話専用（workflow 選択 / worktree / auto_pr を prompt する）ため、
 * エージェントからは takt 自身の store API（TaskRunner.addTask）を直接呼ぶ。
 * tasks.yaml を手書きしてはいけない（TaskStore はファイルロック + tmp→rename で
 * 書くため、実行中の `takt run` と競合して他タスクの記録が飛ぶ）。
 *
 * 使い方:
 *   node add-task.mjs --slug <slug> --workflow <name> --summary <text> [options]
 *
 * 必須:
 *   --slug <slug>          [a-z0-9] 始まり・[a-z0-9-] のみ。task 名と task_dir に使う
 *   --workflow <name>      .takt/workflows/<name>.yaml の basename、または builtin 名
 *   --summary <text>       tasks.yaml に載る 1 行要約
 *
 * 任意:
 *   --issue <N>            issue 番号。yt-auto-* レーンでは intake が要求するので必須扱い
 *   --task-dir <path>      既定 .takt/tasks/<slug>（この形式以外は schema が弾く）
 *   --branch <name>        既存ブランチへ積み増す。既存 PR があれば新規作成されない
 *   --base-branch <name>   新規ブランチの分岐元（既定は takt の設定）
 *   --project-dir <path>   既定 cwd
 *   --no-auto-pr           auto_pr を無効化（既定は有効）
 *   --draft-pr             draft PR で作る
 *   --no-worktree          worktree を使わない（既定は使う）
 *   --dry-run              addTask を呼ばず、渡すオプションだけ表示する
 */

import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

const { values } = parseArgs({
  // `--no-auto-pr` / `--no-worktree` を効かせるためのトップレベル指定（Node 22.4+）。
  // オプション側に書いても効かず Unknown option になる。
  allowNegative: true,
  options: {
    slug: { type: 'string' },
    workflow: { type: 'string' },
    summary: { type: 'string' },
    issue: { type: 'string' },
    'task-dir': { type: 'string' },
    branch: { type: 'string' },
    'base-branch': { type: 'string' },
    'project-dir': { type: 'string' },
    'auto-pr': { type: 'boolean', default: true },
    'draft-pr': { type: 'boolean', default: false },
    worktree: { type: 'boolean', default: true },
    'dry-run': { type: 'boolean', default: false },
  },
})

const fail = (message) => {
  console.error(`error: ${message}`)
  process.exit(1)
}

for (const key of ['slug', 'workflow', 'summary']) {
  if (!values[key]) fail(`--${key} is required`)
}
if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(values.slug)) {
  fail(`--slug must match [a-z0-9](?:[a-z0-9-]*[a-z0-9])? (got "${values.slug}")`)
}

const projectDir = path.resolve(values['project-dir'] ?? process.cwd())
const taskDir = values['task-dir'] ?? `.takt/tasks/${values.slug}`
const orderPath = path.join(projectDir, taskDir, 'order.md')
if (!existsSync(orderPath)) fail(`order.md not found: ${orderPath}`)

// takt バイナリ -> dist/ を解決する。nix store のハッシュ付きパスを直書きすると
// バージョン更新で壊れるため、必ず which + realpath から辿る。
let dist
try {
  const taktBin = realpathSync(execFileSync('which', ['takt'], { encoding: 'utf8' }).trim())
  dist = path.resolve(path.dirname(taktBin), '../lib/node_modules/takt/dist')
} catch {
  fail('takt not found on PATH')
}
const runnerPath = path.join(dist, 'infra/task/runner.js')
if (!existsSync(runnerPath)) fail(`takt runner not found: ${runnerPath}`)

const options = {
  workflow: values.workflow,
  worktree: values.worktree,
  auto_pr: values['auto-pr'],
  draft_pr: values['draft-pr'],
  task_dir: taskDir,
  slug: values.slug,
  summary: values.summary,
}
if (values.issue !== undefined) {
  const issue = Number(values.issue)
  if (!Number.isSafeInteger(issue) || issue <= 0) fail(`--issue must be a positive integer`)
  options.issue = issue
}
if (values.branch !== undefined) options.branch = values.branch
if (values['base-branch'] !== undefined) options.base_branch = values['base-branch']

if (values['dry-run']) {
  console.log(JSON.stringify({ dryRun: true, projectDir, orderPath, options }, null, 2))
  process.exit(0)
}

const { TaskRunner } = await import(pathToFileURL(runnerPath).href)
const runner = new TaskRunner(projectDir, { onWarning: (w) => console.warn(`[warn] ${w}`) })
runner.ensureDirs()

// 同じ branch に pending / running のタスクがあると findActiveTaskTargetConflict が throw する。
// completed は対象外なので、同じ PR への積み増しは何度でも積める。
const info = runner.addTask(`# ${values.summary}`, options)
console.log(JSON.stringify(info, null, 2))
