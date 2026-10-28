// decide.mjs の判定テスト。GitHub・takt・Discord・子プロセスは一切呼ばない。
import assert from "node:assert/strict";
import { test } from "node:test";
import { SEQUENCE_DONE, closedTabMarker, decide, decisionMarker, launchedMarker, sequencesToObserve, sessionsToObserve, tabTitle, tabsToClose } from "./decide.mjs";
// map のスレッド・人が見る ticket・ticket の停止の観測（新しい公開物）は名前空間で読む（未実装でも他のテストは動かす）。
import * as D from "./decide.mjs";
// 修正の起動の印・やり直しの印・失敗のコメントの文言の正本（#360）。guide 側で書き写さず、同じ定数・関数で組み立てる。
import { REVIEW_FAILED, fixLaunchedMarker, fixLaunchingMarker, redoMarker } from "../../takt/scripts/review-stage.mjs";

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

// -- 保留の map --

const ON_HOLD = { labels: ["wayfinder:map", "wayfinder:on-hold"] };

test("保留: wayfinder:on-hold の map の frontier には、起動もスレッドも通知も出さない", () => {
  const s = mapWorld([wfTicket(21, "research"), wfTicket(22, "grilling"), wfTicket(23, "task"), wfTicket(24, "prototype")], { map: ON_HOLD });
  assert.deepEqual(decide(s), []);
  const threadedHold = mapWorld([wfTicket(24, "prototype")], { map: ON_HOLD, mapComments: threaded() });
  assert.deepEqual(notifies(decide(threadedHold)), []);
});

test("保留: wayfinder:on-hold の map の子は、起動済みでも観測も判断依頼もしない", () => {
  const s = stallOf([launchedTicket(21, "research")], { sessions: {}, over: {} });
  s.issues.find((i) => i.number === 20).labels.push("wayfinder:on-hold");
  assert.deepEqual(D.ticketSessionsToObserve(s), []);
  assert.deepEqual(mapDecisions(decide(s)), []);
});

test("保留: 保留を外した map は、次の周からまた起動を出す", () => {
  const held = mapWorld([wfTicket(21, "research")], { map: ON_HOLD });
  assert.deepEqual(wfActions(decide(held)), []);
  held.issues.find((i) => i.number === 20).labels = ["wayfinder:map"];
  assert.deepEqual(wfActions(decide(held)), [wfAction(21, "research")]);
});

// ---- 仮決め: map の子 ticket の resolution コメントの `## 仮決め` 節を、仮決めごとに map のスレッドへ流す ----
const PD_SENDING = (t, n) => `案内役: Discord に仮決めを流す（#${t} 仮決め ${n}）`;
const PD_SENT = (t, n, thread = "900", message = "M1") => `案内役: Discord に仮決めを流した（#${t} 仮決め ${n} / スレッド ${thread} / メッセージ ${message}）`;
const pdItem = (q, a, { triage = "⓪", reason = "後で替えられる", evidence = "なし" } = {}) =>
  `### ${q}\n- 答え: ${a}\n- 振り分け: ${triage}\n- 理由: ${reason}\n- 根拠: ${evidence}`;
const pdComment = (...items) => `## 結果\n\n調べた。\n\n## 仮決め\n\n${items.join("\n\n")}\n`;
const posts = (actions) => actions.filter((a) => a.kind === "post-provisional-decision");
const pdWorld = (ticketOver, { mapComments = threaded(), map = {}, over = {}, type = "grilling" } = {}) =>
  mapWorld([wfTicket(21, type, { title: "parser を選ぶ", state: "CLOSED", ...ticketOver })], { mapComments, map, over });
const two = pdComment(pdItem("どの parser？", "既存", { reason: "後で替えられる" }), pdItem("名前は？", "foo", { triage: "③", reason: "内部名", evidence: "[ADR](docs/adr/1.md)" }));

test("仮決め: 閉じた ticket の resolution に仮決めが 2 件あれば、仮決めごとに 1 件ずつ、題名・問い・答え・理由・根拠つきで map のスレッドへ出す", () => {
  const found = posts(decide(pdWorld({ comments: [byViewer(two)] })));
  assert.deepEqual(found, [
    {
      kind: "post-provisional-decision", key: "post-provisional-decision:20:21:1", map: 20, ticket: 21, n: 1, threadId: "900",
      title: "parser を選ぶ", question: "どの parser？", answer: "既存", reason: "後で替えられる", evidence: "なし",
    },
    {
      kind: "post-provisional-decision", key: "post-provisional-decision:20:21:2", map: 20, ticket: 21, n: 2, threadId: "900",
      title: "parser を選ぶ", question: "名前は？", answer: "foo", reason: "内部名", evidence: "[ADR](docs/adr/1.md)",
    },
  ]);
});

test("仮決め: open な ticket の resolution でも出す。task の ticket でも出す", () => {
  assert.equal(posts(decide(pdWorld({ state: "OPEN", comments: [byViewer(two)] }, { type: "task" }))).length, 2);
});

test("仮決め: 「## 次」など次の `## ` 見出し以降は仮決めとして読まない", () => {
  const body = `${pdComment(pdItem("Q1", "A1"))}\n## 次\n\n${pdItem("Q2", "A2")}\n`;
  assert.deepEqual(posts(decide(pdWorld({ comments: [byViewer(body)] }))).map((a) => a.question), ["Q1"]);
});

test("仮決め: 掲載の一周目は 1 度だけ出る。同じ周の中で重複しない", () => {
  const keys = posts(decide(pdWorld({ comments: [byViewer(two)] }))).map((a) => a.key);
  assert.deepEqual(keys, [...new Set(keys)]);
});

test("仮決め: 仮決めの節が無い resolution には出さない。節が空の resolution にも出さない", () => {
  assert.deepEqual(posts(decide(pdWorld({ comments: [byViewer("## 結果\n\n調べた。\n")] }))), []);
  assert.deepEqual(posts(decide(pdWorld({ comments: [byViewer("## 仮決め\n\n")] }))), []);
  assert.deepEqual(posts(decide(pdWorld({ comments: [] }))), []);
});

test("仮決め: 送る前の印がある仮決めには出さない。他の仮決めは出す", () => {
  const found = posts(decide(pdWorld({ comments: [byViewer(two), byViewer(PD_SENDING(21, 1))] })));
  assert.deepEqual(found.map((a) => a.n), [2]);
});

test("仮決め: 送った後の印（スレッドとメッセージの ID つき）がある仮決めには出さない", () => {
  const found = posts(decide(pdWorld({ comments: [byViewer(two), byViewer(PD_SENDING(21, 1)), byViewer(PD_SENT(21, 1)), byViewer(PD_SENDING(21, 2)), byViewer(PD_SENT(21, 2))] })));
  assert.deepEqual(found, []);
});

test("仮決め: 送った後の印だけがあっても出さない", () => {
  assert.deepEqual(posts(decide(pdWorld({ comments: [byViewer(two), byViewer(PD_SENT(21, 1)), byViewer(PD_SENT(21, 2))] }))), []);
});

test("仮決め: dispatched に key があれば出さない。同じ周の 2 周目も、印を足せば二重に出ない", () => {
  const s = pdWorld({ comments: [byViewer(two)] }, { over: { dispatched: ["post-provisional-decision:20:21:1"] } });
  assert.deepEqual(posts(decide(s)).map((a) => a.n), [2]);
  const first = pdWorld({ comments: [byViewer(pdComment(pdItem("Q", "A")))] });
  assert.equal(posts(decide(first)).length, 1);
  first.issues.find((i) => i.number === 21).comments.push(byViewer(PD_SENDING(21, 1)));
  assert.deepEqual(posts(decide(first)), []);
});

test("仮決め: 別の ticket（#21 は #2 に前方一致しない）・他人・行の途中の印では掲載済みとみなさない", () => {
  const s = mapWorld([wfTicket(2, "task", { title: "t2", state: "CLOSED", comments: [
    byViewer(pdComment(pdItem("Q", "A"))),
    byViewer(PD_SENDING(21, 1)),
    { author: "someone", body: PD_SENDING(2, 1) },
    { author: "someone", body: PD_SENT(2, 1) },
    byViewer(`メモ: ${PD_SENDING(2, 1)}`),
    byViewer(`${PD_SENDING(2, 1)} 続き`),
  ] })], { mapComments: threaded() });
  assert.deepEqual(posts(decide(s)).map((a) => [a.ticket, a.n]), [[2, 1]]);
});

test("仮決め: 別の仮決め番号の印では掲載済みとみなさない", () => {
  const s = pdWorld({ comments: [byViewer(pdComment(pdItem("Q", "A"))), byViewer(PD_SENDING(21, 11)), byViewer(PD_SENT(21, 2))] });
  assert.deepEqual(posts(decide(s)).map((a) => a.n), [1]);
});

test("仮決め: viewer 以外が書いた resolution は仮決めとして読まない", () => {
  assert.deepEqual(posts(decide(pdWorld({ comments: [{ author: "someone", body: two }] }))), []);
});

test("仮決め: コードフェンス（``` と ~~~、閉じ忘れ）の中の `## 仮決め` は数えない", () => {
  const inner = `## 仮決め\n\n${pdItem("Q", "A")}`;
  for (const body of [`\`\`\`markdown\n${inner}\n\`\`\``, `~~~\n${inner}\n~~~`, `\`\`\`\n${inner}`]) {
    assert.deepEqual(posts(decide(pdWorld({ comments: [byViewer(body)] }))), [], body);
  }
});

test("仮決め: 長いフェンスの中の短いフェンスで閉じたとみなさず、中の `## 仮決め` は数えない", () => {
  const inner = `## 仮決め\n\n${pdItem("Q", "A")}\n## 補足`;
  const body = `\`\`\`\`markdown\n\`\`\`markdown\n${inner}\n\`\`\`\n\`\`\`\``;
  assert.deepEqual(posts(decide(pdWorld({ comments: [byViewer(body)] }))), []);
});

test("仮決め: 長いフェンスが閉じた後の `## 仮決め` は数える（閉じる行が長くてもよい）", () => {
  for (const close of ["````", "`````"]) {
    const body = `\`\`\`\`markdown\n\`\`\`\n例\n\`\`\`\n${close}\n\n## 仮決め\n\n${pdItem("Q", "A")}`;
    assert.deepEqual(posts(decide(pdWorld({ comments: [byViewer(body)] }))).map((a) => [a.ticket, a.n, a.question]), [[21, 1, "Q"]], close);
  }
});

test("仮決め: 形に合わない仮決めが 1 件でもある resolution は、正しい仮決めも含めて 0 件にする", () => {
  const ok = pdItem("Q1", "A1");
  const bad = [
    "### Q2\n- 答え: A\n- 理由: R\n- 振り分け: ⓪\n- 根拠: なし",
    "### Q2\n- 答え: A\n- 振り分け: ①\n- 理由: R\n- 根拠: なし",
    "### Q2\n- 答え: A\n- 振り分け: ⓪\n- 理由: R",
    "### Q2\n- 答え: A\n- 振り分け: ⓪\n- 理由: R\n- 根拠: なし\n- 補足: 余分",
    "### Q2\n- 答え:\n- 振り分け: ⓪\n- 理由: R\n- 根拠: なし",
    "### Q2\n- 振り分け: ⓪\n- 答え: A\n- 理由: R\n- 根拠: なし",
  ];
  for (const b of bad) {
    assert.deepEqual(posts(decide(pdWorld({ comments: [byViewer(pdComment(ok, b))] }))), [], b);
  }
});

test("仮決め: `###` の問いが 1 つも無い節は 0 件", () => {
  const body = "## 仮決め\n\n- 答え: A\n- 振り分け: ⓪\n- 理由: R\n- 根拠: なし\n";
  assert.deepEqual(posts(decide(pdWorld({ comments: [byViewer(body)] }))), []);
});

test("仮決め: 振り分けは ⓪ と ③ を受け入れる。CRLF の本文も読める", () => {
  const body = pdComment(pdItem("Q1", "A1", { triage: "⓪" }), pdItem("Q2", "A2", { triage: "③" })).replace(/\n/g, "\r\n");
  assert.deepEqual(posts(decide(pdWorld({ comments: [byViewer(body)] }))).map((a) => a.question), ["Q1", "Q2"]);
});

test("仮決め: 複数のコメントに仮決めがあるとき、番号は ticket の中で通しになる。形に合わないコメントは番号を使わない", () => {
  const s = pdWorld({ comments: [byViewer(pdComment(pdItem("Q1", "A1"))), byViewer(pdComment("### 壊れ\n- 答え: A")), byViewer(pdComment(pdItem("Q2", "A2")))] });
  assert.deepEqual(posts(decide(s)).map((a) => [a.n, a.question]), [[1, "Q1"], [2, "Q2"]]);
});

test("仮決め: map のスレッドが無ければ、掲載の代わりにスレッドを立てる行動を 1 件だけ出す", () => {
  const actions = decide(pdWorld({ comments: [byViewer(two)] }, { mapComments: [] }));
  assert.deepEqual(posts(actions), []);
  assert.deepEqual(creates(actions), [createThread()]);
});

test("仮決め: スレッドの「立てる」印だけがあるときは、掲載もスレッド作成も出さない", () => {
  const actions = decide(pdWorld({ comments: [byViewer(two)] }, { mapComments: [byViewer(MT_CREATING)] }));
  assert.deepEqual(posts(actions), []);
  assert.deepEqual(creates(actions), []);
});

test("仮決め: 掲載済みで他に知らせることが無ければ、スレッドが無くてもスレッドは立てない", () => {
  const s = pdWorld({ comments: [byViewer(pdComment(pdItem("Q", "A"))), byViewer(PD_SENT(21, 1))] }, { mapComments: [] });
  assert.deepEqual(creates(decide(s)), []);
});

test("仮決め: 保留の map・閉じた map・map の子でない ticket には出さない", () => {
  assert.deepEqual(posts(decide(pdWorld({ comments: [byViewer(two)] }, { map: { labels: ["wayfinder:map", "wayfinder:on-hold"] } }))), []);
  assert.deepEqual(posts(decide(pdWorld({ comments: [byViewer(two)] }, { map: { state: "CLOSED" } }))), []);
  const orphan = snapshot([issue(20, { labels: ["wayfinder:map"], title: "地図", comments: threaded(), subIssues: [] }), wfTicket(21, "task", { state: "CLOSED", comments: [byViewer(two)] })]);
  assert.deepEqual(posts(decide(orphan)), []);
});

test("仮決め: 複数の map の子になっている ticket は、最初の map にだけ出す", () => {
  const ticket = wfTicket(21, "task", { state: "CLOSED", comments: [byViewer(pdComment(pdItem("Q", "A")))] });
  const s = snapshot([
    issue(20, { labels: ["wayfinder:map"], title: "地図", comments: threaded(), subIssues: [{ number: 21, state: "CLOSED" }] }),
    issue(30, { labels: ["wayfinder:map"], title: "別", comments: threaded(), subIssues: [{ number: 21, state: "CLOSED" }] }),
    ticket,
  ]);
  assert.deepEqual(posts(decide(s)).map((a) => [a.map, a.ticket]), [[20, 21]]);
});

test("仮決め: 既存の遷移（prototype の通知）は、仮決めがあっても変わらない", () => {
  const s = mapWorld([wfTicket(21, "prototype", { title: "試作" }), wfTicket(22, "task", { state: "CLOSED", comments: [byViewer(two)] })], { mapComments: threaded() });
  assert.deepEqual(notifies(decide(s)).map((a) => a.ticket), [21]);
  assert.equal(posts(decide(s)).length, 2);
});

// ---- 仮決めの差し戻し: 閉じた ticket の仮決めに本人が ❌ を押したら、ticket に書き戻して開き直し、claim を外す ----
const RJ = (t, n) => D.provisionalRejectedMarker(t, n, "どの parser？", "既存");
const rejects = (actions) => actions.filter((a) => a.kind === "reject-provisional-decision");
const ONE = pdComment(pdItem("どの parser？", "既存"));
// 掲載済み（メッセージ M1）で閉じた #21。既定では本人の ❌ が付いている。
const rjWorld = (ticketOver = {}, { reactions = { M1: [{ emoji: "❌", userId: OWNER }] }, over = {}, map = {} } = {}) =>
  pdWorld(
    { comments: [byViewer(ONE), byViewer(PD_SENDING(21, 1)), byViewer(PD_SENT(21, 1, "900", "M1"))], assignees: [VIEWER], ...ticketOver },
    { map, over: { discordUserId: OWNER, provisionalReactions: reactions, ...over } },
  );

test("差し戻しの書き戻し: 印の文言は 1 行目に ticket と仮決めの番号、続けて問いと答え。承認の差し戻しの印とも仮決めの掲載の印とも前方一致しない", () => {
  const m = RJ(21, 1);
  assert.equal(m.split("\n")[0], "案内役: Discord で仮決めが差し戻された（#21 仮決め 1）");
  assert.ok(m.includes("- 問い: どの parser？") && m.includes("- 答え: 既存"), m);
  assert.ok(!m.startsWith(D.MARKER_REJECTED));
  assert.ok(!m.split(/\r?\n/).some((l) => l.startsWith("## ") || l.startsWith("### ")), m);
});

test("差し戻しの書き戻し: 書き戻しコメントの本文は仮決めとして読まれない（通し番号が増えない）", () => {
  const t = wfTicket(21, "grilling", { comments: [byViewer(ONE), byViewer(D.provisionalRejectedMarker(21, 1, "どの parser？", "## 仮決め"))] });
  assert.deepEqual(D.provisionalDecisions(t, VIEWER).map((p) => p.n), [1]);
});

test("差し戻し: 閉じた ticket の掲載済みの仮決めに本人の ❌ があれば、書き戻しと開き直しの行動が 1 件だけ出る（問い・答え・外す assignee つき）", () => {
  const found = rejects(decide(rjWorld()));
  assert.deepEqual(found, [
    {
      kind: "reject-provisional-decision", key: "reject-provisional-decision:20:21:1", map: 20, ticket: 21,
      provisionals: [{ n: 1, question: "どの parser？", answer: "既存" }], assignees: [VIEWER],
    },
  ]);
});

test("差し戻し: 同じ ticket の複数の仮決めが差し戻されたら、1 件の行動に仮決めごとの問いと答えを束ねる（開き直しは 1 回）", () => {
  const w = rjWorld({
    comments: [byViewer(two), byViewer(PD_SENT(21, 1, "900", "M1")), byViewer(PD_SENT(21, 2, "900", "M2"))],
  }, { reactions: { M1: [{ emoji: "❌", userId: OWNER }], M2: [{ emoji: "❌", userId: OWNER }] } });
  const found = rejects(decide(w));
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].provisionals, [
    { n: 1, question: "どの parser？", answer: "既存" },
    { n: 2, question: "名前は？", answer: "foo" },
  ]);
  assert.equal(found[0].key, "reject-provisional-decision:20:21:1,2");
});

test("差し戻し: 書き戻しの印を足した 2 周目と、dispatched に key がある周には出ない（1 度だけ）", () => {
  const w = rjWorld();
  const first = rejects(decide(w));
  assert.equal(first.length, 1);
  assert.deepEqual(rejects(decide({ ...w, dispatched: [first[0].key] })), []);
  w.issues.find((i) => i.number === 21).comments.push(byViewer(RJ(21, 1)));
  assert.deepEqual(rejects(decide(w)), []);
});

test("差し戻し: 本人以外の ❌・本人の ✅ だけ・別のメッセージへの ❌・本人の ID が不明、では出ない", () => {
  const cases = [
    { M1: [{ emoji: "❌", userId: "U-other" }] },
    { M1: [{ emoji: "✅", userId: OWNER }] },
    { M2: [{ emoji: "❌", userId: OWNER }] },
    {},
  ];
  for (const reactions of cases) assert.deepEqual(rejects(decide(rjWorld({}, { reactions }))), [], JSON.stringify(reactions));
  assert.deepEqual(rejects(decide(rjWorld({}, { over: { discordUserId: undefined } }))), []);
  assert.deepEqual(rejects(decide({ ...rjWorld(), provisionalReactions: undefined })), []);
});

test("差し戻し: 書き戻し済みの判定は ticket の番号と書き手で区別する（他人・別の ticket・行の途中の字面は書き戻し済みにしない）", () => {
  const text = RJ(21, 1);
  const comments = (extra) => [byViewer(ONE), byViewer(PD_SENT(21, 1, "900", "M1")), ...extra];
  for (const extra of [
    [{ author: "someone", body: text }],
    [byViewer(RJ(2, 1))],
    [byViewer(`メモ: ${text}`)],
    [byViewer(RJ(21, 2))],
  ]) {
    assert.equal(rejects(decide(rjWorld({ comments: comments(extra) }))).length, 1, JSON.stringify(extra));
  }
});

test("差し戻し: ticket が open の間は出ない（閉じる前の差し戻しは、閉じてから開き直す）。閉じれば同じ ❌ で 1 件出る", () => {
  const w = rjWorld({ state: "OPEN" });
  assert.deepEqual(rejects(decide(w)), []);
  w.issues.find((i) => i.number === 21).state = "CLOSED";
  w.issues.find((i) => i.number === 20).subIssues = [{ number: 21, state: "CLOSED" }];
  assert.equal(rejects(decide(w)).length, 1);
});

test("差し戻し: 仮決めを流した印が無い（掲載前の）ticket、保留の map の ticket には出ない", () => {
  assert.deepEqual(rejects(decide(rjWorld({ comments: [byViewer(ONE)] }))), []);
  assert.deepEqual(rejects(decide(rjWorld({}, { map: ON_HOLD }))), []);
});

test("差し戻し: 書き戻しの行動は、開き直す前の assignee がいなくても出る（assignees は空のまま）", () => {
  const [a] = rejects(decide(rjWorld({ assignees: [] })));
  assert.deepEqual(a.assignees, []);
});

test("差し戻し: 読む対象は、閉じた ticket の、流した印があり書き戻し前の仮決めのスレッドとメッセージだけ", () => {
  const sent = (t, n, message) => byViewer(PD_SENT(t, n, "900", message));
  const s = mapWorld(
    [
      wfTicket(21, "grilling", { state: "CLOSED", comments: [byViewer(two), sent(21, 1, "M1"), sent(21, 2, "M2"), byViewer(RJ(21, 2))] }),
      wfTicket(22, "task", { state: "OPEN", comments: [byViewer(ONE), sent(22, 1, "M3")] }),
      wfTicket(23, "task", { state: "CLOSED", comments: [byViewer(ONE)] }),
    ],
    { mapComments: threaded() },
  );
  assert.deepEqual(D.provisionalRejectionsToRead(s), [{ threadId: "900", messageId: "M1" }]);
});

test("差し戻し: 純粋性。入力を変更せず、同じ入力に同じ出力を返す", () => {
  const s = deepFreeze(rjWorld());
  const first = decide(s);
  assert.equal(rejects(first).length, 1);
  assert.deepEqual(decide(s), first);
});

// ---- 開き直した回ごとに 1 度だけ起動する ----
const WF_REOPENED = (extra = []) => [byViewer(WF_LAUNCHING), byViewer(WF_LAUNCHED_AT("term_old")), byViewer(RJ(21, 1)), ...extra];
const reopened = (extra = [], over = {}) => wfTicket(21, "grilling", { title: "parser を選ぶ", comments: WF_REOPENED(extra), ...over });

test("開き直した回の起動: 前の回の起動の印が残っていても、書き戻しより後に起動の印が無ければ新しい key で 1 件出る（初回の key は変わらない）", () => {
  const s = mapWorld([reopened()], { mapComments: threaded() });
  assert.deepEqual(wfActions(decide(s)), [{ ...wfAction(21, "grilling"), key: "wayfinder:21:1" }]);
  assert.deepEqual(wfActions(decide(mapWorld([wfTicket(21, "grilling")], { mapComments: threaded() }))), [wfAction(21, "grilling")]);
});

test("開き直した回の起動: 同じ回では二重に起動しない。dispatched の新しい key、新しい回の起動前の印、起動後の印のどれでも止まる", () => {
  const world = (extra, over = {}) => mapWorld([reopened(extra)], { mapComments: threaded(), over });
  assert.deepEqual(wfActions(decide(world([], { dispatched: ["wayfinder:21:1"] }))), []);
  assert.deepEqual(wfActions(decide(world([byViewer(WF_LAUNCHING)]))), []);
  assert.deepEqual(wfActions(decide(world([byViewer(WF_LAUNCHING), byViewer(WF_LAUNCHED_AT("term_new"))]))), []);
});

test("開き直した回の起動: 前の回の key（wayfinder:21）が dispatched にあっても新しい回の起動は止まらず、2 周目（印を足した後）は 0 件", () => {
  const s = mapWorld([reopened()], { mapComments: threaded(), over: { dispatched: ["wayfinder:21"] } });
  const first = wfActions(decide(s));
  assert.deepEqual(first.map((a) => a.key), ["wayfinder:21:1"]);
  s.issues.find((i) => i.number === 21).comments.push(byViewer(WF_LAUNCHING));
  assert.deepEqual(wfActions(decide({ ...s, dispatched: ["wayfinder:21", first[0].key] })), []);
});

test("開き直した回の起動: 回は書き戻しの印の数で数える（2 回目の差し戻しの後は key wayfinder:21:2）。他人・別の ticket の書き戻しでは回が進まない", () => {
  const twice = reopened([byViewer(WF_LAUNCHING), byViewer(WF_LAUNCHED_AT("term_2")), byViewer(RJ(21, 1))]);
  assert.deepEqual(wfActions(decide(mapWorld([twice], { mapComments: threaded() }))).map((a) => a.key), ["wayfinder:21:2"]);
  const noise = wfTicket(21, "grilling", { comments: [byViewer(WF_LAUNCHING), byViewer(WF_LAUNCHED_AT("term_old")), { author: "someone", body: RJ(21, 1) }, byViewer(RJ(2, 1))] });
  assert.deepEqual(wfActions(decide(mapWorld([noise], { mapComments: threaded() }))), []);
});

test("開き直した回の起動: assignee が残る間（claim を外す前）は起動しない", () => {
  assert.deepEqual(wfActions(decide(mapWorld([reopened([], { assignees: [VIEWER] })], { mapComments: threaded() }))), []);
});

test("開き直した ticket の停止の観測: 書き戻しの後に起動の印が無い間は前の回の handle を観測せず、判断依頼も出さない。新しい起動の印の後は新しい handle", () => {
  const gone = { term_old: obs({ found: false, tail: [] }) };
  const s = mapWorld([reopened()], { mapComments: threaded(), over: { sessions: gone, now: at(1) } });
  assert.deepEqual(D.ticketSessionsToObserve(s), []);
  assert.deepEqual(mapDecisions(decide(s)), []);
  const fresh = mapWorld([reopened([byViewer(WF_LAUNCHING), byViewer(WF_LAUNCHED_AT("term_new"))], { assignees: [VIEWER] })], { mapComments: threaded() });
  assert.deepEqual(D.ticketSessionsToObserve(fresh).map((t) => t.handle), ["term_new"]);
});

// ---- to-spec: 晴れた map（霧が無く、子がすべて閉じていて、起動の印が無い）に to-spec を起動する ----
const TS_LAUNCHING = "案内役: to-spec を起動する";
const TS_LAUNCHED_AT = (handle = "term_s", at0 = T0) => `案内役: to-spec を起動した（ターミナル ${handle} / ${at0}）`;
const TS_CAUSE = "to-spec のセッションの停止";
const toSpecAction = (map = 20) => ({ kind: "to-spec", key: `to-spec:${map}`, map });
const toSpecs = (actions) => actions.filter((a) => a.kind === "to-spec");
const FOG_TEMPLATE = '## Not yet specified\n\n<!-- see "Fog of war": in-scope fog -->\n\n## Out of scope\n- 決済\n';
const closedChild = (n) => wfTicket(n, "research", { state: "CLOSED" });
// map #20（子 #21 #22 が CLOSED）。本文と上書きは引数で変える。
const clearWorld = ({ body = FOG_TEMPLATE, children = [closedChild(21), closedChild(22)], map = {}, over = {} } = {}) =>
  mapWorld(children, { map: { body, ...map }, over });

// 差し戻し（本人の ❌）が同じ周に子を開き直す map には、to-spec を出さない。
test("to-spec: 同じ周の差し戻しで開き直す子がある晴れた map には出さず、差し戻しだけを出す。❌ が無ければ出る", () => {
  const w = rjWorld({}, { map: { body: FOG_TEMPLATE } });
  const found = decide(w);
  assert.deepEqual(rejects(found).map((a) => [a.map, a.ticket]), [[20, 21]]);
  assert.deepEqual(toSpecs(found), []);
  const noReaction = decide(rjWorld({}, { map: { body: FOG_TEMPLATE }, reactions: {} }));
  assert.deepEqual(rejects(noReaction), []);
  assert.deepEqual(toSpecs(noReaction), [toSpecAction()]);
});

test("to-spec: 差し戻しの書き戻しの印がある（開き直し済みで再び閉じた）map には出る。未処理の ❌ が残れば出ない", () => {
  const done = rjWorld({ comments: [byViewer(ONE), byViewer(PD_SENDING(21, 1)), byViewer(PD_SENT(21, 1, "900", "M1")), byViewer(RJ(21, 1))] }, { map: { body: FOG_TEMPLATE } });
  assert.deepEqual(rejects(decide(done)), []);
  assert.deepEqual(toSpecs(decide(done)), [toSpecAction()]);
});

test("to-spec: 差し戻し対象の ticket を子に持たないほかの晴れた map には出る。共有された子を持つ map は除外する", () => {
  const base = rjWorld({}, { map: { body: FOG_TEMPLATE } });
  const clear = (n, child) => issue(n, { labels: ["wayfinder:map"], title: "別", comments: threaded(), body: FOG_TEMPLATE, subIssues: [{ number: child, state: "CLOSED" }] });
  const other = { ...base, issues: [...base.issues, clear(30, 31), wfTicket(31, "research", { state: "CLOSED" })] };
  assert.deepEqual(toSpecs(decide(other)).map((a) => a.key), ["to-spec:30"]);
  assert.deepEqual(rejects(decide(other)).map((a) => [a.map, a.ticket]), [[20, 21]]);
  const shared = { ...base, issues: [...base.issues, clear(40, 21)] };
  assert.deepEqual(toSpecs(decide(shared)), []);
  assert.deepEqual(rejects(decide(shared)).map((a) => [a.map, a.ticket]), [[20, 21]]);
});

test("to-spec: 霧が無く子がすべて CLOSED で印も無い map に、map 単位の起動を 1 件だけ出す", () => {
  assert.deepEqual(toSpecs(decide(clearWorld())), [toSpecAction()]);
});

test("to-spec: 子が CLOSED でも、霧が残っていれば出さない（frontier が空でも）", () => {
  const body = "## Not yet specified\n\n- 認証方式をどうするか\n\n## Out of scope\n";
  assert.deepEqual(toSpecs(decide(clearWorld({ body }))), []);
});

// 子がすべて閉じたのに霧が残る map は、黙って止まらず、霧を晴らす grilling の ticket を起こす。
// 霧の ticket だけが閉じて霧が残ったときに限り、map のスレッドへ判断依頼を送る。
const FOG_BODY = "## Not yet specified\n\n<!-- 説明 -->\n- 認証方式をどうするか\n- map #30 ができたら課金を決める\n\n## Out of scope\n- 決済\n";
const FOG_CAUSE = "霧の残り";
const fogWorld = (opts = {}) => clearWorld({ body: FOG_BODY, ...opts, map: { comments: threaded(...(opts.mapComments ?? [])), ...opts.map } });
const fogTickets = (actions) => actions.filter((a) => a.kind === "create-fog-ticket");

test("霧の残り: 子がすべて CLOSED で霧が残る map に、霧の行を本文に持つ ticket を起こす行動を 1 件出す。判断依頼も to-spec も出さない", () => {
  const actions = decide(fogWorld());
  assert.deepEqual(fogTickets(actions).map(({ body, ...a }) => a), [
    { kind: "create-fog-ticket", key: "create-fog-ticket:20:2", map: 20, children: 2, title: "残った霧を晴らす（地図）" },
  ]);
  const { body } = fogTickets(actions)[0];
  assert.match(body, /^## Question\n/);
  assert.match(body, /霧:\n- 認証方式をどうするか\n- map #30 ができたら課金を決める$/);
  assert.doesNotMatch(body, /説明|決済/);
  assert.deepEqual(mapDecisions(actions), []);
  assert.deepEqual(toSpecs(actions), []);
});

test("霧の残り: 前の霧の ticket の後に別の ticket が増えていれば、霧が残っていても起こし直す（子の数がキー）", () => {
  const actions = decide(fogWorld({ children: [closedChild(21), closedChild(22), closedChild(23)], mapComments: [byViewer(D.fogTicketMarker(1))] }));
  assert.deepEqual(fogTickets(actions).map((a) => a.key), ["create-fog-ticket:20:3"]);
  assert.deepEqual(mapDecisions(actions), []);
});

test("霧の残り: 霧の ticket だけが閉じて霧が残れば、起こし直さず、map のスレッドへ霧の行つきの判断依頼を 1 件出す", () => {
  const actions = decide(fogWorld({ mapComments: [byViewer(D.fogTicketMarker(1))] }));
  assert.deepEqual(fogTickets(actions), []);
  const found = mapDecisions(actions);
  assert.equal(found.length, 1);
  const [a] = found;
  assert.deepEqual({ ...a, reason: undefined }, {
    kind: "request-map-decision", key: `request-map-decision:20:20:${FOG_CAUSE}`, map: 20, issue: 20, cause: FOG_CAUSE, title: "地図", threadId: "900", reason: undefined,
  });
  assert.match(a.reason, /霧:\n- 認証方式をどうするか\n- map #30 ができたら課金を決める$/);
  // 起こす印はあるのに ticket が子に無い（作成が失敗した）ときも、起こし直さず判断依頼に回す。
  const failed = decide(fogWorld({ mapComments: [byViewer(D.fogTicketMarker(2))] }));
  assert.deepEqual(fogTickets(failed), []);
  assert.equal(mapDecisions(failed).length, 1);
});

test("霧の残り: dispatched があれば起こさない。open の子・霧なし・子が 0 件・保留の map にも起こさない", () => {
  assert.deepEqual(fogTickets(decide(fogWorld({ over: { dispatched: ["create-fog-ticket:20:2"] } }))), []);
  assert.deepEqual(fogTickets(decide(fogWorld({ children: [closedChild(21), wfTicket(22, "task", { assignees: ["daiki-beppu"] })] }))), []);
  assert.deepEqual(fogTickets(decide(clearWorld({ map: { comments: threaded() } }))), []);
  assert.deepEqual(fogTickets(decide(fogWorld({ children: [] }))), []);
  assert.deepEqual(fogTickets(decide(fogWorld({ map: { labels: ["wayfinder:map", "wayfinder:on-hold"] } }))), []);
});

test("霧の残り: 判断依頼の印か dispatched があれば判断依頼を再送しない。スレッドが無ければ先に立てる。霧の ticket はスレッドが無くても起こす", () => {
  const stuck = [byViewer(D.fogTicketMarker(1))];
  assert.deepEqual(mapDecisions(decide(fogWorld({ mapComments: [...stuck, byViewer(decisionMarker(20, FOG_CAUSE))] }))), []);
  assert.deepEqual(mapDecisions(decide(fogWorld({ mapComments: stuck, over: { dispatched: [`request-map-decision:20:20:${FOG_CAUSE}`] } }))), []);
  const noThread = decide(clearWorld({ body: FOG_BODY, map: { comments: stuck } })).map((a) => a.kind);
  assert.ok(noThread.includes("create-map-thread"));
  assert.ok(!noThread.includes("request-map-decision"));
  assert.equal(fogTickets(decide(clearWorld({ body: FOG_BODY }))).length, 1);
});

test("to-spec: 霧が無くても、claim 済み・ブロック中の ticket が開いていれば出さない（frontier が空でも）", () => {
  const claimed = clearWorld({ children: [closedChild(21), wfTicket(22, "task", { assignees: ["daiki-beppu"] })] });
  assert.deepEqual(wfActions(decide(claimed)), []);
  assert.deepEqual(toSpecs(decide(claimed)), []);
  const blocked = clearWorld({ children: [closedChild(21), wfTicket(22, "task", { blockedBy: [{ number: 9, state: "OPEN" }] })] });
  assert.deepEqual(toSpecs(decide(blocked)), []);
});

test("to-spec: frontier にまだ着手していない ticket があれば出さない。種類のラベルが無い開いた子でも出さない", () => {
  assert.deepEqual(toSpecs(decide(clearWorld({ children: [closedChild(21), wfTicket(22, "task")] }))), []);
  assert.deepEqual(toSpecs(decide(clearWorld({ children: [closedChild(21), issue(22, { assignees: ["x"], blockedBy: [] })] }))), []);
});

test("to-spec: 子が 0 件の map には出さない（起票の途中の空の map で起動しない）", () => {
  assert.deepEqual(toSpecs(decide(clearWorld({ children: [] }))), []);
});

test("to-spec: 起動前の印だけ・起動後の印だけ、どちらでも出さない（viewer が map に書いた印）", () => {
  assert.deepEqual(toSpecs(decide(clearWorld({ map: { comments: [byViewer(TS_LAUNCHING)] } }))), []);
  assert.deepEqual(toSpecs(decide(clearWorld({ map: { comments: [byViewer(TS_LAUNCHED_AT())] } }))), []);
});

test("to-spec: viewer 以外のコメントと、行の途中に印の字面があるだけのコメントは印とみなさない", () => {
  const comments = [{ author: "someone", body: TS_LAUNCHING }, { author: "someone", body: TS_LAUNCHED_AT() }, byViewer(`メモ: ${TS_LAUNCHING}`)];
  assert.deepEqual(toSpecs(decide(clearWorld({ map: { comments } }))), [toSpecAction()]);
});

test("to-spec: dispatched に key があれば出さない。同じスナップショットに印を足した 2 周目でも二重に出ない", () => {
  assert.deepEqual(toSpecs(decide(clearWorld({ over: { dispatched: ["to-spec:20"] } }))), []);
  const first = clearWorld();
  assert.equal(toSpecs(decide(first)).length, 1);
  first.issues.find((i) => i.number === 20).comments.push(byViewer(TS_LAUNCHING));
  assert.deepEqual(toSpecs(decide(first)), []);
});

test("to-spec: 保留（wayfinder:on-hold）の map と CLOSED の map には出さない", () => {
  assert.deepEqual(toSpecs(decide(clearWorld({ map: { labels: ["wayfinder:map", "wayfinder:on-hold"] } }))), []);
  assert.deepEqual(toSpecs(decide(clearWorld({ map: { state: "CLOSED" } }))), []);
});

test("to-spec: ticket 側の wayfinder の印は map の to-spec の印とみなさない", () => {
  const s = clearWorld({ children: [wfTicket(21, "research", { state: "CLOSED", comments: [byViewer(TS_LAUNCHING)] })] });
  assert.deepEqual(toSpecs(decide(s)), [toSpecAction()]);
});

test("to-spec: 複数の map は、晴れたものだけに map 順で 1 件ずつ出す", () => {
  const s = snapshot([
    issue(20, { labels: ["wayfinder:map"], body: FOG_TEMPLATE, subIssues: [{ number: 21, state: "CLOSED" }] }),
    issue(30, { labels: ["wayfinder:map"], body: "## Not yet specified\n- 残り", subIssues: [{ number: 31, state: "CLOSED" }] }),
    issue(40, { labels: ["wayfinder:map"], body: "", subIssues: [{ number: 41, state: "CLOSED" }] }),
    closedChild(21), closedChild(31), closedChild(41),
  ]);
  assert.deepEqual(toSpecs(decide(s)), [toSpecAction(20), toSpecAction(40)]);
});

test("to-spec: 既存の遷移（承認依頼・wayfinder の frontier）は変わらない", () => {
  const base = snapshot([specBare(12)]);
  const withClear = snapshot([specBare(12), ...clearWorld().issues]);
  assert.deepEqual(decide(withClear).filter((a) => a.kind !== "to-spec"), decide(base));
});

// -- 霧の判定 --

test("霧の判定: HTML コメントと空行だけの節は霧なし。節が無い本文・空の本文も霧なし", () => {
  assert.equal(D.hasFog(FOG_TEMPLATE), false);
  assert.equal(D.hasFog("## Not yet specified\n"), false);
  assert.equal(D.hasFog("## Not yet specified"), false);
  assert.equal(D.hasFog("## Out of scope\n- 決済\n"), false);
  assert.equal(D.hasFog(""), false);
});

test("霧の判定: 複数行の HTML コメントと CRLF の空行・空白だけの行でも霧なし", () => {
  assert.equal(D.hasFog("## Not yet specified\r\n\r\n<!--\r\n説明\r\n-->\r\n   \r\n## Out of scope\r\n- x"), false);
  assert.equal(D.hasFog("## Not yet specified\n<!-- a -->\n\n<!-- b\nc -->\n\t\n"), false);
});

test("霧の判定: コメントの外に 1 行でも文字があれば霧あり（コメントの前後・同じ行の後ろでも）", () => {
  assert.equal(D.hasFog("## Not yet specified\n<!-- 説明 -->\n- 認証方式をどうするか\n"), true);
  assert.equal(D.hasFog("## Not yet specified\n- 先に書いた\n<!-- 説明 -->\n"), true);
  assert.equal(D.hasFog("## Not yet specified\n<!-- 説明 --> 後ろに文字\n"), true);
  assert.equal(D.hasFog("## Not yet specified\r\n- 認証\r\n"), true);
});

test("霧の判定: 次の ## 見出しから後ろ（Out of scope など）の中身は霧に数えない。見出し前の中身は数えない", () => {
  assert.equal(D.hasFog("# 目的\n- 本文\n\n## Not yet specified\n<!-- x -->\n\n## Out of scope\n- 決済\n- 通知\n"), false);
  assert.equal(D.hasFog("## Not yet specified\n<!-- x -->\n## Next\n- a"), false);
});

test("霧の判定: 節の中のコードフェンスは中身として数える。フェンスの中の見出し風の行は節の境界にしない", () => {
  assert.equal(D.hasFog("## Not yet specified\n```\n<!-- x -->\n```\n"), true);
  assert.equal(D.hasFog("## Not yet specified\n```\n## Out of scope\n```\n"), true);
  assert.equal(D.hasFog("```\n## Not yet specified\n- 例\n```\n"), false);
});

test("霧の判定: 閉じていない <!-- は節の末尾まで読めないものとして中身に数えない", () => {
  assert.equal(D.hasFog("## Not yet specified\n<!-- 閉じ忘れ\n- 見えない行\n"), false);
  assert.equal(D.hasFog("## Not yet specified\n- 先頭\n<!-- 閉じ忘れ\n"), true);
});

test("霧の判定: HTML コメントの中の見出し・フェンスは節の境界にしない。コメントの後に残る霧は数える", () => {
  assert.equal(D.hasFog("## Not yet specified\n<!--\n## 説明\n-->\n- 未決事項\n"), true);
  assert.equal(D.hasFog("## Not yet specified\n<!--\n```\n-->\n- 未決事項\n"), true);
  assert.equal(D.hasFog("## Not yet specified\n<!--\n## 説明\n-->\n\n## Out of scope\n- 決済\n"), false);
  assert.deepEqual(toSpecs(decide(clearWorld({ body: "## Not yet specified\n<!--\n## 説明\n-->\n- 未決事項\n" }))), []);
});

test("霧の判定: 節が複数あれば、どれか 1 つに中身があれば霧あり", () => {
  assert.equal(D.hasFog("## Not yet specified\n<!-- a -->\n\n## Not yet specified\n- 残り\n"), true);
});

test("霧の判定: 見出しの字面が違う行（###、前方一致、行の途中）は節の開始とみなさない", () => {
  assert.equal(D.hasFog("### Not yet specified\n- a\n"), false);
  assert.equal(D.hasFog("## Not yet specified later\n- a\n"), false);
  assert.equal(D.hasFog("メモ ## Not yet specified\n- a\n"), false);
});

test("霧の判定: 入力の本文は書き換えない（純粋）", () => {
  const body = FOG_TEMPLATE;
  D.hasFog(body);
  assert.equal(body, FOG_TEMPLATE);
});

// -- to-spec のセッションの観測 --

const TS_MAP = (over = {}) => clearWorld({ map: { comments: threaded(byViewer(TS_LAUNCHING), byViewer(TS_LAUNCHED_AT())), ...over } });
const specOf = (n, body, labels = ["spec"]) => issue(n, { labels, body });
const tsStall = (extra = [], { sessions = { term_s: obs() }, now = at(1), over = {}, mapOver = {} } = {}) => {
  const s = TS_MAP(mapOver);
  s.issues.push(...extra);
  return { ...s, sessions, now, ...over };
};

test("to-spec の観測: 起動後の印（handle と時刻）がある map を、その handle と時刻で返す。複数あれば最後の印", () => {
  assert.deepEqual(D.mapSessionsToObserve(TS_MAP()), [{ map: 20, step: "to-spec", handle: "term_s", startedAt: T0 }]);
  const twice = TS_MAP({ comments: threaded(byViewer(TS_LAUNCHED_AT("term_old")), byViewer(TS_LAUNCHED_AT("term_new", at(5)))) });
  assert.deepEqual(D.mapSessionsToObserve(twice).map((t) => [t.handle, t.startedAt]), [["term_new", at(5)]]);
});

test("to-spec の観測: 起動前の印だけ・印が無い・他人の印・wayfinder の起動後の印しかない map は観測しない", () => {
  assert.deepEqual(D.mapSessionsToObserve(TS_MAP({ comments: threaded(byViewer(TS_LAUNCHING)) })), []);
  assert.deepEqual(D.mapSessionsToObserve(clearWorld()), []);
  assert.deepEqual(D.mapSessionsToObserve(TS_MAP({ comments: [{ author: "someone", body: TS_LAUNCHED_AT() }] })), []);
  assert.deepEqual(D.mapSessionsToObserve(TS_MAP({ comments: [byViewer(`案内役: wayfinder を起動した（ターミナル term_w / ${T0}）`)] })), []);
});

test("to-spec の観測: 保留の map と CLOSED の map は観測しない", () => {
  assert.deepEqual(D.mapSessionsToObserve(TS_MAP({ labels: ["wayfinder:map", "wayfinder:on-hold"] })), []);
  assert.deepEqual(D.mapSessionsToObserve(TS_MAP({ state: "CLOSED" })), []);
});

test("to-spec の観測: 停止の判断依頼の印が map にあれば観測しない", () => {
  const marked = TS_MAP({ comments: threaded(byViewer(TS_LAUNCHED_AT()), byViewer(`案内役: Discord に判断依頼を送る（#20 ${TS_CAUSE}）`)) });
  assert.deepEqual(D.mapSessionsToObserve(marked), []);
});

test("to-spec の観測: spec ラベルで本文に「元の map: #m」だけの行がある issue ができたら観測しない（状態は問わない）", () => {
  for (const state of ["OPEN", "CLOSED"]) {
    const s = TS_MAP();
    s.issues.push(issue(30, { state, labels: ["spec"], body: "概要\n元の map: #20\n以上" }));
    assert.deepEqual(D.mapSessionsToObserve(s), [], state);
  }
  const crlf = TS_MAP();
  crlf.issues.push(issue(30, { labels: ["spec", "spec-approved"], body: "概要\r\n元の map: #20  \r\n" }));
  assert.deepEqual(D.mapSessionsToObserve(crlf), []);
});

test("to-spec の観測: 別の map を指す行・行の途中の言及・spec ラベルの無い issue・本文に行が無い仕様は結果とみなさない", () => {
  const s = TS_MAP();
  s.issues.push(
    specOf(30, "元の map: #21"),
    specOf(31, "参考: 元の map: #20 を見た"),
    specOf(32, "元の map: #200"),
    specOf(33, "元の map: #20", []),
    specOf(34, "仕様のみ"),
  );
  assert.deepEqual(D.mapSessionsToObserve(s).map((t) => t.map), [20]);
});

test("to-spec の停止: 見つからない・入力待ち・stallMinutes 経過のどれかで、map のスレッドへ判断依頼を 1 件出す", () => {
  for (const [label, ctx] of [
    ["見つからない", { sessions: { term_s: obs({ found: false }) } }],
    ["入力待ち", { sessions: { term_s: obs({ waiting: true, idle: true }) } }],
    ["時間切れ", { now: at(61) }],
  ]) {
    const [req, ...rest] = mapDecisions(decide(tsStall([], ctx)));
    assert.equal(rest.length, 0, label);
    assert.equal(req.kind, "request-map-decision", label);
    assert.deepEqual([req.map, req.issue, req.cause, req.step, req.tab, req.threadId], [20, 20, TS_CAUSE, "to-spec", "to-spec #20", "900"], label);
    assert.equal(req.key, `request-map-decision:20:20:${TS_CAUSE}`, label);
    assert.equal(req.title, "地図", label);
    assert.equal(typeof req.reason, "string", label);
    assert.deepEqual(req.tail, ["line1", "line2"], label);
  }
});

test("to-spec の停止: 動いている間（見つかり・入力待ちでなく・時間内）は出さない", () => {
  assert.deepEqual(mapDecisions(decide(tsStall())), []);
});

test("to-spec の停止: 結果の仕様ができた・判断依頼の印がある・dispatched に key がある・観測が無い場合は出さない", () => {
  const stale = { sessions: { term_s: obs({ found: false }) } };
  assert.deepEqual(mapDecisions(decide(tsStall([specOf(30, "元の map: #20")], stale))), []);
  const marked = tsStall([], { ...stale, mapOver: { comments: threaded(byViewer(TS_LAUNCHED_AT()), byViewer(`案内役: Discord に判断依頼を送る（#20 ${TS_CAUSE}）`)) } });
  assert.deepEqual(mapDecisions(decide(marked)), []);
  assert.deepEqual(mapDecisions(decide(tsStall([], { ...stale, over: { dispatched: [`request-map-decision:20:20:${TS_CAUSE}`] } }))), []);
  assert.deepEqual(mapDecisions(decide(tsStall([], { sessions: {} , now: at(61) }))), []);
});

test("to-spec の停止: map のスレッドがまだ無ければ、判断依頼より先にスレッドを立てる行動を出す", () => {
  const s = tsStall([], { sessions: { term_s: obs({ found: false }) }, mapOver: { comments: [byViewer(TS_LAUNCHED_AT())] } });
  const actions = decide(s);
  assert.deepEqual(creates(actions), [createThread(20, "地図")]);
  assert.deepEqual(mapDecisions(actions), []);
});

test("to-spec の停止: 仕様のスレッド向けの request-decision は出さない（仕様がまだ無いので map のスレッドへ送る）", () => {
  const actions = decide(tsStall([], { sessions: { term_s: obs({ found: false }) } }));
  assert.deepEqual(actions.filter((a) => a.kind === "request-decision"), []);
});

// ---- takt のレビューが失敗した PR に、修正のセッションを起動する（review-fix） ----

const H1 = "1".repeat(40);
const H2 = "2".repeat(40);
const RF_BRANCH = "feat/21-something";
const rfFailed = (head, login = VIEWER) => ({ author: login, body: `${REVIEW_FAILED} for head ${head}: 指摘が残っている\n詳細` });
const rfLaunching = (head) => byViewer(fixLaunchingMarker(head));
const rfLaunched = (head) => byViewer(fixLaunchedMarker(head, "term_f", T0));
const rfRedo = (head) => byViewer(redoMarker(head));
const rfMerge = (over = {}) => ({ prNumber: 70, kind: "completed", createdAt: "2026-10-17T00:30:00Z", initialHead: H1, pushedHead: null, reports: "/repo/.takt/runs/run-1", ...over });

// 仕様 #12 の親 #20 が #21 #22 を takt-sequence に渡した状態。#21 の最新の takt タスクの PR #70 が OPEN。
// reviewPullRequests は snapshot.mjs が作る形（読み取り対象の PR だけ）。
const rfWorld = ({ comments = [rfFailed(H1)], head = H1, state = "OPEN", mergeTasks = [rfMerge()], specComments = SENT_ALL, checks = [], over = {} } = {}) =>
  snapshot(
    [
      spec(12, { comments: specComments }),
      issue(20, { body: "仕様: #12", comments: [byViewer(HANDED(21, 22)), byViewer(SEQ_LAUNCHED())], subIssues: openSubs(21, 22) }),
      issue(21),
      issue(22),
    ],
    {
      taktTasks: [{ issue: 21, kind: "completed", createdAt: "2026-10-17T00:00:00Z", prUrl: "https://github.com/o/r/pull/70" }],
      pullRequests: [{ number: 70, state, author: VIEWER, body: "", autoMerge: false, head, headBranch: RF_BRANCH }],
      reviewPullRequests: [{ spec: 12, issue: 21, number: 70, state, head, headBranch: RF_BRANCH, comments, checks }],
      mergeTasks,
      ...over,
    },
  );
const reviewFixes = (actions) => actions.filter((a) => a.kind === "review-fix");
const NO_RECORD = "（merge タスクの記録なし）";
const rfAction = (head = H1, over = {}) => ({ kind: "review-fix", key: `review-fix:70:${head}`, issue: 21, pr: 70, head, branch: RF_BRANCH, reports: "/repo/.takt/runs/run-1", ...over });

test("review-fix: 渡した sub-issue の OPEN な PR の現在の head に viewer の失敗のコメントがあれば、PR・issue・head・ブランチ・レポートの場所つきで 1 件出す", () => {
  assert.deepEqual(reviewFixes(decide(rfWorld())), [rfAction()]);
});

test("review-fix: レポートの場所は、PR 番号が一致し、その head を扱った merge タスクのうち最新のものから取る", () => {
  const s = rfWorld({
    mergeTasks: [
      rfMerge({ createdAt: "2026-10-17T00:10:00Z", reports: "/repo/.takt/runs/old" }),
      rfMerge({ createdAt: "2026-10-17T00:50:00Z", reports: "/repo/.takt/runs/new" }),
      rfMerge({ createdAt: "2026-10-17T00:59:00Z", initialHead: H2, reports: "/repo/.takt/runs/other-head" }),
      rfMerge({ createdAt: "2026-10-17T00:59:00Z", prNumber: 71, reports: "/repo/.takt/runs/other-pr" }),
    ],
  });
  assert.equal(reviewFixes(decide(s))[0].reports, "/repo/.takt/runs/new");
  const pushed = rfWorld({ mergeTasks: [rfMerge({ initialHead: H2, pushedHead: H1, reports: "/repo/.takt/runs/pushed" })] });
  assert.equal(reviewFixes(decide(pushed))[0].reports, "/repo/.takt/runs/pushed");
});

test("review-fix: merge タスクの記録が無くても出す。レポートの場所は「記録なし」の文言にする", () => {
  assert.equal(reviewFixes(decide(rfWorld({ mergeTasks: [] })))[0].reports, "（merge タスクの記録なし）");
});

test("review-fix: 失敗のコメントが viewer 以外のものなら出さない", () => {
  assert.deepEqual(reviewFixes(decide(rfWorld({ comments: [rfFailed(H1, "someone")] }))), []);
});

test("review-fix: 失敗のコメントが無い（レビューが成功した、またはレビューそのものが落ちた）head には出さない。merge タスクが 2 回 failed でも出さない", () => {
  assert.deepEqual(reviewFixes(decide(rfWorld({ comments: [] }))), []);
  const ok = rfWorld({ comments: [byViewer(`TAKT review completed for head ${H1}; ok`)] });
  assert.deepEqual(reviewFixes(decide(ok)), []);
  const crashed = rfWorld({ comments: [], mergeTasks: [rfMerge({ kind: "failed" }), rfMerge({ kind: "failed", createdAt: "2026-10-17T00:40:00Z" })] });
  assert.deepEqual(reviewFixes(decide(crashed)), []);
});

test("review-fix: 同じ head に 1 段目の印だけ、または 2 段目の印だけがあれば出さない", () => {
  assert.deepEqual(reviewFixes(decide(rfWorld({ comments: [rfFailed(H1), rfLaunching(H1)] }))), []);
  assert.deepEqual(reviewFixes(decide(rfWorld({ comments: [rfFailed(H1), rfLaunched(H1)] }))), []);
  assert.deepEqual(reviewFixes(decide(rfWorld({ comments: [rfFailed(H1), rfLaunching(H1), rfLaunched(H1)] }))), []);
});

test("review-fix: 起動の印が viewer 以外のものなら数えず、出す", () => {
  const other = { author: "someone", body: fixLaunchingMarker(H1) };
  assert.deepEqual(reviewFixes(decide(rfWorld({ comments: [rfFailed(H1), other] }))), [rfAction()]);
});

test("review-fix: 同じ head にやり直しの印があれば出さない。別の head のやり直しの印では止めない", () => {
  assert.deepEqual(reviewFixes(decide(rfWorld({ comments: [rfFailed(H1), rfRedo(H1)] }))), []);
  assert.deepEqual(reviewFixes(decide(rfWorld({ comments: [rfFailed(H1), rfRedo(H2)] }))), [rfAction()]);
});

test("review-fix: やり直しの印が viewer 以外のものなら止めない", () => {
  const other = { author: "someone", body: redoMarker(H1) };
  assert.deepEqual(reviewFixes(decide(rfWorld({ comments: [rfFailed(H1), other] }))), [rfAction()]);
});

test("review-fix: 起動の回数は head を問わず 1 段目の印で数え、上限（2）に達していれば新しい head の失敗にも出さない", () => {
  const two = [rfLaunching(H1), rfLaunched(H1), rfLaunching(H2), rfLaunched(H2)];
  const s = rfWorld({ head: "3".repeat(40), comments: [...two, rfFailed("3".repeat(40))] });
  assert.deepEqual(reviewFixes(decide(s)), []);
});

test("review-fix: 1 回目の起動（1 段目と 2 段目で 1 回）の後の新しい head の失敗には、もう一度出す", () => {
  const s = rfWorld({ head: H2, comments: [rfLaunching(H1), rfLaunched(H1), rfFailed(H2)] });
  assert.deepEqual(reviewFixes(decide(s)), [rfAction(H2, { reports: NO_RECORD })]);
});

test("review-fix: 1 段目の印だけが 2 件（起動の途中で止まった 2 回）でも上限に達したと数える", () => {
  const s = rfWorld({ head: "3".repeat(40), comments: [rfLaunching(H1), rfLaunching(H2), rfFailed("3".repeat(40))] });
  assert.deepEqual(reviewFixes(decide(s)), []);
});

test("review-fix: push で head が変わり、新しい head に失敗のコメントが無ければ何も出さない（古い head の失敗・起動の印は無関係）", () => {
  const s = rfWorld({ head: H2, comments: [rfFailed(H1), rfLaunching(H1), rfLaunched(H1)] });
  assert.deepEqual(reviewFixes(decide(s)), []);
});

test("review-fix: 古い head にだけ失敗があり、現在の head に失敗があれば、現在の head のキーで出す", () => {
  const s = rfWorld({ head: H2, comments: [rfFailed(H1), rfFailed(H2)] });
  assert.deepEqual(reviewFixes(decide(s)), [rfAction(H2, { reports: NO_RECORD })]);
});

test("review-fix: PR が OPEN でなければ出さない", () => {
  assert.deepEqual(reviewFixes(decide(rfWorld({ state: "CLOSED" }))), []);
  assert.deepEqual(reviewFixes(decide(rfWorld({ state: "MERGED" }))), []);
});

test("review-fix: 読み取った PR が無い（reviewPullRequests が空・未設定）なら出さない", () => {
  assert.deepEqual(reviewFixes(decide(rfWorld({ over: { reviewPullRequests: [] } }))), []);
  const { reviewPullRequests, ...without } = rfWorld();
  assert.deepEqual(reviewFixes(decide(without)), []);
});

test("review-fix: 同じスナップショットで 2 周しても二重に出さない（dispatched のキーで止める）。新しい head のキーは止めない", () => {
  const s = rfWorld();
  const [first] = reviewFixes(decide(s));
  assert.deepEqual(reviewFixes(decide({ ...s, dispatched: [first.key] })), []);
  const next = rfWorld({ head: H2, comments: [rfFailed(H2)], over: { dispatched: [first.key] } });
  assert.deepEqual(reviewFixes(decide(next)), [rfAction(H2, { reports: NO_RECORD })]);
});

// ---- takt のレビュー失敗の判断依頼（上限・やり直し後の失敗・レビューそのものが落ちた） ----

const RF_CAUSE = "takt のレビュー失敗";
const reviewDecisions = (actions) => actions.filter((a) => a.kind === "request-review-decision");
const H3 = "3".repeat(40);
// 判断依頼の期待値（reason は文言を固定せず、別に確かめる）。レポートの場所は reports に入れる。
const rdAction = (over = {}) => ({
  kind: "request-review-decision", key: `request-decision:12:70:${RF_CAUSE}`, spec: 12, issue: 21, pr: 70, head: H1, cause: RF_CAUSE,
  title: "issue 21", threadId: "555", reports: "/repo/.takt/runs/run-1", ...over,
});
const rfRedoAt = (head, minutes) => ({ author: VIEWER, body: redoMarker(head), createdAt: at(minutes) });
const rfCrashMerge = (minutes, over = {}) => rfMerge({ kind: "failed", createdAt: at(minutes), ...over });
// 上限（2）に達した状態: 別の head で 2 回起動済み、現在の head（H3）に失敗のコメントがあり、現在の head の印は無い。
const limitWorld = (over = {}) => rfWorld({ head: H3, comments: [rfLaunching(H1), rfLaunched(H1), rfLaunching(H2), rfLaunched(H2), rfFailed(H3)], mergeTasks: [rfMerge({ initialHead: H3 })], ...over });

test("判断依頼（上限）: 現在の head に失敗のコメントがあり、その head の起動の印もやり直しの印も無く、起動が上限（2）に達していれば、原因 takt のレビュー失敗の判断依頼を 1 件出し、review-fix は出さない", () => {
  const actions = decide(limitWorld());
  const [a, ...rest] = reviewDecisions(actions);
  assert.deepEqual(rest, []);
  assert.deepEqual(withoutReason(a), rdAction({ head: H3 }));
  assert.match(a.reason, /上限/);
  assert.match(a.reason, /指摘が残っている/);
  assert.deepEqual(reviewFixes(actions), []);
  assert.equal(D.CAUSE_REVIEW_FAILED, RF_CAUSE);
});

test("判断依頼（上限）: 1 回の起動（1 段目と 2 段目で 1 回）の後なら出さず、review-fix を出す。1 段目の印だけ 2 件でも上限に達したと数える", () => {
  const one = rfWorld({ head: H2, comments: [rfLaunching(H1), rfLaunched(H1), rfFailed(H2)] });
  assert.deepEqual(reviewDecisions(decide(one)), []);
  assert.equal(reviewFixes(decide(one)).length, 1);
  const halves = rfWorld({ head: H3, comments: [rfLaunching(H1), rfLaunching(H2), rfFailed(H3)] });
  assert.equal(reviewDecisions(decide(halves)).length, 1);
});

test("判断依頼（上限）: 現在の head に起動の印（1 段目・2 段目）かやり直しの印があれば、上限に達していても出さない（修正中・やり直し待ち）", () => {
  const base = [rfLaunching(H1), rfLaunched(H1), rfLaunching(H2), rfLaunched(H2)];
  for (const mark of [rfLaunching(H3), rfLaunched(H3), rfRedo(H3)]) {
    const s = rfWorld({ head: H3, comments: [...base, rfFailed(H3), mark], mergeTasks: [] });
    assert.deepEqual(reviewDecisions(decide(s)), [], mark.body);
    assert.deepEqual(reviewFixes(decide(s)), [], mark.body);
  }
});

test("判断依頼（上限）: 失敗のコメントが viewer 以外のもの、または現在の head のものでなければ出さない。viewer 以外の起動の印は数えない", () => {
  const two = [rfLaunching(H1), rfLaunched(H1), rfLaunching(H2), rfLaunched(H2)];
  assert.deepEqual(reviewDecisions(decide(rfWorld({ head: H3, comments: [...two, rfFailed(H3, "someone")], mergeTasks: [] }))), []);
  assert.deepEqual(reviewDecisions(decide(rfWorld({ head: H3, comments: [...two, rfFailed(H1)], mergeTasks: [] }))), []);
  const others = [{ author: "someone", body: fixLaunchingMarker(H1) }, { author: "someone", body: fixLaunchingMarker(H2) }, rfFailed(H3)];
  assert.deepEqual(reviewDecisions(decide(rfWorld({ head: H3, comments: others, mergeTasks: [] }))), []);
  assert.equal(reviewFixes(decide(rfWorld({ head: H3, comments: others, mergeTasks: [] }))).length, 1);
});

test("判断依頼（やり直しの後の失敗）: 現在の head のやり直しの印より後に同じ head の失敗のコメントがあれば、判断依頼を 1 件出し、review-fix は出さない", () => {
  const actions = decide(rfWorld({ comments: [rfFailed(H1), rfRedo(H1), rfFailed(H1)] }));
  const [a, ...rest] = reviewDecisions(actions);
  assert.deepEqual(rest, []);
  assert.deepEqual(withoutReason(a), rdAction());
  assert.match(a.reason, /やり直し/);
  assert.deepEqual(reviewFixes(actions), []);
});

test("判断依頼（やり直しの後の失敗）: 同じ head にやり直しの印が複数あるときは最初の印を基準にする。やり直し → 失敗 → やり直し でも判断依頼を 1 件出し、review-fix は出さない", () => {
  const actions = decide(rfWorld({ comments: [rfRedo(H1), rfFailed(H1), rfRedo(H1)] }));
  const [a, ...rest] = reviewDecisions(actions);
  assert.deepEqual(rest, []);
  assert.deepEqual(withoutReason(a), rdAction());
  assert.match(a.reason, /やり直し/);
  assert.match(a.reason, /指摘が残っている/);
  assert.deepEqual(reviewFixes(actions), []);
});

test("判断依頼（レビューそのものが落ちた）: 同じ head にやり直しの印が複数あるときは最初の印より後の failed を数える", () => {
  const s = rfWorld({
    comments: [rfRedoAt(H1, 5), rfRedoAt(H1, 30)],
    mergeTasks: [rfCrashMerge(10), rfCrashMerge(20)],
  });
  const actions = decide(s);
  const [a, ...rest] = reviewDecisions(actions);
  assert.deepEqual(rest, []);
  assert.match(a.reason, /2 回落ちた/);
  assert.deepEqual(reviewFixes(actions), []);
});

test("判断依頼（やり直しの後の失敗）: 起動の印がある head でも、やり直しの印より後に失敗していれば出す。上限に達していなくても出す", () => {
  const s = rfWorld({ comments: [rfFailed(H1), rfLaunching(H1), rfLaunched(H1), rfRedo(H1), rfFailed(H1)] });
  assert.equal(reviewDecisions(decide(s)).length, 1);
  assert.deepEqual(reviewFixes(decide(s)), []);
});

test("判断依頼（やり直しの後の失敗）: 失敗がやり直しの印より前だけなら出さない（やり直し待ち）。別の head のやり直しの印の後の失敗や、viewer 以外の失敗では出さない", () => {
  const waiting = rfWorld({ comments: [rfFailed(H1), rfFailed(H1), rfRedo(H1)] });
  assert.deepEqual(reviewDecisions(decide(waiting)), []);
  assert.deepEqual(reviewFixes(decide(waiting)), []);
  const otherHead = rfWorld({ comments: [rfFailed(H1), rfRedo(H2), rfFailed(H1)] });
  assert.deepEqual(reviewDecisions(decide(otherHead)), []);
  assert.equal(reviewFixes(decide(otherHead)).length, 1);
  const stranger = rfWorld({ comments: [rfFailed(H1), rfRedo(H1), rfFailed(H1, "someone")] });
  assert.deepEqual(reviewDecisions(decide(stranger)), []);
  const strangerRedo = rfWorld({ comments: [rfFailed(H1), { author: "someone", body: redoMarker(H1) }, rfFailed(H1)] });
  assert.deepEqual(reviewDecisions(decide(strangerRedo)), []);
});

test("判断依頼（やり直しの後の失敗）: やり直しの印の後に別の head の失敗しかなければ、現在の head の判断依頼は出ない", () => {
  const s = rfWorld({ head: H2, comments: [rfFailed(H1), rfRedo(H1), rfFailed(H1)] });
  assert.deepEqual(reviewDecisions(decide(s)), []);
});

test("判断依頼（レビューそのものが落ちた）: 失敗・完了のコメントが無く、現在の head で merge タスクが 2 回 failed なら、判断依頼を 1 件出し、review-fix は出さない。レポートの場所は最新の merge タスクから取る", () => {
  const tasks = [rfCrashMerge(10, { reports: "/repo/.takt/runs/first" }), rfCrashMerge(40, { reports: "/repo/.takt/runs/second" })];
  const actions = decide(rfWorld({ comments: [], mergeTasks: tasks }));
  const [a, ...rest] = reviewDecisions(actions);
  assert.deepEqual(rest, []);
  assert.deepEqual(withoutReason(a), rdAction({ reports: "/repo/.takt/runs/second" }));
  assert.match(a.reason, /2 回落ちた/);
  assert.deepEqual(reviewFixes(actions), []);
});

test("判断依頼（レビューそのものが落ちた）: 現在の head を pushedHead として扱った failed の merge タスクも数える。別の head・別の PR のタスクは数えない", () => {
  const pushed = rfWorld({ comments: [], mergeTasks: [rfCrashMerge(10), rfCrashMerge(20, { initialHead: H2, pushedHead: H1 })] });
  assert.equal(reviewDecisions(decide(pushed)).length, 1);
  const mixed = rfWorld({ comments: [], mergeTasks: [rfCrashMerge(10), rfCrashMerge(20, { initialHead: H2 }), rfCrashMerge(30, { prNumber: 71 })] });
  assert.deepEqual(reviewDecisions(decide(mixed)), []);
});

test("判断依頼（レビューそのものが落ちた）: failed が 1 件、failed 以外（completed）が 2 件、merge タスクが 0 件のときは出さない（普通の失敗・成功を落ちたと誤判定しない）", () => {
  assert.deepEqual(reviewDecisions(decide(rfWorld({ comments: [], mergeTasks: [rfCrashMerge(10)] }))), []);
  assert.deepEqual(reviewDecisions(decide(rfWorld({ comments: [], mergeTasks: [rfMerge(), rfMerge({ createdAt: at(40) })] }))), []);
  assert.deepEqual(reviewDecisions(decide(rfWorld({ comments: [], mergeTasks: [] }))), []);
});

test("判断依頼（レビューそのものが落ちた）: 完了のコメントがある head、実行中・待機中の merge タスクがある head では、failed が 2 件あっても出さない", () => {
  const two = [rfCrashMerge(10), rfCrashMerge(20)];
  const reviewed = rfWorld({ comments: [byViewer(`TAKT review completed for head ${H1}; ok`)], mergeTasks: two });
  assert.deepEqual(reviewDecisions(decide(reviewed)), []);
  for (const kind of ["running", "pending"]) {
    const busy = rfWorld({ comments: [], mergeTasks: [...two, rfMerge({ kind, createdAt: at(30) })] });
    assert.deepEqual(reviewDecisions(decide(busy)), [], kind);
  }
  const strangerDone = rfWorld({ comments: [{ author: "someone", body: `TAKT review completed for head ${H1}; ok` }], mergeTasks: two });
  assert.equal(reviewDecisions(decide(strangerDone)).length, 1);
});

test("判断依頼（レビューそのものが落ちた）: 現在の head に失敗のコメントがあり、やり直しの印が無ければ、failed が 2 件でも出さない（上限・修正の経路に任せる）", () => {
  const s = rfWorld({ comments: [rfFailed(H1)], mergeTasks: [rfCrashMerge(10), rfCrashMerge(20)] });
  assert.deepEqual(reviewDecisions(decide(s)), []);
  assert.equal(reviewFixes(decide(s)).length, 1);
});

test("判断依頼（レビューそのものが落ちた）: やり直しの印より前の failed の merge タスクは数えない。印より後に 2 件あれば出す", () => {
  const redo = rfRedoAt(H1, 25);
  const before = rfWorld({ comments: [redo], mergeTasks: [rfCrashMerge(10), rfCrashMerge(20)] });
  assert.deepEqual(reviewDecisions(decide(before)), []);
  const oneAfter = rfWorld({ comments: [redo], mergeTasks: [rfCrashMerge(10), rfCrashMerge(40)] });
  assert.deepEqual(reviewDecisions(decide(oneAfter)), []);
  const twoAfter = rfWorld({ comments: [redo], mergeTasks: [rfCrashMerge(10), rfCrashMerge(30), rfCrashMerge(40)] });
  assert.equal(reviewDecisions(decide(twoAfter)).length, 1);
  assert.deepEqual(reviewFixes(decide(twoAfter)), []);
});

test("判断依頼（レビューそのものが落ちた）: やり直しの印の後の failed が 2 件でも、同じ head のやり直しの印より後に失敗のコメントがあれば、判断依頼は 1 件だけ（二重に出さない）", () => {
  const s = rfWorld({
    comments: [rfFailed(H1), rfRedoAt(H1, 25), rfFailed(H1)],
    mergeTasks: [rfCrashMerge(30), rfCrashMerge(40)],
  });
  assert.equal(reviewDecisions(decide(s)).length, 1);
});

test("判断依頼: PR が OPEN でなければ、どの経路でも出さない", () => {
  for (const state of ["CLOSED", "MERGED"]) {
    assert.deepEqual(reviewDecisions(decide(limitWorld({ state }))), [], state);
    assert.deepEqual(reviewDecisions(decide(rfWorld({ state, comments: [rfFailed(H1), rfRedo(H1), rfFailed(H1)] }))), [], state);
    assert.deepEqual(reviewDecisions(decide(rfWorld({ state, comments: [], mergeTasks: [rfCrashMerge(10), rfCrashMerge(20)] }))), [], state);
  }
});

test("判断依頼: 同じスナップショットで 2 周しても二重に出さない（dispatched のキーで止める）。経路ごとに同じ原因なので、同じ PR の別 head では同じキーになる", () => {
  for (const s of [
    limitWorld(),
    rfWorld({ comments: [rfFailed(H1), rfRedo(H1), rfFailed(H1)] }),
    rfWorld({ comments: [], mergeTasks: [rfCrashMerge(10), rfCrashMerge(20)] }),
  ]) {
    const [first] = reviewDecisions(decide(s));
    assert.deepEqual(reviewDecisions(decide({ ...s, dispatched: [first.key] })), []);
    assert.equal(reviewDecisions(decide(s))[0].key, first.key);
  }
});

test("判断依頼: 仕様に同じ PR・同じ原因の送信の印があれば、dispatched が空でも出さない（印は行動より先に書くので、再起動後も二重に送らない）", () => {
  const marker = byViewer(decisionMarker(70, RF_CAUSE));
  assert.equal(marker.body, "案内役: Discord に判断依頼を送る（#70 takt のレビュー失敗）");
  assert.deepEqual(reviewDecisions(decide(limitWorld({ specComments: [...SENT_ALL, marker] }))), []);
  assert.deepEqual(reviewDecisions(decide(rfWorld({ comments: [rfFailed(H1), rfRedo(H1), rfFailed(H1)], specComments: [...SENT_ALL, marker] }))), []);
  assert.deepEqual(reviewDecisions(decide(rfWorld({ comments: [], mergeTasks: [rfCrashMerge(10), rfCrashMerge(20)], specComments: [...SENT_ALL, marker] }))), []);
});

test("判断依頼: 別の PR の番号の印・別の原因の印・viewer 以外の印では止めない（#70 と #7 は別）", () => {
  const others = [
    byViewer(decisionMarker(7, RF_CAUSE)),
    byViewer(decisionMarker(70, "takt の ABORT")),
    { author: "someone", body: decisionMarker(70, RF_CAUSE) },
  ];
  const [a, ...rest] = reviewDecisions(decide(limitWorld({ specComments: [...SENT_ALL, ...others] })));
  assert.deepEqual(rest, []);
  assert.equal(a.pr, 70);
});

test("判断依頼: 送り先は PR を持つ sub-issue の仕様の承認依頼のスレッド。承認依頼を送っていない仕様には出さない", () => {
  const [a] = reviewDecisions(decide(limitWorld()));
  assert.equal(a.threadId, "555");
  assert.equal(a.spec, 12);
  assert.deepEqual(reviewDecisions(decide(limitWorld({ specComments: [] }))), []);
});

// ---- 修正のセッション（review-fix）の停止 ----

const RF_STALL_CAUSE = "review-fix のセッションの停止";
const fixStalls = (actions) => actions.filter((a) => a.kind === "request-decision" && a.cause === RF_STALL_CAUSE);
const fixSession = (over = {}) => ({ term_f: obs(over) });
// 修正のセッションを起動済み（head H1 / handle term_f / 起動時刻 T0）で、結果はまだ無い PR #70。
const stalledFix = ({ comments = [rfFailed(H1), rfLaunching(H1), rfLaunched(H1)], sessions = fixSession({ waiting: true }), now = at(1), head = H1, specComments, over = {} } = {}) =>
  rfWorld({ comments, head, specComments, over: { sessions, now, ...over } });

test("修正のセッションの停止: 行動に PR・sub-issue と、H を扱った最新の merge タスクの reports を持つ。無ければ記録なしの文言", () => {
  const [a] = fixStalls(decide(stalledFix()));
  assert.equal(a.pr, 70);
  assert.equal(a.subIssue, 21);
  assert.equal(a.reports, rfMerge().reports);
  const [none] = fixStalls(decide(stalledFix({ over: { mergeTasks: [] } })));
  assert.equal(none.reports, "（merge タスクの記録なし）");
});

test("修正のセッションの停止: 結果が無く入力待ちなら、原因 review-fix のセッションの停止の判断依頼を 1 件出す。送り先は仕様の承認依頼のスレッド、印は PR の番号、タブは review-fix #PR、画面の数行つき", () => {
  const actions = decide(stalledFix());
  const [a, ...rest] = fixStalls(actions);
  assert.deepEqual(rest, []);
  assert.equal(a.spec, 12);
  assert.equal(a.issue, 70);
  assert.equal(a.cause, RF_STALL_CAUSE);
  assert.equal(a.threadId, "555");
  assert.equal(a.step, "review-fix");
  assert.equal(a.tab, "review-fix #70");
  assert.deepEqual(a.tail, ["line1", "line2"]);
  assert.match(a.reason, /入力待ち/);
  assert.equal(a.title, "issue 12");
  // 修正のセッションの停止は、レビュー失敗の判断依頼（kind も原因も別）とは混ざらない
  assert.deepEqual(reviewDecisions(actions), []);
});

test("修正のセッションの停止: 既存の停止の観測と同じ規則（見つからない → 入力待ち → 時間切れ）。見つからないなら時刻によらず、時間切れは 60 分ちょうどから、手が止まっているだけ（idle）では出さない", () => {
  const [lost] = fixStalls(decide(stalledFix({ sessions: fixSession({ found: false, tail: [] }), now: at(1) })));
  assert.match(lost.reason, /見つから/);
  assert.deepEqual(lost.tail, []);
  const [timeout, ...rest] = fixStalls(decide(stalledFix({ sessions: fixSession(), now: at(60) })));
  assert.deepEqual(rest, []);
  assert.match(timeout.reason, /60 分/);
  assert.deepEqual(fixStalls(decide(stalledFix({ sessions: fixSession(), now: at(59) }))), []);
  assert.deepEqual(fixStalls(decide(stalledFix({ sessions: fixSession({ idle: true }), now: at(1) }))), []);
  assert.deepEqual(fixStalls(decide(stalledFix({ sessions: fixSession(), now: at(60), over: { stallMinutes: 120 } }))), []);
  assert.equal(fixStalls(decide(stalledFix({ sessions: fixSession(), now: at(30), over: { stallMinutes: 30 } }))).length, 1);
});

test("修正のセッションの停止: 時間切れは 2 段目の印の起動時刻から数える（1 段目の印や失敗のコメントの時刻ではない）", () => {
  const launchedLate = byViewer(fixLaunchedMarker(H1, "term_f", at(50)));
  const comments = [rfFailed(H1), rfLaunching(H1), launchedLate];
  assert.deepEqual(fixStalls(decide(stalledFix({ comments, sessions: fixSession(), now: at(100) }))), []);
  assert.equal(fixStalls(decide(stalledFix({ comments, sessions: fixSession(), now: at(110) }))).length, 1);
});

test("修正のセッションの停止: 観測が無い（sessions に handle が無い）なら出さない。2 段目の印が無い（1 段目だけ）なら観測の対象にも出さない", () => {
  assert.deepEqual(fixStalls(decide(stalledFix({ sessions: {} }))), []);
  const halfway = stalledFix({ comments: [rfFailed(H1), rfLaunching(H1)], sessions: fixSession({ found: false }) });
  assert.deepEqual(fixStalls(decide(halfway)), []);
  assert.deepEqual(D.reviewFixSessionsToObserve(halfway), []);
});

test("修正のセッションの停止: 現在の head が印の head から変わっていれば、見つからない・時間切れでも止まった扱いにせず、観測の対象にも出さない", () => {
  const s = stalledFix({ head: H2, comments: [rfFailed(H1), rfLaunching(H1), rfLaunched(H1)], sessions: fixSession({ found: false }), now: at(500) });
  assert.deepEqual(fixStalls(decide(s)), []);
  assert.deepEqual(D.reviewFixSessionsToObserve(s), []);
});

test("修正のセッションの停止: 印の head にやり直しの印が付いていれば、見つからない・時間切れでも止まった扱いにせず、観測の対象にも出さない。別の head や viewer 以外のやり直しの印は結果にならない", () => {
  const redone = stalledFix({ comments: [rfFailed(H1), rfLaunching(H1), rfLaunched(H1), rfRedo(H1)], sessions: fixSession({ found: false }), now: at(500) });
  assert.deepEqual(fixStalls(decide(redone)), []);
  assert.deepEqual(D.reviewFixSessionsToObserve(redone), []);
  for (const other of [rfRedo(H2), { author: "someone", body: redoMarker(H1) }]) {
    const s = stalledFix({ comments: [rfFailed(H1), rfLaunching(H1), rfLaunched(H1), other], sessions: fixSession({ found: false }), now: at(500) });
    assert.equal(fixStalls(decide(s)).length, 1);
    assert.equal(D.reviewFixSessionsToObserve(s).length, 1);
  }
});

test("修正のセッションの停止: 印の head にやり直しの印が付いた後でも、ほかの経路（やり直しの後の失敗）の判断依頼とは混ざらない（停止は 0 件、レビュー失敗は 1 件）", () => {
  const s = stalledFix({ comments: [rfFailed(H1), rfLaunching(H1), rfLaunched(H1), rfRedo(H1), rfFailed(H1)], sessions: fixSession({ found: false }), now: at(500) });
  assert.deepEqual(fixStalls(decide(s)), []);
  assert.equal(reviewDecisions(decide(s)).length, 1);
});

test("修正のセッションの停止: 判断依頼は 1 度だけ。dispatched のキー、仕様の停止の印のどちらでも止まる。別の原因の印・別の PR の印・viewer 以外の印では止まらない", () => {
  const s = stalledFix();
  const [first] = fixStalls(decide(s));
  assert.deepEqual(fixStalls(decide({ ...s, dispatched: [first.key] })), []);
  assert.equal(fixStalls(decide(s))[0].key, first.key);
  const marker = (n, cause, login = VIEWER) => ({ author: login, body: decisionMarker(n, cause) });
  assert.deepEqual(fixStalls(decide(stalledFix({ specComments: [...SENT_ALL, marker(70, RF_STALL_CAUSE)] }))), []);
  assert.deepEqual(D.reviewFixSessionsToObserve(stalledFix({ specComments: [...SENT_ALL, marker(70, RF_STALL_CAUSE)] })), []);
  for (const other of [marker(70, RF_CAUSE), marker(7, RF_STALL_CAUSE), marker(70, RF_STALL_CAUSE, "someone"), marker(12, RF_STALL_CAUSE)]) {
    assert.equal(fixStalls(decide(stalledFix({ specComments: [...SENT_ALL, other] }))).length, 1, other.body);
  }
});

test("修正のセッションの停止: 停止の判断依頼の印が、レビュー失敗の判断依頼を止めない（原因ごとに 1 度）", () => {
  const stall = byViewer(decisionMarker(70, RF_STALL_CAUSE));
  const s = limitWorld({ specComments: [...SENT_ALL, stall] });
  assert.equal(reviewDecisions(decide(s)).length, 1);
});

test("修正のセッションの停止: PR が OPEN でなければ出さず、観測の対象にも出さない", () => {
  const s = stalledFix({ sessions: fixSession({ found: false }) });
  for (const state of ["CLOSED", "MERGED"]) {
    const closed = { ...s, reviewPullRequests: s.reviewPullRequests.map((p) => ({ ...p, state })) };
    assert.deepEqual(fixStalls(decide(closed)), [], state);
    assert.deepEqual(D.reviewFixSessionsToObserve(closed), [], state);
  }
});

test("reviewFixSessionsToObserve: 結果が無い PR の viewer の最後の 2 段目の印から、仕様・PR・sub-issue・handle・起動時刻を返す", () => {
  const second = byViewer(fixLaunchedMarker(H2, "term_g", at(10)));
  const s = rfWorld({ head: H2, comments: [rfFailed(H1), rfLaunching(H1), rfLaunched(H1), rfFailed(H2), rfLaunching(H2), second] });
  assert.deepEqual(D.reviewFixSessionsToObserve(s), [{ spec: 12, pr: 70, issue: 21, handle: "term_g", startedAt: at(10) }]);
});

test("reviewFixSessionsToObserve: 最後の印の head に結果が出ていれば、それより前の印の handle も観測しない", () => {
  const second = byViewer(fixLaunchedMarker(H2, "term_g", at(10)));
  const s = rfWorld({ head: H3, comments: [rfFailed(H1), rfLaunching(H1), rfLaunched(H1), rfLaunching(H2), second] });
  assert.deepEqual(D.reviewFixSessionsToObserve(s), []);
});

test("reviewFixSessionsToObserve: 起動の印が viewer 以外のもの、読み取った PR が無い（未設定・空）ときは返さない", () => {
  const stranger = rfWorld({ comments: [rfFailed(H1), { author: "someone", body: fixLaunchedMarker(H1, "term_f", T0) }] });
  assert.deepEqual(D.reviewFixSessionsToObserve(stranger), []);
  assert.deepEqual(D.reviewFixSessionsToObserve(rfWorld({ over: { reviewPullRequests: [] } })), []);
  const { reviewPullRequests, ...without } = rfWorld();
  assert.deepEqual(D.reviewFixSessionsToObserve(without), []);
});

test("修正のセッションの停止: 同じスナップショットで 2 周しても、停止の判断依頼が二重に出ない（1 周目の key を dispatched に入れて 0 件）", () => {
  const s = stalledFix({ sessions: fixSession({ found: false }) });
  const first = fixStalls(decide(s));
  assert.equal(first.length, 1);
  assert.deepEqual(fixStalls(decide({ ...s, dispatched: first.map((a) => a.key) })), []);
});

// 読み取り対象（snapshot.mjs が PR のコメントを読む範囲）
const rfToRead = (over = {}) => {
  const { reviewPullRequests, mergeTasks, ...base } = rfWorld({ over });
  return D.reviewPullRequestsToRead(base);
};

test("reviewPullRequestsToRead: 渡した sub-issue の最新の takt タスクの PR が OPEN なら、issue・番号・state・head・head ブランチを返す", () => {
  assert.deepEqual(rfToRead(), [{ spec: 12, issue: 21, number: 70, state: "OPEN", head: H1, headBranch: RF_BRANCH }]);
});

test("reviewPullRequestsToRead: PR を持たない sub-issue（takt タスクが無い・prUrl が無い）と、PR が OPEN でないものは返さない", () => {
  assert.deepEqual(rfToRead({ taktTasks: [] }), []);
  assert.deepEqual(rfToRead({ taktTasks: [{ issue: 21, kind: "running", createdAt: "2026-10-17T00:00:00Z" }] }), []);
  assert.deepEqual(rfToRead({ pullRequests: [{ number: 70, state: "CLOSED", author: VIEWER, body: "", autoMerge: false, head: H1, headBranch: RF_BRANCH }] }), []);
  assert.deepEqual(rfToRead({ pullRequests: [] }), []);
});

test("reviewPullRequestsToRead: 最新の takt タスクの PR だけを見る（古いタスクの PR は見ない）", () => {
  const tasks = [
    { issue: 21, kind: "failed", createdAt: "2026-10-17T00:00:00Z", prUrl: "https://github.com/o/r/pull/60" },
    { issue: 21, kind: "completed", createdAt: "2026-10-17T01:00:00Z", prUrl: "https://github.com/o/r/pull/70" },
  ];
  const prs = [60, 70].map((number) => ({ number, state: "OPEN", author: VIEWER, body: "", autoMerge: false, head: H1, headBranch: `b${number}` }));
  assert.deepEqual(rfToRead({ taktTasks: tasks, pullRequests: prs }).map((r) => r.number), [70]);
});

test("reviewPullRequestsToRead: takt-sequence に渡していない issue の PR と、渡した sub-issue でも閉じたものの PR は返さない", () => {
  const extra = issue(30);
  const base = rfWorld();
  const s = {
    ...base,
    issues: [...base.issues.map((i) => (i.number === 20 ? { ...i, subIssues: [{ number: 21, state: "OPEN" }, { number: 22, state: "CLOSED" }] } : i)), extra],
    taktTasks: [
      ...base.taktTasks,
      { issue: 30, kind: "completed", createdAt: "2026-10-17T00:00:00Z", prUrl: "https://github.com/o/r/pull/80" },
      { issue: 22, kind: "completed", createdAt: "2026-10-17T00:00:00Z", prUrl: "https://github.com/o/r/pull/81" },
    ],
    pullRequests: [...base.pullRequests, ...[80, 81].map((number) => ({ number, state: "OPEN", author: VIEWER, body: "", autoMerge: false, head: H2, headBranch: `b${number}` }))],
  };
  assert.deepEqual(D.reviewPullRequestsToRead(s).map((r) => r.number), [70]);
});

test("reviewPullRequestsToRead: 親が takt-sequence に渡す前、または viewer 以外が渡した印の親の sub-issue の PR は返さない", () => {
  const base = rfWorld();
  const patch = (comments) => ({ ...base, issues: base.issues.map((i) => (i.number === 20 ? { ...i, comments } : i)) });
  assert.deepEqual(D.reviewPullRequestsToRead(patch([])), []);
  assert.deepEqual(D.reviewPullRequestsToRead(patch([{ author: "someone", body: HANDED(21, 22) }])), []);
});

// ---- 終わったタブを閉じる: 結果が GitHub に出て手が止まったタブ ----

const closes = (actions) => actions.filter((a) => a.kind === "close-tab");
const closeTab = (issue, step, handle, gone = false) => ({ kind: "close-tab", key: `close-tab:${handle}`, issue, step, handle, gone });
// to-tickets を handle term_1 で起動し、結果の親 #20 ができた仕様 #12
const doneWorld = ({ comments = [], sessions = { term_1: obs({ idle: true }) }, over = {} } = {}) =>
  snapshot(
    [spec(12, { comments: [...SENT_ALL, byViewer(LAUNCHING), byViewer(LAUNCHED), ...comments] }), issue(20, { body: "仕様: #12", comments: [byViewer(HANDED(21))], subIssues: openSubs(21) }), issue(21)],
    { sessions, now: at(1), ...over },
  );

test("タブを閉じる: 結果があり手が止まった（idle）工程のタブは close-tab を出す。印は工程の印と同じ issue", () => {
  assert.deepEqual(closes(decide(doneWorld())), [closeTab(12, "to-tickets", "term_1")]);
});

test("タブを閉じる: 結果があっても手が止まっていなければ出さない。結果が無ければ idle でも出さない", () => {
  assert.deepEqual(closes(decide(doneWorld({ sessions: { term_1: obs({ idle: false }) } }))), []);
  assert.deepEqual(closes(decide(stallWorld({ sessions: { term_1: obs({ idle: true }) } }))), []);
});

test("タブを閉じる: 既に見つからないタブは close せず印だけ書く（gone: true）", () => {
  assert.deepEqual(closes(decide(doneWorld({ sessions: { term_1: obs({ found: false, tail: [] }) } }))), [closeTab(12, "to-tickets", "term_1", true)]);
});

test("タブを閉じる: 閉じた印がある handle と、判断依頼を送った工程には出さず、観測もしない", () => {
  const closed = doneWorld({ comments: [byViewer(closedTabMarker("to-tickets", "term_1"))] });
  assert.deepEqual(tabsToClose(closed), []);
  assert.deepEqual(closes(decide(closed)), []);
  const asked = doneWorld({ comments: [byViewer(stallMarker(12, "to-tickets"))] });
  assert.deepEqual(tabsToClose(asked), []);
  assert.deepEqual(closes(decide(asked)), []);
});

test("タブを閉じる: 古い印の handle を閉じた印は、新しい handle の工程を止めない（handle ごとに区別する）", () => {
  const relaunched = doneWorld({
    comments: [byViewer(closedTabMarker("to-tickets", "term_0")), byViewer(launchedMarker("to-tickets", "term_2", at(5)))],
    sessions: { term_2: obs({ idle: true }) },
  });
  assert.deepEqual(closes(decide(relaunched)), [closeTab(12, "to-tickets", "term_2")]);
});

test("タブを閉じる: knowledge は学びの PR、formal-spec は Formal Spec コメントがあれば結果ありとして閉じる", () => {
  const s = snapshot(
    [spec(12, { comments: [...SENT_ALL, byViewer(launchedMarker("knowledge", "term_k", T0)), byViewer(launchedMarker("formal-spec", "term_f", T0))] })],
    { sessions: { term_k: obs({ idle: true }), term_f: obs({ idle: true }) }, now: at(1), pullRequests: [{ number: 9, state: "OPEN", author: VIEWER, body: "学びの元の仕様: #12", autoMerge: true }] },
  );
  assert.deepEqual(closes(decide(s)).map((a) => a.handle).sort(), ["term_f", "term_k"]);
});

test("タブを閉じる: takt-sequence は渡した sub-issue がすべて閉じ、終わりの行があれば出す。印は親に書く", () => {
  const subsClosed = [21, 22, 23].map((number) => ({ number, state: "CLOSED" }));
  const done = { term_s: obs({ tail: [`${SEQUENCE_DONE}（exit 0）`, "$"] }) };
  assert.deepEqual(closes(decide(seqWorld({ subs: subsClosed, sessions: done }))), [closeTab(20, "takt-sequence", "term_s")]);
  assert.deepEqual(closes(decide(seqWorld({ subs: subsClosed, sessions: { term_s: obs({ tail: ["マージ完了: #23"] }) } }))), []);
  assert.deepEqual(closes(decide(seqWorld({ sessions: done }))), []);
});

test("タブを閉じる: takt-sequence の停止で判断依頼を送った親・閉じた印がある親には出さない", () => {
  const subsClosed = [21, 22, 23].map((number) => ({ number, state: "CLOSED" }));
  const done = { term_s: obs({ tail: [`${SEQUENCE_DONE}（exit 0）`] }) };
  const asked = seqWorld({ subs: subsClosed, sessions: done, specComments: [byViewer(decisionMarker(20, "takt-sequence のセッションの停止"))] });
  assert.deepEqual(closes(decide(asked)), []);
  const closed = seqWorld({ subs: subsClosed, sessions: done, parentComments: [byViewer(HANDED(21, 22, 23)), byViewer(SEQ_LAUNCHED()), byViewer(closedTabMarker("takt-sequence", "term_s"))] });
  assert.deepEqual(tabsToClose(closed), []);
});

test("タブを閉じる: 同じスナップショットで 2 周しても二重に出さない（dispatched の key で止まる）", () => {
  const [a] = closes(decide(doneWorld()));
  assert.deepEqual(closes(decide(doneWorld({ over: { dispatched: [a.key] } }))), []);
});

test("tabsToClose: 結果が出た工程・takt-sequence の handle を返す（停止の観測とは重ならない）", () => {
  assert.deepEqual(tabsToClose(doneWorld()), [{ issue: 12, step: "to-tickets", handle: "term_1" }]);
  assert.deepEqual(sessionsToObserve(doneWorld()), []);
  assert.deepEqual(tabsToClose(stallWorld()), []);
});

test("closedTabMarker: 工程と handle を持つ", () => {
  assert.equal(closedTabMarker("to-tickets", "term_1"), "案内役: to-tickets のタブを閉じた（ターミナル term_1）");
});

test("タブを閉じる: formal-spec の最後の結果が failed なら、判断依頼の前後を問わず閉じない（人が答える場所）", () => {
  const FAILED = "## Formal Spec（takt 0.71.0 の検証器で failed）";
  const s = snapshot([spec(12, { comments: [...SENT_ALL, byViewer(launchedMarker("formal-spec", "term_f", T0)), byViewer(FAILED)] })], { sessions: { term_f: obs({ idle: true }) }, now: at(1) });
  assert.deepEqual(closes(decide(s)), []);
});

test("タブを閉じる: 結果があり idle でも、入力待ち（waiting）なら閉じない", () => {
  assert.deepEqual(closes(decide(doneWorld({ sessions: { term_1: obs({ idle: true, waiting: true }) } }))), []);
});

test("タブを閉じる: 閉じた印がある handle は、結果が消えても停止の観測に戻さない（工程・takt-sequence）", () => {
  const closedStep = stallWorld({ comments: [byViewer(closedTabMarker("to-tickets", "term_1"))], sessions: { term_1: obs({ found: false }) } });
  assert.deepEqual(sessionsToObserve(closedStep), []);
  assert.deepEqual(stalls(decide(closedStep)), []);
  const reopened = seqWorld({ parentComments: [byViewer(HANDED(21, 22, 23)), byViewer(SEQ_LAUNCHED()), byViewer(closedTabMarker("takt-sequence", "term_s"))], sessions: { term_s: obs({ found: false }) } });
  assert.deepEqual(sequencesToObserve(reopened), []);
  assert.deepEqual(seqStalls(decide(reopened)), []);
});

// map #20 の子 #21（research、term_1 で起動済み）が閉じた世界
const IDLE_1 = { term_1: obs({ idle: true }) };
const wfDone = (ticketOver = {}, { mapComments = threaded(), map = {}, sessions = IDLE_1 } = {}) =>
  mapWorld([launchedTicket(21, "research", { state: "CLOSED", ...ticketOver })], { mapComments, map, over: { sessions, now: at(1) } });

test("タブを閉じる: wayfinder の ticket が閉じ、手が止まった（idle）タブは close-tab を出す。印は ticket に書く", () => {
  assert.deepEqual(closes(decide(wfDone())), [closeTab(21, "wayfinder", "term_1")]);
});

test("タブを閉じる: close-tab は同じ周の他の行動より先に出す", () => {
  const s = mapWorld([launchedTicket(21, "research", { state: "CLOSED" }), wfTicket(22, "research")], { mapComments: threaded(), over: { sessions: IDLE_1, now: at(1) } });
  const kinds = decide(s).map((a) => a.kind);
  assert.ok(kinds.includes("wayfinder"));
  assert.equal(kinds[0], "close-tab");
});

test("タブを閉じる: wayfinder の ticket が open の間は、idle でも出さない", () => {
  assert.deepEqual(closes(decide(wfDone({ state: "OPEN" }))), []);
});

test("タブを閉じる: wayfinder の ticket が閉じても、idle でない・入力待ちのタブは出さない", () => {
  assert.deepEqual(closes(decide(wfDone({}, { sessions: { term_1: obs({ idle: false }) } }))), []);
  assert.deepEqual(closes(decide(wfDone({}, { sessions: { term_1: obs({ idle: true, waiting: true }) } }))), []);
});

test("タブを閉じる: wayfinder の既に見つからないタブは close せず印だけ書く（gone: true）", () => {
  assert.deepEqual(closes(decide(wfDone({}, { sessions: { term_1: obs({ found: false, tail: [] }) } }))), [closeTab(21, "wayfinder", "term_1", true)]);
});

test("タブを閉じる: wayfinder の閉じた印が ticket にあれば出さず、map に同じ ticket の停止の判断依頼の印があっても出さない（grilling も）", () => {
  const closed = wfDone({ comments: [byViewer(WF_LAUNCHING), byViewer(WF_LAUNCHED_AT("term_1")), byViewer(closedTabMarker("wayfinder", "term_1"))] });
  assert.deepEqual(tabsToClose(closed), []);
  assert.deepEqual(closes(decide(closed)), []);
  assert.deepEqual(closes(decide(wfDone({}, { mapComments: threaded(byViewer(decisionMarker(21, WF_CAUSE("research")))) }))), []);
  assert.deepEqual(closes(decide(wfDone({ labels: ["wayfinder:grilling"] }, { mapComments: threaded(byViewer(decisionMarker(21, WF_CAUSE("grilling")))) }))), []);
  assert.deepEqual(closes(decide(wfDone({}, { mapComments: threaded(byViewer(decisionMarker(22, WF_CAUSE("research")))) }))), [closeTab(21, "wayfinder", "term_1")]);
});

test("タブを閉じる: 開き直した ticket は今の回の最後の起動の handle だけを閉じる。今の回に起動が無ければ出さない", () => {
  const sessions = { term_old: obs({ idle: true }), term_new: obs({ idle: true }) };
  const again = wfTicket(21, "grilling", { state: "CLOSED", comments: WF_REOPENED([byViewer(WF_LAUNCHING), byViewer(WF_LAUNCHED_AT("term_new"))]) });
  assert.deepEqual(closes(decide(mapWorld([again], { mapComments: threaded(), over: { sessions, now: at(1) } }))), [closeTab(21, "wayfinder", "term_new")]);
  const notYet = wfTicket(21, "grilling", { state: "CLOSED", comments: WF_REOPENED() });
  assert.deepEqual(closes(decide(mapWorld([notYet], { mapComments: threaded(), over: { sessions, now: at(1) } }))), []);
});

test("タブを閉じる: 複数の map の子の ticket は 1 度だけ。保留の map の子は閉じない", () => {
  const s = snapshot(
    [
      issue(20, { labels: ["wayfinder:map"], comments: threaded(), subIssues: [{ number: 21, state: "CLOSED" }] }),
      issue(30, { labels: ["wayfinder:map"], comments: threaded(), subIssues: [{ number: 21, state: "CLOSED" }] }),
      launchedTicket(21, "research", { state: "CLOSED" }),
    ],
    { sessions: IDLE_1, now: at(1) },
  );
  assert.deepEqual(closes(decide(s)), [closeTab(21, "wayfinder", "term_1")]);
  assert.deepEqual(closes(decide(wfDone({}, { map: { labels: ["wayfinder:map", "wayfinder:on-hold"] } }))), []);
});

test("タブを閉じる: to-spec は map の仕様ができ、手が止まったタブに close-tab を出す。印は map に書く。仕様がまだ無ければ出さない", () => {
  const idle = { sessions: { term_s: obs({ idle: true }) } };
  assert.deepEqual(closes(decide(tsStall([specOf(30, "元の map: #20")], idle))), [closeTab(20, "to-spec", "term_s")]);
  assert.deepEqual(closes(decide(tsStall([], idle))), []);
});

test("タブを閉じる: to-spec の閉じた印・停止の判断依頼の印が map にあれば出さない", () => {
  const idle = { sessions: { term_s: obs({ idle: true }) } };
  const closed = tsStall([specOf(30, "元の map: #20")], { ...idle, mapOver: { comments: threaded(byViewer(TS_LAUNCHED_AT()), byViewer(closedTabMarker("to-spec", "term_s"))) } });
  assert.deepEqual(tabsToClose(closed), []);
  const asked = tsStall([specOf(30, "元の map: #20")], { ...idle, mapOver: { comments: threaded(byViewer(TS_LAUNCHED_AT()), byViewer(decisionMarker(20, TS_CAUSE))) } });
  assert.deepEqual(closes(decide(asked)), []);
});

test("タブを閉じる: 閉じた印がある handle は、ticket が開き直されても・仕様が消えても停止の観測に戻さない（wayfinder・to-spec）", () => {
  const ticket = mapWorld(
    [launchedTicket(21, "research", { comments: [byViewer(WF_LAUNCHING), byViewer(WF_LAUNCHED_AT("term_1")), byViewer(closedTabMarker("wayfinder", "term_1"))] })],
    { mapComments: threaded(), over: { sessions: { term_1: obs({ found: false }) }, now: at(1) } },
  );
  assert.deepEqual(D.ticketSessionsToObserve(ticket), []);
  assert.deepEqual(mapDecisions(decide(ticket)), []);
  const map = tsStall([], { sessions: { term_s: obs({ found: false }) }, mapOver: { comments: threaded(byViewer(TS_LAUNCHED_AT()), byViewer(closedTabMarker("to-spec", "term_s"))) } });
  assert.deepEqual(D.mapSessionsToObserve(map), []);
});

test("tabsToClose: 閉じた wayfinder の ticket・仕様ができた map の handle は、停止の観測と重ならない", () => {
  assert.deepEqual(tabsToClose(wfDone()), [{ issue: 21, step: "wayfinder", handle: "term_1" }]);
  assert.deepEqual(D.ticketSessionsToObserve(wfDone()), []);
  const spec = tsStall([specOf(30, "元の map: #20")]);
  assert.deepEqual(tabsToClose(spec), [{ issue: 20, step: "to-spec", handle: "term_s" }]);
  assert.deepEqual(D.mapSessionsToObserve(spec), []);
});

// ---- 判断依頼の答え: 送った印（メッセージ M）への本人の返信か ✅ で、答えた印を書く ----
const DA_SENT = (n, cause, message = "M5") => `案内役: Discord に判断依頼を送った（#${n} ${cause} / スレッド 555 / メッセージ ${message}）`;
const DA_ANSWERED = (n, cause) => `案内役: 判断依頼に答えた（#${n} ${cause}）`;
const daSpec = (comments) => issue(12, { labels: ["spec"], comments: [byViewer(SENDING), byViewer(SENT()), ...comments.map(byViewer)] });
const daMap = (comments) => issue(30, { labels: ["wayfinder:map"], comments: [byViewer(MT_CREATED()), ...comments.map(byViewer)] });
const daAbort = [decisionMarker(21, "takt の ABORT"), DA_SENT(21, "takt の ABORT")];
const answers = (actions) => actions.filter((a) => a.kind === "record-decision-answer");
const daWorld = (issues, decisionAnswers) => snapshot(issues, { discordUserId: OWNER, ...(decisionAnswers === undefined ? {} : { decisionAnswers }) });

test("decisionAnswersToRead: 送った印があり答えた印の無い、仕様と map の判断依頼だけのスレッドとメッセージを返す", () => {
  const s = daWorld([
    daSpec([...daAbort, decisionMarker(12, "formal-spec の検証失敗")]),
    daMap([decisionMarker(31, "research のセッションの停止"), DA_SENT(31, "research のセッションの停止", "M6"), decisionMarker(30, "霧の残り"), DA_SENT(30, "霧の残り", "M7"), DA_ANSWERED(30, "霧の残り")]),
  ]);
  assert.deepEqual(D.decisionAnswersToRead(s), [{ threadId: "555", messageId: "M5" }, { threadId: "555", messageId: "M6" }]);
});

test("decisionAnswersToRead: 閉じた仕様・保留の map・fromSpec より前の仕様・送る前の印だけの判断依頼は読まない", () => {
  const closed = daWorld([{ ...daSpec(daAbort), state: "CLOSED" }]);
  const onHold = daWorld([{ ...daMap([decisionMarker(30, "霧の残り"), DA_SENT(30, "霧の残り")]), labels: ["wayfinder:map", "wayfinder:on-hold"] }]);
  const before = { ...daWorld([daSpec(daAbort)]), fromSpec: 13 };
  const unsent = daWorld([daSpec([decisionMarker(21, "takt の ABORT")])]);
  for (const s of [closed, onHold, before, unsent]) assert.deepEqual(D.decisionAnswersToRead(s), []);
});

test("decisionAnswersToRead: grilling の問いの判断依頼は ticket の 3 段で扱うので読まない", () => {
  const ticket = issue(31, { labels: ["wayfinder:grilling"], comments: [byViewer(decisionMarker(31, "grilling の問い 17")), byViewer(DA_SENT(31, "grilling の問い 17"))] });
  const map = daMap([decisionMarker(31, "grilling の問い 17"), DA_SENT(31, "grilling の問い 17")]);
  assert.deepEqual(D.decisionAnswersToRead(daWorld([{ ...map, subIssues: [{ number: 31, state: "OPEN" }] }, ticket])), []);
  assert.deepEqual(answers(decide(daWorld([map, ticket], { M5: { replies: [{ userId: OWNER, content: "A" }], reactions: [] } }))), []);
});

test("判断依頼の答え: 本人の返信があれば、判断依頼の印と同じ仕様に答えた印を書く行動を出す", () => {
  const s = daWorld([daSpec(daAbort)], { M5: { replies: [{ userId: OWNER, content: "直して流し直す" }], reactions: [] } });
  assert.deepEqual(answers(decide(s)), [{ kind: "record-decision-answer", key: "record-decision-answer:12:21:takt の ABORT", spec: 12, issue: 21, cause: "takt の ABORT" }]);
});

test("判断依頼の答え: 本人の ✅ でも出す。map の判断依頼は map に書く", () => {
  const s = daWorld([daMap([decisionMarker(30, "霧の残り"), DA_SENT(30, "霧の残り")])], { M5: { replies: [], reactions: [{ emoji: "✅", userId: OWNER }] } });
  assert.deepEqual(answers(decide(s)), [{ kind: "record-decision-answer", key: "record-decision-answer:30:30:霧の残り", map: 30, issue: 30, cause: "霧の残り" }]);
});

test("判断依頼の答え: 本人以外の返信・本文が空の返信・本人の ❌・他人の ✅・読み出しなしでは出さない", () => {
  for (const read of [
    { replies: [{ userId: "U-other", content: "他人の答え" }], reactions: [] },
    { replies: [{ userId: OWNER, content: "   " }], reactions: [] },
    { replies: [], reactions: [{ emoji: "❌", userId: OWNER }] },
    { replies: [], reactions: [{ emoji: "✅", userId: "U-other" }] },
  ]) {
    assert.deepEqual(answers(decide(daWorld([daSpec(daAbort)], { M5: read }))), [], JSON.stringify(read));
  }
  assert.deepEqual(answers(decide(daWorld([daSpec(daAbort)]))), []);
  const noOwner = { ...daWorld([daSpec(daAbort)], { M5: { replies: [{ userId: OWNER, content: "A" }], reactions: [] } }), discordUserId: undefined };
  assert.deepEqual(answers(decide(noOwner)), []);
});

test("判断依頼の答え: 答えた印（手で書いたものを含む）があれば読みも出しもしない。dispatched でも止める", () => {
  const read = { M5: { replies: [{ userId: OWNER, content: "A" }], reactions: [] } };
  const answered = daWorld([daSpec([...daAbort, DA_ANSWERED(21, "takt の ABORT")])], read);
  assert.deepEqual(D.decisionAnswersToRead(answered), []);
  assert.deepEqual(answers(decide(answered)), []);
  const dispatched = { ...daWorld([daSpec(daAbort)], read), dispatched: ["record-decision-answer:12:21:takt の ABORT"] };
  assert.deepEqual(answers(decide(dispatched)), []);
});

test("判断依頼の答え: 印を消して送り直した回は、前の回の答えた印では外れない", () => {
  const resent = daSpec([...daAbort, DA_ANSWERED(21, "takt の ABORT"), decisionMarker(21, "takt の ABORT"), DA_SENT(21, "takt の ABORT", "M9")]);
  assert.deepEqual(D.decisionAnswersToRead(daWorld([resent])), [{ threadId: "555", messageId: "M9" }]);
});

// ---- 閉じた仕様・map のスレッドのアーカイブ ----

const archives = (actions) => actions.filter((a) => a.kind === "archive-thread");
const APPROVAL_SENT_555 = byViewer("案内役: Discord に承認依頼を送った（スレッド 555 / メッセージ 777）");
const MAP_THREAD_900 = byViewer("案内役: Discord に map のスレッドを立てた（スレッド 900）");
const archive = (issue, threadId, subject) => ({ kind: "archive-thread", key: `archive-thread:${threadId}`, issue, threadId, subject });

test("アーカイブ: 閉じた仕様の承認依頼のスレッドと、閉じた map のスレッドに archive-thread を出す。open なものには出さない", () => {
  const s = snapshot([
    spec(12, { state: "CLOSED", comments: [APPROVAL_SENT_555] }),
    spec(13, { comments: [byViewer("案内役: Discord に承認依頼を送った（スレッド 556 / メッセージ 778）")] }),
    issue(30, { state: "CLOSED", labels: ["wayfinder:map"], comments: [MAP_THREAD_900] }),
    issue(31, { labels: ["wayfinder:map"], comments: [byViewer("案内役: Discord に map のスレッドを立てた（スレッド 901）")] }),
  ]);
  assert.deepEqual(archives(decide(s)), [archive(12, "555", "仕様"), archive(30, "900", "map")]);
});

test("アーカイブ: アーカイブした印がある・dispatched 済み・スレッドの印が無い・viewer 以外の印なら出さない", () => {
  const closedSpec = (comments) => spec(12, { state: "CLOSED", comments });
  const none = (issues, over) => assert.deepEqual(archives(decide(snapshot(issues, over))), []);
  none([closedSpec([APPROVAL_SENT_555, byViewer(D.archivedThreadMarker("555"))])]);
  none([closedSpec([APPROVAL_SENT_555])], { dispatched: ["archive-thread:555"] });
  none([closedSpec([])]);
  none([closedSpec([{ author: "someone", body: APPROVAL_SENT_555.body }])]);
  none([issue(30, { state: "CLOSED", labels: ["wayfinder:map"], comments: [MAP_THREAD_900, byViewer(D.archivedThreadMarker("900"))] })]);
});

test("アーカイブ: fromSpec の範囲の外の閉じた仕様には出さない", () => {
  const s = snapshot(
    [spec(12, { state: "CLOSED", comments: [APPROVAL_SENT_555] }), spec(14, { state: "CLOSED", comments: [byViewer("案内役: Discord に承認依頼を送った（スレッド 557 / メッセージ 779）")] })],
    { fromSpec: 13 },
  );
  assert.deepEqual(archives(decide(s)), [archive(14, "557", "仕様")]);
});

test("アーカイブ: close-tab の次、他の行動より先に出す", () => {
  const s = snapshot([specBare(40), spec(12, { state: "CLOSED", comments: [APPROVAL_SENT_555] })]);
  const kinds = decide(s).map((a) => a.kind);
  assert.equal(kinds[0], "archive-thread");
  assert.ok(kinds.includes("request-approval"));
});

const MAIN_SHA = "c".repeat(40);
const NIX = "Nix flake evaluation";
const SC = "ShellCheck (severity=error)";
const check = (id, name, conclusion, status = "completed", runId = 700 + id) => ({ id, name, status, conclusion, runId });
const mainOf = (checks, comments = []) => ({ sha: MAIN_SHA, required: [NIX, SC], checks, comments });
const reruns = (main, over = {}) => decide(snapshot([], { main, ...over })).filter((a) => a.kind === "rerun-main");
const RED = [check(1, NIX, "failure"), check(2, SC, "success")];

test("main の修復: main が緑なら何も出ない。main が無いスナップショットでも何も出ない", () => {
  assert.deepEqual(reruns(mainOf([check(1, NIX, "success"), check(2, SC, "success")])), []);
  assert.deepEqual(reruns(undefined), []);
});

test("main の修復: main が赤く再実行の印が無ければ、落ちた run の再実行を 1 つ出す", () => {
  assert.deepEqual(reruns(mainOf(RED)), [{ kind: "rerun-main", key: `rerun-main:${MAIN_SHA}`, sha: MAIN_SHA, runs: [701], checks: [NIX] }]);
});

test("main の修復: 同じ run で落ちたチェックは run を 1 つにまとめ、cancelled・timed_out も落ちたとみなす", () => {
  const [a] = reruns(mainOf([check(1, NIX, "cancelled", "completed", 900), check(2, SC, "timed_out", "completed", 900)]));
  assert.deepEqual(a.runs, [900]);
  assert.deepEqual(a.checks, [NIX, SC]);
});

test("main の修復: 再実行の印があれば出さない。viewer 以外の印は数えない", () => {
  assert.deepEqual(reruns(mainOf(RED, [byViewer(D.mainRerunMarker(701))])), []);
  assert.equal(reruns(mainOf(RED, [{ author: "someone", body: D.mainRerunMarker(701) }])).length, 1);
  assert.equal(reruns(mainOf(RED, [byViewer(D.mainRerunMarker(999))])).length, 1);
});

test("main の修復: 必須チェックが実行中・未登録なら何も出ない。必須でないチェックの失敗でも出ない", () => {
  assert.deepEqual(reruns(mainOf([check(1, NIX, "failure"), check(2, SC, null, "in_progress")])), []);
  assert.deepEqual(reruns(mainOf([check(1, NIX, "failure")])), []);
  assert.deepEqual(reruns(mainOf([check(1, NIX, "success"), check(2, SC, "success"), check(3, "Cloud evidence", "failure")])), []);
});

test("main の修復: 同じスナップショットで 2 周しても二重に出さない（dispatched）", () => {
  const [first] = reruns(mainOf(RED));
  assert.deepEqual(reruns(mainOf(RED), { dispatched: [first.key] }), []);
});

test("main の修復: archive-thread の直後、他の行動より先に出す", () => {
  const kinds = decide(snapshot([specBare(40), spec(12, { state: "CLOSED", comments: [APPROVAL_SENT_555] })], { main: mainOf(RED) })).map((a) => a.kind);
  assert.deepEqual(kinds.slice(0, 2), ["archive-thread", "rerun-main"]);
  assert.ok(kinds.includes("request-approval"));
});

// ---- main が赤い間の review-fix ----

const GREEN = [check(1, NIX, "success"), check(2, SC, "success")];
const rfOnMain = (main, prChecks) => reviewFixes(decide(rfWorld({ checks: prChecks, over: { main } })));

test("main が赤い間の review-fix: PR の現在の head が main と同じ必須チェックだけで落ちていれば、review-fix を出さない", () => {
  assert.deepEqual(rfOnMain(mainOf(RED), [check(11, NIX, "failure"), check(12, SC, "success")]), []);
});

test("main が赤い間の review-fix: PR が main と違うチェックで落ちていれば、今までどおり出す（main と同じチェックにも落ちていても出す）", () => {
  assert.deepEqual(rfOnMain(mainOf(RED), [check(11, NIX, "success"), check(12, SC, "failure")]), [rfAction()]);
  assert.deepEqual(rfOnMain(mainOf(RED), [check(11, NIX, "failure"), check(13, "Cloud evidence", "failure")]), [rfAction()]);
});

test("main が赤い間の review-fix: PR に落ちたチェックが無い（CI 以外の指摘で失敗した）なら、今までどおり出す", () => {
  assert.deepEqual(rfOnMain(mainOf(RED), [check(11, NIX, "success"), check(12, SC, "success")]), [rfAction()]);
});

test("main が赤い間の review-fix: main が緑・未定・スナップショットに無いなら、同じチェックで落ちた PR にも今までどおり出す", () => {
  const prChecks = [check(11, NIX, "failure")];
  assert.deepEqual(rfOnMain(mainOf(GREEN), prChecks), [rfAction()]);
  assert.deepEqual(rfOnMain(mainOf([check(1, NIX, "failure")]), prChecks), [rfAction()]);
  assert.deepEqual(rfOnMain(undefined, prChecks), [rfAction()]);
});

// main-fix: C（MAIN_SHA）で再実行した run 701 が、再実行の印（10:00）より後に落ち直した状態を基準にする。
const GREEN_SHA = "a".repeat(40);
const MID_SHA = "b".repeat(40);
const RERUN_AT = "2026-10-28T10:00:00Z";
const failedAt = (completedAt, id = 1) => ({ ...check(id, NIX, "failure", "completed", 701), completedAt });
const PRS_C = [{ number: 50, title: "feat: x", closes: [41] }];
const PRS_MID = [{ number: 49, title: "fix: y", closes: [] }];
const fixMain = ({ checks = [failedAt("2026-10-28T10:05:00Z"), check(2, SC, "success")], comments = [], commitComments = [] } = {}) => ({
  ...mainOf(checks, [{ author: VIEWER, body: D.mainRerunMarker(701), createdAt: RERUN_AT }, ...comments]),
  commitComments,
  lastGreen: GREEN_SHA,
  range: [{ sha: MAIN_SHA, pullRequests: PRS_C }, { sha: MID_SHA, pullRequests: [...PRS_MID, ...PRS_C] }],
});
const mainFixes = (main, over = {}) => decide(snapshot([], { main, ...over })).filter((a) => a.kind === "main-fix");
const onCommit = (sha, body) => ({ sha, author: VIEWER, body, createdAt: RERUN_AT });

test("main-fix: 再実行でも落ちれば、C・落ちたチェック・run・最後に緑だった commit・範囲の PR（重複なし）を持つ起動を 1 つ出す", () => {
  assert.deepEqual(mainFixes(fixMain()), [{
    kind: "main-fix", key: `main-fix:${MAIN_SHA}`, sha: MAIN_SHA, checks: [NIX], runs: [701], lastGreen: GREEN_SHA,
    pullRequests: [...PRS_C, ...PRS_MID],
  }]);
  assert.deepEqual(reruns(fixMain()), []);
});

test("main-fix: 再実行が通れば（同名の新しい check-run が success）何も出ない", () => {
  const passed = fixMain({ checks: [failedAt("2026-10-28T09:00:00Z"), check(5, NIX, "success"), check(2, SC, "success")] });
  assert.deepEqual(decide(snapshot([], { main: passed })), []);
});

test("main-fix: 再実行の結果がまだ出ていない（落ちた check-run が再実行の印より前のまま）なら出さない", () => {
  assert.deepEqual(mainFixes(fixMain({ checks: [failedAt("2026-10-28T09:59:00Z"), check(2, SC, "success")] })), []);
  assert.deepEqual(mainFixes(fixMain({ checks: [failedAt(null), check(2, SC, "success")] })), []);
});

test("main-fix: 再実行の印が無ければ、先に再実行だけを出す", () => {
  const unmarked = { ...fixMain(), comments: [] };
  assert.deepEqual(decide(snapshot([], { main: unmarked })).map((a) => a.kind), ["rerun-main"]);
});

test("main-fix: 同じ C に起動の印があれば出さない。viewer 以外の印は数えない", () => {
  assert.deepEqual(mainFixes(fixMain({ comments: [byViewer(D.mainFixLaunchingMarker(MAIN_SHA))] })), []);
  assert.equal(mainFixes(fixMain({ comments: [{ author: "someone", body: D.mainFixLaunchingMarker(MAIN_SHA) }] })).length, 1);
});

test("main-fix: 範囲（最後に緑だった commit より後）の起動の印が上限に達していれば出さない。範囲の外の印は数えない", () => {
  assert.equal(D.MAIN_FIX_LAUNCH_LIMIT, 2);
  const one = [onCommit(MID_SHA, D.mainFixLaunchingMarker(MID_SHA))];
  assert.equal(mainFixes(fixMain({ commitComments: one })).length, 1);
  const outside = [...one, onCommit(GREEN_SHA, D.mainFixLaunchingMarker(GREEN_SHA))];
  assert.equal(mainFixes(fixMain({ commitComments: outside })).length, 1);
  // C の印は commitComments にだけある形で数える（C の comments に載っていれば、同じ C の起動の印として先に止まる）
  const full = [...one, onCommit(MAIN_SHA, D.mainFixLaunchingMarker(MAIN_SHA))];
  assert.deepEqual(mainFixes(fixMain({ commitComments: full })), []);
});

test("main-fix: 同じスナップショットで 2 周しても二重に出さない（dispatched）", () => {
  const [first] = mainFixes(fixMain());
  assert.deepEqual(mainFixes(fixMain(), { dispatched: [first.key] }), []);
});

test("main-fix: 印の文言（2 段の起動・直せなかった・タブの題名）", () => {
  assert.equal(D.mainFixLaunchingMarker(MAIN_SHA), `案内役: main-fix を起動する（commit ${MAIN_SHA}）`);
  assert.equal(D.mainFixLaunchedMarker(MAIN_SHA, "term_m", RERUN_AT), `案内役: main-fix を起動した（commit ${MAIN_SHA} / ターミナル term_m / ${RERUN_AT}）`);
  assert.equal(D.mainFixFailedMarker(MAIN_SHA), `案内役: main-fix が直せなかった（commit ${MAIN_SHA}）`);
  assert.equal(D.mainFixTabTitle(MAIN_SHA), "main-fix ccccccc");
});

// main が緑に戻った後: 前の失敗した commit（MID_SHA）に起動した印がある。
const GREEN_MAIN = (commitComments) => ({ ...mainOf([check(1, NIX, "success"), check(2, SC, "success")]), commitComments, lastGreen: null, range: [] });
const LAUNCHED_MID = onCommit(MID_SHA, D.mainFixLaunchedMarker(MID_SHA, "term_m", RERUN_AT));
const idleTab = { term_m: { found: true, waiting: false, idle: true, tail: [] } };
const mainFixCloses = (main, over = {}) => decide(snapshot([], { main, sessions: idleTab, ...over })).filter((a) => a.kind === "close-tab");

test("main-fix のタブ: main が緑に戻り、手が止まっていれば、起動の印と同じ commit に閉じる行動を出す", () => {
  assert.deepEqual(mainFixCloses(GREEN_MAIN([LAUNCHED_MID])), [{ kind: "close-tab", key: "close-tab:term_m", sha: MID_SHA, step: "main-fix", handle: "term_m", gone: false }]);
  assert.deepEqual(D.mainFixTabsToClose(snapshot([], { main: GREEN_MAIN([LAUNCHED_MID]) })), [{ sha: MID_SHA, step: "main-fix", handle: "term_m" }]);
});

test("main-fix のタブ: main が赤いまま・手が動いている・入力待ち・閉じた印がある・2 周目なら出さない。見つからないタブは印だけ（gone）", () => {
  const red = { ...fixMain({ comments: [byViewer(D.mainFixLaunchingMarker(MAIN_SHA))] }), commitComments: [LAUNCHED_MID] };
  assert.deepEqual(mainFixCloses(red), []);
  assert.deepEqual(mainFixCloses(GREEN_MAIN([LAUNCHED_MID]), { sessions: { term_m: { found: true, waiting: false, idle: false, tail: [] } } }), []);
  assert.deepEqual(mainFixCloses(GREEN_MAIN([LAUNCHED_MID]), { sessions: { term_m: { found: true, waiting: true, idle: true, tail: [] } } }), []);
  assert.deepEqual(mainFixCloses(GREEN_MAIN([LAUNCHED_MID, onCommit(MID_SHA, D.closedTabMarker("main-fix", "term_m"))])), []);
  assert.deepEqual(mainFixCloses(GREEN_MAIN([LAUNCHED_MID]), { dispatched: ["close-tab:term_m"] }), []);
  assert.deepEqual(mainFixCloses(GREEN_MAIN([LAUNCHED_MID]), { sessions: { term_m: { found: false, waiting: false, idle: false, tail: [] } } }).map((a) => a.gone), [true]);
});

// main の判断依頼: main-fix で直らない C（MAIN_SHA）。範囲の PR は #50（C、#41 を閉じた）と #49（MID）。
const mainDecisions = (main, over = {}, issues = []) => decide(snapshot(issues, { main, ...over })).filter((a) => a.kind === "request-main-decision");
const LIMIT_REACHED = [onCommit(MID_SHA, D.mainFixLaunchingMarker(MID_SHA)), onCommit(MAIN_SHA, D.mainFixLaunchingMarker(MAIN_SHA))];
const mainDecisionOf = (cause, reason, target = { spec: null, threadId: null }) => ({
  kind: "request-main-decision", key: `request-main-decision:${MAIN_SHA}:${cause}`, sha: MAIN_SHA, cause, reason,
  checks: [NIX], runs: [701], lastGreen: GREEN_SHA, pullRequests: [...PRS_C, ...PRS_MID], ...target,
});
const FAILED_ON_C = [byViewer(D.mainFixLaunchingMarker(MAIN_SHA)), byViewer(`${D.mainFixFailedMarker(MAIN_SHA)}: revert すべきか判断が要る`)];
// main-fix を C で起動した（RERUN_AT）セッション term_m。
const LAUNCHED_ON_C = [byViewer(D.mainFixLaunchingMarker(MAIN_SHA)), byViewer(D.mainFixLaunchedMarker(MAIN_SHA, "term_m", RERUN_AT))];
const goneTab = { term_m: { found: false, waiting: false, idle: false, tail: [] } };
const STALL = D.stallCause("main-fix");

test("main の判断依頼: 範囲の起動の印が上限に達していれば、main-fix の代わりに原因 main の修復の判断依頼を出す", () => {
  assert.deepEqual(mainDecisions(fixMain({ commitComments: LIMIT_REACHED })), [mainDecisionOf(D.CAUSE_MAIN_REPAIR, "main-fix の起動が上限（2 回）に達した")]);
  assert.deepEqual(mainFixes(fixMain({ commitComments: LIMIT_REACHED })), []);
  assert.deepEqual(mainDecisions(fixMain()), []);
});

test("main の判断依頼: C に直せなかった印があれば、印の理由を入れた判断依頼を出す。viewer 以外の印・前の commit の印では出さない", () => {
  assert.deepEqual(mainDecisions(fixMain({ comments: FAILED_ON_C })), [mainDecisionOf(D.CAUSE_MAIN_REPAIR, "main-fix が直せなかった: revert すべきか判断が要る")]);
  const others = [byViewer(D.mainFixLaunchingMarker(MAIN_SHA)), { author: "someone", body: `${D.mainFixFailedMarker(MAIN_SHA)}: x` }, byViewer(`${D.mainFixFailedMarker(MID_SHA)}: x`)];
  assert.deepEqual(mainDecisions(fixMain({ comments: others })), []);
});

test("main の判断依頼: 止まった main-fix のセッションに、原因 main-fix のセッションの停止の判断依頼を 1 度だけ出す", () => {
  const main = fixMain({ comments: LAUNCHED_ON_C });
  assert.deepEqual(D.mainFixSessionsToObserve(snapshot([], { main })), [{ sha: MAIN_SHA, step: "main-fix", handle: "term_m", startedAt: RERUN_AT }]);
  const [sent] = mainDecisions(main, { sessions: goneTab });
  assert.deepEqual(sent, mainDecisionOf(STALL, "起動したセッションが Orca に見つからない"));
  // 送り済みの印（C の commit comment）か dispatched があれば出さず、観測もしない
  const marked = fixMain({ comments: [...LAUNCHED_ON_C, byViewer(D.mainDecisionMarker(MAIN_SHA, STALL))] });
  assert.deepEqual(mainDecisions(marked, { sessions: goneTab }), []);
  assert.deepEqual(D.mainFixSessionsToObserve(snapshot([], { main: marked })), []);
  assert.deepEqual(mainDecisions(main, { sessions: goneTab, dispatched: [sent.key] }), []);
  // 手が動いていて、時間も経っていなければ止まった扱いにしない
  const running = { term_m: { found: true, waiting: false, idle: false, tail: [] } };
  assert.deepEqual(mainDecisions(main, { sessions: running, now: "2026-10-28T10:30:00Z", stallMinutes: 60 }), []);
  assert.equal(mainDecisions(main, { sessions: running, now: "2026-10-28T11:00:00Z", stallMinutes: 60 })[0].cause, STALL);
});

test("main の判断依頼: main の新しい commit が来ていれば（起動の印が前の commit にある）、止まった扱いにしない。直せなかった印があっても停止は見ない", () => {
  const moved = fixMain({ commitComments: [onCommit(MID_SHA, D.mainFixLaunchedMarker(MID_SHA, "term_m", RERUN_AT))] });
  assert.deepEqual(D.mainFixSessionsToObserve(snapshot([], { main: moved })), []);
  assert.deepEqual(mainDecisions(moved, { sessions: goneTab }), []);
  const failed = fixMain({ comments: [...LAUNCHED_ON_C, FAILED_ON_C[1]] });
  assert.deepEqual(D.mainFixSessionsToObserve(snapshot([], { main: failed })), []);
  assert.deepEqual(mainDecisions(failed, { sessions: goneTab }).map((a) => a.cause), [D.CAUSE_MAIN_REPAIR]);
});

test("main の判断依頼: 送り先は、範囲の PR が閉じた issue の仕様のスレッド。複数あれば新しい PR から。たどれなければ repo のチャンネル", () => {
  const prs = [{ number: 50, title: "feat: x", closes: [41] }];
  const older = [{ number: 49, title: "fix: y", closes: [46] }];
  const main = { ...fixMain({ comments: FAILED_ON_C }), range: [{ sha: MAIN_SHA, pullRequests: prs }, { sha: MID_SHA, pullRequests: older }] };
  const spec12 = spec(12, { comments: [APPROVAL_SENT_555] });
  const spec30 = spec(30, { comments: [byViewer(SENT("556", "778"))] });
  const world = [spec12, spec30, issue(40, { body: "仕様: #12", subIssues: [{ number: 41, state: "CLOSED" }] }), issue(45, { body: "仕様: #30", subIssues: [{ number: 46, state: "CLOSED" }] })];
  const targetOf = (issues) => mainDecisions(main, {}, issues).map((a) => [a.spec, a.threadId]);
  assert.deepEqual(targetOf(world), [[12, "555"]]);
  // 新しい PR の仕様に承認依頼のスレッドが無ければ、次の PR の仕様へ
  assert.deepEqual(targetOf([spec(12), ...world.slice(1)]), [[30, "556"]]);
  // どの PR からも仕様にたどれなければ repo のチャンネル
  assert.deepEqual(targetOf([spec12, spec30]), [[null, null]]);
  assert.deepEqual(targetOf([]), [[null, null]]);
});

test("main の判断依頼: 判断依頼の印が、C の commit comment か仕様の issue にあれば出さない", () => {
  const marker = D.mainDecisionMarker(MAIN_SHA, D.CAUSE_MAIN_REPAIR);
  assert.deepEqual(mainDecisions(fixMain({ comments: [...FAILED_ON_C, byViewer(marker)] })), []);
  assert.deepEqual(mainDecisions(fixMain({ comments: FAILED_ON_C }), {}, [spec(12, { comments: [APPROVAL_SENT_555, byViewer(marker)] })]), []);
  // 原因の違う印、前の commit の印、viewer 以外の印では止まらない
  for (const other of [byViewer(D.mainDecisionMarker(MAIN_SHA, STALL)), byViewer(D.mainDecisionMarker(MID_SHA, D.CAUSE_MAIN_REPAIR)), { author: "someone", body: marker }]) {
    assert.equal(mainDecisions(fixMain({ comments: [...FAILED_ON_C, other] })).length, 1);
  }
  assert.deepEqual(D.sentMainDecisions(snapshot([], { main: fixMain({ comments: [byViewer(marker)] }) })), [D.CAUSE_MAIN_REPAIR]);
});

test("main の判断依頼: 同じスナップショットで 2 周しても二重に出さない（dispatched）", () => {
  for (const main of [fixMain({ commitComments: LIMIT_REACHED }), fixMain({ comments: FAILED_ON_C })]) {
    const [first] = mainDecisions(main);
    assert.deepEqual(mainDecisions(main, { dispatched: [first.key] }), []);
  }
});

test("main の判断依頼: 印の文言", () => {
  assert.equal(D.mainDecisionMarker(MAIN_SHA, D.CAUSE_MAIN_REPAIR), `案内役: Discord に判断依頼を送る（commit ${MAIN_SHA} main の修復）`);
  assert.equal(D.mainDecisionMarker(MAIN_SHA, STALL), `案内役: Discord に判断依頼を送る（commit ${MAIN_SHA} main-fix のセッションの停止）`);
});
