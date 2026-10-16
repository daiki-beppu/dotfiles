// loop.mjs のテスト。readSnapshot / execute / sleep は偽物を注入し、GitHub・takt・Discord・子プロセスは呼ばない。
import assert from "node:assert/strict";
import { test } from "node:test";
import { runLoop, runRound } from "./loop.mjs";

const REPO = "daiki-beppu/live-mindmap";
const VIEWER = "daiki-beppu";

const issue = (number, over = {}) => ({
  number,
  title: `issue ${number}`,
  state: "OPEN",
  labels: [],
  body: "",
  comments: [],
  subIssues: [],
  ...over,
});
const spec = (number) => issue(number, { labels: ["spec", "spec-approved"] });

// GitHub 上の状態が周をまたいで変わらない固定のスナップショット（dispatched はループが足す）。
const fixed = () => ({
  repo: REPO,
  viewer: VIEWER,
  issues: [spec(12), spec(30)],
  taktIssues: [],
});

const fakes = (over = {}) => {
  const calls = { read: 0, executed: [], logs: [] };
  return {
    calls,
    deps: {
      readSnapshot: async () => {
        calls.read += 1;
        return fixed();
      },
      execute: async (action) => {
        calls.executed.push(action.key);
      },
      log: (line) => calls.logs.push(String(line)),
      ...over,
    },
  };
};

test("二重にしない: 同じスナップショットで 2 周しても、行動ごとに execute は 1 回だけ", async () => {
  const { calls, deps } = fakes();
  const dispatched = new Set();
  await runRound(deps, dispatched);
  await runRound(deps, dispatched);
  assert.deepEqual(calls.executed, ["to-tickets:12", "to-tickets:30"]);
});

test("二重にしない: 3 周目以降も増えない", async () => {
  const { calls, deps } = fakes();
  const dispatched = new Set();
  for (let i = 0; i < 5; i += 1) await runRound(deps, dispatched);
  assert.deepEqual(calls.executed, ["to-tickets:12", "to-tickets:30"]);
});

test("毎周読み直す: 周ごとに readSnapshot を呼ぶ", async () => {
  const { calls, deps } = fakes();
  const dispatched = new Set();
  await runRound(deps, dispatched);
  await runRound(deps, dispatched);
  assert.equal(calls.read, 2);
});

test("何もない: 何も出ない周では execute を呼ばない", async () => {
  const { calls, deps } = fakes({ readSnapshot: async () => ({ repo: REPO, viewer: VIEWER, issues: [], taktIssues: [] }) });
  await runRound(deps, new Set());
  assert.deepEqual(calls.executed, []);
});

test("実行に成功した key だけを dispatched に加える", async () => {
  const { deps } = fakes();
  const dispatched = new Set();
  await runRound(deps, dispatched);
  assert.deepEqual([...dispatched].sort(), ["to-tickets:12", "to-tickets:30"]);
});

test("execute が失敗したら周を止め（reject）、その key を dispatched に加えない", async () => {
  const { calls, deps } = fakes({
    execute: async (action) => {
      calls.executed.push(action.key);
      throw new Error("claude failed");
    },
  });
  const dispatched = new Set();
  await assert.rejects(runRound(deps, dispatched), /claude failed/);
  assert.deepEqual(calls.executed, ["to-tickets:12"]);
  assert.equal(dispatched.has("to-tickets:12"), false);
});

test("入力のスナップショットには dispatched が反映される（実行済みの key は次周で出ない）", async () => {
  const { calls, deps } = fakes();
  const dispatched = new Set(["to-tickets:12"]);
  await runRound(deps, dispatched);
  assert.deepEqual(calls.executed, ["to-tickets:30"]);
});

test("dry-run: execute を呼ばず、dispatched も更新せず、出た行動を log に表示する", async () => {
  const { calls, deps } = fakes();
  const dispatched = new Set();
  await runRound({ ...deps, dryRun: true }, dispatched);
  assert.deepEqual(calls.executed, []);
  assert.equal(dispatched.size, 0);
  const out = calls.logs.join("\n");
  assert.match(out, /to-tickets:12/);
  assert.match(out, /to-tickets:30/);
});

test("ループ: maxRounds 周だけ回り、周の間に interval 秒ぶん sleep する", async () => {
  const { calls, deps } = fakes();
  const sleeps = [];
  await runLoop({ ...deps, sleep: async (ms) => sleeps.push(ms) }, { intervalSec: 7, maxRounds: 3 });
  assert.equal(calls.read, 3);
  assert.deepEqual(calls.executed, ["to-tickets:12", "to-tickets:30"]);
  assert.deepEqual(sleeps, [7000, 7000]);
});

test("ループ: スナップショットの取得が 3 回続けて失敗したら止まる", async () => {
  let reads = 0;
  const { deps } = fakes({
    readSnapshot: async () => {
      reads += 1;
      throw new Error("gh unavailable");
    },
  });
  await assert.rejects(
    runLoop({ ...deps, sleep: async () => {} }, { intervalSec: 1, maxRounds: 10 }),
    /gh unavailable/,
  );
  assert.equal(reads, 3);
});

test("ループ: 取得失敗が途中で回復すれば連続カウントは戻り、続行する", async () => {
  let reads = 0;
  const { calls, deps } = fakes({
    readSnapshot: async () => {
      reads += 1;
      if (reads === 1 || reads === 2 || reads === 4 || reads === 5) throw new Error("transient");
      return fixed();
    },
  });
  await runLoop({ ...deps, sleep: async () => {} }, { intervalSec: 1, maxRounds: 6 });
  assert.equal(reads, 6);
  assert.deepEqual(calls.executed, ["to-tickets:12", "to-tickets:30"]);
});

test("ループ: execute の失敗は再試行せず即座に止まる", async () => {
  let executes = 0;
  const { deps } = fakes({
    execute: async () => {
      executes += 1;
      throw new Error("orca failed");
    },
  });
  await assert.rejects(
    runLoop({ ...deps, sleep: async () => {} }, { intervalSec: 1, maxRounds: 10 }),
    /orca failed/,
  );
  assert.equal(executes, 1);
});
