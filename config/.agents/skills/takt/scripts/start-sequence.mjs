// takt-sequence を Orca で起動する。repo root で案内役が desk（guide/scripts/desk.mjs）のペインで動いていれば、案内役のペインの下に分割して開く。
// 案内役がいなければ、repo root の takt watch のペインの下に分割して開き、どちらも無ければ新しいタブに開く。どこで開いたかを 1 行出す（終わりは待たない）。
// 案内役は、コマンド行に scripts/guide.mjs を含み、cwd が repo root のプロセス。コマンド行の `--terminal <handle>` が案内役の自分のペイン。
// takt watch のペインは、そのプロセスの環境変数 ORCA_TERMINAL_HANDLE（Orca がペインのシェルに渡す）で知る。
// 使い方（repo root で、watch が動いている状態で）:
//   node <skill>/scripts/start-sequence.mjs <issue>... [--workflow default] [--base main] [--interval 30] [--fix-wait 10]
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { PROCESS_PATTERNS, runningIn } from "../../guide/scripts/desk.mjs";
import { runOrca } from "../../guide/scripts/orca-agent.mjs";
import { startTaktSequence } from "../../guide/scripts/takt.mjs";

const OPTIONS = ["--workflow", "--base", "--interval", "--fix-wait"];

// takt-sequence に渡す引数を確かめ、そのまま返す。issue が 1 つも無い・知らない引数・値の無いオプション・正でない --fix-wait は null。
export function checkSequenceArgs(argv) {
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

// cwd が root の案内役のプロセス（見つけ方は desk.mjs と同じ）に、コマンド行を添える
export function guideProcesses(root) {
  return runningIn({ pattern: PROCESS_PATTERNS.guide, root }).flatMap((pid) => {
    try {
      return [{ pid, cwd: root, command: execFileSync("ps", ["-o", "command=", "-p", pid], { encoding: "utf8" }).trim() }];
    } catch {
      return []; // 調べている間に終わったプロセス
    }
  });
}

// ps eww のコマンド行（後ろに環境変数が並ぶ）から ORCA_TERMINAL_HANDLE の値。無ければ undefined。
export function orcaHandleIn(commandWithEnv) {
  return /(?:^|\s)ORCA_TERMINAL_HANDLE=(term_\S+)/.exec(commandWithEnv)?.[1];
}

// cwd が root の takt watch（見つけ方は desk.mjs と同じ）が動いている Orca のペインの handle。無ければ undefined。
export function watchTerminal(root) {
  for (const pid of runningIn({ pattern: PROCESS_PATTERNS.watch, root })) {
    try {
      const handle = orcaHandleIn(execFileSync("ps", ["eww", "-o", "command=", "-p", pid], { encoding: "utf8" }));
      if (handle) return handle;
    } catch {
      // 調べている間に終わったプロセス
    }
  }
  return undefined;
}

// takt-sequence を起動し、開いたペインかタブの handle を返す。開き方は guide の startTaktSequence（案内役と同じ）。
// watch は repo root の takt watch のペインの handle（無ければ undefined）。run は orca の実行（テストでは偽物）、log は 1 行の出力。
export function startSequence({ root, repo, args, processes, watch, run = runOrca, log = console.log }) {
  const guide = guideTerminal(processes, root);
  const terminal = guide ?? watch;
  const { handle } = startTaktSequence({ cwd: root, repo, issues: args, terminal }, run);
  if (guide !== undefined) log(`案内役のペイン ${guide} の下に分割して起動した: ${handle}`);
  else if (watch !== undefined) log(`takt watch のペイン ${watch} の下に分割して起動した: ${handle}`);
  else log(`新しいタブで起動した: ${handle}`);
  return handle;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isMain) {
  const args = checkSequenceArgs(process.argv.slice(2));
  if (args === null) {
    console.error("usage: node start-sequence.mjs <issue>... [--workflow default] [--base main] [--interval 30] [--fix-wait 10]（--fix-wait は正の数）");
    process.exit(2);
  }
  const sh = (cmd, a) => execFileSync(cmd, a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const root = realpathSync(sh("git", ["rev-parse", "--show-toplevel"]));
  if (realpathSync(process.cwd()) !== root) {
    console.error(`repo の root（${root}）で流す`);
    process.exit(2);
  }
  const repo = JSON.parse(sh("gh", ["repo", "view", "--json", "nameWithOwner"])).nameWithOwner;
  startSequence({ root, repo, args, processes: guideProcesses(root), watch: watchTerminal(root) });
}
