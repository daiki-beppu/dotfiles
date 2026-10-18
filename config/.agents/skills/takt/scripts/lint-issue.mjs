// takt に積む前に、issue の本文とコメント（投入時にタスクへ写るもの）を点検し、警告を出す。
// - 人の手が要る未完了のチェック項目（実機・目視・聞いて確かめる など）: takt のエージェントは満たせず、
//   BLOCKED や周回の浪費を招く。「マージ後に人が確かめること」の節へ移すよう勧める。
// - run の後にしか無いものを確かめる完了条件（PR 本文に書く・CI で確かめる）: run の中では満たせず、
//   レビューの指摘が 0 件でも BLOCKED になって auto_requeue で周回する。
// - 実装レポートや報告に載せる完了条件で、載せる先が PR 本文だと書かれていないもの: レビューは PR の本文とコメントを読むので、
//   「実装レポートに載せる（PR の本文に写る）」と書くよう勧める。
// - 仕様をリンク先に頼る記述（他 issue の参照・仕様の節名での参照・git fetch・ほかのブランチ）: takt のエージェントは
//   リンク先の issue もほかのブランチも読めない。要る内容を本文かコメントに写すよう勧める。
//   「一次資料: #N の解決コメント」のような指し方も拾う。見出しに「写し」を含む節にその #N の該当部分を写してあれば、警告しない。
// 使い方（repo root で）: node lint-issue.mjs <issue> [--strict]
// 警告があっても 0 で終わる。--strict を付けると、警告があれば 1 で終わる。
import { spawnSync } from "node:child_process";
import { lintIssue } from "./lint-issue-rules.mjs";

const args = process.argv.slice(2);
const issue = args.find((a) => /^#?\d+$/.test(a))?.replace(/^#/, "");
if (!issue) { console.error("usage: lint-issue.mjs <issue> [--strict]"); process.exit(2); }

const r = spawnSync("gh", ["issue", "view", issue, "--json", "title,body,comments"], { encoding: "utf8" });
if (r.status !== 0) { console.error(r.stderr.trim()); process.exit(2); }
const { title, body, comments } = JSON.parse(r.stdout);

const warnings = lintIssue({ body, comments });

if (warnings.length === 0) {
  console.log(`#${issue} ${title}: 警告なし`);
  process.exit(0);
}
console.log(`#${issue} ${title}: 警告 ${warnings.length} 件`);
for (const w of warnings) console.log(`- ${w}`);
process.exit(args.includes("--strict") ? 1 : 0);
