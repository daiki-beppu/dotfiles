// 依存の PR の仕上げ（deps-finish）の起動。Renovate などの PR の head ブランチを checkout した Orca の worktree に、
// poteto-mode の対話セッションとして起動する（launchOnHeadBranch）。
import { readFileSync } from "node:fs";
import { tabTitle } from "./decide.mjs";
import { DEPS_INDEX, depsFinishGaveUpMarker } from "./deps-finish-stage.mjs";
import { launchOnHeadBranch } from "./orca-agent.mjs";

const INSTRUCTIONS = readFileSync(new URL("../references/deps-finish.md", import.meta.url), "utf8");

const depsFinishPrompt = ({ repo, pr, title, head, branch, group }) =>
  [
    "/poteto-mode",
    "",
    `依存の PR #${pr} を仕上げてマージできる状態にする。`,
    "",
    `- PR: #${pr} https://github.com/${repo}/pull/${pr}（${title}）`,
    `- グループ: ${group ?? "未定。索引の行の引き方で依存名から引く"}`,
    `- head: ${head}`,
    `- head ブランチ: ${branch}（push 先。push は \`git push origin HEAD:${branch}\`）`,
    `- 索引: ${DEPS_INDEX}（対象 repo の root から）`,
    `- 直せなかった印: ${depsFinishGaveUpMarker(pr)}`,
    "",
    INSTRUCTIONS,
  ].join("\n");

export function launchDepsFinish({ cwd, repo, pr, title, head, branch, group }, run, git) {
  return launchOnHeadBranch(
    { cwd, branch, name: `deps-finish-${pr}-${head.slice(0, 7)}`, prompt: depsFinishPrompt({ repo, pr, title, head, branch, group }), title: tabTitle("deps-finish", pr) },
    run,
    git,
  );
}
