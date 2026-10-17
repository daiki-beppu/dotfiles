// Orca のタブでエージェントを対話セッションとして起動するアダプタ。工程（to-tickets など）に依存しない。
// run(args, { cwd }) は orca を実行して stdout を返す。テストでは偽物を注入する。
import { execFileSync } from "node:child_process";

const runOrca = (args, { cwd }) =>
  execFileSync("orca", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });

const head = (text) => String(text).trim().slice(0, 200);

// `orca agent launch --json` の応答から handle（result.outcome.handle）を取る。
function handleOf(reply) {
  let parsed;
  try {
    parsed = JSON.parse(reply);
  } catch {
    throw new Error(`orca agent launch の応答から handle が取れない（JSON ではない）: ${head(reply)}`);
  }
  const handle = parsed?.result?.outcome?.handle;
  if (typeof handle !== "string" || handle === "") {
    throw new Error(`orca agent launch の応答から handle が取れない（result.outcome.handle が無い）: ${head(reply)}`);
  }
  return handle;
}

export function launchAgent({ cwd, prompt, title }, run = runOrca) {
  const reply = run(["agent", "launch", "--agent", "claude", "--worktree", `path:${cwd}`, "--prompt", prompt, "--json"], { cwd });
  const handle = handleOf(reply);
  try {
    run(["terminal", "rename", "--terminal", handle, "--title", title, "--json"], { cwd });
  } catch (e) {
    throw new Error(`orca terminal rename が失敗した（ターミナル ${handle}）: ${e.message}`, { cause: e });
  }
  return { handle };
}
