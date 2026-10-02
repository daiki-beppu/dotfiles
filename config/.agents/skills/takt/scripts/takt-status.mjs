// タスクの状態を数行で返す: 状態・今の run・現在の工程・最新のレビュー判定・裁定で直すことになった問題。
// 使い方: takt-node.sh takt-status.mjs <issue番号|タスク名の一部> [takt run のログ]
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const { TaskRunner } = await import(`${process.env.TAKT_ROOT}/dist/infra/task/index.js`);
const [key, logPath] = process.argv.slice(2);
if (!key) { console.error("usage: takt-status.mjs <issue|name> [log]"); process.exit(2); }

const items = new TaskRunner(process.cwd(), {}).listAllTaskItems()
  .filter((t) => String(t.issueNumber) === key.replace(/^#/, "") || t.name.includes(key));
if (items.length === 0) { console.log(`該当タスクなし: ${key}`); process.exit(1); }
const t = items.at(-1);
console.log(`${t.name}  status=${t.kind}  run=${t.runSlug ?? "-"}${t.sourceRunSlug ? ` (from ${t.sourceRunSlug})` : ""}`);
if (t.prUrl) console.log(`PR: ${t.prUrl}`);
const clone = t.worktreePath && existsSync(t.worktreePath) ? t.worktreePath : undefined;
console.log(`clone: ${clone ?? "なし"}`);

if (logPath && existsSync(logPath)) {
  const lines = readFileSync(logPath, "utf8").replace(/\r/g, "\n").split("\n");
  const steps = lines.filter((l) => /^\[INFO\] \[\d+\/\d+\]/.test(l));
  if (steps.length) console.log(`工程: ${steps.slice(-3).map((l) => l.replace("[INFO] ", "")).join(" → ")}`);
  const done = lines.findLast((l) => /Workflow completed|PR created|auto-requeued|not auto-requeued/.test(l));
  if (done) console.log(done.trim());
}

if (clone && t.runSlug) {
  const reports = join(clone, ".takt", "runs", t.runSlug, "reports");
  const walk = (d) => readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    if (n.startsWith(".takt-report-internal")) return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const files = existsSync(reports) ? walk(reports).filter((p) => p.endsWith(".md")) : [];
  const latest = new Map(); // 同名のレポートは新しいものだけ
  for (const f of files.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)) latest.set(f.split("/").at(-1), f);
  for (const [name, f] of latest) {
    if (!/review|resolution|gate/.test(name)) continue;
    const text = readFileSync(f, "utf8");
    const verdict = text.match(/^## 結果[:：]?\s*(.*)$/m)?.[1] ?? "?";
    console.log(`${name}: ${verdict}`);
    if (name === "review-resolution.md") {
      const fix = text.split(/^## 修正する問題/m)[1]?.split(/^## /m)[0] ?? "";
      for (const row of fix.split("\n").filter((l) => /^\| [A-Za-z]/.test(l) && !/問題ID/.test(l))) {
        console.log(`  修正: ${row.split("|").slice(1, 3).map((s) => s.trim()).join(" — ").slice(0, 200)}`);
      }
    }
  }
}
