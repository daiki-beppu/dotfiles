// タスクの状態を数行で返す: 状態・今の run・現在の工程・最新のレビュー判定・裁定で直すことになった問題。
// 使い方: takt-node.sh takt-status.mjs <issue番号|タスク名の一部> [takt run のログ]
// キューに無い実行（`takt --pipeline` の直接実行）は、cwd の .takt/runs の最新 run を読む。
// cwd はキュー実行ならリポジトリのルート、直接実行なら takt を起動した worktree。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const { TaskRunner } = await import(`${process.env.TAKT_ROOT}/dist/infra/task/index.js`);
const [key, logPath] = process.argv.slice(2);
if (!key) { console.error("usage: takt-status.mjs <issue|name> [log]"); process.exit(2); }
const issue = key.replace(/^#/, "");
const ago = (ms) => `${Math.round((Date.now() - ms) / 60000)} 分前`;

const items = new TaskRunner(process.cwd(), {}).listAllTaskItems()
  .filter((t) => String(t.issueNumber) === issue || t.name.includes(key));
let runRoot;
if (items.length > 0) {
  const t = items.at(-1);
  console.log(`${t.name}  status=${t.kind}  run=${t.runSlug ?? "-"}${t.sourceRunSlug ? ` (from ${t.sourceRunSlug})` : ""}`);
  if (t.prUrl) console.log(`PR: ${t.prUrl}`);
  const clone = t.worktreePath && existsSync(t.worktreePath) ? t.worktreePath : undefined;
  console.log(`clone: ${clone ?? "なし"}`);
  if (clone && t.runSlug) runRoot = join(clone, ".takt", "runs", t.runSlug);
} else {
  const runs = join(process.cwd(), ".takt", "runs");
  const slugs = existsSync(runs) ? readdirSync(runs).filter((n) => existsSync(join(runs, n, "meta.json"))).sort() : [];
  if (slugs.length === 0) { console.log(`該当タスクなし: ${key}（cwd に .takt/runs も無い）`); process.exit(1); }
  runRoot = join(runs, slugs.at(-1));
  const m = JSON.parse(readFileSync(join(runRoot, "meta.json"), "utf8"));
  console.log(`直接実行  run=${m.runSlug}  workflow=${m.workflow}  status=${m.status}`);
  console.log(`工程: ${m.currentStep ?? "-"}（iteration ${m.currentIteration ?? "-"}）  開始 ${ago(Date.parse(m.startTime))}  meta 更新 ${ago(Date.parse(m.updatedAt))}`);
}

// 止まっているかは、ファイルの更新時刻ではなく CPU 時間の伸びで見る（check の実行中は数分ファイルが動かない）
try {
  const roots = execFileSync("pgrep", ["-f", `takt .*-i ${issue}( |$)`], { encoding: "utf8" }).trim().split("\n");
  const procs = execFileSync("ps", ["-ax", "-o", "pid=,ppid=,time="], { encoding: "utf8" }).trim().split("\n")
    .map((l) => l.trim().split(/\s+/));
  const tree = new Set(roots);
  for (let grew = true; grew;) {
    grew = false;
    for (const [pid, ppid] of procs) if (tree.has(ppid) && !tree.has(pid)) { tree.add(pid); grew = true; }
  }
  const sec = procs.filter(([pid]) => tree.has(pid)).reduce((s, [, , time]) => {
    const [min, rest] = time.split(":");
    return s + Number(min) * 60 + Number(rest);
  }, 0);
  console.log(`プロセス: takt と子 ${tree.size} 個、CPU 累計 ${Math.round(sec)} 秒（間を置いて 2 回見て、伸びていれば動いている）`);
} catch { console.log(`プロセス: -i ${issue} の takt は動いていない（キュー実行は takt run の側で見る）`); }

if (logPath && existsSync(logPath)) {
  const lines = readFileSync(logPath, "utf8").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "\n").split("\n");
  const steps = lines.filter((l) => /^\[INFO\] \[\d+\/\d+\]/.test(l));
  if (steps.length) console.log(`工程: ${steps.slice(-3).map((l) => l.replace("[INFO] ", "")).join(" → ")}`);
  const done = lines.findLast((l) => /Workflow completed|PR created|auto-requeued|not auto-requeued/.test(l));
  if (done) console.log(done.trim());
}

if (runRoot) {
  const walk = (d) => existsSync(d) ? readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    if (n.startsWith(".takt-report-internal")) return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  }) : [];
  const byMtime = (a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs;
  const verdictOf = (text) => text.match(/^## 結果[:：]?\s*(.*)$/m)?.[1] ?? "?";
  const latest = new Map(); // 同名のレポートは新しいものだけ
  for (const f of walk(join(runRoot, "reports")).filter((p) => p.endsWith(".md")).sort(byMtime)) latest.set(f.split("/").at(-1), f);
  for (const [name, f] of latest) {
    if (!/review|resolution|gate/.test(name)) continue;
    const text = readFileSync(f, "utf8");
    console.log(`${name}: ${verdictOf(text)}`);
    if (name === "review-resolution.md") {
      const fix = text.split(/^## 修正する問題/m)[1]?.split(/^## /m)[0] ?? "";
      for (const row of fix.split("\n").filter((l) => /^\| [A-Za-z]/.test(l) && !/問題ID/.test(l))) {
        console.log(`  修正: ${row.split("|").slice(1, 3).map((s) => s.trim()).join(" — ").slice(0, 200)}`);
      }
    }
  }
  // 直近の step の応答。同じ step 名の何周目か（fix-verifier.2 など）と差し戻しの有無が分かる
  for (const f of walk(join(runRoot, "context", "previous_responses")).filter((p) => !p.endsWith("/latest.md")).sort(byMtime).slice(-3)) {
    console.log(`応答: ${f.split("/").at(-1)}  ${ago(statSync(f).mtimeMs)}  結果=${verdictOf(readFileSync(f, "utf8"))}`);
  }
}
