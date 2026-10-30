// desk.mjs のテスト。偽物の orca は呼ばれた argv を記録し、create / split に順番の handle を返す。
// 動いているプロセスの確かめ（running）も注入する。実機の応答の形: create は result.terminal.handle、split は result.split.handle（2026-10-17 に確認）。
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDesk, orcaHandleIn } from "./desk.mjs";
import { SPLIT_DOWN, SPLIT_RIGHT } from "./pane.mjs";

const fakeOrca = () => {
  const calls = [];
  let n = 0;
  const run = (args, opts) => {
    calls.push({ args, cwd: opts.cwd });
    const sub = args[1];
    if (sub === "create") return JSON.stringify({ ok: true, result: { terminal: { handle: `term_${++n}` } } });
    if (sub === "split") return JSON.stringify({ ok: true, result: { split: { handle: `term_${++n}` } } });
    if (sub === "send") return JSON.stringify({ ok: true });
    return assert.fail(`想定外の orca: ${args.join(" ")}`);
  };
  return { calls, run };
};

const runningOf = (pids = {}) => (kind) => pids[kind] ?? [];
const opt = (args, name) => args[args.indexOf(name) + 1];
const desk = (pids, guideArgs = ["--from", "5", "--interval", "30"], { withGuide = true, strict = true, panes = {} } = {}) => {
  const { calls, run } = fakeOrca();
  const lines = [];
  const code = buildDesk({ root: "/repo", repo: "o/r", guideArgs, withGuide, strict, running: runningOf(pids), pane: (kind) => panes[kind], run, log: (s) => lines.push(s) });
  return { code, calls, lines };
};

test("buildDesk: 何も動いていなければ、watch → 案内役（右）→ align-behind（案内役の下）の順に作り、案内役に --terminal <自分の handle> と引数を渡す", () => {
  const { code, calls } = desk({});
  assert.equal(code, 0);
  assert.deepEqual(calls.map((c) => c.args.slice(0, 2).join(" ")), ["terminal create", "terminal split", "terminal send", "terminal split"]);
  for (const c of calls) {
    assert.equal(c.cwd, "/repo");
    assert.ok(c.args.includes("--json"));
  }
  const [watch, guide, send, align] = calls.map((c) => c.args);
  assert.equal(opt(watch, "--worktree"), "path:/repo");
  assert.equal(opt(watch, "--command"), "takt watch");
  // 案内役は watch（term_1）の右
  assert.equal(opt(guide, "--terminal"), "term_1");
  assert.equal(opt(guide, "--direction"), SPLIT_RIGHT);
  // 案内役のペイン（term_2）に、その handle を入れたコマンドを送る
  assert.equal(opt(send, "--terminal"), "term_2");
  assert.ok(send.includes("--enter"));
  assert.match(opt(send, "--text"), /^'node' '[^']*\/guide\.mjs' 'o\/r' '--terminal' 'term_2' '--from' '5' '--interval' '30'$/);
  // align-behind は案内役（term_2）の下
  assert.equal(opt(align, "--terminal"), "term_2");
  assert.equal(opt(align, "--direction"), SPLIT_DOWN);
  assert.match(opt(align, "--command"), /align-behind\.mjs'$/);
});

test("buildDesk: takt watch が動いていてペインが分からなければ、watch のペインを作らず、案内役を最初のペイン（新しいタブ）にする", () => {
  const { code, calls, lines } = desk({ watch: ["111"] }, []);
  assert.equal(code, 0);
  assert.deepEqual(calls.map((c) => c.args.slice(0, 2).join(" ")), ["terminal create", "terminal send", "terminal split"]);
  const [guide, send, align] = calls.map((c) => c.args);
  assert.equal(opt(guide, "--worktree"), "path:/repo");
  assert.ok(!guide.includes("--command"));
  assert.ok(!calls.some((c) => c.args.includes("takt watch")));
  assert.match(opt(send, "--text"), /'o\/r' '--terminal' 'term_1'$/);
  assert.equal(opt(align, "--terminal"), "term_1");
  assert.equal(opt(align, "--direction"), SPLIT_DOWN);
  assert.ok(lines.some((l) => l.includes("111")));
});

test("buildDesk: takt watch が動いていてペインが分かれば、その右に案内役を足す", () => {
  const { calls } = desk({ watch: ["111"] }, [], { panes: { watch: "term_w" } });
  assert.deepEqual(calls.map((c) => c.args.slice(0, 2).join(" ")), ["terminal split", "terminal send", "terminal split"]);
  assert.equal(opt(calls[0].args, "--terminal"), "term_w");
  assert.equal(opt(calls[0].args, "--direction"), SPLIT_RIGHT);
});

test("buildDesk: 案内役なし（withGuide: false）なら、watch の右に align-behind を作り、案内役は作らない", () => {
  const { code, calls } = desk({}, [], { withGuide: false });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((c) => c.args.slice(0, 2).join(" ")), ["terminal create", "terminal split"]);
  const [, align] = calls.map((c) => c.args);
  assert.equal(opt(align, "--terminal"), "term_1");
  assert.equal(opt(align, "--direction"), SPLIT_RIGHT);
  assert.match(opt(align, "--command"), /align-behind\.mjs'$/);
  assert.ok(!calls.some((c) => String(opt(c.args, "--text")).includes("guide.mjs")));
});

test("buildDesk: 案内役なしなら、案内役が動いていても止めない（動いている watch のペインの右に align-behind を足す）", () => {
  const { code, calls } = desk({ guide: ["333"], watch: ["111"] }, [], { withGuide: false, panes: { watch: "term_w" } });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((c) => [c.args[1], opt(c.args, "--terminal"), opt(c.args, "--direction")]), [["split", "term_w", SPLIT_RIGHT]]);
});

test("buildDesk: align-behind が動いていれば align-behind のペインを作らない", () => {
  const { code, calls, lines } = desk({ alignBehind: ["222"] });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((c) => c.args.slice(0, 2).join(" ")), ["terminal create", "terminal split", "terminal send"]);
  assert.ok(!calls.some((c) => String(opt(c.args, "--command")).includes("align-behind")));
  assert.ok(lines.some((l) => l.includes("222")));
});

test("buildDesk: main の ruleset が strict でなければ、watch と案内役だけ作り、align-behind のペインは作らない", () => {
  const { code, calls, lines } = desk({}, [], { strict: false });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((c) => c.args.slice(0, 2).join(" ")), ["terminal create", "terminal split", "terminal send"]);
  assert.ok(!calls.some((c) => String(opt(c.args, "--command")).includes("align-behind")));
  assert.ok(lines.some((l) => l.includes("strict")));
});

test("buildDesk: strict でなく案内役なしなら、watch のペインだけ作る", () => {
  const { code, calls } = desk({}, [], { withGuide: false, strict: false });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((c) => [c.args[1], opt(c.args, "--command")]), [["create", "takt watch"]]);
});

test("buildDesk: 案内役が動いていれば何も作らず、PID を出して終了コード 2", () => {
  const { code, calls, lines } = desk({ guide: ["333"], watch: [], alignBehind: [] });
  assert.equal(code, 2);
  assert.deepEqual(calls, []);
  assert.ok(lines.some((l) => l.includes("333") && l.includes("止めてから")));
});

test("orcaHandleIn: ps eww の行から ORCA_TERMINAL_HANDLE の値を取り出す", () => {
  assert.equal(orcaHandleIn("node /x/takt/bin/takt watch TERM=xterm ORCA_TERMINAL_HANDLE=term_98f2 ORCA_TAB_ID=238f"), "term_98f2");
  assert.equal(orcaHandleIn("node /x/takt/bin/takt watch TERM=xterm"), undefined);
  // 別の変数の値の途中に現れた文字列は拾わない
  assert.equal(orcaHandleIn("node x FOO=ORCA_TERMINAL_HANDLE=term_bad"), undefined);
});
