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
  pending(n, { comments: [byViewer(SENDING), byViewer(SENT())], reactions, ...over });
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
