// deps-finish-stage.mjs のテスト。スナップショットは手で組み、decide を通して deps-finish の行動を確かめる。
import assert from "node:assert/strict";
import { test } from "node:test";
import { decide } from "./decide.mjs";
import {
  DEPS_FINISH_LAUNCH_LIMIT,
  decideDepsFinish,
  depsFinishGaveUpMarker,
  depsFinishLaunchedMarker,
  depsFinishLaunchingMarker,
  depsPullRequestsToRead,
} from "./deps-finish-stage.mjs";

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

test("decideDepsFinish: depsPullRequests が無いスナップショットでは何も出さない", () => {
  assert.deepEqual(decideDepsFinish({ viewer: VIEWER }, new Set()), []);
});
