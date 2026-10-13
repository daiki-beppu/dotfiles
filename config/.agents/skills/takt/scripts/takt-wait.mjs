// 指定した issue のタスクが全件 pending / running を抜けるまで待ち、issue ごとの最終 status と PR を出す。
// - `takt list` の JSON は一時ファイル経由で読む（パイプでは 64KB 付近で切れて jq が失敗し続ける）。
// - failed で抜けても、auto_requeue_max_attempts による自動の積み直しで pending に戻ることがあるので、
//   --grace 秒おいてもう一度見てから終える。
// - PR ができたら、チェックが 1 件も付かないまま --checks-after 分たった PR を警告する
//   （workflow が無効になっていると、CI が来ないまま待ち続けることになる）。
// 使い方（repo root で）: node takt-wait.mjs <issue>... [--interval 30] [--grace 60] [--checks-after 10]
// 状態が変わったときだけ 1 行出す。全件 completed なら 0、それ以外で終われば 1 で終了する。
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { listTasks, tasksFor, issueOf } from "./takt-list.mjs";

const opts = { interval: 30, grace: 60, "checks-after": 10 };
const issues = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--") && a.slice(2) in opts) opts[a.slice(2)] = Number(argv[++i]);
  else if (/^#?\d+$/.test(a)) issues.push(issueOf(a));
  else { console.error(`不明な引数: ${a}`); process.exit(2); }
}
if (issues.length === 0) {
  console.error("usage: takt-wait.mjs <issue>... [--interval 30] [--grace 60] [--checks-after 10]");
  process.exit(2);
}

const active = (t) => t.kind === "pending" || t.kind === "running";
const now = () => new Date().toTimeString().slice(0, 8);
let latest = new Map();
let graceUsed = false;
let lastLine = "";
let lastError = "";

for (;;) {
  let tasks;
  try {
    tasks = listTasks();
    lastError = "";
  } catch (e) {
    if (String(e.message) !== lastError) console.log(`${now()} takt list を読めなかった（次の周回で読み直す）: ${e.message}`);
    lastError = String(e.message);
    await sleep(opts.interval * 1000);
    continue;
  }
  const lists = new Map(issues.map((n) => [n, tasksFor(tasks, n)]));
  latest = new Map(issues.map((n) => [n, lists.get(n)[0]]));
  const line = issues.map((n) => `#${n}=${latest.get(n)?.kind ?? "未投入"}`).join(" ");
  if (line !== lastLine) console.log(`${now()} ${line}`);
  lastLine = line;

  const waiting = issues.some((n) => lists.get(n).length === 0 || lists.get(n).some(active));
  if (!waiting) {
    if (!graceUsed && issues.some((n) => latest.get(n).kind === "failed")) {
      graceUsed = true;
      await sleep(opts.grace * 1000);
      continue;
    }
    break;
  }
  graceUsed = false;
  await sleep(opts.interval * 1000);
}

console.log("--- 最終 status ---");
for (const n of issues) {
  const t = latest.get(n);
  console.log(`#${n} ${t.kind} ${t.prUrl ?? "(PR なし)"} ${t.name}`);
  if (t.failure) console.log(`  failure: ${t.failure.step ?? "-"}: ${String(t.failure.error ?? "").split("\n")[0].slice(0, 200)}`);
}

function checkCount(url) {
  const r = spawnSync("gh", ["pr", "view", url, "--json", "statusCheckRollup", "--jq", ".statusCheckRollup | length"], { encoding: "utf8" });
  return r.status === 0 ? Number(r.stdout.trim()) : NaN;
}

if (opts["checks-after"] > 0) {
  const prs = issues.map((n) => [n, latest.get(n)]).filter(([, t]) => t.prUrl);
  for (const [n, t] of prs) {
    const deadline = (Date.parse(t.completedAt) || Date.now()) + opts["checks-after"] * 60_000;
    for (;;) {
      const count = checkCount(t.prUrl);
      if (count > 0) { console.log(`#${n} チェック ${count} 件: ${t.prUrl}`); break; }
      if (Date.now() >= deadline) {
        console.log(`警告: #${n} の PR に ${opts["checks-after"]} 分たってもチェックが 1 件も付いていない（${Number.isNaN(count) ? "gh で読めなかった" : "0 件"}）。workflow が無効になっていないか、.github/workflows の変更や Actions の設定を確かめる: ${t.prUrl}`);
        break;
      }
      await sleep(30_000);
    }
  }
}

process.exit(issues.every((n) => latest.get(n).kind === "completed") ? 0 : 1);
