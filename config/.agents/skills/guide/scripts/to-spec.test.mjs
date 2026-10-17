// to-spec.mjs のテスト。orca は偽物を注入し、実際には呼ばない。
import assert from "node:assert/strict";
import { test } from "node:test";
import { launchToSpec } from "./to-spec.mjs";

const reply = (handle = "term_s") => JSON.stringify({ result: { outcome: { kind: "terminal", handle } } });
const fake = (calls, launch = reply()) => (args, opts) => {
  calls.push({ args, opts });
  return args[0] === "agent" ? launch : "{}";
};

test("to-spec の起動: map の main checkout で claude を launch し、プロンプトの 1 行目は /to-spec #map、--allowedTools は渡さない", () => {
  const calls = [];
  launchToSpec({ cwd: "/repo", map: 20 }, fake(calls));
  const { args, opts } = calls[0];
  assert.deepEqual(args.slice(0, 7), ["agent", "launch", "--agent", "claude", "--worktree", "path:/repo", "--prompt"]);
  assert.equal(args.at(-1), "--json");
  assert.equal(opts.cwd, "/repo");
  assert.equal(args[7].split("\n")[0], "/to-spec #20");
  assert.ok(!args.includes("--allowedTools"));
  assert.ok(!calls.some((c) => c.args[0] === "worktree"), "worktree は作らない");
});

test("to-spec の起動: プロンプトで spec ラベルを付けることと、本文に「元の map: #m」だけの行を書くことを指示する", () => {
  const calls = [];
  launchToSpec({ cwd: "/repo", map: 20 }, fake(calls));
  const prompt = calls[0].args[7];
  assert.match(prompt, /spec/);
  assert.ok(prompt.split("\n").some((l) => l.includes("元の map: #20")), prompt);
  assert.ok(!prompt.includes("元の map: #2\n") && !/元の map: #2(?!0)/.test(prompt), "別の番号を含めない");
});

test("to-spec の起動: 応答の handle でタブを「to-spec #map」に改名し、handle を返す", () => {
  const calls = [];
  const result = launchToSpec({ cwd: "/repo", map: 20 }, fake(calls, reply("term_99")));
  assert.deepEqual(result, { handle: "term_99" });
  const rename = calls[1].args;
  assert.deepEqual(rename.slice(0, 4), ["terminal", "rename", "--terminal", "term_99"]);
  assert.equal(rename[rename.indexOf("--title") + 1], "to-spec #20");
});

test("to-spec の起動: 応答から handle が取れなければ例外にし、タブの改名はしない", () => {
  for (const launch of ['{"result":{"outcome":{}}}', "not json"]) {
    const calls = [];
    assert.throws(() => launchToSpec({ cwd: "/repo", map: 20 }, fake(calls, launch)), /handle/);
    assert.equal(calls.length, 1);
  }
});
