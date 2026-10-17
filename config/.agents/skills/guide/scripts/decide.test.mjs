// decide.mjs の判定テスト。GitHub・takt・Discord・子プロセスは一切呼ばない。
import assert from "node:assert/strict";
import { test } from "node:test";
import { SEQUENCE_DONE, decide, decisionMarker, launchedMarker, sequencesToObserve, sessionsToObserve, tabTitle } from "./decide.mjs";
// map のスレッド・人が見る ticket・ticket の停止の観測（新しい公開物）は名前空間で読む（未実装でも他のテストは動かす）。
import * as D from "./decide.mjs";

const REPO = "daiki-beppu/live-mindmap";
const VIEWER = "daiki-beppu";

const STARTED = "案内役: to-tickets を起動した";
// 新しい印（Orca のタブで起動）: 起動前と、handle と起動時刻つきの起動後。STARTED（handle なし）と FINISHED は旧版が書いた古い印。
const LAUNCHING = "案内役: to-tickets を起動する";
const LAUNCHED = "案内役: to-tickets を起動した（ターミナル term_1 / 2026-10-17T00:00:00.000Z）";
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
const byViewer = (body) => ({ author: VIEWER, body });
// formal-spec: 起動前の印と、viewer の passed の結果。to-tickets の流れを見るテストは、formal-spec が済んだ仕様（spec）を使う。
// formal-spec の遷移そのものを見るテストは、印も結果も無い仕様（specBare）から組み立てる。
const FS_LAUNCHING = "案内役: formal-spec を起動する";
const FS_PASSED = "## Formal Spec（takt 0.71.0 の検証器で passed）";
const FS_DONE = [byViewer(FS_LAUNCHING), byViewer(FS_PASSED)];
const specBare = (number, over = {}) => issue(number, { labels: ["spec", "spec-approved"], ...over });
const spec = (number, over = {}) => specBare(number, { ...over, comments: [...FS_DONE, ...(over.comments ?? [])] });
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
// 承認依頼の送信より後の流れ（to-tickets / takt-sequence）だけを取り出す。
const flow = (actions) => actions.filter((a) => a.kind === "to-tickets" || a.kind === "takt-sequence");
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
  assert.deepEqual(flow(decide(snapshot([spec(12)]))), [toTickets(12)]);
});

test("遷移1: 複数の承認済み仕様は仕様番号の昇順で出す", () => {
  assert.deepEqual(flow(decide(snapshot([spec(30), spec(12)]))), [toTickets(12), toTickets(30)]);
});

for (const state of ["OPEN", "CLOSED"]) {
  test(`遷移1: 本文で言及するだけの ${state} な issue（sub-issue 0 件）は親ではないので to-tickets を出す`, () => {
    const s = snapshot([spec(12), issue(20, { state, body: "関連: #12" })]);
    assert.deepEqual(flow(decide(s)), [toTickets(12)]);
  });
}

test("遷移1: 記録の行と sub-issue を持つ親が既にあれば to-tickets を出さない", () => {
  const s = snapshot([spec(12), issue(20, { body: "仕様: #12", subIssues: openSubs(21) }), issue(21)]);
  assert.deepEqual(flow(decide(s)), [taktSequence(20, [21])]);
});

test("遷移1: spec-approved が無い仕様には to-tickets を出さない", () => {
  assert.deepEqual(flow(decide(snapshot([issue(12, { labels: ["spec"] })]))), []);
});

test("遷移1: spec ラベルが無い issue は spec-approved だけでは仕様と扱わない", () => {
  assert.deepEqual(decide(snapshot([issue(12, { labels: ["spec-approved"] })])), []);
});

test("遷移1: CLOSED の仕様には to-tickets を出さない", () => {
  assert.deepEqual(decide(snapshot([spec(12, { state: "CLOSED" })])), []);
});

test("遷移1: 別の仕様 #13 が #12 を本文で参照しても #12 の親にはならず to-tickets:12 が出る", () => {
  const s = snapshot([spec(12), spec(13, { body: "関連: #12" })]);
  assert.deepEqual(flow(decide(s)), [toTickets(12), toTickets(13)]);
});

// ---- 遷移 2: 親と sub-issue がそろい、まだ takt に渡していない → takt-sequence ----

test("遷移2: 親と sub-issue がそろい、終了マーカー(exit 0)があれば open な sub-issue を takt-sequence に渡す", () => {
  assert.deepEqual(flow(decide(withParent())), [taktSequence(20, [21, 22])]);
});

test("遷移2: to-tickets の起動マーカーが無い（人が作った）親でも、sub-issue がそろっていれば渡す", () => {
  const s = snapshot([
    spec(12),
    issue(20, { body: "仕様: #12", subIssues: openSubs(21, 22) }),
  ]);
  assert.deepEqual(flow(decide(s)), [taktSequence(20, [21, 22])]);
});

test("遷移2: sub-issue は親の sub-issue の並び順で、open なものだけ渡す", () => {
  const s = withParent();
  s.issues[1].subIssues = [
    { number: 23, state: "OPEN" },
    { number: 21, state: "CLOSED" },
    { number: 22, state: "OPEN" },
  ];
  assert.deepEqual(flow(decide(s)), [taktSequence(20, [23, 22])]);
});

test("遷移2: open な sub-issue が 1 件も無ければ渡さない", () => {
  const s = withParent();
  s.issues[1].subIssues = [{ number: 21, state: "CLOSED" }];
  assert.deepEqual(flow(decide(s)), []);
});

test("遷移2: 同じ親を複数の仕様が指しても 1 件にまとめる", () => {
  const s = snapshot([
    spec(12),
    spec(13),
    issue(20, { body: "仕様: #12\n仕様: #13", subIssues: openSubs(21) }),
  ]);
  assert.deepEqual(flow(decide(s)), [taktSequence(20, [21])]);
});

test("遷移2: 親は仕様番号の昇順、その中は親番号の昇順で出す", () => {
  const s = snapshot([
    spec(30),
    spec(12),
    issue(41, { body: "仕様: #30", subIssues: openSubs(42) }),
    issue(25, { body: "仕様: #12", subIssues: openSubs(26) }),
    issue(20, { body: "仕様: #12", subIssues: openSubs(21) }),
  ]);
  assert.deepEqual(flow(decide(s)), [taktSequence(20, [21]), taktSequence(25, [26]), taktSequence(41, [42])]);
});

test("遷移2: 未承認（spec-approved 無し）の仕様を指す親は渡さない", () => {
  const s = withParent();
  s.issues[0].labels = ["spec"];
  assert.deepEqual(flow(decide(s)), []);
});

test("遷移2: to-tickets の起動マーカーだけで終了マーカーが無い間は渡さず、to-tickets も出さない", () => {
  const s = withParent();
  s.issues[0].comments = [byViewer(STARTED)];
  assert.deepEqual(flow(decide(s)), []);
});

test("遷移2: to-tickets の終了コードが 0 以外なら渡さない", () => {
  const s = withParent();
  s.issues[0].comments = [byViewer(STARTED), byViewer(FINISHED(1))];
  assert.deepEqual(flow(decide(s)), []);
});

test("遷移2: 親に viewer の「渡した」マーカーがあれば渡さない", () => {
  const s = withParent();
  s.issues[1].comments = [byViewer(HANDED(21, 22))];
  assert.deepEqual(flow(decide(s)), []);
});

test("遷移2: 他人が書いた「渡した」マーカーは数えず、渡す", () => {
  const s = withParent();
  s.issues[1].comments = [{ author: "someone", body: HANDED(21, 22) }];
  assert.deepEqual(flow(decide(s)), [taktSequence(20, [21, 22])]);
});

test("遷移2: sub-issue のどれかが takt に既にあれば渡さない", () => {
  assert.deepEqual(flow(decide(withParent({ taktIssues: [22] }))), []);
});

test("遷移2: 閉じた sub-issue だけに takt のタスクが残っていても、open な sub-issue は渡す", () => {
  const s = withParent({ taktIssues: [21] });
  s.issues[1].subIssues = [{ number: 21, state: "CLOSED" }, { number: 22, state: "OPEN" }];
  assert.deepEqual(flow(decide(s)), [taktSequence(20, [22])]);
});

test("遷移2: 無関係な issue が takt にあっても渡す", () => {
  assert.deepEqual(flow(decide(withParent({ taktIssues: [99] }))), [taktSequence(20, [21, 22])]);
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
  assert.deepEqual(flow(decide(s)), []);
});

// ---- Orca のタブで起動した to-tickets: 新しい印があれば出さず、終わりは親ができたかで判定する（終了コードは使わない） ----

test("新しい印: 起動前の印だけでも（親が無くても）to-tickets を出さない", () => {
  assert.deepEqual(flow(decide(snapshot([spec(12, { comments: [byViewer(LAUNCHING)] })]))), []);
});

test("新しい印: 起動後の印（handle と時刻つき）があれば to-tickets を出さない", () => {
  assert.deepEqual(flow(decide(snapshot([spec(12, { comments: [byViewer(LAUNCHING), byViewer(LAUNCHED)] })]))), []);
});

test("新しい印: 他人の印・viewer の引用の印だけなら止めず to-tickets を出す", () => {
  const s = snapshot([spec(12, { comments: [{ author: "someone", body: LAUNCHING }, byViewer(`> ${LAUNCHED}`)] })]);
  assert.deepEqual(flow(decide(s)), [toTickets(12)]);
});

test("新しい印: 親（仕様を指す行と sub-issue）ができたら、終了マーカー無しで takt-sequence に渡す", () => {
  const s = withParent();
  s.issues[0].comments = [byViewer(LAUNCHING), byViewer(LAUNCHED)];
  assert.deepEqual(flow(decide(s)), [taktSequence(20, [21, 22])]);
});

test("新しい印: 起動前の印だけの仕様でも、親ができれば渡す（終わりは親の有無で判定する）", () => {
  const s = withParent();
  s.issues[0].comments = [byViewer(LAUNCHING)];
  assert.deepEqual(flow(decide(s)), [taktSequence(20, [21, 22])]);
});

test("新しい印: 親が無い間は渡す先が無く、to-tickets も二重に出さない", () => {
  const s = snapshot([spec(12, { comments: [byViewer(LAUNCHING), byViewer(LAUNCHED)] }), issue(20, { body: "仕様: #12", subIssues: [] })]);
  assert.deepEqual(flow(decide(s)), []);
});

test("新しい印: handle なしの古い起動の印（「（ターミナル」が続かない）は新しい印として読まず、親があっても渡さない", () => {
  const s = withParent();
  s.issues[0].comments = [byViewer(STARTED)];
  assert.deepEqual(flow(decide(s)), []);
});

test("古い印: exit 0 の親は渡す／exit 0 以外の親は渡さない／どの古い印でも to-tickets を二重に出さない", () => {
  const withComments = (comments) => { const s = withParent(); s.issues[0].comments = comments; return s; };
  assert.deepEqual(flow(decide(withComments([byViewer(STARTED), byViewer(FINISHED(0))]))), [taktSequence(20, [21, 22])]);
  assert.deepEqual(flow(decide(withComments([byViewer(STARTED), byViewer(FINISHED(1))]))), []);
  for (const comments of [[byViewer(STARTED)], [byViewer(STARTED), byViewer(FINISHED(0))], [byViewer(STARTED), byViewer(FINISHED(1))]]) {
    assert.deepEqual(flow(decide(snapshot([spec(12, { comments })]))), [], comments.map((c) => c.body).join(" / "));
  }
});

test("新しい印と古い印の exit 0 以外が混ざっても、古い印の規則（exit 0 以外は渡さない）を保つ", () => {
  const s = withParent();
  s.issues[0].comments = [byViewer(STARTED), byViewer(FINISHED(1)), byViewer(LAUNCHING), byViewer(LAUNCHED)];
  assert.deepEqual(flow(decide(s)), []);
});

test("同じスナップショットで 2 周しても二重に出さない（to-tickets・takt-sequence）", () => {
  const once = (s, dispatched) => flow(decide({ ...s, dispatched: [...dispatched] }));
  const noParent = snapshot([spec(12)]);
  const first = once(noParent, []);
  assert.deepEqual(first, [toTickets(12)]);
  assert.deepEqual(once(noParent, first.map((a) => a.key)), []);

  const s = withParent();
  s.issues[0].comments = [byViewer(LAUNCHING), byViewer(LAUNCHED)];
  const handed = once(s, []);
  assert.deepEqual(handed, [taktSequence(20, [21, 22])]);
  assert.deepEqual(once(s, handed.map((a) => a.key)), []);
});

test("新しい印: sub-issue がすべて閉じていれば knowledge を出す（gate が閉じたままにならない）", () => {
  const s = snapshot([
    spec(12, { comments: [byViewer(LAUNCHING), byViewer(LAUNCHED)] }),
    issue(20, { body: "仕様: #12", subIssues: [{ number: 21, state: "CLOSED" }, { number: 22, state: "CLOSED" }] }),
  ]);
  const k = decide(s).filter((a) => a.kind === "knowledge");
  assert.deepEqual(k.map((a) => ({ spec: a.spec, parents: a.parents, subIssues: a.subIssues })), [{ spec: 12, parents: [20], subIssues: [21, 22] }]);
});

// ---- 再起動しても二重にしない（状態は GitHub のマーカー、dispatched は空） ----

test("再起動: 起動マーカーが GitHub にあれば、dispatched が空でも to-tickets を出さない", () => {
  const s = snapshot([spec(12, { comments: [byViewer(STARTED)] })]);
  assert.deepEqual(s.dispatched, []);
  assert.deepEqual(flow(decide(s)), []);
});

test("再起動: 終了マーカーまであり親も無い仕様にも to-tickets を出さない", () => {
  const s = snapshot([spec(12, { comments: [byViewer(STARTED), byViewer(FINISHED(0))] })]);
  assert.deepEqual(flow(decide(s)), []);
});

// ---- この実行で既に出した行動（dispatched）は出さない ----

test("dispatched: to-tickets:12 が済んでいれば to-tickets を出さない", () => {
  assert.deepEqual(flow(decide(snapshot([spec(12)], { dispatched: ["to-tickets:12"] }))), []);
});

test("dispatched: 別の仕様の key は抑止に使わない", () => {
  assert.deepEqual(flow(decide(snapshot([spec(12)], { dispatched: ["to-tickets:13"] }))), [toTickets(12)]);
});

test("dispatched: takt-sequence:20 が済んでいれば渡さない", () => {
  assert.deepEqual(flow(decide(withParent({ dispatched: ["takt-sequence:20"] }))), []);
});

// ---- マーカー: viewer が書いた、接頭辞で始まるコメントだけ ----

test("マーカー: viewer の起動コメントがあれば to-tickets を出さない", () => {
  const s = snapshot([spec(12, { comments: [byViewer(STARTED)] })]);
  assert.deepEqual(flow(decide(s)), []);
});

test("マーカー: viewer の引用（> 始まり）は数えず to-tickets を出す", () => {
  const s = snapshot([spec(12, { comments: [byViewer(`> ${STARTED}`)] })]);
  assert.deepEqual(flow(decide(s)), [toTickets(12)]);
});

test("マーカー: 他人の同じ文面は数えず to-tickets を出す", () => {
  const s = snapshot([spec(12, { comments: [{ author: "someone", body: STARTED }] })]);
  assert.deepEqual(flow(decide(s)), [toTickets(12)]);
});

test("マーカー: 本文の途中に接頭辞が含まれるだけのコメントは数えない", () => {
  const s = snapshot([spec(12, { comments: [byViewer(`メモ。${STARTED} と書いてあった`)] })]);
  assert.deepEqual(flow(decide(s)), [toTickets(12)]);
});

test("マーカー: 終了マーカーが他人のものなら起動中のままで、渡さない", () => {
  const s = withParent();
  s.issues[0].comments = [byViewer(STARTED), { author: "someone", body: FINISHED(0) }];
  assert.deepEqual(flow(decide(s)), []);
});

// ---- 親の記録の行 ----

for (const body of ["仕様: #12", "概要\n仕様: #12", "仕様: #12\r\n", "概要\r\n  仕様: #12  \r\n末尾"]) {
  test(`記録: ${JSON.stringify(body)} と sub-issue を持つ issue は #12 の親`, () => {
    const s = snapshot([spec(12), issue(20, { body, subIssues: openSubs(21) }), issue(21)]);
    assert.deepEqual(flow(decide(s)), [taktSequence(20, [21])]);
  });
}

for (const body of ["仕様: #120", "仕様: #1", "関連: #12", "仕様は #12。", "#12", `${REPO}#12`, "仕様: #12 #13", "", "記録なし"]) {
  test(`記録: ${JSON.stringify(body)} は #12 の親の記録ではない（sub-issue ありでも）`, () => {
    const s = snapshot([spec(12), issue(30, { body, subIssues: openSubs(31) }), issue(31)]);
    assert.deepEqual(flow(decide(s)), [toTickets(12)]);
  });
}

test("記録: 本文が null/undefined でも例外にせず親と扱わない", () => {
  for (const body of [null, undefined]) {
    const s = snapshot([spec(12), issue(30, { body, subIssues: openSubs(31) })]);
    assert.deepEqual(flow(decide(s)), [toTickets(12)]);
  }
});

test("記録: 行は完全一致で、記録の行が無い親（sub-issue あり）の子は渡さず to-tickets を出す", () => {
  const s = snapshot([spec(12), issue(30, { body: "関連: #12", subIssues: openSubs(31) }), issue(31)]);
  assert.deepEqual(flow(decide(s)), [toTickets(12)]);
});

test("記録: sub-issue が 0 件の記録の行だけの issue は渡さず、to-tickets を出す", () => {
  const s = snapshot([spec(12), issue(20, { body: "仕様: #12" })]);
  assert.deepEqual(flow(decide(s)), [toTickets(12)]);
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
  const first = flow(decide(s));
  const second = flow(decide(s));
  assert.deepEqual(first, [taktSequence(20, [21, 22])]);
  assert.deepEqual(second, first);
});

// ---- 承認の遷移（Discord）----

const SENDING = "案内役: Discord に承認依頼を送る";
const SENT = (thread = "555", message = "777") => `案内役: Discord に承認依頼を送った（スレッド ${thread} / メッセージ ${message}）`;
const OWNER = "U-owner";
const react = (emoji, userId = OWNER) => ({ emoji, userId });
const pending = (n, over = {}) => issue(n, { title: "仕様A", labels: ["spec"], ...over });
const requested = (n, reactions = [], over = {}) =>
  pending(n, { reactions, ...over, comments: [...(over.comments ?? [byViewer(SENDING), byViewer(SENT())]), ...FS_DONE] });
const withOwner = (issues, over = {}) => snapshot(issues, { discordUserId: OWNER, ...over });
const requestApproval = (n, title = "仕様A") => ({ kind: "request-approval", key: `request-approval:${n}`, spec: n, title });
const approveSpec = (n) => ({ kind: "approve-spec", key: `approve-spec:${n}`, spec: n });
const rejectSpec = (n) => ({ kind: "reject-spec", key: `reject-spec:${n}`, spec: n });

test("承認依頼: まだ送っていない未承認の仕様に request-approval を出す", () => {
  assert.deepEqual(decide(withOwner([pending(12)])), [requestApproval(12)]);
});

test("承認依頼: viewer の「送る」マーカーだけの状態（送信中）では再送しない", () => {
  const s = withOwner([pending(12, { comments: [byViewer(SENDING)] })]);
  assert.deepEqual(decide(s), []);
});

test("承認依頼: 送った後のマーカーがあれば再送しない", () => {
  assert.deepEqual(decide(withOwner([requested(12)])), []);
});

test("承認依頼: viewer の引用や他人の同じ文面は送り済みと数えず、request-approval を出す", () => {
  const s = withOwner([
    pending(12, { comments: [byViewer(`> ${SENDING}`), { author: "someone", body: SENDING }, { author: "someone", body: SENT() }] }),
  ]);
  assert.deepEqual(decide(s), [requestApproval(12)]);
});

test("承認依頼: CLOSED の仕様・spec ラベルの無い issue には送らず、承認済みでも未送信なら送る", () => {
  const s = withOwner([
    pending(12, { state: "CLOSED" }),
    issue(13, { labels: ["bug"] }),
    issue(14),
    spec(15),
  ]);
  assert.deepEqual(
    decide(s).map((a) => a.key),
    ["request-approval:15", "to-tickets:15"],
  );
});

test("承認依頼: 仕様番号の昇順で出し、承認関係の行動を既存の行動より前に並べる", () => {
  const s = withOwner([spec(5), pending(30), pending(12)]);
  assert.deepEqual(decide(s), [requestApproval(5, "issue 5"), requestApproval(12, "仕様A"), requestApproval(30, "仕様A"), toTickets(5)]);
});

test("承認依頼: dispatched に request-approval:12 があれば出さない", () => {
  const s = withOwner([pending(12)], { dispatched: ["request-approval:12"] });
  assert.deepEqual(decide(s), []);
});

test("承認: 本人の ✅ だけがあり未承認なら approve-spec を出す", () => {
  assert.deepEqual(decide(withOwner([requested(12, [react("✅")])])), [approveSpec(12)]);
});

test("承認: 本人以外の ✅ では approve-spec を出さない", () => {
  assert.deepEqual(decide(withOwner([requested(12, [react("✅", "U-other")])])), []);
});

test("承認: 本人の ✅ に他人の ❌ が混ざっても、本人の ✅ で approve-spec を出す", () => {
  assert.deepEqual(decide(withOwner([requested(12, [react("✅"), react("❌", "U-other")])])), [approveSpec(12)]);
});

test("承認: 「送った」マーカーが無ければ ✅ があっても approve-spec を出さない（送信中の状態）", () => {
  const s = withOwner([pending(12, { comments: [byViewer(SENDING)], reactions: [react("✅")] })]);
  assert.deepEqual(decide(s), []);
});

test("承認: 他人が書いた「送った」マーカーでは approve-spec を出さない", () => {
  const s = withOwner([pending(12, { comments: [{ author: "someone", body: SENT() }], reactions: [react("✅")] })]);
  assert.deepEqual(decide(s), [requestApproval(12)]);
});

test("承認: 既に spec-approved がある仕様には approve-spec を出さない（to-tickets だけ出す）", () => {
  const s = withOwner([requested(12, [react("✅")], { labels: ["spec", "spec-approved"] })]);
  assert.deepEqual(decide(s), [toTickets(12)]);
});

test("差し戻し: 承認済みの仕様でも本人の ❌ だけなら reject-spec を出す（to-tickets も出る）", () => {
  const s = withOwner([requested(12, [react("❌")], { labels: ["spec", "spec-approved"] })]);
  assert.deepEqual(decide(s), [rejectSpec(12), toTickets(12)]);
});

test("承認: dispatched に approve-spec:12 があれば出さない", () => {
  const s = withOwner([requested(12, [react("✅")])], { dispatched: ["approve-spec:12"] });
  assert.deepEqual(decide(s), []);
});

test("承認: reactions が無い（undefined）仕様は例外にせず何も出さない", () => {
  const s = withOwner([requested(12, undefined)]);
  assert.deepEqual(decide(s), []);
});

test("差し戻し: 本人の ❌ だけがあれば reject-spec を出す", () => {
  assert.deepEqual(decide(withOwner([requested(12, [react("❌")])])), [rejectSpec(12)]);
});

test("差し戻し: 本人以外の ❌ では reject-spec を出さない", () => {
  assert.deepEqual(decide(withOwner([requested(12, [react("❌", "U-other")])])), []);
});

test("差し戻し: 「送った」マーカーが無ければ reject-spec を出さない", () => {
  const s = withOwner([pending(12, { comments: [byViewer(SENDING)], reactions: [react("❌")] })]);
  assert.deepEqual(decide(s), []);
});

test("差し戻し: dispatched に reject-spec:12 があれば出さない", () => {
  const s = withOwner([requested(12, [react("❌")])], { dispatched: ["reject-spec:12"] });
  assert.deepEqual(decide(s), []);
});

const REJECTED = "案内役: Discord で差し戻された";

test("差し戻し: viewer の差し戻しマーカーがあれば reject-spec を出さない", () => {
  const s = withOwner([requested(12, [react("❌")], { comments: [byViewer(SENDING), byViewer(SENT()), byViewer(REJECTED)] })]);
  assert.deepEqual(decide(s), []);
});

test("差し戻し: 他人や引用の同じ文面は差し戻し済みと数えず、reject-spec を出す", () => {
  const s = withOwner([
    requested(12, [react("❌")], {
      comments: [byViewer(SENDING), byViewer(SENT()), { author: "someone", body: REJECTED }, byViewer(`> ${REJECTED}`)],
    }),
  ]);
  assert.deepEqual(decide(s), [rejectSpec(12)]);
});

test("✅ と ❌ の両方が本人から付いていれば、承認も差し戻しもしない", () => {
  assert.deepEqual(decide(withOwner([requested(12, [react("✅"), react("❌")])])), []);
});

test("承認と差し戻しは仕様ごとに独立して判定する", () => {
  const s = withOwner([requested(13, [react("❌")]), requested(12, [react("✅")])]);
  assert.deepEqual(decide(s), [approveSpec(12), rejectSpec(13)]);
});

test("承認: 承認ラベルが付いた次の周は、既存の遷移1の to-tickets が拾う", () => {
  const before = withOwner([requested(12, [react("✅")])]);
  assert.deepEqual(decide(before), [approveSpec(12)]);
  const after = withOwner([requested(12, [react("✅")], { labels: ["spec", "spec-approved"] })]);
  assert.deepEqual(decide(after), [toTickets(12)]);
});

test("純粋性: 承認の遷移でも入力を変更せず、同じ入力に同じ出力を返す", () => {
  const s = deepFreeze(withOwner([pending(5), requested(12, [react("✅")]), requested(13, [react("❌")])]));
  const first = decide(s);
  assert.deepEqual(first, [requestApproval(5), approveSpec(12), rejectSpec(13)]);
  assert.deepEqual(decide(s), first);
});

// ---- 遷移: 仕様の sub-issue がすべて閉じ、学びの PR がまだない → knowledge ----

const KNOWLEDGE_STARTED = "案内役: knowledge を起動した";
const closedSubs = (...nums) => nums.map((number) => ({ number, state: "CLOSED" }));
const knowledgeActions = (actions) => actions.filter((a) => a.kind === "knowledge");
const knowledge = (n, parents, subIssues) => ({ kind: "knowledge", key: `knowledge:${n}`, spec: n, parents, subIssues });
const pr = (number, body, over = {}) => ({ number, state: "MERGED", author: VIEWER, body, autoMerge: false, ...over });
const mergeActions = (actions) => actions.filter((a) => a.kind === "merge-auto");

// 仕様 #12・親 #20（sub-issue #21 #22 がともに閉じている）の基準の状態。
const allClosed = (over = {}, specOver = {}) =>
  snapshot(
    [
      spec(12, { comments: [byViewer(STARTED), byViewer(FINISHED(0))], ...specOver }),
      issue(20, { body: "仕様: #12", subIssues: closedSubs(21, 22) }),
      issue(21, { state: "CLOSED" }),
      issue(22, { state: "CLOSED" }),
    ],
    { pullRequests: [], ...over },
  );

test("knowledge: sub-issue がすべて閉じ、学びの PR が無ければ、親・閉じた sub-issue を載せて出す", () => {
  assert.deepEqual(knowledgeActions(decide(allClosed())), [knowledge(12, [20], [21, 22])]);
});

test("knowledge: pullRequests が無い（旧形式の）スナップショットでも、PR 無しとして出す", () => {
  const s = allClosed();
  delete s.pullRequests;
  assert.deepEqual(knowledgeActions(decide(s)), [knowledge(12, [20], [21, 22])]);
});

test("knowledge: 親が人の作ったもの（起動マーカー無し）でも、全部閉じていれば出す", () => {
  const s = allClosed({}, { comments: [] });
  assert.deepEqual(knowledgeActions(decide(s)), [knowledge(12, [20], [21, 22])]);
});

test("knowledge: sub-issue に開いたものが 1 件でも残っていれば出さない（閉じたものがあっても）", () => {
  const s = allClosed();
  s.issues.find((i) => i.number === 20).subIssues = [{ number: 21, state: "CLOSED" }, { number: 22, state: "OPEN" }];
  assert.deepEqual(knowledgeActions(decide(s)), []);
});

test("knowledge: 親が 2 つあり片方に開いた sub-issue が残っていれば出さない", () => {
  const s = allClosed();
  s.issues.push(issue(30, { body: "仕様: #12", subIssues: [{ number: 31, state: "OPEN" }] }), issue(31));
  assert.deepEqual(knowledgeActions(decide(s)), []);
});

test("knowledge: 親が 2 つとも全部閉じていれば、親の昇順で両方の sub-issue を載せて 1 件だけ出す", () => {
  const s = allClosed();
  s.issues.push(issue(30, { body: "仕様: #12", subIssues: closedSubs(31) }), issue(31, { state: "CLOSED" }));
  assert.deepEqual(knowledgeActions(decide(s)), [knowledge(12, [20, 30], [21, 22, 31])]);
});

test("knowledge: 仕様を指す親が無ければ出さない", () => {
  assert.deepEqual(knowledgeActions(decide(snapshot([spec(12)], { pullRequests: [] }))), []);
});

test("knowledge: 承認されていない仕様・閉じた仕様には出さない", () => {
  assert.deepEqual(knowledgeActions(decide(allClosed({}, { labels: ["spec"] }))), []);
  assert.deepEqual(knowledgeActions(decide(allClosed({}, { state: "CLOSED" }))), []);
});

test("knowledge: to-tickets が動いている間（起動マーカーだけ）・失敗した仕様（exit 1）には出さない", () => {
  assert.deepEqual(knowledgeActions(decide(allClosed({}, { comments: [byViewer(STARTED)] }))), []);
  assert.deepEqual(knowledgeActions(decide(allClosed({}, { comments: [byViewer(STARTED), byViewer(FINISHED(1))] }))), []);
});

test("学びの PR があれば二度作らない: 状態が MERGED・CLOSED・OPEN のどれでも、本文の途中の記録の行（CRLF・前後の空白つき）で数える", () => {
  for (const state of ["MERGED", "CLOSED", "OPEN"]) {
    const s = allClosed({ pullRequests: [pr(50, "概要\r\n  学びの元の仕様: #12  \r\n", { state })] });
    assert.deepEqual(knowledgeActions(decide(s)), [], state);
  }
});

test("学びの PR の判定: 似ているが一致しない行は PR 有りと数えず、出す", () => {
  for (const body of ["学びの元の仕様: #120", "仕様: #12", "関連: #12", "学びの元の仕様: #12 #13", "引用 > 学びの元の仕様: #12", ""]) {
    const s = allClosed({ pullRequests: [pr(50, body)] });
    assert.deepEqual(knowledgeActions(decide(s)), [knowledge(12, [20], [21, 22])], JSON.stringify(body));
  }
});

test("学びの PR の判定: 他人が作った PR の同じ行は数えず、出す", () => {
  const s = allClosed({ pullRequests: [pr(50, "学びの元の仕様: #12", { author: "someone" })] });
  assert.deepEqual(knowledgeActions(decide(s)), [knowledge(12, [20], [21, 22])]);
});

test("学びの PR の判定: 別の仕様の学びの PR は数えない", () => {
  const s = allClosed({ pullRequests: [pr(50, "学びの元の仕様: #13")] });
  assert.deepEqual(knowledgeActions(decide(s)), [knowledge(12, [20], [21, 22])]);
});

test("knowledge: viewer の起動マーカーがあれば（PR がまだ無くても）出さない。他人のコメントは数えない", () => {
  assert.deepEqual(knowledgeActions(decide(allClosed({}, { comments: [byViewer(STARTED), byViewer(FINISHED(0)), byViewer(KNOWLEDGE_STARTED)] }))), []);
  const other = { author: "someone", body: KNOWLEDGE_STARTED };
  assert.deepEqual(knowledgeActions(decide(allClosed({}, { comments: [byViewer(STARTED), byViewer(FINISHED(0)), other] }))), [knowledge(12, [20], [21, 22])]);
});

const KNOWLEDGE_LAUNCHING = "案内役: knowledge を起動する";
const KNOWLEDGE_LAUNCHED = "案内役: knowledge を起動した（ターミナル term_k / 2026-10-17T00:00:00.000Z）";
const specComments = (...extra) => [byViewer(STARTED), byViewer(FINISHED(0)), ...extra];

test("knowledge: 起動の印（1 段目だけ・1 段目と 2 段目・古い handle なしの印）のどれがあっても出さない", () => {
  for (const extra of [[byViewer(KNOWLEDGE_LAUNCHING)], [byViewer(KNOWLEDGE_LAUNCHING), byViewer(KNOWLEDGE_LAUNCHED)], [byViewer(KNOWLEDGE_STARTED)]]) {
    assert.deepEqual(knowledgeActions(decide(allClosed({}, { comments: specComments(...extra) }))), [], JSON.stringify(extra));
  }
});

test("knowledge: 他人の起動の印や、引用で始まる印では止めない", () => {
  for (const extra of [
    [{ author: "someone", body: KNOWLEDGE_LAUNCHING }],
    [{ author: "someone", body: KNOWLEDGE_LAUNCHED }],
    [byViewer(`> ${KNOWLEDGE_LAUNCHED}`)],
    [byViewer(`> ${KNOWLEDGE_LAUNCHING}`)],
  ]) {
    assert.deepEqual(knowledgeActions(decide(allClosed({}, { comments: specComments(...extra) }))), [knowledge(12, [20], [21, 22])], JSON.stringify(extra));
  }
});

test("knowledge: 1 周目の行動の key を dispatched に入れた 2 周目は、同じスナップショットでも出さない", () => {
  const first = decide(allClosed());
  assert.deepEqual(knowledgeActions(first), [knowledge(12, [20], [21, 22])]);
  assert.deepEqual(knowledgeActions(decide(allClosed({ dispatched: first.map((a) => a.key) }))), []);
});

test("merge-auto: 新しい 2 段の印があり、学びの PR が OPEN で未予約なら、予約だけを出す。1 周目の key を dispatched に入れた 2 周目は出さない", () => {
  const comments = specComments(byViewer(KNOWLEDGE_LAUNCHING), byViewer(KNOWLEDGE_LAUNCHED));
  const prs = [pr(50, "学びの元の仕様: #12", { state: "OPEN" })];
  const first = decide(allClosed({ pullRequests: prs }, { comments }));
  assert.deepEqual(mergeActions(first), [{ kind: "merge-auto", key: "merge-auto:50", spec: 12, pr: 50 }]);
  assert.deepEqual(knowledgeActions(first), []);
  const second = decide(allClosed({ pullRequests: prs, dispatched: first.map((a) => a.key) }, { comments }));
  assert.deepEqual(mergeActions(second), []);
  assert.deepEqual(knowledgeActions(second), []);
});

test("knowledge: dispatched に knowledge:12 があれば出さない", () => {
  assert.deepEqual(knowledgeActions(decide(allClosed({ dispatched: ["knowledge:12"] }))), []);
});

test("knowledge: 仕様ごとに独立して判定する（片方の PR は他方を止めない）", () => {
  const s = allClosed({ pullRequests: [pr(50, "学びの元の仕様: #12")] });
  s.issues.push(
    spec(13, { comments: [byViewer(STARTED), byViewer(FINISHED(0))] }),
    issue(40, { body: "仕様: #13", subIssues: closedSubs(41) }),
    issue(41, { state: "CLOSED" }),
  );
  assert.deepEqual(knowledgeActions(decide(s)), [knowledge(13, [40], [41])]);
});

test("merge-auto: OPEN で未予約の学びの PR があれば、起動マーカーの有無によらず予約だけを出し、knowledge は出さない", () => {
  for (const comments of [[byViewer(STARTED), byViewer(FINISHED(0))], [byViewer(STARTED), byViewer(FINISHED(0)), byViewer(KNOWLEDGE_STARTED)]]) {
    const actions = decide(allClosed({ pullRequests: [pr(50, "学びの元の仕様: #12", { state: "OPEN" })] }, { comments }));
    assert.deepEqual(mergeActions(actions), [{ kind: "merge-auto", key: "merge-auto:50", spec: 12, pr: 50 }]);
    assert.deepEqual(knowledgeActions(actions), []);
  }
});

test("merge-auto: 予約済み・MERGED・CLOSED の PR、または dispatched に key があれば出さない。knowledge:12 だけなら出す", () => {
  for (const over of [{ state: "OPEN", autoMerge: true }, { state: "MERGED" }, { state: "CLOSED" }]) {
    assert.deepEqual(mergeActions(decide(allClosed({ pullRequests: [pr(50, "学びの元の仕様: #12", over)] }))), [], JSON.stringify(over));
  }
  const open = [pr(50, "学びの元の仕様: #12", { state: "OPEN" })];
  assert.deepEqual(mergeActions(decide(allClosed({ pullRequests: open, dispatched: ["merge-auto:50"] }))), []);
  assert.equal(mergeActions(decide(allClosed({ pullRequests: open, dispatched: ["knowledge:12"] }))).length, 1);
});

test("merge-auto: viewer 以外の PR・別の仕様の PR には出さない", () => {
  const others = [pr(50, "学びの元の仕様: #12", { state: "OPEN", author: "someone" }), pr(51, "学びの元の仕様: #13", { state: "OPEN" })];
  assert.deepEqual(mergeActions(decide(allClosed({ pullRequests: others }))), []);
});

test("knowledge: 全部閉じていると takt-sequence は出ず、既存の遷移の出力は変わらない", () => {
  assert.deepEqual(flow(decide(allClosed())), []);
  assert.deepEqual(flow(decide(withParent())), [taktSequence(20, [21, 22])]);
  assert.deepEqual(knowledgeActions(decide(withParent())), []);
});

test("純粋性: knowledge の遷移でも入力を変更せず、同じ入力に同じ出力を返す", () => {
  const s = deepFreeze(allClosed({ pullRequests: [pr(50, "学びの元の仕様: #13")] }));
  const first = decide(s);
  assert.deepEqual(knowledgeActions(first), [knowledge(12, [20], [21, 22])]);
  assert.deepEqual(decide(s), first);
});

// ---- 判断依頼: takt の run が ABORT、または formal-spec の検証が失敗 → 仕様の Discord スレッドへ ----

const APPROVAL_SENDING = "案内役: Discord に承認依頼を送る";
const APPROVAL_SENT = "案内役: Discord に承認依頼を送った（スレッド 555 / メッセージ 777）";
const ABORT_MARKER = (n) => `案内役: Discord に判断依頼を送る（#${n} takt の ABORT）`;
const FSPEC_MARKER = (n) => `案内役: Discord に判断依頼を送る（#${n} formal-spec の検証失敗）`;
const FSPEC_FAILED = "## Formal Spec（takt 0.71.0 の検証器で failed）\n破れた性質: P1\n検証器の作業ディレクトリ: /c/run1";
const FSPEC_PASSED = "## Formal Spec（takt 0.71.0 の検証器で passed）";
const decisions = (actions) => actions.filter((a) => a.kind === "request-decision");
const sentComments = [byViewer(APPROVAL_SENDING), byViewer(APPROVAL_SENT)];
const task = (over = {}) => ({
  issue: 21,
  kind: "failed",
  createdAt: "2026-10-16T10:00:00Z",
  step: "implement",
  error: "blocked",
  worktreePath: "/w/21",
  ...over,
});
// 承認済み・承認依頼送り済み（スレッド 555）の仕様 #12、親 #20、OPEN な sub-issue #21 #22。
const abortWorld = (tasks, { specComments = [], over = {} } = {}) =>
  snapshot(
    [
      spec(12, { comments: [...sentComments, byViewer(STARTED), byViewer(FINISHED(0)), ...specComments] }),
      issue(20, { body: "仕様: #12", subIssues: openSubs(21, 22) }),
      issue(21, { title: "実装A" }),
      issue(22),
    ],
    { taktTasks: tasks, taktIssues: tasks.map((t) => t.issue), ...over },
  );

test("判断依頼(ABORT): 最新のタスクが failed の sub-issue について、仕様のスレッドへ理由とレポートの場所つきで 1 件出す", () => {
  const [a, ...rest] = decisions(decide(abortWorld([task()])));
  assert.equal(rest.length, 0);
  assert.equal(a.kind, "request-decision");
  assert.equal(a.spec, 12);
  assert.equal(a.issue, 21);
  assert.equal(a.title, "実装A");
  assert.equal(a.threadId, "555");
  assert.equal(a.reports, "/w/21/.takt/runs");
  assert.match(a.reason, /ABORT/);
  assert.ok(a.reason.includes("blocked"));
  assert.ok(a.reason.includes("implement"));
  assert.equal(typeof a.key, "string");
});

test("判断依頼(ABORT): 古い failed の後に新しいタスクがあれば出さない。exceeded / pr_failed / running / completed も出さない", () => {
  assert.deepEqual(
    decisions(decide(abortWorld([task(), task({ kind: "running", createdAt: "2026-10-16T11:00:00Z" })]))),
    [],
  );
  for (const kind of ["exceeded", "pr_failed", "running", "completed", "pending"]) {
    assert.deepEqual(decisions(decide(abortWorld([task({ kind, issue: 22 })]))), [], kind);
  }
});

test("判断依頼(ABORT): タスクの並び順に依らず createdAt が最も新しいもので判定する", () => {
  const newestFailed = [task({ kind: "running", createdAt: "2026-10-16T09:00:00Z" }), task({ createdAt: "2026-10-16T12:00:00Z" })];
  assert.equal(decisions(decide(abortWorld(newestFailed))).length, 1);
  assert.equal(decisions(decide(abortWorld([...newestFailed].reverse()))).length, 1);
});

test("判断依頼(ABORT): 閉じた sub-issue・仕様の sub-issue でない issue のタスクでは出さない", () => {
  const w = abortWorld([task({ issue: 99 })]);
  assert.deepEqual(decisions(decide(w)), []);
  const closed = abortWorld([task()]);
  closed.issues.find((i) => i.number === 21).state = "CLOSED";
  closed.issues.find((i) => i.number === 20).subIssues = [{ number: 21, state: "CLOSED" }, { number: 22, state: "OPEN" }];
  assert.deepEqual(decisions(decide(closed)), []);
});

test("判断依頼(ABORT): 未承認の仕様、承認依頼のスレッドが無い仕様、閉じた仕様には出さない", () => {
  const unapproved = abortWorld([task()]);
  unapproved.issues.find((i) => i.number === 12).labels = ["spec"];
  assert.deepEqual(decisions(decide(unapproved)), []);
  const noThread = abortWorld([task()]);
  noThread.issues.find((i) => i.number === 12).comments = [byViewer(STARTED), byViewer(FINISHED(0))];
  assert.deepEqual(decisions(decide(noThread)), []);
  const closed = abortWorld([task()]);
  closed.issues.find((i) => i.number === 12).state = "CLOSED";
  assert.deepEqual(decisions(decide(closed)), []);
});

test("判断依頼(ABORT): step・error・worktree の記録が無くても出し、無い項目で壊れない", () => {
  const [a] = decisions(decide(abortWorld([task({ step: undefined, error: undefined, worktreePath: undefined })])));
  assert.equal(a.issue, 21);
  assert.match(a.reason, /ABORT/);
  assert.ok(!a.reason.includes("undefined"));
  assert.equal(typeof a.reports, "string");
  assert.ok(a.reports.length > 0 && !a.reports.includes("undefined"));
});

test("判断依頼(ABORT): 複数の sub-issue が止まっていれば番号の昇順で 1 件ずつ出し、key は互いに異なる", () => {
  const as = decisions(decide(abortWorld([task({ issue: 22, worktreePath: "/w/22" }), task()])));
  assert.deepEqual(as.map((a) => a.issue), [21, 22]);
  assert.equal(new Set(as.map((a) => a.key)).size, 2);
});

test("判断依頼(検証失敗): 最後の Formal Spec 見出しが failed なら仕様自身について出し、レポートの場所は検証器の作業ディレクトリ", () => {
  const s = snapshot([issue(12, { labels: ["spec"], comments: [...sentComments, byViewer(FSPEC_FAILED)] })]);
  const [a, ...rest] = decisions(decide(s));
  assert.equal(rest.length, 0);
  assert.equal(a.spec, 12);
  assert.equal(a.issue, 12);
  assert.equal(a.threadId, "555");
  assert.equal(a.reports, "/c/run1");
  assert.match(a.reason, /formal-spec|Formal Spec|検証/);
});

test("判断依頼(検証失敗): 承認済みの仕様でも出す", () => {
  const s = snapshot([spec(12, { comments: [...sentComments, byViewer(STARTED), byViewer(FINISHED(0)), byViewer(FSPEC_FAILED)] })]);
  assert.equal(decisions(decide(s)).filter((a) => a.issue === 12).length, 1);
});

test("判断依頼(検証失敗): 1 行目が見出しでない・他人が書いた・passed で上書きされた場合は出さない", () => {
  const withComments = (...comments) => decide(snapshot([issue(12, { labels: ["spec"], comments: [...sentComments, ...comments] })]));
  assert.deepEqual(decisions(withComments(byViewer("前回は\n## Formal Spec（takt 0.71.0 の検証器で failed）"))), []);
  assert.deepEqual(decisions(withComments({ author: "someone", body: FSPEC_FAILED })), []);
  assert.deepEqual(decisions(withComments(byViewer(FSPEC_FAILED), byViewer(FSPEC_PASSED))), []);
  assert.equal(decisions(withComments(byViewer(FSPEC_PASSED), byViewer(FSPEC_FAILED))).length, 1);
});

test("判断依頼(検証失敗): 承認依頼のスレッドが無い仕様、閉じた仕様には出さない", () => {
  const noThread = snapshot([issue(12, { labels: ["spec"], comments: [byViewer(FSPEC_FAILED)] })]);
  assert.deepEqual(decisions(decide(noThread)), []);
  const closed = snapshot([issue(12, { labels: ["spec"], state: "CLOSED", comments: [...sentComments, byViewer(FSPEC_FAILED)] })]);
  assert.deepEqual(decisions(decide(closed)), []);
});

test("判断依頼: 送り済みのマーカーが仕様にあれば、空の dispatched でも二度出さない（ABORT）", () => {
  const w = abortWorld([task()], { specComments: [byViewer(ABORT_MARKER(21))] });
  assert.deepEqual(decisions(decide(w)), []);
});

test("判断依頼: 送り済みのマーカーが仕様にあれば、空の dispatched でも二度出さない（検証失敗）", () => {
  const s = snapshot([issue(12, { labels: ["spec"], comments: [...sentComments, byViewer(FSPEC_FAILED), byViewer(FSPEC_MARKER(12))] })]);
  assert.deepEqual(decisions(decide(s)), []);
});

test("判断依頼: 同じ周の dispatched に key があれば出さない", () => {
  const [a] = decisions(decide(abortWorld([task()])));
  assert.deepEqual(decisions(decide(abortWorld([task()], { over: { dispatched: [a.key] } }))), []);
});

test("判断依頼: マーカーは番号の前方一致で別の issue と混同しない（#2 のマーカーで #21 を止めない）", () => {
  const w = abortWorld([task()], { specComments: [byViewer(ABORT_MARKER(2))] });
  assert.deepEqual(decisions(decide(w)).map((a) => a.issue), [21]);
});

test("判断依頼: マーカーは原因ごとに別で、viewer 以外が書いたマーカーでは止まらない", () => {
  const otherCause = abortWorld([task()], { specComments: [byViewer(FSPEC_MARKER(21))] });
  assert.deepEqual(decisions(decide(otherCause)).map((a) => a.issue), [21]);
  const stranger = abortWorld([task()], { specComments: [{ author: "someone", body: ABORT_MARKER(21) }] });
  assert.deepEqual(decisions(decide(stranger)).map((a) => a.issue), [21]);
});

test("判断依頼: 止まっていない仕様の流れ（takt-sequence など）の判定は変えない", () => {
  const s = withParent({ taktTasks: [] });
  assert.deepEqual(decisions(decide(s)), []);
  assert.deepEqual(flow(decide(s)), [taktSequence(20, [21, 22])]);
});

// ---- 扱う仕様の範囲（fromSpec）: 既存の仕様が多い repo に向けるとき、番号がそれ以上の仕様だけを流す ----

test("fromSpec: 範囲の外の仕様には、承認依頼・to-tickets・takt-sequence・学び・判断依頼のどれも出さない", () => {
  const from = { fromSpec: 13, discordUserId: OWNER };
  assert.deepEqual(decide(withOwner([pending(12)], from)), []);
  assert.deepEqual(decide(snapshot([spec(12, { comments: sentComments })], from)), []);
  assert.deepEqual(decide(withParent({ ...from })), []);
  assert.deepEqual(decide(abortWorld([task()], { over: from })), []);
  const allClosed = snapshot(
    [spec(12, { comments: [...sentComments, byViewer(STARTED), byViewer(FINISHED(0))] }), issue(20, { body: "仕様: #12", subIssues: closedSubs(21) })],
    from,
  );
  assert.deepEqual(decide(allClosed), []);
});

test("fromSpec: 境界の番号の仕様は扱い、範囲の内と外が混ざれば内だけに出す", () => {
  const s = withOwner([pending(12), pending(13), pending(14)], { fromSpec: 13 });
  assert.deepEqual(decide(s), [requestApproval(13), requestApproval(14)]);
});

test("fromSpec: 範囲の外の仕様の親も takt に渡さず、範囲の内の仕様の流れは変えない", () => {
  const s = snapshot(
    [
      spec(12),
      issue(20, { body: "仕様: #12", subIssues: openSubs(21) }),
      spec(30, { comments: [byViewer(STARTED), byViewer(FINISHED(0))] }),
      issue(40, { body: "仕様: #30", subIssues: openSubs(41) }),
    ],
    { fromSpec: 30 },
  );
  assert.deepEqual(flow(decide(s)), [taktSequence(40, [41])]);
});

test("fromSpec: 指定が無ければ、すべての OPEN な仕様を扱う", () => {
  assert.deepEqual(decide(withOwner([pending(12), pending(13)])), [requestApproval(12), requestApproval(13)]);
});

// ---- 起動したセッションの停止: 結果が GitHub に無いまま止まったら、承認依頼のスレッドへ判断依頼 ----

const SENT_ALL = [byViewer("案内役: Discord に承認依頼を送る"), byViewer("案内役: Discord に承認依頼を送った（スレッド 555 / メッセージ 777）")];
const T0 = "2026-10-17T00:00:00.000Z";
const at = (minutes) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();
const STALL_CAUSE = (step) => `${step} のセッションの停止`;
const stallMarker = (n, step) => decisionMarker(n, STALL_CAUSE(step));
const obs = (over = {}) => ({ found: true, waiting: false, idle: false, startedAt: T0, tail: ["line1", "line2"], ...over });
const stalls = (actions) => actions.filter((a) => a.kind === "request-decision" && String(a.cause).endsWith("のセッションの停止"));

// to-tickets を handle つきで起動済み、結果（親 issue）はまだ無い仕様 #12
const stallWorld = ({ comments = [], sessions = { term_1: obs() }, now = at(1), over = {}, specOver = {}, extra = [] } = {}) =>
  snapshot(
    [spec(12, { title: "仕様A", comments: [...SENT_ALL, byViewer("案内役: to-tickets を起動する"), byViewer(LAUNCHED), ...comments], ...specOver }), ...extra],
    { sessions, now, ...over },
  );

test("停止: 結果が無く入力待ち（waiting）なら 1 件。送り先は承認依頼のスレッド、タブは工程と仕様の番号、画面の数行と理由つき", () => {
  const [a, ...rest] = stalls(decide(stallWorld({ sessions: { term_1: obs({ waiting: true }) } })));
  assert.deepEqual(rest, []);
  assert.equal(a.kind, "request-decision");
  assert.equal(a.spec, 12);
  assert.equal(a.issue, 12);
  assert.equal(a.cause, STALL_CAUSE("to-tickets"));
  assert.equal(a.threadId, "555");
  assert.equal(a.step, "to-tickets");
  assert.equal(a.tab, "to-tickets #12");
  assert.deepEqual(a.tail, ["line1", "line2"]);
  assert.match(a.reason, /入力待ち/);
});

test("停止: 手が止まっている（idle）だけでは出さない（条件は入力待ち・見つからない・時間切れの 3 つだけ）", () => {
  assert.deepEqual(stalls(decide(stallWorld({ sessions: { term_1: obs({ idle: true }) } }))), []);
  assert.deepEqual(stalls(decide(stallWorld({ sessions: { term_1: obs() } }))), []);
});

test("停止: 結果が無く handle のセッションが見つからない（found: false）なら、時刻によらず 1 件", () => {
  const [a, ...rest] = stalls(decide(stallWorld({ sessions: { term_1: obs({ found: false, waiting: false, tail: [] }) }, now: at(1) })));
  assert.deepEqual(rest, []);
  assert.match(a.reason, /見つから/);
  assert.equal(a.tab, "to-tickets #12");
});

test("停止: 時間切れは既定 60 分。60 分で 1 件、59 分では 0 件（判定は snapshot.now を使い、時計を読まない）", () => {
  const [a, ...rest] = stalls(decide(stallWorld({ now: at(60) })));
  assert.deepEqual(rest, []);
  assert.match(a.reason, /60/);
  assert.deepEqual(stalls(decide(stallWorld({ now: at(59) }))), []);
});

test("停止: stallMinutes の指定で時間が変わる（30 分指定なら 30 分で 1 件、29 分で 0 件）", () => {
  assert.equal(stalls(decide(stallWorld({ now: at(30), over: { stallMinutes: 30 } }))).length, 1);
  assert.deepEqual(stalls(decide(stallWorld({ now: at(29), over: { stallMinutes: 30 } }))), []);
  assert.deepEqual(stalls(decide(stallWorld({ now: at(60), over: { stallMinutes: 120 } }))), []);
});

test("停止: 起動時刻は印のコメントから読む（観測の startedAt ではなく印の時刻で時間切れを判定する）", () => {
  const w = stallWorld({ sessions: { term_1: obs({ startedAt: at(1000) }) }, now: at(60) });
  assert.equal(stalls(decide(w)).length, 1);
});

test("停止: 印の時刻が解析できなければ時間切れにしない（入力待ち・見つからないは効く）", () => {
  const broken = { author: VIEWER, body: "案内役: to-tickets を起動した（ターミナル term_1 / いつか）" };
  const w = (sessions) => snapshot([spec(12, { comments: [...SENT_ALL, broken] })], { sessions, now: at(9999) });
  assert.deepEqual(stalls(decide(w({ term_1: obs() }))), []);
  assert.equal(stalls(decide(w({ term_1: obs({ waiting: true }) }))).length, 1);
});

test("停止: 理由は 1 つだけ選び、見つからない → 入力待ち → 時間切れの順に優先する（行動は常に 1 件）", () => {
  const all = stallWorld({ sessions: { term_1: obs({ found: false, waiting: true }) }, now: at(500) });
  const [a, ...rest] = stalls(decide(all));
  assert.deepEqual(rest, []);
  assert.match(a.reason, /見つから/);
  const wt = stalls(decide(stallWorld({ sessions: { term_1: obs({ waiting: true }) }, now: at(500) })));
  assert.equal(wt.length, 1);
  assert.match(wt[0].reason, /入力待ち/);
});

test("停止: 結果が GitHub にあれば、観測が見つからない・入力待ち・時間切れでも出さない（to-tickets は親 issue）", () => {
  const parent = issue(20, { body: "仕様: #12", subIssues: openSubs(21) });
  const bad = obs({ found: false, waiting: true });
  assert.deepEqual(stalls(decide(stallWorld({ sessions: { term_1: bad }, now: at(999), extra: [parent, issue(21)] }))), []);
});

test("停止: 結果の判定は工程ごと（to-tickets に学びの PR や Formal Spec は結果にならない）", () => {
  const pr = [{ number: 50, state: "OPEN", author: VIEWER, body: "学びの元の仕様: #12", autoMerge: true }];
  const w = stallWorld({ sessions: { term_1: obs({ waiting: true }) }, over: { pullRequests: pr }, comments: [byViewer("## Formal Spec（takt 0.71.0 の検証器で passed）")] });
  assert.equal(stalls(decide(w)).length, 1);
});

test("停止: 汎用 — handle つきの knowledge の印は、学びの PR が無ければ出し、viewer の PR があれば出さない", () => {
  const mark = byViewer("案内役: knowledge を起動した（ターミナル term_k / " + T0 + "）");
  const w = (over) => snapshot([spec(12, { comments: [...SENT_ALL, mark] })], { sessions: { term_k: obs({ waiting: true }) }, now: at(1), ...over });
  const [a, ...rest] = stalls(decide(w()));
  assert.deepEqual(rest, []);
  assert.equal(a.cause, STALL_CAUSE("knowledge"));
  assert.equal(a.tab, "knowledge #12");
  const pr = [{ number: 50, state: "OPEN", author: VIEWER, body: "学びの元の仕様: #12", autoMerge: true }];
  assert.deepEqual(stalls(decide(w({ pullRequests: pr }))), []);
  const stranger = [{ number: 50, state: "OPEN", author: "someone", body: "学びの元の仕様: #12" }];
  assert.equal(stalls(decide(w({ pullRequests: stranger }))).length, 1);
});

test("停止: 汎用 — handle つきの formal-spec の印は、viewer の Formal Spec コメントが無ければ出し、あれば（failed でも）この原因では出さない", () => {
  const mark = byViewer("案内役: formal-spec を起動した（ターミナル term_f / " + T0 + "）");
  const w = (extra = []) => snapshot([specBare(12, { comments: [...SENT_ALL, mark, ...extra] })], { sessions: { term_f: obs({ found: false }) }, now: at(1) });
  const [a, ...rest] = stalls(decide(w()));
  assert.deepEqual(rest, []);
  assert.equal(a.cause, STALL_CAUSE("formal-spec"));
  assert.equal(a.tab, "formal-spec #12");
  assert.deepEqual(stalls(decide(w([byViewer("## Formal Spec（takt 0.71.0 の検証器で passed）")]))), []);
  assert.deepEqual(stalls(decide(w([{ author: "someone", body: "## Formal Spec（takt 0.71.0 の検証器で passed）" }]))).length, 1);
});

test("停止: 結果の判定表に無い工程は観測しない", () => {
  const mark = byViewer("案内役: unknown-step を起動した（ターミナル term_u / " + T0 + "）");
  const s = snapshot([spec(12, { comments: [...SENT_ALL, mark] })], { sessions: { term_u: obs({ found: false }) }, now: at(9999) });
  assert.deepEqual(sessionsToObserve(s), []);
  assert.deepEqual(stalls(decide(s)), []);
});

test("停止: マーカーがあれば再送しない。マーカーは工程ごとに区別できる（別の工程のマーカーでは止まらない）", () => {
  const sessions = { term_1: obs({ waiting: true }) };
  assert.equal(stallMarker(12, "to-tickets"), "案内役: Discord に判断依頼を送る（#12 to-tickets のセッションの停止）");
  assert.deepEqual(stalls(decide(stallWorld({ sessions, comments: [byViewer(stallMarker(12, "to-tickets"))] }))), []);
  assert.equal(stalls(decide(stallWorld({ sessions, comments: [byViewer(stallMarker(12, "knowledge"))] }))).length, 1);
  assert.equal(stalls(decide(stallWorld({ sessions, comments: [{ author: "someone", body: stallMarker(12, "to-tickets") }] }))).length, 1);
  assert.equal(stalls(decide(stallWorld({ sessions, comments: [byViewer(decisionMarker(12, "formal-spec の検証失敗"))] }))).length, 1);
});

test("停止: 同じスナップショットで 2 周しても二重に出さない（dispatched の key で止まる）", () => {
  const sessions = { term_1: obs({ waiting: true }) };
  const [a] = stalls(decide(stallWorld({ sessions })));
  assert.deepEqual(stalls(decide(stallWorld({ sessions, over: { dispatched: [a.key] } }))), []);
  assert.equal(stalls(decide(stallWorld({ sessions }))).map((x) => x.key)[0], a.key);
});

test("停止: handle の無い印（古い to-tickets・handle なしの knowledge）は観測しない。判断依頼 0 件、sessionsToObserve にも出ない", () => {
  for (const legacy of [STARTED, "案内役: knowledge を起動した", FINISHED(0)]) {
    const s = snapshot([spec(12, { comments: [...SENT_ALL, byViewer(legacy)] })], { sessions: {}, now: at(9999) });
    assert.deepEqual(sessionsToObserve(s), [], legacy);
    assert.deepEqual(stalls(decide(s)), [], legacy);
  }
});

test("停止: 範囲 — 承認依頼のスレッドが無い・閉じた・fromSpec の範囲外・viewer 以外の印の仕様には出さない", () => {
  const sessions = { term_1: obs({ waiting: true }) };
  const mk = (specOver, over) => snapshot([spec(12, { comments: [...SENT_ALL, byViewer(LAUNCHED)], ...specOver })], { sessions, now: at(1), ...over });
  assert.equal(stalls(decide(mk({}))).length, 1);
  assert.deepEqual(stalls(decide(snapshot([spec(12, { comments: [byViewer("案内役: Discord に承認依頼を送る"), byViewer(LAUNCHED)] })], { sessions, now: at(1) }))), []);
  assert.deepEqual(stalls(decide(mk({ state: "CLOSED" }))), []);
  assert.deepEqual(stalls(decide(mk({}, { fromSpec: 13 }))), []);
  assert.deepEqual(stalls(decide(mk({ comments: [...SENT_ALL, { author: "someone", body: LAUNCHED }] }))), []);
});

test("停止: 観測が無い（sessions に handle が無い）なら何も出さない", () => {
  assert.deepEqual(stalls(decide(stallWorld({ sessions: {} }))), []);
});

test("停止: 同じ工程の印が複数あれば最後の印の handle を観測する", () => {
  const second = byViewer(launchedMarker("to-tickets", "term_2", at(10)));
  const s = stallWorld({ comments: [second], sessions: { term_2: obs({ waiting: true }) }, now: at(20) });
  assert.deepEqual(sessionsToObserve(s), [{ spec: 12, step: "to-tickets", handle: "term_2", startedAt: at(10) }]);
  assert.equal(stalls(decide(s)).length, 1);
});

test("sessionsToObserve: 結果が出た工程・マーカー送り済みの工程は含めず、起動の印の handle と時刻を返す", () => {
  assert.deepEqual(sessionsToObserve(stallWorld()), [{ spec: 12, step: "to-tickets", handle: "term_1", startedAt: T0 }]);
  const parent = issue(20, { body: "仕様: #12", subIssues: openSubs(21) });
  assert.deepEqual(sessionsToObserve(stallWorld({ extra: [parent, issue(21)] })), []);
  assert.deepEqual(sessionsToObserve(stallWorld({ comments: [byViewer(stallMarker(12, "to-tickets"))] })), []);
});

test("launchedMarker / tabTitle: 起動の印は handle と時刻を持ち、to-tickets の既存の印と同じ形。タブ名は工程と仕様の番号", () => {
  assert.equal(launchedMarker("to-tickets", "term_1", T0), LAUNCHED);
  assert.equal(launchedMarker("knowledge", "t", T0), `案内役: knowledge を起動した（ターミナル t / ${T0}）`);
  assert.equal(tabTitle("to-tickets", 12), "to-tickets #12");
});

// ---- formal-spec: 承認依頼を送った仕様に毎回起動し、結果が出るまで to-tickets を待つ ----

const FS_LAUNCHED = "案内役: formal-spec を起動した（ターミナル term_f / 2026-10-17T00:00:00.000Z）";
const FS_FAILED = "## Formal Spec（takt 0.71.0 の検証器で failed）\n破れた性質: P1\n検証器の作業ディレクトリ: /c/run1";
const FS_NA = "## Formal Spec（対象外）\n状態遷移を持たない文書の変更だけ。";
const formalSpec = (n) => ({ kind: "formal-spec", key: `formal-spec:${n}`, spec: n });
const formalSpecs = (actions) => actions.filter((a) => a.kind === "formal-spec");
// 承認依頼は送り済み。comments は送った印の後ろに足す。formal-spec の印も結果も無い仕様（基準の状態）
const sentSpec = (n, { comments = [], ...over } = {}) => specBare(n, { comments: [byViewer(SENDING), byViewer(SENT()), ...comments], ...over });

test("formal-spec 起動: 承認依頼を送った仕様で、起動の印が無ければ出す（承認済みでも未承認でも）", () => {
  assert.deepEqual(formalSpecs(decide(snapshot([sentSpec(12)]))), [formalSpec(12)]);
  assert.deepEqual(formalSpecs(decide(snapshot([sentSpec(12, { labels: ["spec"] })]))), [formalSpec(12)]);
});

test("formal-spec 起動: 他人の印と viewer の引用の印は数えず、出す", () => {
  const comments = [{ author: "someone", body: FS_LAUNCHING }, { author: "someone", body: FS_LAUNCHED }, byViewer(`> ${FS_LAUNCHING}`), byViewer(`> ${FS_LAUNCHED}`)];
  assert.deepEqual(formalSpecs(decide(snapshot([sentSpec(12, { comments })]))), [formalSpec(12)]);
});

test("formal-spec 起動: 承認依頼を送る前（「送った」の印が無い）は出さない", () => {
  assert.deepEqual(formalSpecs(decide(snapshot([specBare(12)]))), []);
  assert.deepEqual(formalSpecs(decide(snapshot([specBare(12, { comments: [byViewer(SENDING)] })]))), []);
  assert.deepEqual(formalSpecs(decide(snapshot([specBare(12, { comments: [byViewer(SENDING), { author: "someone", body: SENT() }] })]))), []);
});

test("formal-spec 起動: viewer の起動前の印、または起動後の印があれば出さない（起動の成否が不明でも二重に起動しない）", () => {
  assert.deepEqual(formalSpecs(decide(snapshot([sentSpec(12, { comments: [byViewer(FS_LAUNCHING)] })]))), []);
  assert.deepEqual(formalSpecs(decide(snapshot([sentSpec(12, { comments: [byViewer(FS_LAUNCHING), byViewer(FS_LAUNCHED)] })]))), []);
});

test("formal-spec 起動: 結果の Formal Spec コメントだけがあり起動の印が無い仕様にも出す（出すかどうかは印で決める）", () => {
  assert.deepEqual(formalSpecs(decide(snapshot([sentSpec(12, { comments: [byViewer(FS_PASSED)] })]))), [formalSpec(12)]);
});

test("formal-spec 起動: fromSpec の範囲外・CLOSED の仕様には出さず、範囲内には出す", () => {
  const s = snapshot([sentSpec(11), sentSpec(12), sentSpec(13, { state: "CLOSED" })], { fromSpec: 12 });
  assert.deepEqual(formalSpecs(decide(s)), [formalSpec(12)]);
});

test("formal-spec 起動: spec ラベルが無い issue には出さない", () => {
  assert.deepEqual(formalSpecs(decide(snapshot([issue(12, { labels: [], comments: [byViewer(SENDING), byViewer(SENT())] })]))), []);
});

test("formal-spec 起動: 複数の仕様には仕様番号の昇順で出し、印のある仕様は飛ばす", () => {
  const s = snapshot([sentSpec(30), sentSpec(20, { comments: [byViewer(FS_LAUNCHING)] }), sentSpec(12)]);
  assert.deepEqual(formalSpecs(decide(s)), [formalSpec(12), formalSpec(30)]);
});

test("formal-spec 起動: to-tickets を起動済みの古い仕様（起動前の印・起動後の印・handle なしの印・終了の印）には出さず、to-tickets の条件も変えない", () => {
  const oldMarks = [[LAUNCHING], [LAUNCHING, LAUNCHED], [STARTED], [STARTED, FINISHED(0)], [STARTED, FINISHED(1)], [FINISHED(0)]];
  for (const marks of oldMarks) {
    const actions = decide(snapshot([sentSpec(12, { comments: marks.map(byViewer) })]));
    assert.deepEqual(formalSpecs(actions), [], marks.join(" / "));
    assert.deepEqual(flow(actions), [], `${marks.join(" / ")}: to-tickets は印があれば従来どおり出ない`);
  }
});

test("formal-spec 起動: 古い仕様の takt-sequence は従来どおり（exit 0 なら渡し、exit 1 や古い起動の印だけなら渡さない）。Formal Spec コメントは要らない", () => {
  const withMarks = (marks) => snapshot([
    sentSpec(12, { comments: marks.map(byViewer) }),
    issue(20, { body: "仕様: #12", subIssues: openSubs(21, 22) }),
  ]);
  assert.deepEqual(flow(decide(withMarks([STARTED, FINISHED(0)]))), [taktSequence(20, [21, 22])]);
  assert.deepEqual(flow(decide(withMarks([STARTED, FINISHED(1)]))), []);
  assert.deepEqual(flow(decide(withMarks([STARTED]))), []);
  assert.deepEqual(flow(decide(withMarks([LAUNCHING, LAUNCHED]))), [taktSequence(20, [21, 22])]);
});

test("formal-spec 起動: 同じスナップショットで 2 周しても二重に出さない", () => {
  const s = snapshot([sentSpec(12), sentSpec(13)]);
  const first = formalSpecs(decide(s));
  assert.deepEqual(first, [formalSpec(12), formalSpec(13)]);
  assert.deepEqual(formalSpecs(decide({ ...s, dispatched: first.map((a) => a.key) })), []);
  assert.deepEqual(formalSpecs(decide({ ...s, dispatched: ["formal-spec:12"] })), [formalSpec(13)]);
});

test("formal-spec 起動: 承認の✅は formal-spec の実行中（起動の印のみで結果が無い）でも受け付けて approve-spec を出す", () => {
  const s = withOwner([sentSpec(12, { labels: ["spec"], reactions: [react("✅")], comments: [byViewer(FS_LAUNCHING), byViewer(FS_LAUNCHED)] })]);
  assert.deepEqual(decide(s), [approveSpec(12)]);
});

// ---- to-tickets の条件: viewer の最後の Formal Spec コメントが passed か対象外 ----

const ttWith = (...fsBodies) => snapshot([sentSpec(12, { comments: [byViewer(FS_LAUNCHING), ...fsBodies] })]);

test("to-tickets の条件: Formal Spec コメントがまだ無ければ、承認済みでも出さない", () => {
  assert.deepEqual(flow(decide(ttWith())), []);
  assert.deepEqual(flow(decide(snapshot([specBare(12)]))), []);
});

test("to-tickets の条件: 最後の Formal Spec コメントが passed なら出す", () => {
  assert.deepEqual(flow(decide(ttWith(byViewer(FS_PASSED)))), [toTickets(12)]);
});

test("to-tickets の条件: 最後の Formal Spec コメントが対象外（2 行目以降に理由）でも出す", () => {
  assert.deepEqual(flow(decide(ttWith(byViewer(FS_NA)))), [toTickets(12)]);
  assert.deepEqual(flow(decide(ttWith(byViewer("## Formal Spec（対象外）")))), [toTickets(12)]);
});

test("to-tickets の条件: 最後が failed なら出さない（判断依頼は既存の遷移が送る）", () => {
  const actions = decide(ttWith(byViewer(FS_FAILED)));
  assert.deepEqual(flow(actions), []);
  const [d, ...rest] = actions.filter((a) => a.kind === "request-decision");
  assert.deepEqual(rest, []);
  assert.equal(d.cause, "formal-spec の検証失敗");
  assert.equal(d.reports, "/c/run1");
});

test("to-tickets の条件: failed の後に passed へ書き換わったら（同じコメントの本文が変わったら）出す", () => {
  const s = ttWith(byViewer(FS_FAILED));
  assert.deepEqual(flow(decide(s)), []);
  s.issues[0].comments.at(-1).body = FS_PASSED;
  assert.deepEqual(flow(decide(s)), [toTickets(12)]);
});

test("to-tickets の条件: failed の後に対象外へ書き換わっても出す", () => {
  const s = ttWith(byViewer(FS_FAILED));
  s.issues[0].comments.at(-1).body = FS_NA;
  assert.deepEqual(flow(decide(s)), [toTickets(12)]);
});

test("to-tickets の条件: 古い passed があっても最後が failed なら出さない（最後だけを見る）", () => {
  assert.deepEqual(flow(decide(ttWith(byViewer(FS_PASSED), byViewer(FS_FAILED)))), []);
});

test("to-tickets の条件: 古い failed があっても最後が passed なら出す", () => {
  assert.deepEqual(flow(decide(ttWith(byViewer(FS_FAILED), byViewer(FS_PASSED)))), [toTickets(12)]);
});

test("to-tickets の条件: 1 行目以外の passed・他人のコメント・viewer の引用は数えず、出さない", () => {
  const s = ttWith(
    byViewer(`メモ\n${FS_PASSED}`),
    { author: "someone", body: FS_PASSED },
    byViewer(`> ${FS_PASSED}`),
    { author: "someone", body: FS_NA },
  );
  assert.deepEqual(flow(decide(s)), []);
});

test("to-tickets の条件: passed でも対象外でも failed でもない Formal Spec コメントでは出さない", () => {
  assert.deepEqual(flow(decide(ttWith(byViewer("## Formal Spec（takt 0.71.0 の検証器で error）")))), []);
  assert.deepEqual(flow(decide(ttWith(byViewer("## Formal Spec（対象外の理由を確認中）")))), []);
});

test("to-tickets の条件: 他人の passed が最後にあっても、viewer の最後が failed なら出さない", () => {
  assert.deepEqual(flow(decide(ttWith(byViewer(FS_FAILED), { author: "someone", body: FS_PASSED }))), []);
});

test("to-tickets の条件: 条件が揃った後の dispatched で 2 周しても二重に出さない", () => {
  const s = ttWith(byViewer(FS_PASSED));
  const first = flow(decide(s));
  assert.deepEqual(first, [toTickets(12)]);
  assert.deepEqual(flow(decide({ ...s, dispatched: first.map((a) => a.key) })), []);
});

test("to-tickets の条件: 未承認の仕様は passed でも出さない（承認の条件は変わらない）", () => {
  assert.deepEqual(flow(decide(snapshot([sentSpec(12, { labels: ["spec"], comments: [byViewer(FS_LAUNCHING), byViewer(FS_PASSED)] })]))), []);
});

test("to-tickets の条件: 親ができた後の takt-sequence には Formal Spec の条件を掛けない（人が作った親の受け渡し）", () => {
  const s = snapshot([sentSpec(12), issue(20, { body: "仕様: #12", subIssues: openSubs(21) })]);
  assert.deepEqual(flow(decide(s)), [taktSequence(20, [21])]);
});

// ---- takt-sequence の停止: タブが消えたか、sub-issue が残ったまま終わったら、承認依頼のスレッドへ判断依頼 ----

const SEQ_CAUSE = "takt-sequence のセッションの停止";
const SEQ_LAUNCHED = (handle = "term_s") => launchedMarker("takt-sequence", handle, T0);
const seqStalls = (actions) => actions.filter((a) => a.kind === "request-decision" && a.cause === SEQ_CAUSE);

// 仕様 #12 の親 #20 を takt-sequence に渡して起動済み（handle term_s）。#21 は閉じ、#22 #23 が open のまま。
const seqWorld = ({ parentComments = [byViewer(HANDED(21, 22, 23)), byViewer(SEQ_LAUNCHED())], subs, specComments = [], sessions = { term_s: obs({ tail: ["…", `${SEQUENCE_DONE}（exit 0）`, "$"] }) }, over = {} } = {}) =>
  snapshot(
    [
      spec(12, { comments: [...SENT_ALL, ...specComments] }),
      issue(20, { title: "親A", body: "仕様: #12", comments: parentComments, subIssues: subs ?? [{ number: 21, state: "CLOSED" }, ...openSubs(22, 23)] }),
      issue(21, { state: "CLOSED" }),
      issue(22),
      issue(23),
    ],
    { repo: REPO, sessions, now: at(1), ...over },
  );

test("takt-sequence の停止: タブが Orca に見つからなければ 1 件。issue は親、送り先は承認依頼のスレッド、タブは takt-sequence の題名", () => {
  const [a, ...rest] = seqStalls(decide(seqWorld({ sessions: { term_s: obs({ found: false, tail: [] }) } })));
  assert.deepEqual(rest, []);
  assert.equal(a.spec, 12);
  assert.equal(a.issue, 20);
  assert.equal(a.title, "親A");
  assert.equal(a.threadId, "555");
  assert.equal(a.step, "takt-sequence");
  assert.equal(a.tab, `takt sequence ${REPO}`);
  assert.equal(a.key, `request-decision:12:20:${SEQ_CAUSE}`);
  assert.match(a.reason, /見つから/);
  assert.match(a.reason, /#22 #23/);
});

test("takt-sequence の停止: 終わりの行が画面にあり、open な sub-issue が残っていれば 1 件。画面の数行つき", () => {
  const [a, ...rest] = seqStalls(decide(seqWorld()));
  assert.deepEqual(rest, []);
  assert.match(a.reason, /終わった/);
  assert.deepEqual(a.tail, ["…", `${SEQUENCE_DONE}（exit 0）`, "$"]);
});

test("takt-sequence の停止: 動いている（終わりの行が無い）なら、時間がどれだけ経っても入力待ちでも出さない", () => {
  const running = { term_s: obs({ waiting: true, tail: ["投入: #22"] }) };
  assert.deepEqual(seqStalls(decide(seqWorld({ sessions: running, over: { now: at(9999) } }))), []);
});

test("takt-sequence の停止: open な sub-issue に takt の pending / running があれば出さない（別の takt-sequence が流している）", () => {
  for (const kind of ["pending", "running"]) {
    const tasks = [{ issue: 23, kind, createdAt: T0 }];
    assert.deepEqual(seqStalls(decide(seqWorld({ over: { taktTasks: tasks, taktIssues: [23] } }))), [], kind);
  }
  const done = [{ issue: 23, kind: "completed", createdAt: T0 }];
  assert.equal(seqStalls(decide(seqWorld({ over: { taktTasks: done, taktIssues: [23] } }))).length, 1);
});

test("takt-sequence の停止: open な sub-issue の最新の takt タスクが failed（ABORT）なら出さない（ABORT の判断依頼に任せる）", () => {
  const tasks = [{ issue: 22, kind: "failed", createdAt: T0 }];
  assert.deepEqual(seqStalls(decide(seqWorld({ over: { taktTasks: tasks, taktIssues: [22] } }))), []);
});

test("takt-sequence の停止: 渡した sub-issue がすべて閉じていれば観測もせず出さない", () => {
  const s = seqWorld({ subs: [21, 22, 23].map((number) => ({ number, state: "CLOSED" })) });
  assert.deepEqual(sequencesToObserve(s), []);
  assert.deepEqual(seqStalls(decide(s)), []);
});

test("takt-sequence の停止: 渡していない sub-issue（後から足したもの）だけが open なら出さない", () => {
  const s = seqWorld({ subs: [{ number: 21, state: "CLOSED" }, { number: 22, state: "CLOSED" }, { number: 23, state: "CLOSED" }, ...openSubs(24)] });
  assert.deepEqual(seqStalls(decide(s)), []);
});

test("takt-sequence の停止: 古い形（handle の起動の印が無い）の親は観測も判断依頼もせず、二重に渡しもしない", () => {
  const s = seqWorld({ parentComments: [byViewer(HANDED(21, 22, 23))], sessions: {} });
  assert.deepEqual(sequencesToObserve(s), []);
  assert.deepEqual(seqStalls(decide(s)), []);
  assert.deepEqual(flow(decide(s)), []);
});

test("takt-sequence の停止: 判断依頼の印が仕様にあれば再送せず、観測もしない", () => {
  const s = seqWorld({ specComments: [byViewer(decisionMarker(20, SEQ_CAUSE))] });
  assert.deepEqual(sequencesToObserve(s), []);
  assert.deepEqual(seqStalls(decide(s)), []);
});

test("takt-sequence の停止: 同じスナップショットで 2 周しても二重に出さない（dispatched の key で止まる）", () => {
  const [a] = seqStalls(decide(seqWorld()));
  assert.deepEqual(seqStalls(decide(seqWorld({ over: { dispatched: [a.key] } }))), []);
});

test("takt-sequence の停止: 観測が無い・viewer 以外の起動の印・承認依頼のスレッドが無い・fromSpec の範囲外なら出さない", () => {
  assert.deepEqual(seqStalls(decide(seqWorld({ sessions: {} }))), []);
  const other = seqWorld({ parentComments: [byViewer(HANDED(21, 22, 23)), { author: "someone", body: SEQ_LAUNCHED() }] });
  assert.deepEqual(sequencesToObserve(other), []);
  assert.deepEqual(seqStalls(decide(seqWorld({ over: { fromSpec: 13 } }))), []);
  const unsent = snapshot(
    [spec(12), issue(20, { body: "仕様: #12", comments: [byViewer(HANDED(22)), byViewer(SEQ_LAUNCHED())], subIssues: openSubs(22) }), issue(22)],
    { sessions: { term_s: obs({ found: false }) }, now: at(1) },
  );
  assert.deepEqual(seqStalls(decide(unsent)), []);
});

test("sequencesToObserve: 起動の印の handle と時刻、渡したうち open な sub-issue を返す。起動の印が複数あれば最後のもの", () => {
  assert.deepEqual(sequencesToObserve(seqWorld()), [{ spec: 12, parent: 20, issues: [22, 23], handle: "term_s", startedAt: T0 }]);
  const again = seqWorld({ parentComments: [byViewer(HANDED(21, 22, 23)), byViewer(SEQ_LAUNCHED()), byViewer(launchedMarker("takt-sequence", "term_t", at(5)))] });
  assert.deepEqual(sequencesToObserve(again), [{ spec: 12, parent: 20, issues: [22, 23], handle: "term_t", startedAt: at(5) }]);
});

test("takt-sequence の停止: to-tickets などの工程の停止の判定には混ざらない（sessionsToObserve に出ない）", () => {
  assert.deepEqual(sessionsToObserve(seqWorld()), []);
});

test("takt-sequence の停止: 終わりの行は行全体で照合する。起動のコマンド行に含まれる同じ文字列では終わった扱いにしない", () => {
  const commandLine = `$ '/x/takt-node.sh' '/x/takt-sequence.mjs' '22' '23'; echo "${SEQUENCE_DONE}（exit $?）"`;
  assert.deepEqual(seqStalls(decide(seqWorld({ sessions: { term_s: obs({ tail: [commandLine, "投入: #22"] }) } }))), []);
  assert.equal(seqStalls(decide(seqWorld({ sessions: { term_s: obs({ tail: [`  ${SEQUENCE_DONE}（exit 1）  `] }) } }))).length, 1);
});

// ---- wayfinder: open な map の frontier（open・unblocked・未 claim）にある research・grilling・task の ticket ----
const WF_LAUNCHING = "案内役: wayfinder を起動する";
const WF_LAUNCHED = "案内役: wayfinder を起動した（ターミナル term_1 / 2026-10-17T00:00:00.000Z）";
const wfAction = (ticket, type, map = 20) => ({ kind: "wayfinder", key: `wayfinder:${ticket}`, map, ticket, type });
const wfActions = (actions) => actions.filter((a) => a.kind === "wayfinder");
const wfTicket = (number, type, over = {}) =>
  issue(number, { labels: [`wayfinder:${type}`], assignees: [], blockedBy: [], ...over });
const wfWorld = (children, { map = {}, over = {} } = {}) =>
  snapshot(
    [
      issue(20, { labels: ["wayfinder:map"], subIssues: children.map((c) => ({ number: c.number, state: c.state })), ...map }),
      ...children,
    ],
    over,
  );

test("wayfinder: frontier の research・grilling・task それぞれに、map 順で type つきの起動を出す", () => {
  const s = wfWorld([wfTicket(21, "research"), wfTicket(22, "grilling"), wfTicket(23, "task")]);
  assert.deepEqual(wfActions(decide(s)), [wfAction(21, "research"), wfAction(22, "grilling"), wfAction(23, "task")]);
});

test("wayfinder: 子が 1 件だけでも、frontier の全件に出す（最初の 1 件で止めない）", () => {
  const s = wfWorld([wfTicket(21, "research"), wfTicket(22, "research")]);
  assert.equal(wfActions(decide(s)).length, 2);
});

test("wayfinder: map が CLOSED なら、その子には出さない", () => {
  const s = wfWorld([wfTicket(21, "task")], { map: { state: "CLOSED" } });
  assert.deepEqual(wfActions(decide(s)), []);
});

test("wayfinder: 子が CLOSED なら出さない", () => {
  const s = wfWorld([wfTicket(21, "task", { state: "CLOSED" }), wfTicket(22, "task")]);
  assert.deepEqual(wfActions(decide(s)), [wfAction(22, "task")]);
});

test("wayfinder: claim 済み（assignee あり）の ticket には出さない", () => {
  const s = wfWorld([wfTicket(21, "research", { assignees: ["daiki-beppu"] }), wfTicket(22, "research")]);
  assert.deepEqual(wfActions(decide(s)), [wfAction(22, "research")]);
});

test("wayfinder: open なブロッカーがある ticket には出さない。ブロッカーがすべて閉じていれば出す", () => {
  const s = wfWorld([
    wfTicket(21, "task", { blockedBy: [{ number: 9, state: "OPEN" }] }),
    wfTicket(22, "task", { blockedBy: [{ number: 9, state: "CLOSED" }, { number: 10, state: "OPEN" }] }),
    wfTicket(23, "task", { blockedBy: [{ number: 9, state: "CLOSED" }, { number: 10, state: "CLOSED" }] }),
  ]);
  assert.deepEqual(wfActions(decide(s)), [wfAction(23, "task")]);
});

test("wayfinder: prototype ticket と、種類のラベルが無い ticket、wayfinder:map など別の wayfinder ラベルの ticket には出さない", () => {
  const s = wfWorld([
    wfTicket(21, "prototype"),
    issue(22, { assignees: [], blockedBy: [] }),
    issue(23, { labels: ["wayfinder:map"], assignees: [], blockedBy: [] }),
    wfTicket(24, "research"),
  ]);
  assert.deepEqual(wfActions(decide(s)), [wfAction(24, "research")]);
});

test("wayfinder: map の子でない issue には、種類のラベルがあっても出さない", () => {
  const s = snapshot([issue(20, { labels: ["wayfinder:map"], subIssues: [] }), wfTicket(21, "task")]);
  assert.deepEqual(wfActions(decide(s)), []);
});

test("wayfinder: 起動前の印だけ・起動後の印だけ、どちらでも出さない（viewer の印）", () => {
  const s = wfWorld([
    wfTicket(21, "task", { comments: [byViewer(WF_LAUNCHING)] }),
    wfTicket(22, "task", { comments: [byViewer(WF_LAUNCHED)] }),
    wfTicket(23, "task"),
  ]);
  assert.deepEqual(wfActions(decide(s)), [wfAction(23, "task")]);
});

test("wayfinder: viewer 以外のコメントと、行の途中に印の字面があるだけのコメントは印とみなさない", () => {
  const s = wfWorld([
    wfTicket(23, "task", { comments: [{ author: "someone", body: WF_LAUNCHING }, byViewer(`メモ: ${WF_LAUNCHING}`), { author: "someone", body: WF_LAUNCHED }] }),
  ]);
  assert.deepEqual(wfActions(decide(s)), [wfAction(23, "task")]);
});

test("wayfinder: dispatched に key があれば出さない。同じスナップショットで印を足して 2 周しても二重に出ない", () => {
  const s = wfWorld([wfTicket(21, "research")], { over: { dispatched: ["wayfinder:21"] } });
  assert.deepEqual(wfActions(decide(s)), []);
  const first = wfWorld([wfTicket(21, "research")]);
  assert.equal(wfActions(decide(first)).length, 1);
  first.issues.find((i) => i.number === 21).comments.push(byViewer(WF_LAUNCHING));
  assert.deepEqual(wfActions(decide(first)), []);
});

test("wayfinder: 複数の map があっても、各 map の frontier に 1 回ずつ出す。同じ ticket を 2 度出さない", () => {
  const s = snapshot([
    issue(20, { labels: ["wayfinder:map"], subIssues: [{ number: 21, state: "OPEN" }] }),
    issue(30, { labels: ["wayfinder:map"], subIssues: [{ number: 21, state: "OPEN" }, { number: 31, state: "OPEN" }] }),
    wfTicket(21, "research"),
    wfTicket(31, "task"),
  ]);
  const keys = wfActions(decide(s)).map((a) => a.key);
  assert.deepEqual([...keys].sort(), ["wayfinder:21", "wayfinder:31"]);
});

test("wayfinder: 既存の遷移（承認依頼）は wayfinder の map があっても変わらない", () => {
  const base = snapshot([specBare(12)]);
  const withMap = snapshot([specBare(12), issue(20, { labels: ["wayfinder:map"] })]);
  assert.deepEqual(decide(withMap), decide(base));
});

// ---- wayfinder の map のスレッド・人が見る ticket（prototype）・ticket のセッションの停止 ----
const MT_CREATING = "案内役: Discord に map のスレッドを立てる";
const MT_CREATED = (thread = "900") => `案内役: Discord に map のスレッドを立てた（スレッド ${thread}）`;
const HUMAN = (t) => `案内役: Discord に人が見る ticket を知らせる（#${t}）`;
const WF_CAUSE = (type) => `${type} のセッションの停止`;
const WF_LAUNCHED_AT = (handle, at = T0) => `案内役: wayfinder を起動した（ターミナル ${handle} / ${at}）`;
const createThread = (map = 20, title = "地図") => ({ kind: "create-map-thread", key: `create-map-thread:${map}`, map, title });
const notifies = (actions) => actions.filter((a) => a.kind === "notify-human-ticket");
const creates = (actions) => actions.filter((a) => a.kind === "create-map-thread");
const mapDecisions = (actions) => actions.filter((a) => a.kind === "request-map-decision");
// map #20（題名「地図」）の世界。mapComments は map の issue に付く viewer 以外も含むコメント。
const mapWorld = (children, { mapComments = [], map = {}, over = {} } = {}) =>
  wfWorld(children, { map: { title: "地図", comments: mapComments, ...map }, over });
const threaded = (...comments) => [byViewer(MT_CREATED()), ...comments];
// 起動済みの ticket。セッションが最初の書き込みで claim するので、実際には assignee を持つ。
const launchedTicket = (number, type, over = {}) =>
  wfTicket(number, type, { title: `ticket ${number}`, comments: [byViewer(WF_LAUNCHING), byViewer(WF_LAUNCHED_AT("term_1"))], assignees: ["daiki-beppu"], ...over });
const stallOf = (children, { mapComments = threaded(), sessions = { term_1: obs() }, now = at(1), over = {} } = {}) =>
  mapWorld(children, { mapComments, over: { sessions, now, ...over } });

// -- mapThread --

test("mapThread: viewer の「立てた」印からスレッドの ID を文字列で返す。無い・1 段目だけ・他人の印・行の途中の字面は null", () => {
  const read = (comments) => D.mapThread(issue(20, { comments }), VIEWER);
  assert.equal(read([byViewer(MT_CREATING), byViewer(MT_CREATED("900"))]), "900");
  assert.equal(read([]), null);
  assert.equal(read([byViewer(MT_CREATING)]), null);
  assert.equal(read([{ author: "someone", body: MT_CREATED() }]), null);
  assert.equal(read([byViewer(`メモ: ${MT_CREATED()}`)]), null);
});

// -- スレッドを立てる --

test("スレッド: 印が無い map に frontier の prototype があれば、題名つきでスレッドを立てる行動だけが出る（通知は出さない）", () => {
  const s = mapWorld([wfTicket(21, "prototype")]);
  const actions = decide(s);
  assert.deepEqual(creates(actions), [createThread(20, "地図")]);
  assert.deepEqual(notifies(actions), []);
});

test("スレッド: 印が無い map で停止の判断依頼が要るときも、スレッドを立てる行動だけが先に出る（判断依頼は出さない）", () => {
  const s = stallOf([launchedTicket(21, "research")], { mapComments: [], sessions: { term_1: obs({ found: false, tail: [] }) } });
  const actions = decide(s);
  assert.deepEqual(creates(actions), [createThread(20, "地図")]);
  assert.deepEqual(mapDecisions(actions), []);
});

test("スレッド: 知らせることが無い map には立てない（子が無い・research だけ・通知済みの prototype だけ・動いている ticket だけ）", () => {
  assert.deepEqual(creates(decide(mapWorld([]))), []);
  assert.deepEqual(creates(decide(mapWorld([wfTicket(21, "research")]))), []);
  assert.deepEqual(creates(decide(mapWorld([wfTicket(21, "prototype")], { mapComments: [byViewer(HUMAN(21))] }))), []);
  assert.deepEqual(creates(decide(stallOf([launchedTicket(21, "research")], { mapComments: [] }))), []);
});

test("スレッド: prototype と停止が同じ map で同時に起きても、立てる行動は 1 件だけ", () => {
  const s = stallOf([wfTicket(22, "prototype"), launchedTicket(21, "research")], { mapComments: [], sessions: { term_1: obs({ found: false, tail: [] }) } });
  assert.equal(creates(decide(s)).length, 1);
});

test("スレッド: 1 段目の印（立てる）だけなら、成否が不明なので立て直さず、通知も判断依頼も出さない", () => {
  const s = stallOf([wfTicket(22, "prototype"), launchedTicket(21, "research")], { mapComments: [byViewer(MT_CREATING)], sessions: { term_1: obs({ found: false, tail: [] }) } });
  const actions = decide(s);
  assert.deepEqual(creates(actions), []);
  assert.deepEqual(notifies(actions), []);
  assert.deepEqual(mapDecisions(actions), []);
});

test("スレッド: 2 段目の印（立てた）があれば立てる行動は出ない", () => {
  assert.deepEqual(creates(decide(mapWorld([wfTicket(21, "prototype")], { mapComments: threaded() }))), []);
});

test("スレッド: 他人が書いた「立てた」印や、行の途中に字面があるだけのコメントではスレッドありとみなさない", () => {
  const s = mapWorld([wfTicket(21, "prototype")], { mapComments: [{ author: "someone", body: MT_CREATED("900") }, byViewer(`メモ: ${MT_CREATED("900")}`)] });
  const actions = decide(s);
  assert.deepEqual(creates(actions), [createThread(20, "地図")]);
  assert.deepEqual(notifies(actions), []);
});

test("スレッド: map ごとに 1 件ずつ、map の番号順に立てる。CLOSED の map には立てない", () => {
  const s = snapshot([
    issue(30, { title: "地図30", labels: ["wayfinder:map"], subIssues: [{ number: 31, state: "OPEN" }] }),
    issue(20, { title: "地図20", labels: ["wayfinder:map"], subIssues: [{ number: 21, state: "OPEN" }] }),
    issue(40, { title: "閉じた地図", state: "CLOSED", labels: ["wayfinder:map"], subIssues: [{ number: 41, state: "OPEN" }] }),
    wfTicket(21, "prototype"),
    wfTicket(31, "prototype"),
    wfTicket(41, "prototype"),
  ]);
  assert.deepEqual(creates(decide(s)), [createThread(20, "地図20"), createThread(30, "地図30")]);
});

test("スレッド: dispatched に key があれば出さない。同じスナップショットで印を足して 2 周しても二重に立てない", () => {
  assert.deepEqual(creates(decide(mapWorld([wfTicket(21, "prototype")], { over: { dispatched: ["create-map-thread:20"] } }))), []);
  const first = mapWorld([wfTicket(21, "prototype")]);
  assert.equal(creates(decide(first)).length, 1);
  first.issues.find((i) => i.number === 20).comments.push(byViewer(MT_CREATING));
  assert.deepEqual(creates(decide(first)), []);
});

test("スレッド: 立てる行動が出ても、research の起動など既存の wayfinder の行動は変わらない", () => {
  const s = mapWorld([wfTicket(21, "research"), wfTicket(22, "prototype")]);
  assert.deepEqual(wfActions(decide(s)), [wfAction(21, "research")]);
});

// -- prototype の通知 --

test("通知: スレッドがある map の frontier の prototype に、スレッドの ID・題名つきの通知が 1 件出る。セッションの起動は出ない", () => {
  const s = mapWorld([wfTicket(21, "prototype", { title: "見た目の試作" })], { mapComments: threaded() });
  const actions = decide(s);
  assert.deepEqual(notifies(actions), [{ kind: "notify-human-ticket", key: "notify-human-ticket:20:21", map: 20, ticket: 21, title: "見た目の試作", threadId: "900" }]);
  assert.deepEqual(wfActions(actions), []);
  assert.deepEqual(creates(actions), []);
});

test("通知: 知らせた印（viewer が map に書いた）があれば出さない。frontier の複数の prototype には 1 件ずつ出す", () => {
  const s = mapWorld([wfTicket(21, "prototype"), wfTicket(22, "prototype")], { mapComments: threaded(byViewer(HUMAN(21))) });
  assert.deepEqual(notifies(decide(s)).map((a) => a.ticket), [22]);
});

test("通知: 別の ticket の印が前方一致しても通知済みとみなさない（#2 と #21）", () => {
  const s = mapWorld([wfTicket(2, "prototype"), wfTicket(21, "prototype")], { mapComments: threaded(byViewer(HUMAN(21))) });
  assert.deepEqual(notifies(decide(s)).map((a) => a.ticket), [2]);
  const reverse = mapWorld([wfTicket(2, "prototype"), wfTicket(21, "prototype")], { mapComments: threaded(byViewer(HUMAN(2))) });
  assert.deepEqual(notifies(decide(reverse)).map((a) => a.ticket), [21]);
});

test("通知: 他人が書いた印や、行の途中に字面があるだけのコメントでは通知済みとみなさない。ticket 側に書かれた印も数えない", () => {
  const s = mapWorld([wfTicket(21, "prototype", { comments: [byViewer(HUMAN(21))] })], {
    mapComments: threaded({ author: "someone", body: HUMAN(21) }, byViewer(`メモ: ${HUMAN(21)}`)),
  });
  assert.deepEqual(notifies(decide(s)).map((a) => a.ticket), [21]);
});

test("通知: prototype 以外（research・grilling・task・種類なし・map）には出さない。種類の起動は従来どおり", () => {
  const s = mapWorld(
    [wfTicket(21, "research"), wfTicket(22, "grilling"), wfTicket(23, "task"), issue(24, { assignees: [], blockedBy: [] }), issue(25, { labels: ["wayfinder:map"], assignees: [], blockedBy: [] })],
    { mapComments: threaded() },
  );
  const actions = decide(s);
  assert.deepEqual(notifies(actions), []);
  assert.deepEqual(wfActions(actions).map((a) => a.ticket), [21, 22, 23]);
});

test("通知: frontier の外の prototype（assignee あり＝人が引き取った・open なブロッカーあり・CLOSED）には出さず、スレッドも立てない", () => {
  const children = [
    wfTicket(21, "prototype", { assignees: ["daiki-beppu"] }),
    wfTicket(22, "prototype", { blockedBy: [{ number: 9, state: "OPEN" }] }),
    wfTicket(23, "prototype", { state: "CLOSED" }),
  ];
  assert.deepEqual(notifies(decide(mapWorld(children, { mapComments: threaded() }))), []);
  assert.deepEqual(creates(decide(mapWorld(children))), []);
  const ok = mapWorld([wfTicket(24, "prototype", { blockedBy: [{ number: 9, state: "CLOSED" }] })], { mapComments: threaded() });
  assert.deepEqual(notifies(decide(ok)).map((a) => a.ticket), [24]);
});

test("通知: map が CLOSED なら、スレッドがあっても出さない", () => {
  assert.deepEqual(notifies(decide(mapWorld([wfTicket(21, "prototype")], { mapComments: threaded(), map: { state: "CLOSED" } }))), []);
});

test("通知: prototype だけの frontier では wayfinder の起動が 0 件（prototype でセッションを起動しない）", () => {
  const s = mapWorld([wfTicket(21, "prototype"), wfTicket(22, "prototype")], { mapComments: threaded() });
  assert.deepEqual(wfActions(decide(s)), []);
  assert.deepEqual(wfActions(decide(mapWorld([wfTicket(21, "prototype")]))), []);
});

test("通知: dispatched に key があれば出さない。同じスナップショットで印を足して 2 周しても 1 度だけ", () => {
  assert.deepEqual(notifies(decide(mapWorld([wfTicket(21, "prototype")], { mapComments: threaded(), over: { dispatched: ["notify-human-ticket:20:21"] } }))), []);
  const first = mapWorld([wfTicket(21, "prototype")], { mapComments: threaded() });
  assert.equal(notifies(decide(first)).length, 1);
  first.issues.find((i) => i.number === 20).comments.push(byViewer(HUMAN(21)));
  assert.deepEqual(notifies(decide(first)), []);
});

test("通知: 同じ prototype が複数の map の子でも、最初の map だけで 1 回出す", () => {
  const s = snapshot([
    issue(20, { labels: ["wayfinder:map"], comments: threaded(), subIssues: [{ number: 21, state: "OPEN" }] }),
    issue(30, { labels: ["wayfinder:map"], comments: [byViewer(MT_CREATED("901"))], subIssues: [{ number: 21, state: "OPEN" }] }),
    wfTicket(21, "prototype"),
  ]);
  assert.deepEqual(notifies(decide(s)).map((a) => `${a.map}:${a.ticket}:${a.threadId}`), ["20:21:900"]);
});

test("通知: 複数の map があれば、それぞれのスレッドの ID で出す", () => {
  const s = snapshot([
    issue(20, { labels: ["wayfinder:map"], comments: threaded(), subIssues: [{ number: 21, state: "OPEN" }] }),
    issue(30, { labels: ["wayfinder:map"], comments: [byViewer(MT_CREATED("901"))], subIssues: [{ number: 31, state: "OPEN" }] }),
    wfTicket(21, "prototype"),
    wfTicket(31, "prototype"),
  ]);
  assert.deepEqual(notifies(decide(s)).map((a) => `${a.map}:${a.ticket}:${a.threadId}`), ["20:21:900", "30:31:901"]);
});

// -- ticket のセッションの観測の対象 --

test("ticketSessionsToObserve: handle つきの起動の印がある open な ticket（claim 済みでも）の handle・種類・起動時刻を返す", () => {
  const s = mapWorld([launchedTicket(21, "research")], { mapComments: threaded() });
  assert.deepEqual(D.ticketSessionsToObserve(s), [{ map: 20, ticket: 21, type: "research", handle: "term_1", startedAt: T0 }]);
});

test("ticketSessionsToObserve: 起動の印が複数あれば最後の印の handle と時刻を使う", () => {
  const s = mapWorld(
    [launchedTicket(21, "task", { comments: [byViewer(WF_LAUNCHING), byViewer(WF_LAUNCHED_AT("term_1")), byViewer(WF_LAUNCHED_AT("term_2", at(5)))] })],
    { mapComments: threaded() },
  );
  assert.deepEqual(D.ticketSessionsToObserve(s), [{ map: 20, ticket: 21, type: "task", handle: "term_2", startedAt: at(5) }]);
});

test("ticketSessionsToObserve: 閉じた ticket・起動前の印だけ・他の工程の印・他人の印・prototype・閉じた map の子は対象にしない", () => {
  const s = snapshot([
    issue(20, { labels: ["wayfinder:map"], comments: threaded(), subIssues: [21, 22, 23, 24, 25].map((number) => ({ number, state: "OPEN" })) }),
    issue(40, { labels: ["wayfinder:map"], state: "CLOSED", subIssues: [{ number: 41, state: "OPEN" }] }),
    launchedTicket(21, "research", { state: "CLOSED" }),
    launchedTicket(22, "research", { comments: [byViewer(WF_LAUNCHING)] }),
    launchedTicket(23, "research", { comments: [byViewer(launchedMarker("to-tickets", "term_x", T0))] }),
    launchedTicket(24, "research", { comments: [{ author: "someone", body: WF_LAUNCHED_AT("term_y") }] }),
    launchedTicket(25, "prototype"),
    launchedTicket(41, "research"),
  ]);
  assert.deepEqual(D.ticketSessionsToObserve(s), []);
});

test("ticketSessionsToObserve: map に同じ ticket・原因の判断依頼の印があれば対象にしない。別の ticket の印や ticket 側の印では外れない", () => {
  const marker = (n, type = "research") => byViewer(decisionMarker(n, WF_CAUSE(type)));
  const decided = mapWorld([launchedTicket(21, "research")], { mapComments: threaded(marker(21)) });
  assert.deepEqual(D.ticketSessionsToObserve(decided), []);
  const other = mapWorld([launchedTicket(21, "research")], { mapComments: threaded(marker(2)) });
  assert.equal(D.ticketSessionsToObserve(other).length, 1);
  const onTicket = mapWorld([launchedTicket(21, "research", { comments: [byViewer(WF_LAUNCHED_AT("term_1")), marker(21)] })], { mapComments: threaded() });
  assert.equal(D.ticketSessionsToObserve(onTicket).length, 1);
});

test("ticketSessionsToObserve: 仕様用の sessionsToObserve には ticket が混ざらない", () => {
  assert.deepEqual(sessionsToObserve(mapWorld([launchedTicket(21, "research")], { mapComments: threaded() })), []);
});

// -- ticket のセッションの停止 --

const stalledAction = (over = {}) => ({
  kind: "request-map-decision",
  key: `request-map-decision:20:21:${WF_CAUSE("research")}`,
  map: 20,
  issue: 21,
  cause: WF_CAUSE("research"),
  title: "ticket 21",
  threadId: "900",
  step: "wayfinder",
  tab: "wayfinder #21",
  tail: ["line1", "line2"],
  ...over,
});
const withoutReason = ({ reason, ...rest }) => rest;

test("ticket の停止: セッションが見つからなければ、map のスレッドへの判断依頼が 1 件出る（ticket・タブ・画面・理由つき）", () => {
  const s = stallOf([launchedTicket(21, "research")], { sessions: { term_1: obs({ found: false, tail: [] }) } });
  const [a, ...rest] = mapDecisions(decide(s));
  assert.deepEqual(rest, []);
  assert.deepEqual(withoutReason(a), stalledAction({ tail: [] }));
  assert.match(a.reason, /見つから/);
});

test("ticket の停止: 入力待ち（waiting）なら出る。タブの画面の最後の行を持つ", () => {
  const [a, ...rest] = mapDecisions(decide(stallOf([launchedTicket(21, "research")], { sessions: { term_1: obs({ waiting: true }) } })));
  assert.deepEqual(rest, []);
  assert.deepEqual(withoutReason(a), stalledAction());
  assert.match(a.reason, /入力待ち/);
});

test("ticket の停止: 起動から stallMinutes（既定 60）分経てば出る。60 分ちょうどから、59 分では出ない", () => {
  const timedOut = mapDecisions(decide(stallOf([launchedTicket(21, "research")], { now: at(60) })));
  assert.equal(timedOut.length, 1);
  assert.match(timedOut[0].reason, /60 分/);
  assert.deepEqual(mapDecisions(decide(stallOf([launchedTicket(21, "research")], { now: at(59) }))), []);
});

test("ticket の停止: stallMinutes を渡せばその分数で判定する。起動の印の時刻から数える", () => {
  const s = (minutes, now) => stallOf([launchedTicket(21, "task", { comments: [byViewer(WF_LAUNCHED_AT("term_1", at(10)))] })], { now, over: { stallMinutes: minutes } });
  assert.deepEqual(mapDecisions(decide(s(5, at(14)))), []);
  assert.equal(mapDecisions(decide(s(5, at(15)))).length, 1);
});

test("ticket の停止: 理由は 見つからない → 入力待ち → 時間切れ の順に 1 つだけ選ぶ（既存の工程の停止と同じ）", () => {
  const all = stallOf([launchedTicket(21, "research")], { sessions: { term_1: obs({ found: false, waiting: true, tail: [] }) }, now: at(120) });
  assert.match(mapDecisions(decide(all))[0].reason, /見つから/);
  const waitingAndLate = stallOf([launchedTicket(21, "research")], { sessions: { term_1: obs({ waiting: true }) }, now: at(120) });
  assert.match(mapDecisions(decide(waitingAndLate))[0].reason, /入力待ち/);
});

test("ticket の停止: 動いている（見つかる・入力待ちでない・時間内）なら出ない。idle だけでも出ない", () => {
  assert.deepEqual(mapDecisions(decide(stallOf([launchedTicket(21, "research")]))), []);
  assert.deepEqual(mapDecisions(decide(stallOf([launchedTicket(21, "research")], { sessions: { term_1: obs({ idle: true }) } }))), []);
});

test("ticket の停止: 観測が無い handle（sessions に無い）は出さない", () => {
  assert.deepEqual(mapDecisions(decide(stallOf([launchedTicket(21, "research")], { sessions: {} }))), []);
});

test("ticket の停止: 原因は ticket の種類ごと（research・grilling・task）。key に map・ticket・原因が入る", () => {
  for (const type of ["research", "grilling", "task"]) {
    const s = stallOf([launchedTicket(21, type)], { sessions: { term_1: obs({ waiting: true }) } });
    const [a] = mapDecisions(decide(s));
    assert.equal(a.cause, WF_CAUSE(type));
    assert.equal(a.key, `request-map-decision:20:21:${WF_CAUSE(type)}`);
  }
});

test("ticket の停止: ticket が閉じていれば出ない（結果は ticket が閉じたこと）", () => {
  const s = stallOf([launchedTicket(21, "research", { state: "CLOSED" })], { sessions: { term_1: obs({ found: false, tail: [] }) } });
  assert.deepEqual(mapDecisions(decide(s)), []);
  assert.deepEqual(creates(decide(stallOf([launchedTicket(21, "research", { state: "CLOSED" })], { mapComments: [], sessions: { term_1: obs({ found: false, tail: [] }) } }))), []);
});

test("ticket の停止: map に同じ ticket・原因の判断依頼の印があれば出ない。別の ticket の印（#2 と #21）では止めない", () => {
  const down = { term_1: obs({ found: false, tail: [] }) };
  const mark = (n) => byViewer(decisionMarker(n, WF_CAUSE("research")));
  assert.deepEqual(mapDecisions(decide(stallOf([launchedTicket(21, "research")], { sessions: down, mapComments: threaded(mark(21)) }))), []);
  assert.equal(mapDecisions(decide(stallOf([launchedTicket(21, "research")], { sessions: down, mapComments: threaded(mark(2)) }))).length, 1);
});

test("ticket の停止: 他人が書いた判断依頼の印や、行の途中に字面があるだけのコメントでは止めない", () => {
  const down = { term_1: obs({ found: false, tail: [] }) };
  const text = decisionMarker(21, WF_CAUSE("research"));
  const s = stallOf([launchedTicket(21, "research")], { sessions: down, mapComments: threaded({ author: "someone", body: text }, byViewer(`メモ: ${text}`)) });
  assert.equal(mapDecisions(decide(s)).length, 1);
});

test("ticket の停止: dispatched に key があれば出さない。同じスナップショットで印を足して 2 周しても 1 度だけ", () => {
  const down = { term_1: obs({ found: false, tail: [] }) };
  const done = stallOf([launchedTicket(21, "research")], { sessions: down, over: { dispatched: [`request-map-decision:20:21:${WF_CAUSE("research")}`] } });
  assert.deepEqual(mapDecisions(decide(done)), []);
  const first = stallOf([launchedTicket(21, "research")], { sessions: down });
  assert.equal(mapDecisions(decide(first)).length, 1);
  first.issues.find((i) => i.number === 20).comments.push(byViewer(decisionMarker(21, WF_CAUSE("research"))));
  assert.deepEqual(mapDecisions(decide(first)), []);
});

test("ticket の停止: 同じ周で止まった ticket ごとに 1 件ずつ。止まっていない ticket には出さない", () => {
  const s = stallOf(
    [
      launchedTicket(21, "research"),
      launchedTicket(22, "task", { comments: [byViewer(WF_LAUNCHED_AT("term_2"))] }),
      launchedTicket(23, "grilling", { comments: [byViewer(WF_LAUNCHED_AT("term_3"))] }),
    ],
    { sessions: { term_1: obs({ waiting: true }), term_2: obs(), term_3: obs({ found: false, tail: [] }) } },
  );
  assert.deepEqual(mapDecisions(decide(s)).map((a) => a.issue), [21, 23]);
});

test("ticket の停止: 仕様用の判断依頼（request-decision）は出さず、仕様の停止の判定にも混ざらない", () => {
  const s = stallOf([launchedTicket(21, "research")], { sessions: { term_1: obs({ found: false, tail: [] }) } });
  assert.deepEqual(decide(s).filter((a) => a.kind === "request-decision"), []);
});

test("ticket の停止: 仕様の停止（to-tickets）と ticket の停止が同じスナップショットにあっても、それぞれの行動が出る", () => {
  const s = stallOf([launchedTicket(21, "research")], {
    sessions: { term_1: obs({ found: false, tail: [] }), term_s: obs({ waiting: true }) },
  });
  s.issues.push(spec(12, { title: "仕様A", comments: [...SENT_ALL, byViewer("案内役: to-tickets を起動する"), byViewer("案内役: to-tickets を起動した（ターミナル term_s / 2026-10-17T00:00:00.000Z）")] }));
  const actions = decide(s);
  assert.equal(stalls(actions).length, 1);
  assert.equal(mapDecisions(actions).length, 1);
});

test("純粋性: map のスレッド・通知・ticket の停止の判定も入力を変更せず、同じ入力に同じ出力を返す", () => {
  const s = deepFreeze(stallOf([wfTicket(22, "prototype"), launchedTicket(21, "research")], { sessions: { term_1: obs({ waiting: true }) } }));
  const first = decide(s);
  assert.deepEqual(decide(s), first);
  assert.deepEqual(D.ticketSessionsToObserve(s).length, 1);
  assert.equal(notifies(first).length, 1);
  assert.equal(mapDecisions(first).length, 1);
});

// ---- grilling の不可逆な判断: hook の入力待ち → 判断依頼 → 本人の回答の書き戻し → 同じタブへの流し込み ----
// 3 段の印はすべて ticket に書く。S は停止の識別子（agentWait.since）、t は ticket の番号。
const GS = "1760000000000";
const G_SEND = (t = 21, s = GS) => decisionMarker(t, `grilling の問い ${s}`);
const G_SENT = (t = 21, s = GS, thread = "900", message = "M1") => `案内役: Discord に判断依頼を送った（#${t} grilling の問い ${s} / スレッド ${thread} / メッセージ ${message}）`;
const G_WRITTEN = (answer, t = 21, s = GS) => `案内役: Discord の回答を書き戻した（#${t} grilling の問い ${s}）\n\n${answer}`;
const G_INJECT = (t = 21, s = GS) => `案内役: 回答をタブに流し込む（#${t} grilling の問い ${s}）`;
const G_QUESTION = (text) => `## 判断の問い\n${text}`;
const NO_QUESTION = "（問いの記録が ticket に無い）";
const hookWait = (since = GS, over = {}) => obs({ waiting: true, waitSource: "hook", waitSince: since, ...over });
const grillingDecisions = (actions) => actions.filter((a) => a.kind === "request-grilling-decision");
const writeBacks = (actions) => actions.filter((a) => a.kind === "write-back-answer");
const injects = (actions) => actions.filter((a) => a.kind === "inject-answer");
// 起動済みの grilling ticket #21（handle term_1）。ticketComments は起動の印の後ろに足す。
const grillingWorld = (ticketComments = [], { sessions = { term_1: hookWait() }, replies, owner = OWNER, mapComments = threaded(), launched = [byViewer(WF_LAUNCHING), byViewer(WF_LAUNCHED_AT("term_1"))] } = {}) =>
  stallOf([launchedTicket(21, "grilling", { comments: [...launched, ...ticketComments] })], {
    mapComments,
    sessions,
    over: { discordUserId: owner, ...(replies === undefined ? {} : { decisionReplies: replies }) },
  });
const addToTicket = (s, ...bodies) => s.issues.find((i) => i.number === 21).comments.push(...bodies.map(byViewer));
const reply = (content, userId = OWNER) => ({ userId, content });

// -- 判断依頼を出す --

test("grilling の判断依頼: hook の入力待ちで印がなければ、map のスレッドへの request-grilling-decision が 1 件だけ出る（題名・タブ・画面・問い・停止の識別子つき）", () => {
  const s = grillingWorld([byViewer(G_QUESTION("公開 API の名前を v2 にするか？\n- A: する\n- B: しない（推奨）"))]);
  const actions = decide(s);
  const [a, ...rest] = grillingDecisions(actions);
  assert.deepEqual(rest, []);
  assert.equal(a.kind, "request-grilling-decision");
  assert.equal(a.key, `request-grilling-decision:20:21:${GS}`);
  assert.deepEqual([a.map, a.ticket, a.since, a.threadId, a.title, a.tab], [20, 21, GS, "900", "ticket 21", "wayfinder #21"]);
  assert.deepEqual(a.tail, ["line1", "line2"]);
  assert.ok(a.question.includes("公開 API の名前を v2 にするか？") && a.question.includes("B: しない（推奨）"), a.question);
});

test("grilling の判断依頼: 同じ停止で「工程のセッションの停止」の判断依頼（request-map-decision）を重ねて出さない。停止の key も出ない", () => {
  const actions = decide(grillingWorld([byViewer(G_QUESTION("q"))]));
  assert.equal(grillingDecisions(actions).length, 1);
  assert.deepEqual(mapDecisions(actions), []);
  assert.deepEqual(stalls(actions), []);
});

test("grilling の判断依頼: 送り済み（「送る」の印が ticket にある）なら出ない。停止の判断依頼にも切り替わらない", () => {
  const actions = decide(grillingWorld([byViewer(G_SEND())]));
  assert.deepEqual(grillingDecisions(actions), []);
  assert.deepEqual(mapDecisions(actions), []);
});

test("grilling の判断依頼: 同じスナップショットで印を足して 2 周しても 1 度だけ（再起動後の 2 周目は出ない）", () => {
  const s = grillingWorld([byViewer(G_QUESTION("q"))]);
  assert.equal(grillingDecisions(decide(s)).length, 1);
  addToTicket(s, G_SEND());
  assert.deepEqual(grillingDecisions(decide(s)), []);
  assert.deepEqual(mapDecisions(decide(s)), []);
});

test("grilling の判断依頼: dispatched に key があれば出さない", () => {
  const s = { ...grillingWorld(), dispatched: [`request-grilling-decision:20:21:${GS}`] };
  assert.deepEqual(grillingDecisions(decide(s)), []);
});

test("grilling の判断依頼: 別の停止（since が前方一致）・別の ticket（#2 と #21）の印では送り済みとみなさない", () => {
  const s = grillingWorld([byViewer(G_SEND(21, "176000000000")), byViewer(G_SEND(2, GS)), byViewer(G_SENT(2, GS)), byViewer(G_SENT(21, "176000000000"))]);
  const [a, ...rest] = grillingDecisions(decide(s));
  assert.deepEqual(rest, []);
  assert.deepEqual([a.ticket, a.since], [21, GS]);
});

test("grilling の判断依頼: 他人が書いた印や、行の途中に字面があるだけのコメントでは送り済みとみなさない", () => {
  const s = grillingWorld([{ author: "someone", body: G_SEND() }, byViewer(`メモ: ${G_SEND()}`)]);
  assert.equal(grillingDecisions(decide(s)).length, 1);
});

test("grilling の判断依頼: 問いの記録が ticket に無ければ、問いの欄に「問いの記録が ticket に無い」と入れる。他人の「判断の問い」コメントは読まない", () => {
  const none = grillingDecisions(decide(grillingWorld()))[0];
  assert.equal(none.question, NO_QUESTION);
  const foreign = grillingDecisions(decide(grillingWorld([{ author: "someone", body: G_QUESTION("他人の問い") }])))[0];
  assert.equal(foreign.question, NO_QUESTION);
});

test("grilling の判断依頼: 問いのコメントが複数あれば、viewer の最後のものを読む", () => {
  const s = grillingWorld([byViewer(G_QUESTION("古い問い")), byViewer("案内役以外の話")], {});
  addToTicket(s, G_QUESTION("新しい問い"));
  const [a] = grillingDecisions(decide(s));
  assert.ok(a.question.includes("新しい問い") && !a.question.includes("古い問い"), a.question);
});

test("grilling の判断依頼: 過去に「grilling のセッションの停止」の印が map にあっても、後の hook の入力待ちには判断依頼が出る（停止の判断依頼は出ない）", () => {
  const s = grillingWorld([byViewer(G_QUESTION("q"))], { mapComments: threaded(byViewer(decisionMarker(21, WF_CAUSE("grilling")))) });
  const actions = decide(s);
  assert.equal(grillingDecisions(actions).length, 1);
  assert.deepEqual(mapDecisions(actions), []);
});

test("grilling の判断依頼: map にスレッドが無ければ、先に create-map-thread だけが出る（判断依頼は出ない）", () => {
  const actions = decide(grillingWorld([], { mapComments: [] }));
  assert.equal(creates(actions).length, 1);
  assert.deepEqual(grillingDecisions(actions), []);
});

test("grilling の判断依頼: hook 以外の入力待ち（prompt-text・title・source なし）は従来どおり停止の判断依頼で、grilling の判断依頼は出ない", () => {
  for (const wait of [{ waitSource: "prompt-text", waitSince: GS }, { waitSource: "title" }, {}]) {
    const actions = decide(grillingWorld([], { sessions: { term_1: obs({ waiting: true, ...wait }) } }));
    assert.deepEqual(grillingDecisions(actions), [], JSON.stringify(wait));
    assert.equal(mapDecisions(actions).length, 1, JSON.stringify(wait));
    assert.match(mapDecisions(actions)[0].reason, /入力待ち/);
  }
});

test("grilling の判断依頼: hook でも停止の識別子（since）が無ければ判断依頼を出さず、従来の停止の判断依頼に任せる", () => {
  const actions = decide(grillingWorld([], { sessions: { term_1: obs({ waiting: true, waitSource: "hook" }) } }));
  assert.deepEqual(grillingDecisions(actions), []);
  assert.equal(mapDecisions(actions).length, 1);
});

test("grilling の判断依頼: セッションが見つからない・入力待ちでない（時間内）grilling は従来どおり。見つからなければ停止の判断依頼、動いていれば何も出ない", () => {
  const gone = decide(grillingWorld([byViewer(G_SENT())], { sessions: { term_1: obs({ found: false, tail: [] }) } }));
  assert.deepEqual(grillingDecisions(gone), []);
  assert.equal(mapDecisions(gone).length, 1);
  const running = decide(grillingWorld([], { sessions: { term_1: obs() } }));
  assert.deepEqual([...grillingDecisions(running), ...mapDecisions(running)], []);
});

test("grilling の判断依頼: research・task の hook の入力待ちには出ない（従来の停止の判断依頼）。grilling の ticket にだけ出る", () => {
  for (const type of ["research", "task"]) {
    const s = stallOf([launchedTicket(21, type)], { sessions: { term_1: hookWait() } });
    const actions = decide(s);
    assert.deepEqual(grillingDecisions(actions), [], type);
    assert.equal(mapDecisions(actions).length, 1, type);
  }
});

test("grilling の判断依頼: research・task の停止の印が map にあれば、これまでどおり出ない（観測の対象に grilling だけが残っても他の種類は変わらない）", () => {
  for (const type of ["research", "task"]) {
    const s = stallOf([launchedTicket(21, type)], {
      mapComments: threaded(byViewer(decisionMarker(21, WF_CAUSE(type)))),
      sessions: { term_1: obs({ found: false, tail: [] }) },
    });
    assert.deepEqual(mapDecisions(decide(s)), [], type);
  }
});

test("grilling の判断依頼: grilling でも、map に停止の印がある hook 以外の停止（見つからない）には、停止の判断依頼を重ねて出さない", () => {
  const s = grillingWorld([], {
    mapComments: threaded(byViewer(decisionMarker(21, WF_CAUSE("grilling")))),
    sessions: { term_1: obs({ found: false, tail: [] }) },
  });
  assert.deepEqual(mapDecisions(decide(s)), []);
});

test("ticketSessionsToObserve: grilling は map に停止の印があっても観測の対象に残る（後の hook の入力待ちを見るため）。返す形は変わらない", () => {
  const s = grillingWorld([], { mapComments: threaded(byViewer(decisionMarker(21, WF_CAUSE("grilling")))) });
  assert.deepEqual(D.ticketSessionsToObserve(s), [{ map: 20, ticket: 21, type: "grilling", handle: "term_1", startedAt: T0 }]);
});

// -- 本人の回答の書き戻し --

const SENT_THREAD = [byViewer(G_QUESTION("q")), byViewer(G_SEND()), byViewer(G_SENT())];

test("書き戻し: 判断依頼のメッセージへの本人の返信があれば、ticket への write-back-answer が 1 件出る（本文は返信の内容）。流し込みはまだ出ない", () => {
  const s = grillingWorld(SENT_THREAD, { replies: { M1: [reply("B 案で行く。理由は後方互換")] } });
  const actions = decide(s);
  const [a, ...rest] = writeBacks(actions);
  assert.deepEqual(rest, []);
  assert.equal(a.kind, "write-back-answer");
  assert.equal(a.key, `write-back-answer:21:${GS}`);
  assert.deepEqual([a.ticket, a.since, a.answer], [21, GS, "B 案で行く。理由は後方互換"]);
  assert.deepEqual(injects(actions), []);
  assert.deepEqual(grillingDecisions(actions), []);
});

test("書き戻し: 本人以外の返信だけなら書き戻さない（流し込みも出ない）", () => {
  const s = grillingWorld(SENT_THREAD, { replies: { M1: [reply("勝手に A", "U-other"), reply("こっちも", "U-bot")] } });
  const actions = decide(s);
  assert.deepEqual(writeBacks(actions), []);
  assert.deepEqual(injects(actions), []);
});

test("書き戻し: 本人以外の返信が混ざっても、本人の返信の内容だけを書き戻す（他人の内容を使わない）", () => {
  const s = grillingWorld(SENT_THREAD, { replies: { M1: [reply("他人の A", "U-other"), reply("本人の B"), reply("他人の C", "U-other")] } });
  assert.deepEqual(writeBacks(decide(s)).map((a) => a.answer), ["本人の B"]);
});

test("書き戻し: 本人の返信が複数あれば、最も古い 1 件だけを 1 回書き戻す", () => {
  const s = grillingWorld(SENT_THREAD, { replies: { M1: [reply("最初の答え"), reply("言い直し")] } });
  assert.deepEqual(writeBacks(decide(s)).map((a) => a.answer), ["最初の答え"]);
});

test("書き戻し: 本人の返信でも本文が空（空白だけ）なら書き戻さない", () => {
  const s = grillingWorld(SENT_THREAD, { replies: { M1: [reply(""), reply("  \n ")] } });
  assert.deepEqual(writeBacks(decide(s)), []);
});

test("書き戻し: 本人の ID が分からない（discordUserId が無い）ときは、誰の返信も書き戻さない", () => {
  const s = grillingWorld(SENT_THREAD, { owner: null, replies: { M1: [reply("x", "U-other"), reply("y", null)] } });
  assert.deepEqual(writeBacks(decide(s)), []);
});

test("書き戻し: 返信が無い・返信の読み出しが無い（decisionReplies なし）・別のメッセージへの返信だけなら出ない", () => {
  assert.deepEqual(writeBacks(decide(grillingWorld(SENT_THREAD, { replies: { M1: [] } }))), []);
  assert.deepEqual(writeBacks(decide(grillingWorld(SENT_THREAD))), []);
  assert.deepEqual(writeBacks(decide(grillingWorld(SENT_THREAD, { replies: { M2: [reply("別のメッセージへの返信")] } }))), []);
});

test("書き戻し: 判断依頼を送った印（メッセージの ID つき）が無ければ、返信があっても書き戻さない（「送る」の印だけでも出ない）", () => {
  const s = grillingWorld([byViewer(G_SEND())], { replies: { M1: [reply("答え")] } });
  assert.deepEqual(writeBacks(decide(s)), []);
});

test("書き戻し: 書き戻し済み（viewer の書き戻しの印がある）なら、新しい返信があっても出ない。同じスナップショットで印を足して 2 周しても 1 度だけ", () => {
  const s = grillingWorld(SENT_THREAD, { replies: { M1: [reply("答え")] } });
  assert.equal(writeBacks(decide(s)).length, 1);
  addToTicket(s, G_WRITTEN("答え"));
  assert.deepEqual(writeBacks(decide(s)), []);
});

test("書き戻し: dispatched に key があれば出さない。他人が書いた書き戻しの印や別の停止・別の ticket の印では書き戻し済みとみなさない", () => {
  const replies = { M1: [reply("答え")] };
  assert.deepEqual(writeBacks(decide({ ...grillingWorld(SENT_THREAD, { replies }), dispatched: [`write-back-answer:21:${GS}`] })), []);
  const others = grillingWorld([...SENT_THREAD, { author: "someone", body: G_WRITTEN("偽") }, byViewer(G_WRITTEN("x", 2, GS)), byViewer(G_WRITTEN("x", 21, "176000000000"))], { replies });
  assert.equal(writeBacks(decide(others)).length, 1);
});

test("書き戻し: 他人が書いた「送った」印では、その返信を読まない", () => {
  const s = grillingWorld([byViewer(G_SEND()), { author: "someone", body: G_SENT() }], { replies: { M1: [reply("答え")] } });
  assert.deepEqual(writeBacks(decide(s)), []);
});

test("grillingRepliesToRead: 送った印があり書き戻し前の open な grilling だけ、スレッドとメッセージの ID を返す", () => {
  const s = snapshot([
    issue(20, { labels: ["wayfinder:map"], comments: threaded(), subIssues: [21, 22, 23, 24, 25, 26].map((number) => ({ number, state: "OPEN" })) }),
    launchedTicket(21, "grilling", { comments: [byViewer(WF_LAUNCHED_AT("term_1")), byViewer(G_SENT(21, GS, "900", "M1"))] }),
    launchedTicket(22, "grilling", { comments: [byViewer(WF_LAUNCHED_AT("term_2")), byViewer(G_SENT(22, GS, "900", "M2")), byViewer(G_WRITTEN("済", 22))] }),
    launchedTicket(23, "grilling", { comments: [byViewer(WF_LAUNCHED_AT("term_3")), byViewer(G_SEND(23))] }),
    launchedTicket(24, "grilling", { state: "CLOSED", comments: [byViewer(G_SENT(24, GS, "900", "M4"))] }),
    launchedTicket(25, "research", { comments: [byViewer(G_SENT(25, GS, "900", "M5"))] }),
    launchedTicket(26, "grilling", { comments: [{ author: "someone", body: G_SENT(26, GS, "900", "M6") }] }),
  ]);
  assert.deepEqual(D.grillingRepliesToRead(s), [{ threadId: "900", messageId: "M1" }]);
});

// -- 回答の流し込み --

const WRITTEN_THREAD = [...SENT_THREAD, byViewer(G_WRITTEN("B 案で行く"))];

test("流し込み: 書き戻し前は、本人の返信があっても流し込みが出ない（流し込みの判定は GitHub の書き戻しだけを読む）", () => {
  const s = grillingWorld(SENT_THREAD, { replies: { M1: [reply("B 案で行く")] } });
  assert.deepEqual(injects(decide(s)), []);
});

test("流し込み: 書き戻し後、同じ停止（hook・同じ since）のままなら inject-answer が 1 件。handle は起動の印のもの、回答は書き戻しコメントのもの", () => {
  const actions = decide(grillingWorld(WRITTEN_THREAD));
  const [a, ...rest] = injects(actions);
  assert.deepEqual(rest, []);
  assert.equal(a.kind, "inject-answer");
  assert.equal(a.key, `inject-answer:21:${GS}`);
  assert.deepEqual([a.ticket, a.since, a.handle, a.answer], [21, GS, "term_1", "B 案で行く"]);
  assert.deepEqual(grillingDecisions(actions), []);
  assert.deepEqual(writeBacks(actions), []);
  assert.deepEqual(mapDecisions(actions), []);
});

test("流し込み: 回答は GitHub の書き戻しコメントから作る。Discord の返信（decisionReplies）が違う内容でも、返信は使わない", () => {
  const s = grillingWorld(WRITTEN_THREAD, { replies: { M1: [reply("Discord 側の別の内容"), reply("他人", "U-other")] } });
  assert.deepEqual(injects(decide(s)).map((a) => a.answer), ["B 案で行く"]);
  assert.deepEqual(injects(decide(grillingWorld(WRITTEN_THREAD, { replies: {} }))).map((a) => a.answer), ["B 案で行く"]);
});

test("流し込み: 複数行の回答も、書き戻しコメントの 2 行目以降（空行の後）をそのまま回答にする", () => {
  const s = grillingWorld([...SENT_THREAD, byViewer(G_WRITTEN("1 行目\n2 行目"))]);
  assert.deepEqual(injects(decide(s)).map((a) => a.answer), ["1 行目\n2 行目"]);
});

test("流し込み: 流し込みの印があれば出ない。同じスナップショットで印を足して 2 周しても 1 度だけ（流し込み直後にまだ入力待ちが見えても重ねない）", () => {
  const s = grillingWorld(WRITTEN_THREAD);
  assert.equal(injects(decide(s)).length, 1);
  addToTicket(s, G_INJECT());
  const again = decide(s);
  assert.deepEqual(injects(again), []);
  assert.deepEqual(grillingDecisions(again), []);
  assert.deepEqual(mapDecisions(again), []);
});

test("流し込み: dispatched に key があれば出さない", () => {
  assert.deepEqual(injects(decide({ ...grillingWorld(WRITTEN_THREAD), dispatched: [`inject-answer:21:${GS}`] })), []);
});

test("流し込み: タブが別の入力待ち（since が違う）や hook 以外・入力待ちでない・見つからないときは流し込まない（別の入力へ回答を混ぜない）", () => {
  for (const session of [hookWait("1760000099999"), obs({ waiting: true, waitSource: "prompt-text", waitSince: GS }), obs(), obs({ found: false, tail: [] })]) {
    const actions = decide(grillingWorld(WRITTEN_THREAD, { sessions: { term_1: session } }));
    assert.deepEqual(injects(actions), [], JSON.stringify(session));
  }
});

test("流し込み: 他人が書いた書き戻しの印、別の停止・別の ticket の書き戻しの印では流し込まない", () => {
  const base = [...SENT_THREAD];
  for (const wb of [{ author: "someone", body: G_WRITTEN("偽の回答") }, byViewer(G_WRITTEN("x", 21, "176000000000")), byViewer(G_WRITTEN("x", 2, GS))]) {
    assert.deepEqual(injects(decide(grillingWorld([...base, wb]))), []);
  }
});

test("流し込み: 他人が書いた流し込みの印や別の停止の印では流し込み済みとみなさない", () => {
  const s = grillingWorld([...WRITTEN_THREAD, { author: "someone", body: G_INJECT() }, byViewer(G_INJECT(21, "176000000000")), byViewer(G_INJECT(2, GS))]);
  assert.equal(injects(decide(s)).length, 1);
});

test("流し込み: 起動の印が複数あれば、最後の起動の印の handle のタブへ流し込む（セッションは作り直さない: wayfinder の起動は出ない）", () => {
  const launched = [byViewer(WF_LAUNCHING), byViewer(WF_LAUNCHED_AT("term_1")), byViewer(WF_LAUNCHED_AT("term_2", at(5)))];
  const s = grillingWorld(WRITTEN_THREAD, { launched, sessions: { term_1: obs({ found: false, tail: [] }), term_2: hookWait() } });
  const actions = decide(s);
  assert.deepEqual(injects(actions).map((a) => a.handle), ["term_2"]);
  assert.deepEqual(wfActions(actions), []);
});

test("流し込み: 閉じた ticket・閉じた map の ticket には出さない", () => {
  const closed = stallOf([launchedTicket(21, "grilling", { state: "CLOSED", comments: [byViewer(WF_LAUNCHED_AT("term_1")), ...WRITTEN_THREAD] })], { sessions: { term_1: hookWait() } });
  assert.deepEqual(injects(decide(closed)), []);
});

// -- 同じタブでの連続（停止 → 判断依頼 → 書き戻し → 流し込み → 次の停止） --

test("連続: 同じタブ（handle）で 1 回目の停止を最後まで処理した後、次の hook の入力待ち（別の since）には新しい判断依頼だけが 1 件出る", () => {
  const S2 = "1760000500000";
  const s = grillingWorld([byViewer(G_QUESTION("q1"))], { replies: { M1: [reply("B 案")] } });
  assert.equal(grillingDecisions(decide(s)).length, 1);
  addToTicket(s, G_SEND(), G_SENT());
  assert.equal(writeBacks(decide(s)).length, 1);
  addToTicket(s, G_WRITTEN("B 案"));
  assert.equal(injects(decide(s)).length, 1);
  addToTicket(s, G_INJECT());
  assert.deepEqual([...grillingDecisions(decide(s)), ...writeBacks(decide(s)), ...injects(decide(s))], []);
  // 同じタブが次の入力待ち（since が変わる）へ進んだ
  s.sessions.term_1 = hookWait(S2);
  addToTicket(s, G_QUESTION("q2"));
  const next = decide(s);
  assert.deepEqual(grillingDecisions(next).map((a) => [a.since, a.key]), [[S2, `request-grilling-decision:20:21:${S2}`]]);
  assert.ok(grillingDecisions(next)[0].question.includes("q2"));
  assert.deepEqual([...writeBacks(next), ...injects(next), ...mapDecisions(next)], []);
});

test("連続: 同じ周に複数の grilling ticket があれば、ticket ごとに 1 件ずつ出る（印は ticket ごと）", () => {
  const s = stallOf(
    [
      launchedTicket(21, "grilling"),
      launchedTicket(22, "grilling", { comments: [byViewer(WF_LAUNCHED_AT("term_2")), byViewer(G_SEND(22, "1760000000777"))] }),
      launchedTicket(23, "grilling", { comments: [byViewer(WF_LAUNCHED_AT("term_3"))] }),
    ],
    { sessions: { term_1: hookWait(), term_2: hookWait("1760000000777"), term_3: hookWait("1760000000999") } },
  );
  assert.deepEqual(grillingDecisions(decide(s)).map((a) => [a.ticket, a.since]), [[21, GS], [23, "1760000000999"]]);
});

test("grilling の 3 段の遷移: 純粋性（入力を変更せず、同じ入力に同じ出力を返す）", () => {
  const s = deepFreeze(grillingWorld(WRITTEN_THREAD, { replies: { M1: [reply("x")] } }));
  const first = decide(s);
  assert.deepEqual(decide(s), first);
  assert.deepEqual(D.grillingRepliesToRead(s), D.grillingRepliesToRead(s));
  const fresh = deepFreeze(grillingWorld([byViewer(G_QUESTION("q"))]));
  assert.equal(grillingDecisions(decide(fresh)).length, 1);
});
