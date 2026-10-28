import assert from "node:assert/strict";
import { test } from "node:test";
import { planRound } from "./sequence-plan.mjs";

// blocked: 前が閉じていない issue（ready が false）
const plan = (stages, concurrency, blocked = []) => {
  const asked = [];
  const r = planRound({ stages, concurrency, ready: (n) => { asked.push(n); return !blocked.includes(n); } });
  return { ...r, asked };
};

test("並列 2: blocked_by の無い 2 件を同時に積み、blocked_by のある 3 件目は積まない", () => {
  const r = plan([[1, "new"], [2, "new"], [3, "new"]], 2, [3]);
  assert.deepEqual(r.enqueue, [1, 2]);
  assert.equal(r.end, null);
});

test("並列 2: 1 件が進行中なら、空きの 1 件だけを並びの順に積む。前が閉じていない issue は飛ばす", () => {
  const r = plan([[1, "waiting"], [2, "new"], [3, "new"], [4, "new"]], 2, [2]);
  assert.deepEqual(r.enqueue, [3]);
  assert.deepEqual(r.asked, [2, 3]);
});

test("並列 2: 前の issue が閉じて blocked_by が外れたら、3 件目を積む", () => {
  const r = plan([[1, "done"], [2, "waiting"], [3, "new"]], 2);
  assert.deepEqual(r.enqueue, [3]);
});

test("空きが無ければ積まず、積めるかも調べない", () => {
  const r = plan([[1, "waiting"], [2, "waiting"], [3, "new"]], 2);
  assert.deepEqual(r, { enqueue: [], end: null, asked: [] });
});

test("並列 1（既定）: 進行中が無いときだけ、並びの先頭の積める 1 件を積む", () => {
  assert.deepEqual(plan([[1, "new"], [2, "new"]], 1).enqueue, [1]);
  assert.deepEqual(plan([[1, "waiting"], [2, "new"]], 1).enqueue, []);
  assert.deepEqual(plan([[1, "new"], [2, "new"]], 1, [1]).enqueue, [2]);
});

test("止まった issue があっても、進行中の issue は見届け、空きには次を積む", () => {
  assert.deepEqual(plan([[1, "stuck"], [2, "waiting"]], 2), { enqueue: [], end: null, asked: [] });
  assert.deepEqual(plan([[1, "stuck"], [2, "waiting"], [3, "new"]], 2).enqueue, [3]);
});

test("全件 done なら 0 で終わる", () => {
  assert.deepEqual(plan([[1, "done"], [2, "done"]], 2).end, { line: "全件マージ完了", code: 0 });
});

test("進行中も積める issue も無ければ止まる。止まった issue があれば人の手が要る、無ければ積める issue が無い", () => {
  assert.deepEqual(plan([[1, "stuck"], [2, "new"]], 2, [2]).end, { line: "停止: 人の手が要る issue がある", code: 1 });
  assert.deepEqual(plan([[1, "done"], [2, "new"]], 2, [2]).end, { line: "停止: 積める issue が無い（依存が未解除か help wanted）", code: 1 });
});

test("手で対応中の PR だけが残っていれば、そのマージを待つ（止まった issue があれば止まる）", () => {
  assert.equal(plan([[1, "manual"], [2, "done"]], 1).end, null);
  assert.equal(plan([[1, "manual"], [2, "stuck"]], 1).end.code, 1);
});
