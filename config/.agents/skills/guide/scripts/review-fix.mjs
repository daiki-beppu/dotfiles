// takt のレビューが失敗した PR の修正の起動。PR の head ブランチを checkout した Orca の worktree に、対話セッションとして起動する（launchOnHeadBranch）。
import { readFileSync } from "node:fs";
import { redoMarker } from "../../takt/scripts/review-stage.mjs";
import { tabTitle } from "./decide.mjs";
import { launchOnHeadBranch } from "./orca-agent.mjs";

const INSTRUCTIONS = readFileSync(new URL("../references/review-fix.md", import.meta.url), "utf8");

const prompt = ({ repo, pr, issue, head, branch, reports }) =>
  [
    `takt のレビューが PR #${pr} の現在の head で失敗した。この PR を直す。`,
    "",
    `- PR: #${pr} https://github.com/${repo}/pull/${pr}`,
    `- sub-issue: #${issue}`,
    `- 失敗した head: ${head}`,
    `- head ブランチ: ${branch}（push 先。push は \`git push origin HEAD:${branch}\`）`,
    `- レポートの場所: ${reports}`,
    `- やり直しの印: ${redoMarker(head)}`,
    "",
    INSTRUCTIONS,
  ].join("\n");

export function launchReviewFix({ cwd, repo, pr, issue, head, branch, reports }, run, git) {
  return launchOnHeadBranch(
    { cwd, branch, name: `review-fix-${pr}-${head.slice(0, 7)}`, prompt: prompt({ repo, pr, issue, head, branch, reports }), title: tabTitle("review-fix", pr) },
    run,
    git,
  );
}
