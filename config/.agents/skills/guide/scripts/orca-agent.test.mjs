// orca-agent.mjs の観測のテスト。偽物の orca は、呼ばれた argv を記録し、サブコマンドごとの応答を返す。
// 実機（Orca 稼働中の `orca terminal show/read --json`）で確かめた形:
//   show: { ok: true, result: { terminal: { handle, title, agentIdentity, agentWait: null, ... } } }（作業の無いシェルのタブは agentWait: null）
//   read: { ok: true, result: { terminal: { handle, status: "running", tail: [行...], nextCursor, ... } } }
//   存在しない handle: 終了コード 1、stdout に { ok: false, error: { code: "terminal_handle_stale" } }
//   閉じたタブの handle: show は ok: true のまま terminal.connected: false を返す（2026-10-17、`orca terminal close` の後に 15 秒待っても同じ）。動いているタブは connected: true
// agentWait: null（待ちなし）または { source: "prompt-text" | "title" | "hook", reason?, since? }（Orca 本体の getTerminalInteractiveWait の実装で確認。
//   実機のセッションは全て null で、入力待ちの実物の取得は未確認）。show に「手が止まった」を示す欄は無いので、idle は `orca terminal wait --for tui-idle` で取る（満たされれば idle、timeout なら idle ではない。busy な tui-idle の timeout の応答形は、同じ待ちの仕組みの `--for exit` の timeout で確認: 終了コード 1、error.code "timeout"）。
import assert from "node:assert/strict";
import { test } from "node:test";
import { observeSession } from "./orca-agent.mjs";
// 送信（新しい公開物）は名前空間で読む（未実装でも既存の観測のテストは動かす）。
import * as O from "./orca-agent.mjs";

const AGENT_WAIT = {
  none: null,
  prompt: { source: "prompt-text", reason: "agent-interactive-prompt", since: 1792200233506 },
  title: { source: "title" },
  hook: { source: "hook", since: 1792200233506 },
};

const showReply = (agentWait) => JSON.stringify({ ok: true, result: { terminal: { handle: "term_1", title: "to-tickets #12", agentIdentity: "claude", agentWait } } });
const readReply = (tail) => JSON.stringify({ ok: true, result: { terminal: { handle: "term_1", status: "running", tail, nextCursor: "8" } } });
const staleError = () => {
  const e = new Error("Command failed: orca terminal show");
  e.status = 1;
  e.stdout = JSON.stringify({ ok: false, error: { code: "terminal_handle_stale", message: "terminal_handle_stale" } });
  return e;
};

const waitReply = (satisfied) => JSON.stringify({ ok: true, result: { wait: { handle: "term_1", condition: "tui-idle", satisfied, status: "running", exitCode: null } } });
const timeoutError = () => Object.assign(new Error("Command failed: orca terminal wait"), { status: 1, stdout: JSON.stringify({ ok: false, error: { code: "timeout", message: "timeout" } }) });

const fakeOrca = ({ show = showReply(null), read = readReply(["a"]), wait = timeoutError() } = {}) => {
  const calls = [];
  const run = (args, opts) => {
    calls.push({ args, cwd: opts.cwd });
    const reply = args[1] === "show" ? show : args[1] === "read" ? read : args[1] === "wait" ? wait : assert.fail(`想定外の orca: ${args.join(" ")}`);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { calls, run };
};

test("observeSession: orca terminal show / read を handle 指定で呼び、観測の形 { found, waiting, waitSource, waitSince, idle, tail } を作る", () => {
  const { calls, run } = fakeOrca({ read: readReply(["x", "y"]) });
  const o = observeSession({ cwd: "/x", handle: "term_1" }, run);
  assert.deepEqual(o, { found: true, waiting: false, waitSource: null, waitSince: null, idle: false, tail: ["x", "y"] });
  assert.deepEqual(calls.map((c) => c.args.slice(0, 2).join(" ")), ["terminal show", "terminal read", "terminal wait"]);
  for (const c of calls) {
    assert.ok(c.args.includes("--json"));
    assert.equal(c.args[c.args.indexOf("--terminal") + 1], "term_1");
    assert.equal(c.cwd, "/x");
  }
});

test("observeSession: agentWait が null でなければ（prompt-text / title / hook のどれでも）waiting、null なら waiting ではない", () => {
  for (const key of ["prompt", "title", "hook"]) {
    const o = observeSession({ cwd: "/x", handle: "term_1" }, fakeOrca({ show: showReply(AGENT_WAIT[key]) }).run);
    assert.deepEqual([o.found, o.waiting], [true, true], key);
  }
  const none = observeSession({ cwd: "/x", handle: "term_1" }, fakeOrca({ show: showReply(AGENT_WAIT.none) }).run);
  assert.deepEqual([none.found, none.waiting], [true, false]);
});

test("observeSession: idle は tui-idle の待ちが満たされたときだけ true（timeout は false、それ以外の失敗は例外）。waiting とは独立", () => {
  const idle = observeSession({ cwd: "/x", handle: "term_1" }, fakeOrca({ wait: waitReply(true) }).run);
  assert.deepEqual([idle.waiting, idle.idle], [false, true]);
  const both = observeSession({ cwd: "/x", handle: "term_1" }, fakeOrca({ show: showReply(AGENT_WAIT.hook), wait: waitReply(true) }).run);
  assert.deepEqual([both.waiting, both.idle], [true, true]);
  const { calls, run } = fakeOrca();
  assert.equal(observeSession({ cwd: "/x", handle: "term_1" }, run).idle, false);
  const w = calls.find((c) => c.args[1] === "wait").args;
  assert.equal(w[w.indexOf("--for") + 1], "tui-idle");
  assert.ok(w.includes("--timeout-ms") && w.includes("--json"));
  const broken = Object.assign(new Error("x"), { status: 1, stdout: JSON.stringify({ ok: false, error: { code: "runtime_unavailable" } }) });
  assert.throws(() => observeSession({ cwd: "/x", handle: "t" }, fakeOrca({ wait: broken }).run));
});

test("observeSession: 画面は最後の 10 行に切る", () => {
  const lines = Array.from({ length: 30 }, (_, n) => `l${n}`);
  const o = observeSession({ cwd: "/x", handle: "term_1" }, fakeOrca({ read: readReply(lines) }).run);
  assert.deepEqual(o.tail, lines.slice(-10));
});

test("observeSession: セッションが見つからない（terminal_handle_stale）なら found: false で、read は呼ばない", () => {
  const { calls, run } = fakeOrca({ show: staleError() });
  const o = observeSession({ cwd: "/x", handle: "term_gone" }, run);
  assert.deepEqual(o, { found: false, waiting: false, idle: false, tail: [] });
  assert.deepEqual(calls.map((c) => c.args[1]), ["show"]);
});

test("observeSession: 閉じたタブ（show の connected: false）も found: false で、read は呼ばない", () => {
  const closed = JSON.stringify({ ok: true, result: { terminal: { handle: "term_1", connected: false, agentWait: null } } });
  const { calls, run } = fakeOrca({ show: closed });
  assert.deepEqual(observeSession({ cwd: "/x", handle: "term_1" }, run), { found: false, waiting: false, idle: false, tail: [] });
  assert.deepEqual(calls.map((c) => c.args[1]), ["show"]);
});

test("observeSession: 見つからない以外の失敗（Orca が応答しない・別のエラー・JSON でない応答）は found: false にせず例外にする", () => {
  const down = Object.assign(new Error("Command failed"), { status: 1, stdout: "", stderr: "Orca is not running" });
  const other = Object.assign(new Error("Command failed"), { status: 1, stdout: JSON.stringify({ ok: false, error: { code: "runtime_unavailable" } }) });
  for (const show of [down, other]) assert.throws(() => observeSession({ cwd: "/x", handle: "t" }, fakeOrca({ show }).run));
  assert.throws(() => observeSession({ cwd: "/x", handle: "t" }, fakeOrca({ show: "not json" }).run));
  assert.throws(() => observeSession({ cwd: "/x", handle: "t" }, fakeOrca({ read: new Error("read failed") }).run));
});

// ---- 入力待ちの種類と停止の識別子 ----

test("observeSession: hook の入力待ちは waitSource: \"hook\" と、その停止の識別子 waitSince（agentWait.since の文字列）を返す", () => {
  const o = observeSession({ cwd: "/x", handle: "term_1" }, fakeOrca({ show: showReply(AGENT_WAIT.hook) }).run);
  assert.deepEqual([o.found, o.waiting, o.waitSource, o.waitSince], [true, true, "hook", "1792200233506"]);
});

test("observeSession: hook 以外の入力待ち（prompt-text・title）は waitSource にその種類を返し、waiting は従来どおり true", () => {
  const prompt = observeSession({ cwd: "/x", handle: "term_1" }, fakeOrca({ show: showReply(AGENT_WAIT.prompt) }).run);
  assert.deepEqual([prompt.waiting, prompt.waitSource], [true, "prompt-text"]);
  const title = observeSession({ cwd: "/x", handle: "term_1" }, fakeOrca({ show: showReply(AGENT_WAIT.title) }).run);
  assert.deepEqual([title.waiting, title.waitSource, title.waitSince ?? null], [true, "title", null]);
});

test("observeSession: 待ちなし（agentWait: null）は waitSource・waitSince が null", () => {
  const o = observeSession({ cwd: "/x", handle: "term_1" }, fakeOrca().run);
  assert.deepEqual([o.waiting, o.waitSource, o.waitSince], [false, null, null]);
});

test("observeSession: hook でも since が無ければ waitSince は null（識別子を捏造しない）", () => {
  const o = observeSession({ cwd: "/x", handle: "term_1" }, fakeOrca({ show: showReply({ source: "hook" }) }).run);
  assert.deepEqual([o.waitSource, o.waitSince], ["hook", null]);
});

// ---- 回答の流し込み（orca terminal send） ----

test("sendToSession: handle のタブへ --text と --enter つきで `orca terminal send` を 1 回呼ぶ（cwd を渡す。新しいセッションは作らない）", () => {
  const calls = [];
  O.sendToSession({ cwd: "/x", handle: "term_1", text: "B 案で行く" }, (args, opts) => { calls.push({ args, cwd: opts.cwd }); return JSON.stringify({ ok: true, result: {} }); });
  assert.equal(calls.length, 1);
  const { args, cwd } = calls[0];
  assert.equal(cwd, "/x");
  assert.deepEqual(args.slice(0, 2), ["terminal", "send"]);
  assert.equal(args[args.indexOf("--terminal") + 1], "term_1");
  assert.equal(args[args.indexOf("--text") + 1], "B 案で行く");
  assert.ok(args.includes("--enter") && args.includes("--json"));
  assert.ok(!args.includes("launch"));
});

test("sendToSession: 回答の本文はそのまま 1 つの引数で渡す（空白・引用符・シェルの記号を含んでも分割・加工しない）", () => {
  const text = `A 案 "x" $(rm -rf /) ; echo 'y'`;
  let argv;
  O.sendToSession({ cwd: "/x", handle: "term_1", text }, (args) => { argv = args; return "{}"; });
  assert.equal(argv.filter((a) => a === text).length, 1);
});

test("sendToSession: orca が失敗したら例外にする（handle を含む）", () => {
  const down = () => { throw Object.assign(new Error("Command failed"), { status: 1, stdout: JSON.stringify({ ok: false, error: { code: "terminal_handle_stale" } }) }); };
  assert.throws(() => O.sendToSession({ cwd: "/x", handle: "term_gone", text: "x" }, down), /term_gone/);
});
