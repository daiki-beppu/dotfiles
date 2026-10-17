// align-decide.mjs の判定テスト。GitHub は呼ばない。
import assert from "node:assert/strict";
import { test } from "node:test";
import { decide } from "./align-decide.mjs";

const pr = (number, over = {}) => ({
  number, enabledAt: `2026-10-17T0${number % 10}:00:00Z`, mergeState: "BEHIND", upToDate: false, check: "success", dirtyNotified: false, alignFailed: false, ...over,
});

test("予約済みの PR が無ければ何もしない", () => {
  assert.deepEqual(decide([]), { align: null, notify: [], wait: "揃える PR が無い", skipped: [] });
});

test("BEHIND のうち予約の最も古い 1 件だけを揃える", () => {
  assert.equal(decide([pr(3), pr(1), pr(2)]).align, 1);
});

test("予約の時刻が同じなら番号の小さい方", () => {
  const at = "2026-10-17T00:00:00Z";
  assert.equal(decide([pr(12, { enabledAt: at }), pr(11, { enabledAt: at })]).align, 11);
});

for (const check of ["none", "pending", "success"]) {
  test(`最新の main を含む PR の check が ${check} なら、次は揃えずに待つ`, () => {
    const r = decide([pr(1), pr(2, { mergeState: "BLOCKED", upToDate: true, check })]);
    assert.equal(r.align, null);
    assert.match(r.wait, /#2/);
  });
}

test("最新の main を含む PR の check が落ちていれば、待たずに次を揃える", () => {
  assert.equal(decide([pr(1), pr(2, { mergeState: "BLOCKED", upToDate: true, check: "failure" })]).align, 1);
});

test("最新の main を含んでいても DIRTY なら待たない", () => {
  assert.equal(decide([pr(1), pr(2, { mergeState: "DIRTY", upToDate: true, dirtyNotified: true })]).align, 1);
});

test("head の check が落ちている BEHIND は飛ばし、次に古いものを揃える", () => {
  const r = decide([pr(1, { check: "failure" }), pr(2)]);
  assert.equal(r.align, 2);
  assert.deepEqual(r.skipped, [{ number: 1, reason: "check が落ちている" }]);
});

test("この head で update-branch が失敗した PR は飛ばす", () => {
  assert.equal(decide([pr(1, { alignFailed: true }), pr(2)]).align, 2);
});

test("BEHIND・DIRTY 以外の状態で最新の main を含まない PR は揃えない（UNKNOWN は次の周に任せる）", () => {
  assert.equal(decide([pr(1, { mergeState: "UNKNOWN" }), pr(2, { mergeState: "CLEAN" })]).align, null);
});

test("まだ知らせていない DIRTY はすべて知らせ、揃えるかどうかとは関係しない", () => {
  const r = decide([pr(1, { mergeState: "DIRTY" }), pr(2, { mergeState: "DIRTY", dirtyNotified: true }), pr(3, { mergeState: "DIRTY" }), pr(4)]);
  assert.deepEqual(r.notify, [1, 3]);
  assert.equal(r.align, 4);
});

test("待つときも DIRTY は知らせる", () => {
  const r = decide([pr(1, { mergeState: "DIRTY" }), pr(2, { mergeState: "CLEAN", upToDate: true, check: "pending" })]);
  assert.deepEqual(r.notify, [1]);
  assert.equal(r.align, null);
});
