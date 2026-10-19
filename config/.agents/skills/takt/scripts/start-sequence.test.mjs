// start-sequence.mjs のテスト。偽物の orca は呼ばれた argv を記録し、create / split に handle を返す。
// 動いているプロセスの一覧（pid・cwd・コマンド行）も偽物を渡す。実機の応答の形は desk.test.mjs と同じ（create は result.terminal.handle、split は result.split.handle）。
import assert from "node:assert/strict";
import { test } from "node:test";
import { SPLIT_DOWN } from "../../guide/scripts/pane.mjs";
import { SEQUENCE_DONE } from "../../guide/scripts/decide.mjs";
import { guideTerminal, checkSequenceArgs, startSequence } from "./start-sequence.mjs";

const fakeOrca = () => {
  const calls = [];
  const run = (args, opts) => {
    calls.push({ args, cwd: opts.cwd });
    if (args[1] === "create") return JSON.stringify({ ok: true, result: { terminal: { handle: "term_new" } } });
    if (args[1] === "split") return JSON.stringify({ ok: true, result: { split: { handle: "term_split" } } });
    return assert.fail(`想定外の orca: ${args.join(" ")}`);
  };
  return { calls, run };
};

const opt = (args, name) => args[args.indexOf(name) + 1];
const guide = (over = {}) => ({ pid: "101", cwd: "/repo", command: "node /x/guide/scripts/guide.mjs o/r --terminal term_guide --from 5", ...over });
const ARGS = ["701", "702", "--workflow", "takt-default", "--base", "develop", "--interval", "60", "--fix-wait", "15"];
const start = (processes, args = ARGS) => {
  const { calls, run } = fakeOrca();
  const lines = [];
  const handle = startSequence({ root: "/repo", repo: "o/r", args, processes, run, log: (s) => lines.push(s) });
  return { handle, calls, lines };
};

// --command の文字列に、takt-sequence.mjs と、その後ろに引数がこの順でそのまま並び、案内役と同じ終わりの行が続くこと
const assertSequenceCommand = (command) => {
  const [sequence, done] = command.split("; ");
  assert.match(sequence, /^TAKT_SEQUENCE_LAUNCHER=1 '[^']*\/takt-node\.sh' '[^']*\/takt-sequence\.mjs' '701' '702' '--workflow' 'takt-default' '--base' 'develop' '--interval' '60' '--fix-wait' '15'$/);
  assert.match(done, new RegExp(SEQUENCE_DONE));
};

test("repo root で --terminal 付きの案内役が動いていれば、その handle から下へ split して起動する", () => {
  const { handle, calls, lines } = start([guide()]);
  assert.equal(calls.length, 1);
  const [{ args, cwd }] = calls;
  assert.deepEqual(args.slice(0, 2), ["terminal", "split"]);
  assert.equal(opt(args, "--terminal"), "term_guide");
  assert.equal(opt(args, "--direction"), SPLIT_DOWN);
  assert.ok(args.includes("--json"));
  assert.equal(cwd, "/repo");
  assertSequenceCommand(opt(args, "--command"));
  assert.equal(handle, "term_split");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /term_guide/);
  assert.match(lines[0], /term_split/);
});

const assertNewTab = ({ handle, calls, lines }) => {
  assert.equal(calls.length, 1);
  const [{ args, cwd }] = calls;
  assert.deepEqual(args.slice(0, 2), ["terminal", "create"]);
  assert.equal(opt(args, "--worktree"), "path:/repo");
  assert.equal(opt(args, "--title"), "takt sequence o/r");
  assert.ok(args.includes("--json"));
  assert.equal(cwd, "/repo");
  assertSequenceCommand(opt(args, "--command"));
  assert.equal(handle, "term_new");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /新しいタブ/);
  assert.match(lines[0], /term_new/);
};

test("案内役が動いていなければ、terminal create で新しいタブに起動する", () => {
  assertNewTab(start([]));
});

test("案内役が別の repo root で動いていれば、新しいタブに起動する", () => {
  assertNewTab(start([guide({ cwd: "/other-repo" })]));
});

test("案内役のコマンド行に --terminal が無ければ（手で guide.mjs を流した）、新しいタブに起動する", () => {
  assertNewTab(start([guide({ command: "node /x/guide/scripts/guide.mjs o/r --from 5" })]));
});

test("guideTerminal: repo root の案内役のうち、--terminal を持つものの handle を返す", () => {
  const processes = [guide({ pid: "1", cwd: "/other", command: "node guide.mjs o/x --terminal term_x" }), guide({ pid: "2", command: "node guide.mjs o/r" }), guide({ pid: "3" })];
  assert.equal(guideTerminal(processes, "/repo"), "term_guide");
  assert.equal(guideTerminal([], "/repo"), undefined);
  // --terminal が最後の語で、値が無いものは持たないとみなす
  assert.equal(guideTerminal([guide({ command: "node guide.mjs o/r --terminal" })], "/repo"), undefined);
});

test("checkSequenceArgs: issue の並びと --workflow・--base・--interval・--fix-wait を受け取り、それ以外と issue の無い並びは断る", () => {
  assert.deepEqual(checkSequenceArgs(ARGS), ARGS);
  assert.deepEqual(checkSequenceArgs(["#701"]), ["#701"]);
  assert.equal(checkSequenceArgs([]), null);
  assert.equal(checkSequenceArgs(["--base", "main"]), null);
  assert.equal(checkSequenceArgs(["701", "--merge"]), null);
  assert.equal(checkSequenceArgs(["701", "--workflow"]), null);
  assert.equal(checkSequenceArgs(["701", "--fix-wait", "0"]), null);
});
