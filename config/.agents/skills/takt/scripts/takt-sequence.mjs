// 指定した issue を順に 1 件ずつ takt に積み、PR の自動マージ予約からマージ完了までを見届けて、次の issue を積む。
// 出力は出来事が起きたときだけ「日時（JST） 出来事: #issue か PR の URL」の 1 行。Orca のタブで流して人が追える形にする。
// - 積むのは、対象のタスクが pending / running でなく、open で、blocked_by が全部閉じていて、
//   takt:manual / help wanted の付いていない issue のうち、並びの先頭のもの。
// - 積む前に main checkout（base ブランチでクリーンなこと）を ff-only で最新化し、空きディスク 8GiB を確かめる。
// - 投入は takt MCP の takt_enqueue_task（enqueue.md と同じ入力）。応答が不明なら積み直さずに止める。
// - 状態はファイルに持たず、毎周 takt list と GitHub から読み直す。止めて流し直しても二重には積まない。
// 使い方（repo root で、watch が動いている状態で）:
//   <skill>/scripts/takt-node.sh <skill>/scripts/takt-sequence.mjs <issue>... [--workflow default] [--base main] [--interval 30]
// 全件マージ済みなら 0、CI 失敗・競合・タスク失敗などで進めなくなったら 1 で終わる。
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { listTasks, tasksFor, issueOf } from "./takt-list.mjs";

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
const event = (n, s) => { if (last.get(n) !== s) log(s); last.set(n, s); };

const active = (t) => t.kind === "pending" || t.kind === "running";
const SKIP_LABELS = ["takt:manual", "help wanted"];
const FAILED_CHECK = ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"];

sh("takt", ["workflow", "doctor", opts.workflow]);
const repo = gh(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
const { Client } = await import(join(process.env.TAKT_ROOT, "node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js"));
const { StdioClientTransport } = await import(join(process.env.TAKT_ROOT, "node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js"));
const client = new Client({ name: "takt-sequence", version: "1.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(process.env.TAKT_ROOT, "dist/app/mcp/index.js")], cwd, stderr: "inherit" }));

// issue 1 件の今の段階を返す。done: マージ済みか issue が閉じた / waiting: 進行中 / stuck: 人の手が要る / new: 未投入
function stage(n, tasks) {
  const t = tasksFor(tasks, n)[0];
  if (!t) return gh(["issue", "view", n, "--json", "state"]).state === "CLOSED" ? "done" : "new";
  if (active(t)) return "waiting";
  if (t.kind !== "completed") { event(n, `タスク${t.kind}: #${n}`); return "stuck"; }
  if (!t.prUrl) { event(n, `PR なし: #${n}`); return "stuck"; }
  const pr = gh(["pr", "view", t.prUrl, "--json", "state,mergeable,statusCheckRollup,autoMergeRequest"]);
  if (pr.state === "MERGED") { event(n, `マージ完了: #${n}`); return "done"; }
  if (pr.state === "CLOSED") { event(n, `PR クローズ: ${t.prUrl}`); return "stuck"; }
  if (pr.statusCheckRollup.some((c) => FAILED_CHECK.includes(c.conclusion ?? c.state))) { event(n, `CI失敗: ${t.prUrl}`); return "stuck"; }
  if (pr.mergeable === "CONFLICTING") { event(n, `競合修正待ち: ${t.prUrl}`); return "stuck"; }
  if (!pr.autoMergeRequest) {
    sh("gh", ["pr", "merge", t.prUrl, "--auto", "--squash"]);
    event(n, `自動マージ予約: ${t.prUrl}`);
  }
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
  const r = await client.callTool({ name: "takt_enqueue_task", arguments: { cwd, task, workflow: opts.workflow, worktree: true, autoPr: true, issue: { number: Number(n) }, taskContext: { baseBranch: opts.base } } });
  if (r.isError) throw new Error(`投入の応答がエラー（tasks.yaml を照合してから流し直す）: ${JSON.stringify(r.content)}`);
  event(n, `投入: #${n}`);
}

let code = 1;
let errors = 0;
try {
  for (;;) {
    try {
      const tasks = listTasks(cwd);
      const stages = new Map(issues.map((n) => [n, stage(n, tasks)]));
      const all = [...stages.values()];
      if (all.every((s) => s === "done")) { log("全件マージ完了"); code = 0; break; }
      if (!all.includes("waiting")) {
        const next = issues.find((n) => stages.get(n) === "new" && ready(n));
        if (next) await enqueue(next);
        else { log(all.includes("stuck") ? "停止: 人の手が要る issue がある" : "停止: 積める issue が無い（依存が未解除か takt:manual）"); break; }
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
