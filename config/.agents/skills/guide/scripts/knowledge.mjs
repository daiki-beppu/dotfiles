// Orca 起動アダプタ。orca agent launch で devlog → knowledge を 1 つの Orca のタブの対話セッションとして起動し、終わるまで待たない。
import { KNOWLEDGE_SPEC_PREFIX, tabTitle } from "./decide.mjs";
import { launchAgent } from "./orca-agent.mjs";

const nums = (ns) => ns.map((n) => `#${n}`).join(" ");

export const prompt = ({ spec, parents, subIssues, runDirs }) =>
  [
    "/devlog",
    "",
    `仕様 #${spec} の sub-issue がすべて閉じたので、その学びを開発ログ（devlog）に書き、続けて knowledge スキルでそのエントリを素材に用語集・ADR・知識文書へ振り分け、両方を 1 本の PR にする。`,
    "`docs/devlog/` にこの仕様の作業のエントリがすでにあれば、新しく書かずにそれを素材にする。devlog の手順 5 では PR を作らない。knowledge の手順 1 はブランチを切らずに読むところだけ行い、devlog のブランチのまま続ける。開発ログの素材として、次を直接読む。",
    `- 仕様の issue: #${spec}`,
    `- 親 issue: ${nums(parents)}`,
    `- 閉じた sub-issue: ${nums(subIssues)}（それぞれを閉じた PR は gh で辿り、差分と resolution コメントを読む）`,
    runDirs.length > 0
      ? `- takt の run: ${runDirs.map((d) => `${d}（各 run の trace.md と reports/）`).join("、")}`
      : "- takt の run: なし（issue と PR だけを素材にする）",
    "",
    `できた PR の本文には、「${KNOWLEDGE_SPEC_PREFIX}${spec}」だけの行を必ず 1 行書く（二重に作らないための記録）。PR の自動マージの予約は呼び出し側が行うので、ここでは行わない。`,
  ].join("\n");

export function launchKnowledge({ cwd, spec, parents, subIssues, runDirs }, run) {
  return launchAgent({ cwd, prompt: prompt({ spec, parents, subIssues, runDirs }), title: tabTitle("knowledge", spec) }, run);
}
