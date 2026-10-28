// takt アダプタ。タスクの一覧を読み、takt-sequence を Orca の新しいターミナルタブ（案内役のペインがあればその下のペイン）で起動する（終わりは待たず、handle を返す）。
// repo に takt-sequence が動いていれば、新しく起動せずにその受け口へ issue を足し、そのペインの handle を返す。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendToInbox, inboxDirOf } from "../../takt/scripts/sequence-inbox.mjs";
import { listTasks } from "../../takt/scripts/takt-list.mjs";
import { SEQUENCE_DONE, sequenceTabTitle } from "./decide.mjs";
import { handleOf, runOrca } from "./orca-agent.mjs";
import { SPLIT_DOWN } from "./pane.mjs";

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
      prUrl: t.prUrl,
    }))
    .filter((t) => Number.isInteger(t.issue));
}

const runTaktNode = (args, { cwd }) =>
  execFileSync(`${TAKT_SCRIPTS}takt-node.sh`, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });

// merge タスクの記録（PR 番号・状態・作成時刻・扱った head・レポートの場所）。merge_task と pr_number は takt list --format json に出ないので、
// TaskRunner を読む merge-tasks.mjs を takt-node.sh 経由で呼ぶ。merge タスクでないものと、pr_number が整数でないものは除く。
export function mergeTasks(cwd, run = runTaktNode) {
  const rows = JSON.parse(run([`${TAKT_SCRIPTS}merge-tasks.mjs`], { cwd }));
  return rows
    .filter((t) => t.data?.merge_task === true && Number.isInteger(t.data?.pr_number))
    .map((t) => ({
      prNumber: t.data.pr_number,
      kind: t.kind,
      createdAt: t.createdAt,
      initialHead: t.data.merge_initial_head_sha,
      pushedHead: t.data.merge_pushed_head_sha,
      reports: t.runSlug ? join(cwd, ".takt", "runs", t.runSlug) : null,
    }));
}

// takt-sequence.mjs は、起動の入口（ここ）を通った印の LAUNCHER_ENV が無ければ止まる。
export const LAUNCHER_ENV = "TAKT_SEQUENCE_LAUNCHER";

// takt-sequence の後に SEQUENCE_DONE の行を出す。タブは閉じずにシェルへ戻るので、終わったことはこの行で見分ける。
// terminal（案内役の自分のペインの handle。desk.mjs が --terminal で渡す）があれば、新しいタブではなくそのペインを direction（既定は下）へ分割して起動する。
// 先に append（既定は repo の受け口へ足す）を試し、動いている takt-sequence に足せたら起動せずに { handle, appended: true } を返す。
// 足すのは issue の番号だけ（--workflow などのオプションは、動いている takt-sequence のものを使う）。
export function startTaktSequence({ cwd, repo, issues, terminal, direction = SPLIT_DOWN }, run = runOrca, append = appendToRunning) {
  const running = append(cwd, issueNumbers(issues));
  if (running !== null) return { handle: running.handle, appended: true };
  const sequence = `${LAUNCHER_ENV}=1 ` + [`${TAKT_SCRIPTS}takt-node.sh`, `${TAKT_SCRIPTS}takt-sequence.mjs`, ...issues.map(String)].map(q).join(" ");
  const command = `${sequence}; echo "${SEQUENCE_DONE}（exit $?）"`;
  if (terminal !== undefined) {
    const reply = run(["terminal", "split", "--terminal", terminal, "--direction", direction, "--command", command, "--json"], { cwd });
    return { handle: handleOf(reply, "orca terminal split", "result.split.handle") };
  }
  const reply = run(["terminal", "create", "--worktree", `path:${cwd}`, "--title", sequenceTabTitle(repo), "--json", "--command", command], { cwd });
  return { handle: handleOf(reply, "orca terminal create", "result.terminal.handle") };
}

// takt-sequence の引数から issue の番号だけを取り出す（`--interval 60` などのオプションの値は数えない）
const issueNumbers = (args) => args.map(String).filter((a, i, all) => /^#?\d+$/.test(a) && !all[i - 1]?.startsWith("--")).map((a) => a.replace(/^#/, ""));

function appendToRunning(cwd, issues) {
  const dir = inboxDirOf(cwd);
  return dir === null ? null : appendToInbox(dir, issues);
}

// 対象 issue の takt の run のディレクトリ（trace.md か reports/ があるものだけ）。knowledge に素材として渡す。
// takt-sequence はマージした issue のクローンを消す前に run を main checkout（cwd）の .takt/runs へ写すので、そこを名前（-issue-<n>-）で探す。
// まだ片付けていないタスクのクローンの run も足す。同じ slug は main checkout のものを使う。
export function taktRunDirs(cwd, issues, list = listTasks) {
  const wanted = new Set(issues.map(Number));
  const runsIn = (root) => {
    const dir = join(root, ".takt", "runs");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .map((slug) => join(dir, slug))
      .filter((d) => existsSync(join(d, "trace.md")) || existsSync(join(d, "reports")));
  };
  const issueOfRun = (d) => Number(/-issue-(\d+)-/.exec(d.split("/").at(-1))?.[1]);
  const archived = runsIn(cwd).filter((d) => wanted.has(issueOfRun(d)));
  const clones = list(cwd)
    .filter((t) => wanted.has(Number(t.issueNumber ?? t.data?.issue)) && t.worktreePath)
    .flatMap((t) => runsIn(t.worktreePath));
  // 後に入れた main checkout のものが同じ slug のクローンのものを上書きする
  const bySlug = new Map([...clones, ...archived].map((d) => [d.split("/").at(-1), d]));
  return [...bySlug.keys()].sort().map((k) => bySlug.get(k));
}

const NO_VERDICT = "（レポートに判定が無い）";
const NO_UNDECIDABLE = "（判定不能の理由の記録なし）";

// merge タスクの run のレポートから、final-gate の review-resolution.md の判定（`## 結果:`）と判定不能の理由の節を読む。
// reports の下を再帰的に探し、内部の履歴（.takt-report-internal）は除き、更新時刻が最も新しいものを使う。読めなければ決まった文言を返す（判断依頼の送信を止めない）。
export function readReviewReport(runDir) {
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === ".takt-report-internal") continue;
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (name === "review-resolution.md") found.push({ path, mtime: stat.mtimeMs });
    }
  };
  let text;
  try {
    walk(join(runDir, "reports"));
    const newest = found.sort((a, b) => b.mtime - a.mtime)[0];
    if (newest === undefined) return { verdict: NO_VERDICT, undecidable: NO_UNDECIDABLE };
    text = readFileSync(newest.path, "utf8");
  } catch {
    return { verdict: NO_VERDICT, undecidable: NO_UNDECIDABLE };
  }
  const verdict = text.match(/^## 結果: *(.+)$/m)?.[1].trim() ?? NO_VERDICT;
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith("## 判定不能の理由"));
  let undecidable = NO_UNDECIDABLE;
  if (start !== -1) {
    const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
    const body = lines.slice(start + 1, end === -1 ? undefined : end).join("\n").trim();
    if (body !== "") undecidable = body;
  }
  return { verdict, undecidable };
}
