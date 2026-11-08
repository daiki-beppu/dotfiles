// deps-finish-stage.mjs のテスト。スナップショットは手で組み、decide を通して deps-finish の行動を確かめる。
import assert from "node:assert/strict";
import { test } from "node:test";
import { decide } from "./decide.mjs";
import {
  CAUSE_DEPS_CAP,
  CAUSE_DEPS_GAVE_UP,
  CAUSE_DEPS_STALL,
  DEPS_FINISH_LAUNCH_LIMIT,
  decideDeps,
  depsQuestionCause,
  depsQuestionsToRefresh,
  depsSessionsToObserve,
  depsFinishGaveUpMarker,
  depsFinishLaunchedMarker,
  depsFinishLaunchingMarker,
  depsPullRequestsToRead,
} from "./deps-finish-stage.mjs";
import { NO_QUESTION, QUESTION_HEADING, decisionMarker } from "./session-watch.mjs";

const VIEWER = "me";
const HEAD = "d".repeat(40);
const AT = "2026-11-07T00:00:00.000Z";
const run = (id, name, conclusion, status = "completed") => ({ id, name, status, conclusion, runId: id });
const PASS = [run(1, "check", "success")];
const PENDING = [run(1, "check", null, "in_progress")];
const FAIL = [run(1, "check", "failure")];
const GREEN_MAIN = { sha: "c".repeat(40), required: ["check"], checks: [run(9, "check", "success")], comments: [], commitComments: [] };

const pr = (number, over = {}) => ({
  number, title: `PR ${number}`, state: "OPEN", head: HEAD, headBranch: `feat/${number}`, labels: [], autoMerge: false, comments: [], checks: PASS, ...over,
});
const labeled = (number, over = {}) => pr(number, { labels: ["deps:finish"], ...over });
const renovate = (number, over = {}) => pr(number, { headBranch: `renovate/group-${number}`, ...over });
const mine = (body) => ({ author: VIEWER, body, createdAt: AT });
const STAGE1 = mine(depsFinishLaunchingMarker(HEAD));
const STAGE2 = mine(depsFinishLaunchedMarker(HEAD, "term_1", AT));
const REPORT = mine("## 依存の仕上げ\n\n- typecheck: pass");
const gaveUp = (n) => mine(`${depsFinishGaveUpMarker(n)}: Evals の差が大きい`);

const actionsOf = (depsPullRequests, { dispatched = [], main = GREEN_MAIN } = {}) =>
  decide({ repo: "o/r", viewer: VIEWER, issues: [], taktIssues: [], depsPullRequests, main, dispatched }).filter((a) => a.kind === "deps-finish");
const prsOf = (prs, opts) => actionsOf(prs, opts).map((a) => a.pr);

test("deps:finish のラベル付きで自動マージが未予約の OPEN な PR を対象にし、PR・題・head・ブランチを持つ行動を 1 件出す", () => {
  assert.deepEqual(actionsOf([labeled(5)]), [{ kind: "deps-finish", key: "deps-finish:5:1", pr: 5, title: "PR 5", head: HEAD, branch: "feat/5", group: null }]);
});

test("ラベル付きでも自動マージを予約済みなら、必須チェックが通った・実行中のあいだは対象にしない", () => {
  assert.deepEqual(prsOf([labeled(5, { autoMerge: true, checks: PASS })]), []);
  assert.deepEqual(prsOf([labeled(5, { autoMerge: true, checks: PENDING })]), []);
});

test("ラベル付きで自動マージを予約済みでも、必須チェックが落ちれば対象にする", () => {
  assert.deepEqual(prsOf([labeled(5, { autoMerge: true, checks: FAIL })]), [5]);
});

test("renovate/ のブランチの PR は、必須チェックが落ちたときだけ対象にし、group にブランチ名の renovate/ の後ろを入れる", () => {
  assert.deepEqual(actionsOf([renovate(6, { checks: FAIL })]).map((a) => [a.pr, a.group]), [[6, "group-6"]]);
  assert.deepEqual(prsOf([renovate(6, { checks: PASS })]), []);
  assert.deepEqual(prsOf([renovate(6, { checks: PENDING })]), []);
});

test("ラベルも renovate/ のブランチも無い PR は、必須チェックが落ちても対象にしない", () => {
  assert.deepEqual(prsOf([pr(7, { checks: FAIL })]), []);
});

test("閉じた・マージ済みの PR は対象にしない", () => {
  assert.deepEqual(prsOf([labeled(5, { state: "CLOSED" }), renovate(6, { state: "MERGED", checks: FAIL })]), []);
});

test("`## 依存の仕上げ` のコメントだけでは対象から外さない（起動の印が無ければ起動する）", () => {
  assert.deepEqual(prsOf([labeled(5, { comments: [REPORT] })]), [5]);
});

test("対象は番号の小さい順に見て 1 件だけ出す。最小の PR が上限に達していれば次に小さい PR を出す", () => {
  assert.deepEqual(prsOf([labeled(12), labeled(5), labeled(9)]), [5]);
  const capped = labeled(5, { comments: [STAGE1, STAGE2, REPORT, STAGE1, STAGE2, REPORT] });
  assert.deepEqual(prsOf([labeled(12), capped, labeled(9)]), [9]);
});

test("起動する の印だけがある PR（起動中）があれば、どの PR にも起動しない", () => {
  assert.deepEqual(prsOf([labeled(3, { comments: [STAGE1] }), labeled(5)]), []);
});

test("起動した の印がある PR（動いている）があれば、どの PR にも起動しない。対象でなくなった PR でも同じ", () => {
  assert.deepEqual(prsOf([labeled(3, { comments: [STAGE1, STAGE2] }), labeled(5)]), []);
  assert.deepEqual(prsOf([labeled(3, { autoMerge: true, comments: [STAGE1, STAGE2] }), labeled(5)]), []);
});

test("最後の 起動する の印より後に `## 依存の仕上げ` か直せなかった印があれば、そのセッションは終わったとみなして次を起動する", () => {
  assert.deepEqual(prsOf([labeled(3, { autoMerge: true, comments: [STAGE1, STAGE2, REPORT] }), labeled(5)]), [5]);
  assert.deepEqual(prsOf([pr(3, { comments: [STAGE1, STAGE2, gaveUp(3)] }), labeled(5)]), [5]);
});

test("結果のコメントが最後の 起動する の印より前にしか無ければ、まだ動いているとみなす", () => {
  assert.deepEqual(prsOf([labeled(3, { comments: [STAGE1, STAGE2, REPORT, STAGE1, STAGE2] }), labeled(5)]), []);
});

test("別の PR 向けの直せなかった印では終わったとみなさない", () => {
  assert.deepEqual(prsOf([labeled(3, { comments: [STAGE1, STAGE2, gaveUp(4)] }), labeled(5)]), []);
});

test("viewer 以外が書いた印・結果は読まない", () => {
  const other = (c) => ({ ...c, author: "someone" });
  assert.deepEqual(prsOf([labeled(3, { comments: [other(STAGE1), other(STAGE2)] }), labeled(5)]), [3]);
  assert.deepEqual(prsOf([labeled(3, { comments: [STAGE1, STAGE2, other(REPORT)] }), labeled(5)]), []);
});

test("起動の回数は 起動する の印の数で数え、上限 2 回に達した PR には起動しない（起動した の印は数えない）", () => {
  assert.equal(DEPS_FINISH_LAUNCH_LIMIT, 2);
  assert.deepEqual(actionsOf([labeled(5, { comments: [STAGE1, STAGE2, REPORT] })]).map((a) => a.key), ["deps-finish:5:2"]);
  assert.deepEqual(prsOf([labeled(5, { comments: [STAGE1, STAGE2, REPORT, STAGE1, STAGE2, gaveUp(5)] })]), []);
  assert.deepEqual(prsOf([labeled(5, { comments: [STAGE1, STAGE2, STAGE2, REPORT] })]), [5]);
});

test("対象が何件あっても、1 周で出す行動は高々 1 件", () => {
  assert.equal(actionsOf([labeled(1), labeled(2), renovate(3, { checks: FAIL }), labeled(4, { autoMerge: true, checks: FAIL })]).length, 1);
});

test("出し済みの key（dispatched）は出し直さず、次の候補へも進まない（書いた印がまだ読めない周に 2 件目を起動しない）", () => {
  assert.deepEqual(prsOf([labeled(5), labeled(9)], { dispatched: ["deps-finish:5:1"] }), []);
  assert.deepEqual(prsOf([labeled(5, { comments: [STAGE1, STAGE2, REPORT] })], { dispatched: ["deps-finish:5:1"] }), [5]);
});

test("main が赤く、PR の落ちたチェックがすべて main の落ちた必須チェックなら、main の壊れとして除き次の候補を見る", () => {
  const red = { ...GREEN_MAIN, checks: [run(9, "check", "failure")] };
  assert.deepEqual(prsOf([renovate(5, { checks: FAIL }), labeled(9)], { main: red }), [9]);
  assert.deepEqual(prsOf([renovate(5, { checks: [...FAIL, run(2, "lint", "failure")] })], { main: red }), [5]);
});

test("depsPullRequestsToRead: OPEN なラベル付きと renovate/ のブランチの PR だけを、番号の小さい順に返す", () => {
  const prs = [renovate(9), pr(7), labeled(3), labeled(4, { state: "CLOSED" }), renovate(2, { state: "MERGED" })];
  assert.deepEqual(depsPullRequestsToRead({ pullRequests: prs }).map((p) => p.number), [3, 9]);
});

test("decideDeps: depsPullRequests が無いスナップショットでは何も出さない", () => {
  assert.deepEqual(decideDeps({ viewer: VIEWER }, new Set()), []);
});

const LATER = (minutes) => new Date(Date.parse(AT) + minutes * 60_000).toISOString();
const ALIVE = { found: true, waiting: false, idle: false, tail: ["作業中"] };
const IDLE = { ...ALIVE, idle: true, tail: ["❯"] };
const HOOK = (since) => ({ found: true, waiting: true, waitSource: "hook", waitSince: since, idle: true, tail: ["? どちらにしますか"] });
const decidedBy = (n, cause) => mine(decisionMarker(n, cause));
const question = (text) => mine(`${QUESTION_HEADING}\n\n${text}`);
const RUNNING = [STAGE1, STAGE2];

const depsActionsOf = (depsPullRequests, { dispatched = [], main = GREEN_MAIN, sessions = {}, now = LATER(1) } = {}) =>
  decide({ repo: "o/r", viewer: VIEWER, issues: [], taktIssues: [], depsPullRequests, main, dispatched, sessions, now, stallMinutes: 60 })
    .filter((a) => a.kind === "request-deps-decision" || a.kind === "deps-finish");
const requestsOf = (prs, opts) => depsActionsOf(prs, opts).filter((a) => a.kind === "request-deps-decision");
const launchesOf = (prs, opts) => depsActionsOf(prs, opts).filter((a) => a.kind === "deps-finish").map((a) => a.pr);

test("止まったセッション（見つからない・入力待ち・時間切れ）には停止の判断依頼を 1 件出し、時間切れ前なら出さない", () => {
  const prs = [labeled(3, { comments: RUNNING })];
  const cases = [
    [{ term_1: { found: false } }, LATER(1), "起動したセッションが Orca に見つからない"],
    [{ term_1: { ...ALIVE, waiting: true, waitSource: "prompt-text" } }, LATER(1), "セッションが入力待ち（確認・許可）で止まっている"],
    [{ term_1: IDLE }, LATER(60), "起動から 60 分経っても結果が GitHub に出ていない"],
  ];
  for (const [sessions, now, reason] of cases) {
    const [request, ...rest] = requestsOf(prs, { sessions, now });
    assert.deepEqual(rest, []);
    assert.deepEqual(request, {
      kind: "request-deps-decision", key: `request-deps-decision:3:${CAUSE_DEPS_STALL}`, pr: 3, title: "PR 3", tab: "deps-finish #3",
      cause: CAUSE_DEPS_STALL, reason, tail: sessions.term_1.tail ?? [],
    });
  }
  assert.deepEqual(requestsOf(prs, { sessions: { term_1: IDLE }, now: LATER(59) }), []);
});

test("時間切れを過ぎても手が動いている（idle でない）セッションは動いている扱いで、判断依頼を出さず、ほかの PR を起動しない", () => {
  const prs = [labeled(3, { comments: RUNNING }), labeled(5)];
  assert.deepEqual(depsActionsOf(prs, { sessions: { term_1: ALIVE }, now: LATER(180) }), []);
  assert.deepEqual(requestsOf(prs, { sessions: { term_1: IDLE }, now: LATER(180) }).map((a) => [a.pr, a.cause]), [[3, CAUSE_DEPS_STALL]]);
  assert.deepEqual(launchesOf(prs, { sessions: { term_1: IDLE }, now: LATER(180) }), []);
});

test("止まったセッションは、判断依頼の印が読めるまで動いている扱いのまま。印が読めたら次の PR を起動し、止まった PR は起動し直さない", () => {
  const stalled = labeled(3, { comments: RUNNING });
  const sessions = { term_1: { found: false } };
  assert.deepEqual(launchesOf([stalled, labeled(5)], { sessions }), []);
  const decided = labeled(3, { comments: [...RUNNING, decidedBy(3, CAUSE_DEPS_STALL)] });
  assert.deepEqual(depsActionsOf([decided, labeled(5)], { sessions }).map((a) => [a.kind, a.pr]), [["deps-finish", 5]]);
  assert.deepEqual(launchesOf([decided]), []);
});

test("上限に達して対象のまま残った PR には、上限の判断依頼を 1 件出す。対象でない・main と同じ壊れ・印が既にあるときは出さない", () => {
  const twice = [STAGE1, STAGE2, REPORT, STAGE1, STAGE2, REPORT];
  assert.deepEqual(requestsOf([labeled(5, { comments: twice })]).map((a) => [a.pr, a.cause, a.key]), [[5, CAUSE_DEPS_CAP, `request-deps-decision:5:${CAUSE_DEPS_CAP}`]]);
  assert.deepEqual(requestsOf([labeled(5, { autoMerge: true, comments: twice })]), []);
  const red = { ...GREEN_MAIN, checks: [run(9, "check", "failure")] };
  assert.deepEqual(requestsOf([renovate(5, { checks: FAIL, comments: twice })], { main: red }), []);
  assert.deepEqual(requestsOf([labeled(5, { comments: [...twice, decidedBy(5, CAUSE_DEPS_CAP)] })]), []);
});

test("ラベル付きの PR が 1 回目で直せなかった印を書いたら、直せなかった判断依頼を理由つきで 1 件出し、同じ PR を起動し直さない", () => {
  const prs = [labeled(3, { comments: [...RUNNING, gaveUp(3)] })];
  assert.deepEqual(depsActionsOf(prs), [
    { kind: "request-deps-decision", key: `request-deps-decision:3:${CAUSE_DEPS_GAVE_UP}`, pr: 3, title: "PR 3", tab: "deps-finish #3", cause: CAUSE_DEPS_GAVE_UP, reason: "Evals の差が大きい" },
  ]);
  assert.deepEqual(depsActionsOf([labeled(3, { comments: [...RUNNING, gaveUp(3), decidedBy(3, CAUSE_DEPS_GAVE_UP)] })]), []);
});

test("2 回目のセッションが直せなかった印を書いたら、出すのは直せなかった判断依頼だけ（上限の判断依頼は重ねない）", () => {
  const prs = [labeled(5, { comments: [STAGE1, STAGE2, REPORT, STAGE1, STAGE2, gaveUp(5)] })];
  assert.deepEqual(requestsOf(prs).map((a) => a.cause), [CAUSE_DEPS_GAVE_UP]);
});

test("hook の入力待ち S には問いつきの判断依頼を 1 件出し、時間切れを過ぎても停止の判断依頼は出さない。S の印があれば出さず、新しい S2 には出す", () => {
  const withQuestion = labeled(3, { comments: [...RUNNING, question("A と B のどちらにするか")] });
  const [request, ...rest] = requestsOf([withQuestion], { sessions: { term_1: HOOK("111") }, now: LATER(120) });
  assert.deepEqual(rest, []);
  assert.deepEqual(request, {
    kind: "request-deps-decision", key: `request-deps-decision:3:${depsQuestionCause("111")}`, pr: 3, title: "PR 3", tab: "deps-finish #3",
    cause: depsQuestionCause("111"), reason: "セッションが本人の判断（AskUserQuestion）を待っている", since: "111", question: "A と B のどちらにするか",
  });
  assert.equal(requestsOf([labeled(3, { comments: RUNNING })], { sessions: { term_1: HOOK("111") } })[0].question, NO_QUESTION);
  const asked = labeled(3, { comments: [...withQuestion.comments, decidedBy(3, depsQuestionCause("111"))] });
  assert.deepEqual(requestsOf([asked], { sessions: { term_1: HOOK("111") }, now: LATER(120) }), []);
  assert.deepEqual(requestsOf([asked], { sessions: { term_1: HOOK("222") } }).map((a) => a.cause), [depsQuestionCause("222")]);
});

test("問いの判断依頼の後は、停止の時間切れをその印の時刻から数え直す", () => {
  const askedAt = { ...decidedBy(3, depsQuestionCause("111")), createdAt: LATER(50) };
  const prs = [labeled(3, { comments: [...RUNNING, askedAt] })];
  assert.deepEqual(requestsOf(prs, { sessions: { term_1: IDLE }, now: LATER(100) }), []);
  assert.deepEqual(requestsOf(prs, { sessions: { term_1: IDLE }, now: LATER(110) }).map((a) => a.cause), [CAUSE_DEPS_STALL]);
});

test("問いのセッションは動いている扱いで、ほかの PR を起動しない", () => {
  assert.deepEqual(launchesOf([labeled(3, { comments: RUNNING }), labeled(5)], { sessions: { term_1: HOOK("111") } }), []);
});

test("出し済みの判断依頼の key（dispatched）は出し直さない", () => {
  const prs = [labeled(3, { comments: [...RUNNING, gaveUp(3)] })];
  assert.deepEqual(requestsOf(prs, { dispatched: [`request-deps-decision:3:${CAUSE_DEPS_GAVE_UP}`] }), []);
});

test("判断依頼の印は viewer が書いた、同じ番号の PR のものだけを数える（#2 の印は #21 に効かない）", () => {
  const sessions = { term_1: { found: false } };
  const other = { ...decidedBy(21, CAUSE_DEPS_STALL), author: "someone" };
  assert.deepEqual(requestsOf([labeled(21, { comments: [...RUNNING, other] })], { sessions }).map((a) => a.pr), [21]);
  assert.deepEqual(requestsOf([labeled(21, { comments: [...RUNNING, decidedBy(2, CAUSE_DEPS_STALL)] })], { sessions }).map((a) => a.pr), [21]);
  assert.deepEqual(requestsOf([labeled(2, { comments: [...RUNNING, decidedBy(21, CAUSE_DEPS_STALL)] })], { sessions }).map((a) => a.pr), [2]);
});

test("depsSessionsToObserve: 2 段目があり結果も判断依頼の印も無い PR の、最後の 2 段目の handle と起動時刻を返す", () => {
  const relaunched = mine(depsFinishLaunchedMarker(HEAD, "term_2", LATER(5)));
  const prs = [
    labeled(3, { comments: [STAGE1, STAGE2, REPORT, STAGE1, relaunched] }),
    labeled(4, { comments: [STAGE1] }),
    labeled(5, { comments: [...RUNNING, REPORT] }),
    labeled(6, { comments: [...RUNNING, decidedBy(6, CAUSE_DEPS_STALL)] }),
  ];
  assert.deepEqual(depsSessionsToObserve({ viewer: VIEWER, depsPullRequests: prs }), [{ pr: 3, handle: "term_2", startedAt: LATER(5) }]);
});

test("depsQuestionsToRefresh: hook の入力待ちで、その停止の問いの印がまだ無い PR だけを返す", () => {
  const prs = [
    labeled(3, { comments: RUNNING }),
    labeled(4, { comments: [STAGE1, mine(depsFinishLaunchedMarker(HEAD, "term_4", AT)), decidedBy(4, depsQuestionCause("111"))] }),
    labeled(5, { comments: [STAGE1, mine(depsFinishLaunchedMarker(HEAD, "term_5", AT))] }),
  ];
  const sessions = { term_1: HOOK("111"), term_4: HOOK("111"), term_5: ALIVE };
  assert.deepEqual(depsQuestionsToRefresh({ viewer: VIEWER, depsPullRequests: prs, sessions, now: LATER(1) }), [3]);
});
