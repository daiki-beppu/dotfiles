// takt-sequence.mjs の起動の印のテスト。読み込んだ時点で引数を解析して gh や takt を呼ぶので、子プロセスで流し、
// gh・takt に届く前（印の確認と usage）で止まる入力だけを渡す。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { startTaktSequence } from "../../guide/scripts/takt.mjs";

const SCRIPT = fileURLToPath(new URL("./takt-sequence.mjs", import.meta.url));
const { TAKT_SEQUENCE_LAUNCHER: _, TAKT_ROOT: __, ...BASE_ENV } = process.env;
const sequence = (args, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...BASE_ENV, ...env }, encoding: "utf8" });

// startTaktSequence が --command の頭に付ける環境変数の割り当て
const launcherEnv = () => {
  let command;
  startTaktSequence({ cwd: "/w", repo: "o/r", issues: [21] }, (args) => {
    command = args[args.indexOf("--command") + 1];
    return JSON.stringify({ ok: true, result: { terminal: { handle: "term_seq" } } });
  });
  const [, name, value] = command.match(/^(\w+)=(\S+) /);
  return { [name]: value };
};

test("印が無ければ（直に流した）、start-sequence.mjs を案内する 1 行を出して 2 で止まる", () => {
  const r = sequence(["21"], { TAKT_ROOT: "/nonexistent" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /start-sequence\.mjs <issue>\.\.\./);
  assert.equal(r.stderr.trim().split("\n").length, 1);
});

test("startTaktSequence の起動の印があれば、印の確認を通って引数の確認に進む（TAKT_ROOT が無いので usage で止まる）", () => {
  const r = sequence(["21"], launcherEnv());
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^usage: start-sequence\.mjs/);
});
