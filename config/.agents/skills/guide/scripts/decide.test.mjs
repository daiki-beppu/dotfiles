// decide.mjs の判定テスト。GitHub・takt・Discord・子プロセスは一切呼ばない。
import assert from "node:assert/strict";
import { test } from "node:test";
import { decide } from "./decide.mjs";

const REPO = "daiki-beppu/live-mindmap";
const VIEWER = "daiki-beppu";

const STARTED = "案内役: to-tickets を起動した";
const FINISHED = (code) => `案内役: to-tickets が終わった（exit ${code}）`;
const HANDED = (...nums) => `案内役: takt-sequence に渡した ${nums.map((n) => `#${n}`).join(" ")}`;

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
const spec = (number, over = {}) => issue(number, { labels: ["spec", "spec-approved"], ...over });
const byViewer = (body) => ({ author: VIEWER, body });
const snapshot = (issues, over = {}) => ({
  repo: REPO,
  viewer: VIEWER,
  issues,
  taktIssues: [],
  dispatched: [],
  ...over,
});
const toTickets = (n) => ({ kind: "to-tickets", key: `to-tickets:${n}`, spec: n });
const taktSequence = (parent, issues) => ({
  kind: "takt-sequence",
  key: `takt-sequence:${parent}`,
  parent,
  issues,
});
const openSubs = (...nums) => nums.map((number) => ({ number, state: "OPEN" }));

// 親 #20（仕様 #12 を指す）と sub-issue #21 #22 がそろった基準の状態。
const withParent = (over = {}) =>
  snapshot(
    [
      spec(12, { comments: [byViewer(STARTED), byViewer(FINISHED(0))] }),
      issue(20, { body: "仕様: #12", subIssues: openSubs(21, 22) }),
      issue(21),
      issue(22),
    ],
    over,
  );

// ---- 遷移 1: 承認済みの仕様があり、それを指す親がまだない → to-tickets ----

test("遷移1: spec と spec-approved が付いた仕様で、親も起動マーカーも無ければ to-tickets を出す", () => {
  assert.deepEqual(decide(snapshot([spec(12)])), [toTickets(12)]);
});

test("遷移1: 複数の承認済み仕様は仕様番号の昇順で出す", () => {
  assert.deepEqual(decide(snapshot([spec(30), spec(12)])), [toTickets(12), toTickets(30)]);
});

for (const state of ["OPEN", "CLOSED"]) {
  test(`遷移1: 本文で言及するだけの ${state} な issue（sub-issue 0 件）は親ではないので to-tickets を出す`, () => {
    const s = snapshot([spec(12), issue(20, { state, body: "関連: #12" })]);
    assert.deepEqual(decide(s), [toTickets(12)]);
  });
}

test("遷移1: 記録の行と sub-issue を持つ親が既にあれば to-tickets を出さない", () => {
  const s = snapshot([spec(12), issue(20, { body: "仕様: #12", subIssues: openSubs(21) }), issue(21)]);
  assert.deepEqual(decide(s), [taktSequence(20, [21])]);
});

test("遷移1: spec-approved が無い仕様には to-tickets を出さない", () => {
  assert.deepEqual(decide(snapshot([issue(12, { labels: ["spec"] })])), []);
});

test("遷移1: spec ラベルが無い issue は spec-approved だけでは仕様と扱わない", () => {
  assert.deepEqual(decide(snapshot([issue(12, { labels: ["spec-approved"] })])), []);
});

test("遷移1: CLOSED の仕様には to-tickets を出さない", () => {
  assert.deepEqual(decide(snapshot([spec(12, { state: "CLOSED" })])), []);
});

test("遷移1: 別の仕様 #13 が #12 を本文で参照しても #12 の親にはならず to-tickets:12 が出る", () => {
  const s = snapshot([spec(12), spec(13, { body: "関連: #12" })]);
  assert.deepEqual(decide(s), [toTickets(12), toTickets(13)]);
});

// ---- 遷移 2: 親と sub-issue がそろい、まだ takt に渡していない → takt-sequence ----

test("遷移2: 親と sub-issue がそろい、終了マーカー(exit 0)があれば open な sub-issue を takt-sequence に渡す", () => {
  assert.deepEqual(decide(withParent()), [taktSequence(20, [21, 22])]);
});

test("遷移2: to-tickets の起動マーカーが無い（人が作った）親でも、sub-issue がそろっていれば渡す", () => {
  const s = snapshot([
    spec(12),
    issue(20, { body: "仕様: #12", subIssues: openSubs(21, 22) }),
  ]);
  assert.deepEqual(decide(s), [taktSequence(20, [21, 22])]);
});

test("遷移2: sub-issue は親の sub-issue の並び順で、open なものだけ渡す", () => {
  const s = withParent();
  s.issues[1].subIssues = [
    { number: 23, state: "OPEN" },
    { number: 21, state: "CLOSED" },
    { number: 22, state: "OPEN" },
  ];
  assert.deepEqual(decide(s), [taktSequence(20, [23, 22])]);
});

test("遷移2: open な sub-issue が 1 件も無ければ渡さない", () => {
  const s = withParent();
  s.issues[1].subIssues = [{ number: 21, state: "CLOSED" }];
  assert.deepEqual(decide(s), []);
});

test("遷移2: 同じ親を複数の仕様が指しても 1 件にまとめる", () => {
  const s = snapshot([
    spec(12),
    spec(13),
    issue(20, { body: "仕様: #12\n仕様: #13", subIssues: openSubs(21) }),
  ]);
  assert.deepEqual(decide(s), [taktSequence(20, [21])]);
});

test("遷移2: 親は仕様番号の昇順、その中は親番号の昇順で出す", () => {
  const s = snapshot([
    spec(30),
    spec(12),
    issue(41, { body: "仕様: #30", subIssues: openSubs(42) }),
    issue(25, { body: "仕様: #12", subIssues: openSubs(26) }),
    issue(20, { body: "仕様: #12", subIssues: openSubs(21) }),
  ]);
  assert.deepEqual(decide(s), [taktSequence(20, [21]), taktSequence(25, [26]), taktSequence(41, [42])]);
});

test("遷移2: 未承認（spec-approved 無し）の仕様を指す親は渡さない", () => {
  const s = withParent();
  s.issues[0].labels = ["spec"];
  assert.deepEqual(decide(s), []);
});

test("遷移2: to-tickets の起動マーカーだけで終了マーカーが無い間は渡さず、to-tickets も出さない", () => {
  const s = withParent();
  s.issues[0].comments = [byViewer(STARTED)];
  assert.deepEqual(decide(s), []);
});

test("遷移2: to-tickets の終了コードが 0 以外なら渡さない", () => {
  const s = withParent();
  s.issues[0].comments = [byViewer(STARTED), byViewer(FINISHED(1))];
  assert.deepEqual(decide(s), []);
});

test("遷移2: 親に viewer の「渡した」マーカーがあれば渡さない", () => {
  const s = withParent();
  s.issues[1].comments = [byViewer(HANDED(21, 22))];
  assert.deepEqual(decide(s), []);
});

test("遷移2: 他人が書いた「渡した」マーカーは数えず、渡す", () => {
  const s = withParent();
  s.issues[1].comments = [{ author: "someone", body: HANDED(21, 22) }];
  assert.deepEqual(decide(s), [taktSequence(20, [21, 22])]);
});

test("遷移2: sub-issue のどれかが takt に既にあれば渡さない", () => {
  assert.deepEqual(decide(withParent({ taktIssues: [22] })), []);
});

test("遷移2: 閉じた sub-issue だけに takt のタスクが残っていても、open な sub-issue は渡す", () => {
  const s = withParent({ taktIssues: [21] });
  s.issues[1].subIssues = [{ number: 21, state: "CLOSED" }, { number: 22, state: "OPEN" }];
  assert.deepEqual(decide(s), [taktSequence(20, [22])]);
});

test("遷移2: 無関係な issue が takt にあっても渡す", () => {
  assert.deepEqual(decide(withParent({ taktIssues: [99] })), [taktSequence(20, [21, 22])]);
});

// ---- 何もすることがない状態 ----

test("何もない: issue が 0 件のスナップショットは空の行動を返す", () => {
  assert.deepEqual(decide(snapshot([])), []);
});

test("何もない: 仕様が無く通常の issue だけなら空を返す", () => {
  assert.deepEqual(decide(snapshot([issue(1), issue(2, { labels: ["bug"] })])), []);
});

test("何もない: 全て渡し済み・投入済みの状態では空を返す", () => {
  const s = withParent({ taktIssues: [21, 22] });
  s.issues[1].comments = [byViewer(HANDED(21, 22))];
  assert.deepEqual(decide(s), []);
});

// ---- 再起動しても二重にしない（状態は GitHub のマーカー、dispatched は空） ----

test("再起動: 起動マーカーが GitHub にあれば、dispatched が空でも to-tickets を出さない", () => {
  const s = snapshot([spec(12, { comments: [byViewer(STARTED)] })]);
  assert.deepEqual(s.dispatched, []);
  assert.deepEqual(decide(s), []);
});

test("再起動: 終了マーカーまであり親も無い仕様にも to-tickets を出さない", () => {
  const s = snapshot([spec(12, { comments: [byViewer(STARTED), byViewer(FINISHED(0))] })]);
  assert.deepEqual(decide(s), []);
});

// ---- この実行で既に出した行動（dispatched）は出さない ----

test("dispatched: to-tickets:12 が済んでいれば to-tickets を出さない", () => {
  assert.deepEqual(decide(snapshot([spec(12)], { dispatched: ["to-tickets:12"] })), []);
});

test("dispatched: 別の仕様の key は抑止に使わない", () => {
  assert.deepEqual(decide(snapshot([spec(12)], { dispatched: ["to-tickets:13"] })), [toTickets(12)]);
});

test("dispatched: takt-sequence:20 が済んでいれば渡さない", () => {
  assert.deepEqual(decide(withParent({ dispatched: ["takt-sequence:20"] })), []);
});

// ---- マーカー: viewer が書いた、接頭辞で始まるコメントだけ ----

test("マーカー: viewer の起動コメントがあれば to-tickets を出さない", () => {
  const s = snapshot([spec(12, { comments: [byViewer(STARTED)] })]);
  assert.deepEqual(decide(s), []);
});

test("マーカー: viewer の引用（> 始まり）は数えず to-tickets を出す", () => {
  const s = snapshot([spec(12, { comments: [byViewer(`> ${STARTED}`)] })]);
  assert.deepEqual(decide(s), [toTickets(12)]);
});

test("マーカー: 他人の同じ文面は数えず to-tickets を出す", () => {
  const s = snapshot([spec(12, { comments: [{ author: "someone", body: STARTED }] })]);
  assert.deepEqual(decide(s), [toTickets(12)]);
});

test("マーカー: 本文の途中に接頭辞が含まれるだけのコメントは数えない", () => {
  const s = snapshot([spec(12, { comments: [byViewer(`メモ。${STARTED} と書いてあった`)] })]);
  assert.deepEqual(decide(s), [toTickets(12)]);
});

test("マーカー: 終了マーカーが他人のものなら起動中のままで、渡さない", () => {
  const s = withParent();
  s.issues[0].comments = [byViewer(STARTED), { author: "someone", body: FINISHED(0) }];
  assert.deepEqual(decide(s), []);
});

// ---- 親の記録の行 ----

for (const body of ["仕様: #12", "概要\n仕様: #12", "仕様: #12\r\n", "概要\r\n  仕様: #12  \r\n末尾"]) {
  test(`記録: ${JSON.stringify(body)} と sub-issue を持つ issue は #12 の親`, () => {
    const s = snapshot([spec(12), issue(20, { body, subIssues: openSubs(21) }), issue(21)]);
    assert.deepEqual(decide(s), [taktSequence(20, [21])]);
  });
}

for (const body of ["仕様: #120", "仕様: #1", "関連: #12", "仕様は #12。", "#12", `${REPO}#12`, "仕様: #12 #13", "", "記録なし"]) {
  test(`記録: ${JSON.stringify(body)} は #12 の親の記録ではない（sub-issue ありでも）`, () => {
    const s = snapshot([spec(12), issue(30, { body, subIssues: openSubs(31) }), issue(31)]);
    assert.deepEqual(decide(s), [toTickets(12)]);
  });
}

test("記録: 本文が null/undefined でも例外にせず親と扱わない", () => {
  for (const body of [null, undefined]) {
    const s = snapshot([spec(12), issue(30, { body, subIssues: openSubs(31) })]);
    assert.deepEqual(decide(s), [toTickets(12)]);
  }
});

test("記録: 行は完全一致で、記録の行が無い親（sub-issue あり）の子は渡さず to-tickets を出す", () => {
  const s = snapshot([spec(12), issue(30, { body: "関連: #12", subIssues: openSubs(31) }), issue(31)]);
  assert.deepEqual(decide(s), [toTickets(12)]);
});

test("記録: sub-issue が 0 件の記録の行だけの issue は渡さず、to-tickets を出す", () => {
  const s = snapshot([spec(12), issue(20, { body: "仕様: #12" })]);
  assert.deepEqual(decide(s), [toTickets(12)]);
});

// ---- 純粋性 ----

const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

test("純粋性: 入力を変更せず、同じ入力に同じ出力を返す", () => {
  const s = deepFreeze(withParent());
  const first = decide(s);
  const second = decide(s);
  assert.deepEqual(first, [taktSequence(20, [21, 22])]);
  assert.deepEqual(second, first);
});
