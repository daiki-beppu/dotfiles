// takt が作った PR の本文に、run のレポートから拾った検証の結果と査読の判定を「## Tests」として足す。
// takt の PR 本文は固定の形（Summary・Execution Report・Closes）で、pr_body_template は --pipeline でしか効かないため。
// 使い方（cwd はリポジトリのルート）: node pr-tests.mjs <issue番号> [--dry-run]
// 既に「## Tests」がある本文には足さない。表の行は実装レポートの「ビルド・テスト・静的検査・E2E」の行をそのまま写す。
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const [issue, flag] = process.argv.slice(2);
if (!/^\d+$/.test(issue ?? "")) { console.error("usage: pr-tests.mjs <issue> [--dry-run]"); process.exit(2); }

const yaml = readFileSync(".takt/tasks.yaml", "utf8");
const block = yaml.split(/\n  - /).find((b) => new RegExp(`\\n\\s*issue: ${issue}\\n`).test(`\n${b}\n`) && /\n\s*status: completed/.test(`\n${b}`));
if (!block) { console.error(`completed のタスクが見つからない: #${issue}`); process.exit(2); }
const field = (k) => (block.match(new RegExp(`\\n\\s*${k}: (.*)`)) ?? [])[1]?.trim();
const pr = field("pr_url");
const runDir = join(field("worktree_path") ?? "", ".takt/runs", field("run_slug") ?? "");
if (!pr || !existsSync(runDir)) { console.error(`PR か run のディレクトリが無い: ${pr} ${runDir}`); process.exit(2); }

// reports 配下の Markdown を、内部の履歴（.takt-report-internal）を除いて新しい順に集める
const reports = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === ".takt-report-internal") continue;
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith(".md")) reports.push({ name, path, mtime: statSync(path).mtimeMs });
  }
};
walk(join(runDir, "reports"));
reports.sort((a, b) => b.mtime - a.mtime);

const impl = reports.find((r) => r.name === "implementation-report.md");
// 「品質ゲート」の節の表を丸ごと写す（行の見出しはレポートごとに「テスト」「単体テスト」などと揺れる）。節が無ければ見出しで拾う
const gateRows = (text) => {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^## .*(品質ゲート|検証)/.test(l));
  if (start < 0) return lines.filter((l) => /^\| *(ビルド|テスト|単体|軽い|重い|静的検査|E2E|build|test)/.test(l));
  const body = [];
  for (const l of lines.slice(start + 1)) {
    if (/^## /.test(l)) break;
    if (l.startsWith("| ")) body.push(l);
  }
  return body.slice(1); // 先頭はレポートの表の見出し行（区切り行は "|---" なので入らない）
};
const rows = impl ? gateRows(readFileSync(impl.path, "utf8")) : [];
// 査読ごとの最新の判定（同じ名前のレポートは新しいものだけ）
const verdicts = new Map();
for (const r of reports) {
  if (!/review|resolution|verification/.test(r.name) || verdicts.has(r.name)) continue;
  const line = readFileSync(r.path, "utf8").match(/^## 結果: *(.+)$/m);
  if (line) verdicts.set(r.name.replace(/\.md$/, ""), line[1].trim());
}

const section = [
  "## Tests",
  "",
  "takt の実装レポートから写した検証の結果（各行のログは run のレポートにある）:",
  "",
  "| 種別 | コマンド | 結果 | 判断 |",
  "|---|---|---|---|",
  ...(rows.length ? rows : ["| — | 実装レポートに検証の表が見つからない | — | 手で確かめる |"]),
  "",
  // 最終の判定（review-resolution）を先に出す。観点ごとの判定は修正前のものが残りうる（修正は fix-verification が確かめ、再レビューはしない）
  `- 査読の最終判定: ${verdicts.get("review-resolution") ?? "見つからない"}${verdicts.has("fix-verification") ? `（修正の確認: ${verdicts.get("fix-verification")}）` : ""}`,
  `- 観点ごとの判定（修正の前の判定を含む）: ${[...verdicts].filter(([k]) => !["review-resolution", "fix-verification"].includes(k)).map(([k, v]) => `${k} ${v}`).join("・") || "見つからない"}`,
].join("\n");

const body = execFileSync("gh", ["pr", "view", pr, "--json", "body", "-q", ".body"], { encoding: "utf8" });
if (/^## Tests\b/m.test(body)) { console.log(`既に ## Tests がある: ${pr}`); process.exit(0); }
const next = `${body.trimEnd()}\n\n${section}\n`;
if (flag === "--dry-run") { console.log(section); process.exit(0); }
execFileSync("gh", ["pr", "edit", pr, "--body-file", "-"], { input: next });
console.log(`足した: ${pr}`);
