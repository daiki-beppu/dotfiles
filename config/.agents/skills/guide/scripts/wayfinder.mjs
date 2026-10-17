// wayfinder の ticket の起動。Orca のタブに /wayfinder の対話セッションとして起動する（1 セッション 1 ticket）。
// task は origin/main から作った Orca の worktree で、research と grilling は対象 repo の main checkout で起動する。
import { execFileSync } from "node:child_process";
import { tabTitle } from "./decide.mjs";
import { launchAgent, runOrca } from "./orca-agent.mjs";

const gitFetch = (cwd) => execFileSync("git", ["fetch", "origin"], { cwd, stdio: "ignore", timeout: 120_000 });

const prompt = (map, ticket) =>
  [`/wayfinder #${map} #${ticket}`, "", `map #${map} の ticket #${ticket} だけを解く。ほかの ticket には手を付けない。`].join("\n");

// orca worktree create --json の応答 { ok, result: { worktree: { path } } } から path を取る。
function worktreePath(reply) {
  let parsed;
  try {
    parsed = JSON.parse(reply);
  } catch {
    throw new Error(`orca worktree create の応答から result.worktree.path が取れない（JSON ではない）: ${String(reply).trim().slice(0, 200)}`);
  }
  const path = parsed?.result?.worktree?.path;
  if (typeof path !== "string" || path === "") {
    throw new Error(`orca worktree create の応答から result.worktree.path が取れない: ${String(reply).trim().slice(0, 200)}`);
  }
  return path;
}

export function launchWayfinder({ cwd, map, ticket, type }, run = runOrca, fetch = gitFetch) {
  let where = cwd;
  if (type === "task") {
    fetch(cwd);
    const reply = run(
      ["worktree", "create", "--repo", `path:${cwd}`, "--name", `wayfinder-${ticket}`, "--base-branch", "origin/main", "--json"],
      { cwd },
    );
    where = worktreePath(reply);
  }
  return launchAgent({ cwd: where, prompt: prompt(map, ticket), title: tabTitle("wayfinder", ticket) }, run);
}
