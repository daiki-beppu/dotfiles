// 指定した issue を順に 1 件ずつ takt に積み、PR の自動マージ予約からマージ完了までを見届けて、次の issue を積む。
// 出力は出来事が起きたときだけ「日時（JST） 出来事: #issue タイトル [PR の URL]」の 1 行。Orca のタブで流して人が追える形にする。
// 起動直後に、対象の issue とタイトル・今の段階を 1 行ずつ出す（最初の出来事までタブが空にならないように）。
// - 積むのは、対象のタスクが pending / running でなく、open で、blocked_by が全部閉じていて、
//   help wanted の付いていない issue のうち、並びの先頭のもの。
// - タスクが無いか終わっていない issue に、閉じる予定の open な PR（closingIssuesReferences）があれば、
//   人が引き取って PR にしたとみなして積まない。その PR は自動マージを予約せず、マージで issue が閉じるのを待つ。
// - タスクが PR を作ったら、`takt merge <PR>` を workflows/merge-review-automerge.yaml で流す（base との同期・AI の競合解消・
//   査読と修正・push）。その workflow が PR に「TAKT review completed」とコメントしたら、自動マージを予約する。
//   現在の head に対して「TAKT evaluation failed for head <sha>」とコメントしたか、現在の head で例外により 2 回落ちたら止める。止まったあとに PR の head が変われば、流し直したときにレビューからやり直す。
//   自動マージを予約済みの PR は、レビューを済ませたものとして扱う。
// - 予約済みで BEHIND の PR は揃えない。align-behind.mjs を別のタブで常駐させておく（揃える仕組みはそちらに一本化した）。
// - 積む前に main checkout（base ブランチでクリーンなこと）を ff-only で最新化し、空きディスク 8GiB を確かめる。
// - 投入は takt MCP の takt_enqueue_task（enqueue.md と同じ入力）。応答が不明なら積み直さずに止める。
// - 状態はファイルに持たず、毎周 takt list と GitHub から読み直す。止めて流し直しても二重には積まない。
// 使い方（repo root で、watch が動いている状態で）:
//   <skill>/scripts/takt-node.sh <skill>/scripts/takt-sequence.mjs <issue>... [--workflow default] [--base main] [--interval 30]
// 全件マージ済みなら 0、CI 失敗・競合・タスク失敗などで進めなくなったら 1 で終わる。
import { execFileSync, spawn } from "node:child_process";
import { closeSync, openSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { tasksFor, issueOf } from "./takt-list.mjs";

const opts = { workflow: "default", base: "main", interval: "30" };
const issues = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--") && a.slice(2) in opts) opts[a.slice(2)] = argv[++i];
  else if (/^#?\d+$/.test(a)) issues.push(issueOf(a));
  else { console.error(`不明な引数: ${a}`); process.exit(2); }
}
if (issues.length === 0 || !process.env.TAKT_ROOT) {
  console.error("usage: takt-node.sh takt-sequence.mjs <issue>... [--workflow default] [--base main] [--interval 30]");
  process.exit(2);
}

const cwd = process.cwd();
const sh = (cmd, args) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
const gh = (args) => JSON.parse(sh("gh", args));
const log = (s) => console.log(new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }), s);
// 同じ出来事を毎周出さないよう、issue ごとに最後に出した出来事を覚える
const last = new Map();
const titles = new Map();
const label = (n) => `#${n} ${titles.get(n) ?? ""}`.trim();
const event = (n, s) => { if (last.get(n) !== s) log(s); last.set(n, s); };

const active = (t) => t.kind === "pending" || t.kind === "running";
const SKIP_LABELS = ["help wanted"];
const REVIEW_WORKFLOW = fileURLToPath(new URL("../workflows/merge-review-automerge.yaml", import.meta.url));
const REVIEWED = "TAKT review completed";
const REVIEW_FAILED = "TAKT evaluation failed";
const FAILED_CHECK = ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"];

sh("takt", ["workflow", "doctor", opts.workflow]);
sh("takt", ["workflow", "doctor", REVIEW_WORKFLOW]);
// `takt merge --workflow` はグローバルの -w/--workflow に吸われて届かない（0.71.0）。takt merge は config の merge.workflow を使うので、
// それがこの workflow を指していなければ止める（builtin のままだと、takt が CI を待ってそのままマージする）
{
  const { resolveConfigValue } = await import(join(process.env.TAKT_ROOT, "dist/infra/config/index.js"));
  const wf = resolveConfigValue(cwd, "merge")?.workflow ?? "";
  const real = (p) => { try { return realpathSync(p); } catch { return p; } };
  const configured = wf.startsWith("~") ? resolve(homedir(), wf.slice(1).replace(/^\//, "")) : resolve(cwd, wf);
  if (!wf || real(configured) !== real(REVIEW_WORKFLOW)) {
    console.error(`merge.workflow が ${REVIEW_WORKFLOW} を指していない（今: ${wf || "未設定"}）。~/.takt/config.yaml を確かめる`);
    process.exit(2);
  }
}
const repo = gh(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
// レビュー結果のコメントは、takt merge が gh の認証ユーザーとして投稿する。第三者のコメントで判定が動かないよう、その login を起点で 1 回だけ解決する
const viewer = gh(["api", "user"]).login;
const { Client } = await import(join(process.env.TAKT_ROOT, "node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js"));
const { StdioClientTransport } = await import(join(process.env.TAKT_ROOT, "node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js"));
const { TaskRunner } = await import(join(process.env.TAKT_ROOT, "dist/infra/task/index.js"));
const { deleteBranch } = await import(join(process.env.TAKT_ROOT, "dist/features/tasks/list/taskBranchLifecycleActions.js"));
// merge タスクの merge_task・pr_number は `takt list --format json` に出ないので、TaskRunner から直接読む
const listTasks = () => new TaskRunner(cwd).listAllTaskItems();
const client = new Client({ name: "takt-sequence", version: "1.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(process.env.TAKT_ROOT, "dist/app/mcp/index.js")], cwd, stderr: "inherit" }));

// issue 1 件の今の段階を返す。done: マージ済みか issue が閉じた / waiting: 進行中 / manual: 人が引き取った PR がある /
// stuck: 人の手が要る / new: 未投入
function stage(n, tasks) {
  const t = tasksFor(tasks, n)[0];
  // タスクが failed でも、差分を人が引き取って PR にし、マージで issue が閉じていれば終わっている（run.md の「打ち切り」）
  const issue = gh(["issue", "view", n, "--json", "state,closedByPullRequestsReferences"]);
  if (issue.state === "CLOSED") {
    const merged = t?.prUrl && gh(["pr", "view", t.prUrl, "--json", "state"]).state === "MERGED";
    event(n, `${merged ? "マージ完了" : "issue クローズ"}: ${label(n)}`);
    return "done";
  }
  if (t && active(t)) return "waiting";
  if (t?.kind !== "completed") {
    const hand = issue.closedByPullRequestsReferences.map((r) => r.url).find((url) => gh(["pr", "view", url, "--json", "state"]).state === "OPEN");
    if (hand) { event(n, `手で対応中: ${label(n)} ${hand}`); return "manual"; }
  }
  if (!t) return "new";
  if (t.kind !== "completed") { event(n, `タスク${t.kind}: ${label(n)}`); return "stuck"; }
  if (!t.prUrl) { event(n, `PR なし: ${label(n)}`); return "stuck"; }
  const pr = gh(["pr", "view", t.prUrl, "--json", "number,state,mergeable,mergeStateStatus,statusCheckRollup,autoMergeRequest,comments,headRefOid"]);
  if (pr.state === "MERGED") { event(n, `マージ完了: ${label(n)}`); return "done"; }
  if (pr.state === "CLOSED") { event(n, `PR クローズ: ${label(n)} ${t.prUrl}`); return "stuck"; }
  if (!pr.autoMergeRequest) {
    const review = reviewStage(n, pr, t.prUrl, tasks);
    if (review !== "reviewed") return review;
  }
  if (pr.statusCheckRollup.some((c) => FAILED_CHECK.includes(c.conclusion ?? c.state))) { event(n, `CI失敗: ${label(n)} ${t.prUrl}`); return "stuck"; }
  if (pr.mergeable === "CONFLICTING") { event(n, `競合修正待ち: ${label(n)} ${t.prUrl}`); return "stuck"; }
  if (!pr.autoMergeRequest) {
    sh("gh", ["pr", "merge", t.prUrl, "--auto", "--squash"]);
    event(n, `自動マージ予約: ${label(n)} ${t.prUrl}`);
  } else if (pr.mergeStateStatus === "BEHIND") {
    // 予約済みの BEHIND は align-behind.mjs が作者を問わず 1 件ずつ揃える。ここでも揃えると 2 つの仕組みが同じ PR を揃えて空回りする
    event(n, `main に揃うのを待つ: ${label(n)} ${t.prUrl}`);
  }
  return "waiting";
}

// takt merge が走らせているレビューの子プロセス（PR 番号 → プロセス）
const reviewing = new Map();
// この実行で起動したレビューの回数（PR 番号 → 回数）。merge タスクを作る前に落ちると takt list に残らないので、ここでも数える
const attempts = new Map();

// PR のレビューの段階を返す。reviewed: 済み / waiting: 実行中か今起動した / stuck: 失敗して人の手が要る
function reviewStage(n, pr, url, tasks) {
  const merges = tasks.filter((x) => x.data?.merge_task === true && Number(x.data?.pr_number) === pr.number);
  if (pr.comments.some((c) => c.author?.login === viewer && c.body.startsWith(`${REVIEWED} for head ${pr.headRefOid};`))) {
    // 子プロセスが生きている間と merge タスクが running の間は、片付けも自動マージ予約も先送りする
    if (reviewing.has(pr.number) || merges.some(active)) return "waiting";
    // 成功しても takt は未マージの merge タスクを failed と記録し、クローンを残すので、予約の前に片付ける（報告書は repo の .takt/runs に残る）
    for (const m of merges) {
      if (m.worktreePath) deleteBranch(cwd, m);
      new TaskRunner(cwd, {}).deleteTask(m.name, m.kind);
    }
    return "reviewed";
  }
  if (reviewing.has(pr.number) || merges.some(active)) return "waiting";
  // 現在の head に対する失敗だけを数える。止まったあとに PR の head が変われば、レビューからやり直す
  const failure = pr.comments.filter((c) => c.author?.login === viewer && c.body.startsWith(`${REVIEW_FAILED} for head ${pr.headRefOid}:`)).at(-1);
  const crashes = Math.max(merges.filter((x) => x.kind === "failed" && (x.data?.merge_initial_head_sha === pr.headRefOid || x.data?.merge_pushed_head_sha === pr.headRefOid)).length, attempts.get(pr.number) ?? 0);
  if (failure || crashes >= 2) {
    event(n, `レビュー失敗: ${label(n)} ${url} ${failure ? failure.body.split("\n")[0] : "（takt merge が 2 回落ちた。takt list の merge タスクを見る）"}`);
    return "stuck";
  }
  const logFile = join(tmpdir(), `takt-sequence-review-${pr.number}.log`);
  const fd = openSync(logFile, "a");
  const child = spawn("takt", ["merge", String(pr.number)], { cwd, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  reviewing.set(pr.number, child);
  attempts.set(pr.number, (attempts.get(pr.number) ?? 0) + 1);
  const done = () => reviewing.delete(pr.number);
  child.on("exit", done);
  child.on("error", done);
  log(`レビュー開始: ${label(n)} ${url}（ログ: ${logFile}）`);
  return "waiting";
}

function ready(n) {
  const issue = gh(["api", `repos/${repo}/issues/${n}`]);
  if (issue.labels.some((l) => SKIP_LABELS.includes(l.name))) return false;
  const blockers = gh(["api", `repos/${repo}/issues/${n}/dependencies/blocked_by`]);
  return blockers.every((b) => b.state === "closed");
}

async function enqueue(n) {
  if (sh("git", ["branch", "--show-current"]).trim() !== opts.base) throw new Error(`main checkout が ${opts.base} にいない`);
  if (sh("git", ["status", "--porcelain"]).trim()) throw new Error("main checkout が dirty");
  sh("git", ["fetch", "origin"]);
  sh("git", ["merge", "--ff-only", `origin/${opts.base}`]);
  const freeKiB = Number(sh("df", ["-k", cwd]).trim().split("\n").at(-1).trim().split(/\s+/)[3]);
  if (freeKiB < 8 * 1024 * 1024) throw new Error("空きディスクが 8GiB 未満（takt-cleanup で片付けてから流し直す）");
  const issue = gh(["issue", "view", n, "--json", "number,title,body,labels,comments"]);
  const task = [
    `## Issue #${issue.number}: ${issue.title}`,
    ...(issue.body ? ["", issue.body] : []),
    ...(issue.labels.length ? ["", "### Labels", issue.labels.map((l) => l.name).join(", ")] : []),
    ...(issue.comments.length ? ["", "### Comments", ...issue.comments.map((c) => `**${c.author.login}**: ${c.body}`)] : []),
  ].join("\n");
  const r = await client.callTool({ name: "takt_enqueue_task", arguments: { cwd, task, workflow: opts.workflow, worktree: true, autoPr: true, draftPr: false, issue: { number: Number(n) }, taskContext: { baseBranch: opts.base } } });
  if (r.isError) throw new Error(`投入の応答がエラー（tasks.yaml を照合してから流し直す）: ${JSON.stringify(r.content)}`);
  event(n, `投入: ${label(n)}`);
}

let code = 1;
let errors = 0;
try {
  const startTasks = listTasks();
  for (const n of issues) {
    const issue = gh(["issue", "view", n, "--json", "title,state"]);
    titles.set(n, issue.title);
    const t = tasksFor(startTasks, n)[0];
    log(`対象: ${label(n)}（${t ? t.kind : issue.state === "CLOSED" ? "issue クローズ済み" : "未投入"}）`);
  }
  for (;;) {
    try {
      const tasks = listTasks();
      const stages = new Map(issues.map((n) => [n, stage(n, tasks)]));
      const all = [...stages.values()];
      if (all.every((s) => s === "done")) { log("全件マージ完了"); code = 0; break; }
      if (!all.includes("waiting")) {
        const next = issues.find((n) => stages.get(n) === "new" && ready(n));
        if (next) await enqueue(next);
        else if (all.includes("manual") && !all.includes("stuck")) { /* 手で対応中の PR のマージを待つ */ }
        else { log(all.includes("stuck") ? "停止: 人の手が要る issue がある" : "停止: 積める issue が無い（依存が未解除か help wanted）"); break; }
      }
      errors = 0;
    } catch (e) {
      log(`監視エラー: ${String(e.message).split("\n")[0]}`);
      // 投入と ff-only の失敗は流し直しても直らないので、すぐ止める
      if (++errors >= 3 || /投入|main checkout|空きディスク/.test(e.message)) break;
    }
    await sleep(Number(opts.interval) * 1000);
  }
} finally {
  await client.close();
}
process.exit(code);
