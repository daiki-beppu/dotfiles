// lint-issue の判定。issue の本文とコメントから警告の文字列を返す純粋な関数。gh も console も使わない。
const HUMAN = /実機|マージ後|人が(確|見|聞|試)|人の手|人手|目視|手で|手動|聞いて|聴いて|耳で|画面で確(か|認)|画面を見|録画|manual(ly)?\b|by hand|real device/i;
const AFTER_MERGE = /マージ後|人が確かめ|人の確認|manual/i;
// PR は run の終わりに作られ、CI はその後に走る。「CI は変えない」のような触らない宣言は拾わない
const PR_BODY = /PR\s*の?本文|pull request (body|description)/i;
const CI_AFTER = /\bCI\s*(の|で|が)/i;
// 「実装レポート」「報告」に載せる・書く旨。実装レポートは PR の本文に写るので、PR の本文に直接書く項目と違い run の中で満たせる
const REPORT = /(実装レポート|報告)[^、。]*?(に|へ)[^、。]*?(載|書)/;
const RECOMMENDED = "実装レポートに載せる（PR の本文に写る）";
const SPEC_WORD = /参照|詳細は|に従|を見て|を読んで|に書いた|のとおり|の通り|\bsee\b/i;
const ISSUE_REF = /(^|[^\w&])#\d+\b|github\.com\/[\w.-]+\/[\w.-]+\/(issues|pull)\/\d+/;
// 「仕様の『機能ごとの設定』」のように、リンク先の節を名前で指す書き方。本文に同じ見出しがあれば写してあるとみなす
const SECTION_REF = /(?:仕様|親 ?issue|spec)\s*の?\s*[「『]([^」』]+)[」』]/gi;
const BRANCH_REF = /git (fetch|checkout|switch|cherry-pick|merge)\b|origin\/(?!main\b|master\b)[\w./-]+/;

const norm = (s) => s.replace(/^#+\s*/, "").replace(/[`\s]/g, "");

export function lintIssue({ body, comments }) {
  const warnings = [];
  const sources = [["本文", body ?? ""], ...(comments ?? []).map((c, i) => [`コメント ${i + 1}（${c.author?.login ?? "?"}）`, c.body ?? ""])];
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
      const agentItem = /^\s*[-*]\s+\[ \]/.test(line) && !AFTER_MERGE.test(heading);
      if (/^\s*[-*]\s+\[ \]/.test(line) && HUMAN.test(line) && !AFTER_MERGE.test(heading)) {
        warnings.push(`${at}: 人の手が要る完了条件に見える。「## マージ後に人が確かめること」の節へ移すか、エージェントが自力で確かめられる形に書き直す\n    ${line.trim()}`);
      }
      if (agentItem && (CI_AFTER.test(line) || (PR_BODY.test(line) && !REPORT.test(line)))) {
        warnings.push(`${at}: PR 本文や CI を確かめる完了条件は run の中では満たせない。${RECOMMENDED}、CI と同じコマンドを手元で流して確かめる、の形に書き直す\n    ${line.trim()}`);
      }
      if (agentItem && REPORT.test(line) && !PR_BODY.test(line)) {
        warnings.push(`${at}: 実装レポートや報告に載せる完了条件に、載せる先が PR の本文だと書かれていない。レビューは PR の本文とコメントを読む。証跡は PR の本文に載せる、と書く（例: ${RECOMMENDED}）\n    ${line.trim()}`);
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
  return warnings;
}
