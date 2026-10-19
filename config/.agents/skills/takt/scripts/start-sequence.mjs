// takt-sequence を Orca で起動する。repo root で案内役が desk（guide/scripts/desk.mjs）のペインで動いていれば、案内役のペインの下に分割して開き、
// そうでなければ新しいタブに開く。どちらで開いたかを 1 行出す（終わりは待たない）。
// 案内役は、コマンド行に scripts/guide.mjs を含み、cwd が repo root のプロセス。コマンド行の `--terminal <handle>` が案内役の自分のペイン。
// 使い方（repo root で、watch が動いている状態で）:
//   node <skill>/scripts/start-sequence.mjs <issue>... [--workflow default] [--base main] [--fix-wait 10]
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { handleOf, runOrca } from "../../guide/scripts/orca-agent.mjs";
import { SPLIT_DOWN } from "../../guide/scripts/pane.mjs";

const TAKT_SCRIPTS = fileURLToPath(new URL("./", import.meta.url));
const GUIDE_PATTERN = "scripts/guide\\.mjs";
const OPTIONS = ["--workflow", "--base", "--fix-wait"];
const q = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;

// takt-sequence に渡す引数を確かめ、そのまま返す。issue が 1 つも無い・知らない引数・値の無いオプション・正でない --fix-wait は null。
export function parseSequenceArgs(argv) {
  let issues = 0;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (/^#?\d+$/.test(a)) issues++;
    else if (OPTIONS.includes(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) return null;
      if (a === "--fix-wait" && !(Number(v) > 0)) return null;
    } else return null;
  }
  return issues > 0 ? argv : null;
}

// processes（{ pid, cwd, command } の配列）のうち、cwd が root の案内役が `--terminal <handle>` で受け取った handle。無ければ undefined。
export function guideTerminal(processes, root) {
  for (const p of processes) {
    if (p.cwd !== root) continue;
    const words = p.command.split(/\s+/);
    const handle = words[words.indexOf("--terminal") + 1];
    if (words.includes("--terminal") && handle) return handle;
  }
  return undefined;
}

// 動いている案内役のプロセス。pgrep は合うものが無いと終了コード 1 になるので、空として扱う。
export function guideProcesses() {
  const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  let pids;
  try {
    pids = sh("pgrep", ["-f", GUIDE_PATTERN]).split("\n").filter(Boolean);
  } catch (e) {
    if (e.status === 1) return [];
    throw e;
  }
  return pids.flatMap((pid) => {
    try {
      const cwd = sh("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"]).split("\n").find((l) => l.startsWith("n"))?.slice(1);
      return [{ pid, cwd, command: sh("ps", ["-o", "command=", "-p", pid]).trim() }];
    } catch {
      return []; // 調べている間に終わったプロセス
    }
  });
}

// takt-sequence を起動し、開いたペインかタブの handle を返す。run は orca の実行（テストでは偽物）、log は 1 行の出力。
export function startSequence({ root, repo, args, processes, run = runOrca, log = console.log }) {
  const command = [`${TAKT_SCRIPTS}takt-node.sh`, `${TAKT_SCRIPTS}takt-sequence.mjs`, ...args].map(q).join(" ");
  const guide = guideTerminal(processes, root);
  if (guide !== undefined) {
    const reply = run(["terminal", "split", "--terminal", guide, "--direction", SPLIT_DOWN, "--command", command, "--json"], { cwd: root });
    const handle = handleOf(reply, "orca terminal split", "result.split.handle");
    log(`案内役のペイン ${guide} の下に分割して起動した: ${handle}`);
    return handle;
  }
  const reply = run(["terminal", "create", "--worktree", `path:${root}`, "--title", `takt sequence ${repo}`, "--json", "--command", command], { cwd: root });
  const handle = handleOf(reply, "orca terminal create", "result.terminal.handle");
  log(`新しいタブで起動した: ${handle}`);
  return handle;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isMain) {
  const args = parseSequenceArgs(process.argv.slice(2));
  if (args === null) {
    console.error("usage: node start-sequence.mjs <issue>... [--workflow default] [--base main] [--fix-wait 10]（--fix-wait は正の数）");
    process.exit(2);
  }
  const sh = (cmd, a) => execFileSync(cmd, a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const root = realpathSync(sh("git", ["rev-parse", "--show-toplevel"]));
  if (realpathSync(process.cwd()) !== root) {
    console.error(`repo の root（${root}）で流す`);
    process.exit(2);
  }
  const repo = JSON.parse(sh("gh", ["repo", "view", "--json", "nameWithOwner"])).nameWithOwner;
  startSequence({ root, repo, args, processes: guideProcesses() });
}
