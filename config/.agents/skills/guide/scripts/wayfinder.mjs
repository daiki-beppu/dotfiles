// wayfinder の ticket の起動。Orca のタブに /wayfinder の対話セッションとして起動する（1 セッション 1 ticket）。
// task は origin/main から作った Orca の worktree で、research と grilling は対象 repo の main checkout で起動する。
import { execFileSync } from "node:child_process";
import { tabTitle } from "./decide.mjs";
import { launchAgent, runOrca, worktreePath } from "./orca-agent.mjs";

const gitFetch = (cwd) => execFileSync("git", ["fetch", "origin"], { cwd, stdio: "ignore", timeout: 120_000 });

const prompt = (map, ticket) =>
  [`/wayfinder #${map} #${ticket}`, "", `map #${map} の ticket #${ticket} だけを解く。ほかの ticket には手を付けない。`].join("\n");

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
