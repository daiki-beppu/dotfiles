// main の修復の修正のセッション（main-fix）の起動。origin/main から作った Orca の worktree に、対話セッションとして起動する。
// review-fix（PR の head ブランチを直す）と違い、main から切って修正の PR を新しく出す。worktree の作成の失敗は例外にして、別の場所では起動しない。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mainFixFailedMarker, mainFixTabTitle } from "./decide.mjs";
import { launchAgent, runOrca, worktreePath } from "./orca-agent.mjs";

const INSTRUCTIONS = readFileSync(new URL("../references/main-fix.md", import.meta.url), "utf8");

const gitFetch = (cwd) => execFileSync("git", ["fetch", "origin"], { cwd, stdio: "ignore", timeout: 120_000 });

const pullLine = (repo, p) => `  - #${p.number} ${p.title}（https://github.com/${repo}/pull/${p.number}）${p.closes.length > 0 ? ` 閉じた issue: ${p.closes.map((n) => `#${n}`).join(" ")}` : ""}`;

const prompt = ({ repo, sha, checks, runs, lastGreen, pullRequests }) =>
  [
    `main の commit ${sha} で、必須チェックが再実行でも落ちた。main を直す。`,
    "",
    `- 失敗した commit C: ${sha} https://github.com/${repo}/commit/${sha}`,
    `- 落ちたチェック: ${checks.join("、")}`,
    `- 失敗した run: ${runs.length > 0 ? runs.map((r) => `https://github.com/${repo}/actions/runs/${r}`).join(" ") : "（Actions の run が無い）"}`,
    `- 最後に緑だった commit: ${lastGreen ?? "（さかのぼった範囲に無い）"}`,
    `- 範囲の PR（最後に緑だった commit より後、C まで）:`,
    ...(pullRequests.length > 0 ? pullRequests.map((p) => pullLine(repo, p)) : ["  - （無い）"]),
    `- 直せなかった印: ${mainFixFailedMarker(sha)}: <理由>`,
    "",
    INSTRUCTIONS,
  ].join("\n");

export function launchMainFix({ cwd, repo, sha, checks, runs, lastGreen, pullRequests }, run = runOrca, fetch = gitFetch) {
  fetch(cwd);
  const reply = run(
    ["worktree", "create", "--repo", `path:${cwd}`, "--name", `main-fix-${sha.slice(0, 7)}`, "--base-branch", "origin/main", "--json"],
    { cwd },
  );
  const where = worktreePath(reply);
  return launchAgent({ cwd: where, prompt: prompt({ repo, sha, checks, runs, lastGreen, pullRequests }), title: mainFixTabTitle(sha) }, run);
}
