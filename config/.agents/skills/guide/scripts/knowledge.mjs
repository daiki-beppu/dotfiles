// Orca 起動アダプタ。orca agent launch で knowledge だけを Orca のタブの対話セッションとして起動し（devlog は起動しない）、終わるまで待たない。
import { KNOWLEDGE_SPEC_PREFIX, tabTitle } from "./decide.mjs";
import { launchAgent } from "./orca-agent.mjs";

const nums = (ns) => ns.map((n) => `#${n}`).join(" ");

export const prompt = ({ spec, parents, subIssues, runDirs }) =>
  [
    "/knowledge",
    "",
    `仕様 #${spec} の sub-issue がすべて閉じたので、その学びをまとめて PR にする。開発ログ（devlog）は無いので書かない。`,
    "手順 2 の「開発ログの無い作業」の経路で、次を直接読んで素材にする。",
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
