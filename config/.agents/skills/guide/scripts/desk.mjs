// repo ごとの常駐（takt watch・案内役・align-behind）を、Orca の 1 つのタブにペインで並べて起動する。
// 使い方（対象 repo の main checkout の root で）: node desk.mjs <owner/repo> [案内役の引数…（--from・--interval など。--terminal は除く）]
//                                                  node desk.mjs <owner/repo> --no-guide（案内役を立てない。右の列は align-behind から始まる）
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
// takt watch が動いていれば左のペインを作らず、そのペイン（環境変数 ORCA_TERMINAL_HANDLE）の右に足す。ペインが分からなければ新しいタブに足す。
// align-behind が動いていれば、そのペインを作らない。案内役が動いていれば何も作らず、PID を出して終了コード 2 で止める。
// takt-sequence は takt の start-sequence.mjs が、案内役か align-behind のペインの下に足す。
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

// ps eww のコマンド行（後ろに環境変数が並ぶ）から ORCA_TERMINAL_HANDLE の値。無ければ undefined。
export function orcaHandleIn(commandWithEnv) {
  return /(?:^|\s)ORCA_TERMINAL_HANDLE=(term_\S+)/.exec(commandWithEnv)?.[1];
}

// cwd が root の kind（PROCESS_PATTERNS のキー）のプロセスが動いている Orca のペインの handle。無ければ undefined。
export function paneOf(kind, root) {
  for (const pid of runningIn({ pattern: PROCESS_PATTERNS[kind], root })) {
    try {
      const handle = orcaHandleIn(execFileSync("ps", ["eww", "-o", "command=", "-p", pid], { encoding: "utf8" }));
      if (handle) return handle;
    } catch {
      // 調べている間に終わったプロセス
    }
  }
  return undefined;
}

// タブを組み立てる。running(kind) は動いているプロセスの PID の配列（kind は PROCESS_PATTERNS のキー）、pane(kind) はそのペインの handle（無ければ undefined）、
// run は orca の実行（テストでは偽物）。withGuide が false なら案内役を立てず、右の列を align-behind から始める。
// 戻り値は終了コード。log は出力（作ったペインの handle と、飛ばした理由）。
export function buildDesk({ root, repo, guideArgs = [], withGuide = true, running, pane = () => undefined, run = runOrca, log = console.log }) {
  const guidePids = withGuide ? running("guide") : [];
  if (guidePids.length > 0) {
    log(`案内役が既に動いている（PID ${guidePids.join(" ")}）。何も作らない。止めてから流し直す`);
    return 2;
  }
  const orca = (args) => run(args, { cwd: root });
  const watchPids = running("watch");
  let watch;
  if (watchPids.length > 0) {
    watch = pane("watch");
    log(`takt watch は既に動いている（PID ${watchPids.join(" ")}）。左のペインは作らない${watch === undefined ? "（ペインが分からないので新しいタブに足す）" : ""}`);
  } else {
    watch = handleOf(orca(["terminal", "create", "--worktree", `path:${root}`, "--title", `takt watch ${repo}`, "--json", "--command", "takt watch"]), "orca terminal create", "result.terminal.handle");
    log(`takt watch: ${watch}`);
  }
  // 右の列の先頭のペイン。watch のペインが分かればその右、分からなければ新しいタブ
  const column = (title, command) => {
    const cmd = command === undefined ? [] : ["--command", command];
    return watch === undefined
      ? handleOf(orca(["terminal", "create", "--worktree", `path:${root}`, "--title", title, "--json", ...cmd]), "orca terminal create", "result.terminal.handle")
      : handleOf(orca(["terminal", "split", "--terminal", watch, "--direction", SPLIT_RIGHT, "--json", ...cmd]), "orca terminal split", "result.split.handle");
  };
  let top;
  if (withGuide) {
    top = column(`案内役 ${repo}`);
    // 案内役には自分のペインの handle を渡すので、ペインを作ってから、その handle を入れたコマンドを送る
    const command = ["node", GUIDE, repo, "--terminal", top, ...guideArgs].map(q).join(" ");
    orca(["terminal", "send", "--terminal", top, "--text", command, "--enter", "--json"]);
    log(`案内役: ${top}`);
  }
  const alignPids = running("alignBehind");
  if (alignPids.length > 0) {
    log(`align-behind は既に動いている（PID ${alignPids.join(" ")}）。そのペインは作らない`);
    return 0;
  }
  const alignCommand = ["node", ALIGN_BEHIND].map(q).join(" ");
  const align = top === undefined
    ? column(`align-behind ${repo}`, alignCommand)
    : handleOf(orca(["terminal", "split", "--terminal", top, "--direction", SPLIT_DOWN, "--command", alignCommand, "--json"]), "orca terminal split", "result.split.handle");
  log(`align-behind: ${align}`);
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isMain) {
  const [repo, ...rest] = process.argv.slice(2);
  const withGuide = !rest.includes("--no-guide");
  const guideArgs = rest.filter((a) => a !== "--no-guide");
  // 案内役の引数はそのまま渡すので、ここで案内役と同じ検証をする。--terminal は desk.mjs が付ける
  if (parseArgs([repo ?? "", ...guideArgs]) === null || guideArgs.includes("--terminal") || (!withGuide && guideArgs.length > 0)) {
    console.error("usage: node desk.mjs <owner/repo> [--interval 60] [--from <仕様の issue 番号>] [--stall-minutes 60] [--dry-run]\n       node desk.mjs <owner/repo> --no-guide");
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
  process.exit(buildDesk({ root, repo, guideArgs, withGuide, running: (kind) => runningIn({ pattern: PROCESS_PATTERNS[kind], root }), pane: (kind) => paneOf(kind, root) }));
}
