// main-state.mjs の判定テスト。gh は呼ばない。
import assert from "node:assert/strict";
import { test } from "node:test";
import { failsLikeMain, mainState, requiredChecks } from "./main-state.mjs";

const NIX = "Nix flake evaluation";
const SC = "ShellCheck (severity=error)";
const RULES = [
  { type: "deletion", parameters: {} },
  { type: "required_status_checks", parameters: { required_status_checks: [{ context: NIX, integration_id: 15368 }, { context: SC, integration_id: 15368 }] } },
  { type: "required_status_checks", parameters: { required_status_checks: [{ context: NIX, integration_id: 15368 }] } },
];

test("requiredChecks: ruleset の応答の required_status_checks から名前を重複なく読み、他のルールは無視する", () => {
  assert.deepEqual(requiredChecks(RULES), [NIX, SC]);
  assert.deepEqual(requiredChecks([{ type: "deletion" }]), []);
  assert.deepEqual(requiredChecks([]), []);
});

const run = (id, name, conclusion, status = "completed") => ({ id, name, status, conclusion, runId: id * 10 });
const REQUIRED = [NIX, SC];

const table = [
  ["必須がすべて success なら green", { checks: [run(1, NIX, "success"), run(2, SC, "success")] }, { state: "green", failed: [] }],
  ["必須の skipped・neutral は落ちたとみなさない", { checks: [run(1, NIX, "skipped"), run(2, SC, "neutral")] }, { state: "green", failed: [] }],
  ["必須が failure なら red で、落ちたチェックと run を返す", { checks: [run(1, NIX, "success"), run(2, SC, "failure")] }, { state: "red", failed: [{ name: SC, runId: 20 }] }],
  ["cancelled を落ちたとみなす", { checks: [run(1, NIX, "cancelled"), run(2, SC, "success")] }, { state: "red", failed: [{ name: NIX, runId: 10 }] }],
  ["timed_out を落ちたとみなす", { checks: [run(1, NIX, "success"), run(2, SC, "timed_out")] }, { state: "red", failed: [{ name: SC, runId: 20 }] }],
  ["落ちた必須は required の順に返す", { checks: [run(2, SC, "failure"), run(1, NIX, "failure")] }, { state: "red", failed: [{ name: NIX, runId: 10 }, { name: SC, runId: 20 }] }],
  ["必須でないチェックの失敗では赤にしない", { checks: [run(1, NIX, "success"), run(2, SC, "success"), run(3, "Cloud evidence", "failure")] }, { state: "green", failed: [] }],
  ["必須が実行中なら undetermined", { checks: [run(1, NIX, null, "in_progress"), run(2, SC, "failure")] }, { state: "undetermined", failed: [] }],
  ["必須が未登録なら undetermined", { checks: [run(2, SC, "failure")] }, { state: "undetermined", failed: [] }],
  ["必須が ruleset に無ければ undetermined", { required: [], checks: [run(1, NIX, "failure")] }, { state: "undetermined", failed: [] }],
  ["同名は最新（id 最大）を採る: 再実行で通れば green", { checks: [run(5, NIX, "success"), run(1, NIX, "failure"), run(2, SC, "success")] }, { state: "green", failed: [] }],
  ["同名は最新を採る: 再実行が実行中なら undetermined", { checks: [run(1, NIX, "failure"), run(5, NIX, null, "queued"), run(2, SC, "success")] }, { state: "undetermined", failed: [] }],
  ["runId が取れない check-run は null のまま返す", { checks: [{ ...run(1, NIX, "failure"), runId: null }, run(2, SC, "success")] }, { state: "red", failed: [{ name: NIX, runId: null }] }],
];

for (const [name, over, expected] of table) {
  test(`mainState: ${name}`, () => {
    assert.deepEqual(mainState({ required: REQUIRED, ...over }), expected);
  });
}

test("mainState: ruleset の応答から読んだ名前で判定する", () => {
  assert.deepEqual(mainState({ required: requiredChecks(RULES), checks: [run(1, NIX, "success"), run(2, SC, "failure")] }), { state: "red", failed: [{ name: SC, runId: 20 }] });
});

const RED_MAIN = { required: REQUIRED, checks: [run(1, NIX, "failure"), run(2, SC, "success")] };
const failsLike = [
  ["main と同じ必須チェックだけで落ちた PR は true", RED_MAIN, [run(11, NIX, "failure"), run(12, SC, "success")], true],
  ["cancelled・timed_out も落ちたとみなす", { ...RED_MAIN, checks: [run(1, NIX, "timed_out"), run(2, SC, "success")] }, [run(11, NIX, "cancelled")], true],
  ["main と違うチェックで落ちた PR は false", RED_MAIN, [run(11, NIX, "success"), run(12, SC, "failure")], false],
  ["main と同じチェックに加えて、違うチェックでも落ちた PR は false", RED_MAIN, [run(11, NIX, "failure"), run(13, "Cloud evidence", "failure")], false],
  ["落ちたチェックが無い PR は false", RED_MAIN, [run(11, NIX, "success")], false],
  ["同名は最新を採る: 再実行で通ったチェックは落ちたとみなさない", RED_MAIN, [run(11, SC, "failure"), run(15, SC, "success"), run(12, NIX, "failure")], true],
  ["main が緑なら false", { ...RED_MAIN, checks: [run(1, NIX, "success"), run(2, SC, "success")] }, [run(11, NIX, "failure")], false],
  ["main が undetermined なら false", { ...RED_MAIN, checks: [run(1, NIX, "failure")] }, [run(11, NIX, "failure")], false],
];

for (const [name, main, checks, expected] of failsLike) {
  test(`failsLikeMain: ${name}`, () => {
    assert.equal(failsLikeMain(main, checks), expected);
  });
}
