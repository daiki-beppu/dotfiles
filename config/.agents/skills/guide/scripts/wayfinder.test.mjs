// wayfinder.mjs のテスト。orca と git は偽物を注入し、呼ばれた argv と cwd で、起動する場所と渡すプロンプトを確かめる。
// orca worktree create --json の応答の形は { ok, result: { worktree: { path } } }（Orca の CLI の実装で確認。実機の応答は未取得）。
import assert from "node:assert/strict";
import { test } from "node:test";
import { launchWayfinder } from "./wayfinder.mjs";

const launchReply = (handle = "term_1") => JSON.stringify({ result: { outcome: { kind: "terminal", handle } } });
const worktreeReply = (path) => JSON.stringify({ ok: true, result: { worktree: { id: "wt_9", path } } });

const fakes = ({ worktree = worktreeReply("/wt/23"), launch = launchReply() } = {}) => {
  const calls = [];
  const run = (args, opts) => {
    calls.push({ args, cwd: opts.cwd });
    const reply = args[0] === "worktree" ? worktree : args[0] === "agent" ? launch : "{}";
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const fetched = [];
  const fetch = (cwd) => {
    calls.push({ args: ["git", "fetch", "origin"], cwd });
    fetched.push(cwd);
  };
  return { calls, run, fetch, fetched };
};
const arg = (args, flag) => args[args.indexOf(flag) + 1];
const sub = (calls, name) => calls.filter((c) => c.args[0] === name);

test("research: worktree を作らず、対象 repo の main checkout で対話セッションを起動し、handle を返す", () => {
  const { calls, run, fetch } = fakes();
  const result = launchWayfinder({ cwd: "/repo", map: 20, ticket: 21, type: "research" }, run, fetch);
  assert.deepEqual(result, { handle: "term_1" });
  assert.deepEqual(sub(calls, "worktree"), []);
  const [launch] = sub(calls, "agent");
  assert.equal(arg(launch.args, "--worktree"), "path:/repo");
  assert.equal(launch.cwd, "/repo");
});

test("grilling: research と同じく main checkout で起動する", () => {
  const { calls, run, fetch } = fakes();
  launchWayfinder({ cwd: "/repo", map: 20, ticket: 22, type: "grilling" }, run, fetch);
  assert.deepEqual(sub(calls, "worktree"), []);
  assert.equal(arg(sub(calls, "agent")[0].args, "--worktree"), "path:/repo");
});

test("task: origin/main を base にした Orca の worktree を作り、その path で起動する", () => {
  const { calls, run, fetch } = fakes();
  launchWayfinder({ cwd: "/repo", map: 20, ticket: 23, type: "task" }, run, fetch);
  const [create] = sub(calls, "worktree");
  assert.deepEqual(create.args.slice(0, 2), ["worktree", "create"]);
  assert.equal(arg(create.args, "--repo"), "path:/repo");
  assert.equal(arg(create.args, "--base-branch"), "origin/main");
  assert.ok(create.args.includes("--json"));
  assert.match(arg(create.args, "--name"), /23/);
  const [launch] = sub(calls, "agent");
  assert.equal(arg(launch.args, "--worktree"), "path:/wt/23");
  assert.equal(launch.cwd, "/wt/23");
});

test("task: 古い main から切らないよう、worktree を作る前に origin を fetch する", () => {
  const { calls, run, fetch, fetched } = fakes();
  launchWayfinder({ cwd: "/repo", map: 20, ticket: 23, type: "task" }, run, fetch);
  assert.deepEqual(fetched, ["/repo"]);
  const order = calls.map((c) => c.args[0]);
  assert.ok(order.indexOf("git") < order.indexOf("worktree"));
  assert.ok(order.indexOf("worktree") < order.indexOf("agent"));
});

test("research・grilling は fetch もしない", () => {
  const { run, fetch, fetched } = fakes();
  launchWayfinder({ cwd: "/repo", map: 20, ticket: 21, type: "research" }, run, fetch);
  assert.deepEqual(fetched, []);
});

test("プロンプトの 1 行目は /wayfinder #<map> #<ticket>。ticket は 1 つだけ", () => {
  const { calls, run, fetch } = fakes();
  launchWayfinder({ cwd: "/repo", map: 20, ticket: 21, type: "research" }, run, fetch);
  const prompt = arg(sub(calls, "agent")[0].args, "--prompt");
  assert.equal(prompt.split("\n")[0], "/wayfinder #20 #21");
  assert.ok(!/#22/.test(prompt));
});

test("タブの題名に wayfinder と ticket の番号を入れる", () => {
  const { calls, run, fetch } = fakes();
  launchWayfinder({ cwd: "/repo", map: 20, ticket: 21, type: "research" }, run, fetch);
  const [rename] = sub(calls, "terminal");
  assert.equal(arg(rename.args, "--terminal"), "term_1");
  assert.match(arg(rename.args, "--title"), /wayfinder.*#21/);
});

test("--allowedTools は渡さない（対話セッションとして起動する）", () => {
  const { calls, run, fetch } = fakes();
  launchWayfinder({ cwd: "/repo", map: 20, ticket: 23, type: "task" }, run, fetch);
  assert.ok(!calls.flatMap((c) => c.args).includes("--allowedTools"));
});

test("task: worktree create の応答に result.worktree.path が無ければ、path の名前を入れた例外にして起動しない", () => {
  for (const worktree of [JSON.stringify({ ok: true, result: { worktree: {} } }), JSON.stringify({ ok: true, result: {} }), "not json"]) {
    const { calls, run, fetch } = fakes({ worktree });
    assert.throws(() => launchWayfinder({ cwd: "/repo", map: 20, ticket: 23, type: "task" }, run, fetch), /result\.worktree\.path/);
    assert.deepEqual(sub(calls, "agent"), []);
  }
});

test("task: worktree の作成が失敗したら起動せずに例外を伝える", () => {
  const { calls, run, fetch } = fakes({ worktree: new Error("name already exists") });
  assert.throws(() => launchWayfinder({ cwd: "/repo", map: 20, ticket: 23, type: "task" }, run, fetch), /name already exists/);
  assert.deepEqual(sub(calls, "agent"), []);
});
