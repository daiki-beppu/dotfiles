// takt のレビューが失敗した PR の修正の起動。PR の head ブランチを checkout した Orca の worktree に、対話セッションとして起動する。
// 手順: fetch → 他の worktree が head ブランチを持っているか確かめる → origin/<head ブランチ> から worktree を作る → worktree で切り替える → 起動。
// 持ち主がいなければ head ブランチを checkout する。いれば（前回の review-fix の worktree など）ブランチを共有せず、origin/<head ブランチ> の commit に detach する。
// 確認・作成・切り替えの失敗は例外にして、別のブランチの worktree では起動しない。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { redoMarker } from "../../takt/scripts/review-stage.mjs";
import { tabTitle } from "./decide.mjs";
import { launchAgent, runOrca, worktreePath } from "./orca-agent.mjs";

const INSTRUCTIONS = readFileSync(new URL("../references/review-fix.md", import.meta.url), "utf8");

const runGit = (args, { cwd }) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });

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

export function launchReviewFix({ cwd, repo, pr, issue, head, branch, reports }, run = runOrca, git = runGit) {
  git(["fetch", "origin"], { cwd });
  const owned = String(git(["worktree", "list", "--porcelain"], { cwd })).split("\n").includes(`branch refs/heads/${branch}`);
  const reply = run(
    ["worktree", "create", "--repo", `path:${cwd}`, "--name", `review-fix-${pr}-${head.slice(0, 7)}`, "--base-branch", `origin/${branch}`, "--json"],
    { cwd },
  );
  const where = worktreePath(reply);
  // 他の worktree が head ブランチを持っていれば、そのブランチを共有もリセットもせず origin/<ブランチ> に detach する。持ち主がいなければ追従させて checkout する
  git(owned ? ["switch", "--detach", `origin/${branch}`] : ["switch", "--track", "-C", branch, `origin/${branch}`], { cwd: where });
  return launchAgent({ cwd: where, prompt: prompt({ repo, pr, issue, head, branch, reports }), title: tabTitle("review-fix", pr) }, run);
}
