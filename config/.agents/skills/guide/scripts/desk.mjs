// repo ごとの常駐（takt watch・案内役・align-behind）を、Orca の 1 つのタブにペインで並べて起動する。
// 使い方（対象 repo の main checkout の root で）: node desk.mjs <owner/repo> [案内役の引数…（--from・--interval など。--terminal は除く）]
//
//   ┌────────────┬─────────────────┐
//   │            │ 案内役          │
//   │            ├─────────────────┤
//   │ takt watch │ takt-sequence   │ ← 案内役が仕様ごとに自分のペインの下へ足す（--terminal）
//   │            ├─────────────────┤
//   │            │ align-behind    │
//   └────────────┴─────────────────┘
//
// 既に動いているものは二重に起動しない（cwd が repo root のプロセスを pgrep と lsof で見る。takt の references/run.md と同じ確かめ方）。
// takt watch が動いていれば左のペインを作らず、案内役が最初のペインになる。align-behind が動いていれば、そのペインを作らない。
// 案内役が動いていれば何も作らず、PID を出して終了コード 2 で止める。
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "./args.mjs";
import { handleOf, runOrca } from "./orca-agent.mjs";
import { SPLIT_DOWN, SPLIT_RIGHT } from "./pane.mjs";

const GUIDE = fileURLToPath(new URL("./guide.mjs", import.meta.url));
const ALIGN_BEHIND = fileURLToPath(new URL("../../takt/scripts/align-behind.mjs", import.meta.url));
const q = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;

// pgrep -f に渡す、それぞれのプロセスのコマンド行の正規表現
export const PROCESS_PATTERNS = {
  watch: "/bin/takt (watch|run)",
  guide: "scripts/guide\\.mjs",
  alignBehind: "scripts/align-behind\\.mjs",
};

// pattern に合うプロセスのうち、cwd が root のものの PID。pgrep は合うものが無いと終了コード 1 になるので、空として扱う。
export function runningIn({ pattern, root }) {
  let pids;
  try {
    pids = execFileSync("pgrep", ["-f", pattern], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch (e) {
    if (e.status === 1) return [];
    throw e;
  }
  return pids.filter((pid) => {
    try {
      const cwd = execFileSync("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"], { encoding: "utf8" });
      return cwd.split("\n").some((l) => l === `n${root}`);
    } catch {
      return false; // 調べている間に終わったプロセス
    }
  });
}

// タブを組み立てる。running(kind) は動いているプロセスの PID の配列（kind は PROCESS_PATTERNS のキー）、run は orca の実行（テストでは偽物）。
// 戻り値は終了コード。log は出力（作ったペインの handle と、飛ばした理由）。
export function buildDesk({ root, repo, guideArgs = [], running, run = runOrca, log = console.log }) {
  const guidePids = running("guide");
  if (guidePids.length > 0) {
    log(`案内役が既に動いている（PID ${guidePids.join(" ")}）。何も作らない。止めてから流し直す`);
    return 2;
  }
  const orca = (args) => run(args, { cwd: root });
  const watchPids = running("watch");
  let guide;
  if (watchPids.length > 0) {
    log(`takt watch は既に動いている（PID ${watchPids.join(" ")}）。左のペインは作らない`);
    guide = handleOf(orca(["terminal", "create", "--worktree", `path:${root}`, "--title", `案内役 ${repo}`, "--json"]), "orca terminal create", "result.terminal.handle");
  } else {
    const watch = handleOf(orca(["terminal", "create", "--worktree", `path:${root}`, "--title", `takt watch ${repo}`, "--json", "--command", "takt watch"]), "orca terminal create", "result.terminal.handle");
    log(`takt watch: ${watch}`);
    guide = handleOf(orca(["terminal", "split", "--terminal", watch, "--direction", SPLIT_RIGHT, "--json"]), "orca terminal split", "result.split.handle");
  }
  // 案内役には自分のペインの handle を渡すので、ペインを作ってから、その handle を入れたコマンドを送る
  const command = ["node", GUIDE, repo, "--terminal", guide, ...guideArgs].map(q).join(" ");
  orca(["terminal", "send", "--terminal", guide, "--text", command, "--enter", "--json"]);
  log(`案内役: ${guide}`);
  const alignPids = running("alignBehind");
  if (alignPids.length > 0) {
    log(`align-behind は既に動いている（PID ${alignPids.join(" ")}）。そのペインは作らない`);
  } else {
    const align = handleOf(orca(["terminal", "split", "--terminal", guide, "--direction", SPLIT_DOWN, "--command", ["node", ALIGN_BEHIND].map(q).join(" "), "--json"]), "orca terminal split", "result.split.handle");
    log(`align-behind: ${align}`);
  }
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isMain) {
  const [repo, ...guideArgs] = process.argv.slice(2);
  // 案内役の引数はそのまま渡すので、ここで案内役と同じ検証をする。--terminal は desk.mjs が付ける
  if (parseArgs([repo ?? "", ...guideArgs]) === null || guideArgs.includes("--terminal")) {
    console.error("usage: node desk.mjs <owner/repo> [--interval 60] [--from <仕様の issue 番号>] [--stall-minutes 60] [--dry-run]");
    process.exit(2);
  }
  const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const root = realpathSync(sh("git", ["rev-parse", "--show-toplevel"]));
  if (realpathSync(process.cwd()) !== root) {
    console.error(`repo の root（${root}）で流す`);
    process.exit(2);
  }
  const actual = JSON.parse(sh("gh", ["repo", "view", "--json", "nameWithOwner"])).nameWithOwner;
  if (actual.toLowerCase() !== repo.toLowerCase()) {
    console.error(`cwd の repo (${actual}) が引数 (${repo}) と違う。対象 repo の main checkout で流す`);
    process.exit(2);
  }
  process.exit(buildDesk({ root, repo, guideArgs, running: (kind) => runningIn({ pattern: PROCESS_PATTERNS[kind], root }) }));
}
