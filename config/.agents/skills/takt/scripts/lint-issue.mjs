// takt に積む前に、issue の本文とコメント（投入時にタスクへ写るもの）を点検し、警告を出す。
// - 人の手が要る未完了のチェック項目（実機・目視・聞いて確かめる など）: takt のエージェントは満たせず、
//   BLOCKED や周回の浪費を招く。「マージ後に人が確かめること」の節へ移すよう勧める。
// - 仕様をリンク先に頼る記述（他 issue の参照・仕様の節名での参照・git fetch・ほかのブランチ）: takt のエージェントは
//   リンク先の issue もほかのブランチも読めない。要る内容を本文かコメントに写すよう勧める。
// 使い方（repo root で）: node lint-issue.mjs <issue> [--strict]
// 警告があっても 0 で終わる。--strict を付けると、警告があれば 1 で終わる。
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const issue = args.find((a) => /^#?\d+$/.test(a))?.replace(/^#/, "");
if (!issue) { console.error("usage: lint-issue.mjs <issue> [--strict]"); process.exit(2); }

const r = spawnSync("gh", ["issue", "view", issue, "--json", "title,body,comments"], { encoding: "utf8" });
if (r.status !== 0) { console.error(r.stderr.trim()); process.exit(2); }
const { title, body, comments } = JSON.parse(r.stdout);

const HUMAN = /実機|マージ後|人が(確|見|聞|試)|人の手|人手|目視|手で|手動|聞いて|聴いて|耳で|画面で確(か|認)|画面を見|録画|manual(ly)?\b|by hand|real device/i;
const AFTER_MERGE = /マージ後|人が確かめ|人の確認|manual/i;
const SPEC_WORD = /参照|詳細は|に従|を見て|を読んで|に書いた|のとおり|の通り|\bsee\b/i;
const ISSUE_REF = /(^|[^\w&])#\d+\b|github\.com\/[\w.-]+\/[\w.-]+\/(issues|pull)\/\d+/;
// 「仕様の『機能ごとの設定』」のように、リンク先の節を名前で指す書き方。本文に同じ見出しがあれば写してあるとみなす
const SECTION_REF = /(?:仕様|親 ?issue|spec)\s*の?\s*[「『]([^」』]+)[」』]/gi;
const BRANCH_REF = /git (fetch|checkout|switch|cherry-pick|merge)\b|origin\/(?!main\b|master\b)[\w./-]+/;

const warnings = [];
const sources = [["本文", body ?? ""], ...(comments ?? []).map((c, i) => [`コメント ${i + 1}（${c.author?.login ?? "?"}）`, c.body ?? ""])];
const norm = (s) => s.replace(/^#+\s*/, "").replace(/[`\s]/g, "");
const headings = new Set(sources.flatMap(([, text]) => text.split("\n").filter((l) => /^#{1,6}\s/.test(l)).map(norm)));
for (const [where, text] of sources) {
  let heading = "";
  let inFence = false;
  text.split("\n").forEach((line, i) => {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) return;
    const h = line.match(/^#{1,6}\s+(.*)/);
    if (h) { heading = h[1]; return; }
    const at = `${where} ${i + 1} 行目`;
    if (/^\s*[-*]\s+\[ \]/.test(line) && HUMAN.test(line) && !AFTER_MERGE.test(heading)) {
      warnings.push(`${at}: 人の手が要る完了条件に見える。「## マージ後に人が確かめること」の節へ移すか、エージェントが自力で確かめられる形に書き直す\n    ${line.trim()}`);
    }
    if (ISSUE_REF.test(line) && SPEC_WORD.test(line)) {
      warnings.push(`${at}: 仕様をリンク先の issue / PR に頼っている。takt のエージェントはリンク先を読めないので、要る内容を本文かコメントに写す\n    ${line.trim()}`);
    }
    const unseen = [...line.matchAll(SECTION_REF)].map((m) => m[1]).filter((name) => !headings.has(norm(name)));
    if (unseen.length) {
      warnings.push(`${at}: リンク先の仕様の節（${unseen.map((n) => `「${n}」`).join("・")}）を名前で指している。takt のエージェントは読めないので、その節の中身を本文かコメントに写す\n    ${line.trim()}`);
    }
    if (BRANCH_REF.test(line)) {
      warnings.push(`${at}: ほかのブランチや fetch を前提にしている。takt のクローンには remote が無いので、要る内容を本文かコメントに写すか、base に入れてから積む\n    ${line.trim()}`);
    }
  });
}

if (warnings.length === 0) {
  console.log(`#${issue} ${title}: 警告なし`);
  process.exit(0);
}
console.log(`#${issue} ${title}: 警告 ${warnings.length} 件`);
for (const w of warnings) console.log(`- ${w}`);
process.exit(args.includes("--strict") ? 1 : 0);
