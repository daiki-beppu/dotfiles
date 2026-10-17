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

const TAIL_LINES = 10;
const STALE_HANDLE = "terminal_handle_stale";
const WAIT_TIMEOUT = "timeout";
const IDLE_PROBE_MS = 500;

const parseReply = (reply, what) => {
  try {
    return JSON.parse(reply);
  } catch {
    throw new Error(`${what} の応答が JSON ではない: ${head(reply)}`);
  }
};

// orca は失敗時に終了コード 1 で、stdout に { ok: false, error: { code } } を出す。その code（読めなければ undefined）。
function errorCode(e) {
  try {
    return JSON.parse(e?.stdout)?.error?.code;
  } catch {
    return undefined;
  }
}

// handle のセッションの観測 { found, waiting, idle, tail }。
//   found: `orca terminal show` が handle を返し、タブがつながっているか。存在しない handle の応答 terminal_handle_stale と、
//          閉じたタブ（show は ok のまま connected: false を返す）を false にする。それ以外の失敗は例外
//   waiting: show の agentWait が null でない（人にしか答えられない入力待ち。Orca が prompt-text / title / hook のどれかで確かめたもの）
//   idle: `orca terminal wait --for tui-idle` が短い待ちで満たされた（手が止まっている）。待ちが timeout（終了コード 1、error.code: "timeout"）なら false
//   tail: `orca terminal read` の画面の最後の 10 行
export function observeSession({ cwd, handle }, run = runOrca) {
  let shown;
  try {
    shown = run(["terminal", "show", "--terminal", handle, "--json"], { cwd });
  } catch (e) {
    if (errorCode(e) === STALE_HANDLE) return { found: false, waiting: false, idle: false, tail: [] };
    throw new Error(`orca terminal show が失敗した（ターミナル ${handle}）: ${e.message}`, { cause: e });
  }
  const terminal = parseReply(shown, "orca terminal show").result?.terminal;
  if (terminal === undefined) throw new Error(`orca terminal show の応答に result.terminal が無い: ${head(shown)}`);
  if (terminal.connected === false) return { found: false, waiting: false, idle: false, tail: [] };
  const read = parseReply(run(["terminal", "read", "--terminal", handle, "--json"], { cwd }), "orca terminal read");
  const tail = read.result?.terminal?.tail;
  if (!Array.isArray(tail)) throw new Error(`orca terminal read の応答に result.terminal.tail が無い（ターミナル ${handle}）`);
  return { found: true, waiting: terminal.agentWait != null, idle: isIdle({ cwd, handle }, run), tail: tail.slice(-TAIL_LINES) };
}

function isIdle({ cwd, handle }, run) {
  let reply;
  try {
    reply = run(["terminal", "wait", "--terminal", handle, "--for", "tui-idle", "--timeout-ms", String(IDLE_PROBE_MS), "--json"], { cwd });
  } catch (e) {
    if (errorCode(e) === WAIT_TIMEOUT) return false;
    throw new Error(`orca terminal wait が失敗した（ターミナル ${handle}）: ${e.message}`, { cause: e });
  }
  return parseReply(reply, "orca terminal wait").result?.wait?.satisfied === true;
}
