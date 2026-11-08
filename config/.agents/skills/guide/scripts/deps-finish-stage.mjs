// 依存の PR の仕上げ（deps-finish）の判定と印の文言。I/O を持たない純粋なモジュール。
// takt は deps-finish の印を読まないので、review-fix の印と違って takt の review-stage.mjs には置かない。
//
// 対象: OPEN な PR のうち、deps:finish のラベル付き（自動マージを予約済みなら必須チェックが落ちるまで外す）と、
//       renovate/ のブランチで必須チェックが落ちたもの。`## 依存の仕上げ` のコメントでは対象を決めない。
// 起動は 1 度に 1 件、対象を番号の小さい順に見て、PR ごとに 2 回まで（1 段目の印の数で数える）。
// 止まった・上限に達した・直せなかったときは、PR ごとに 1 度だけ repo のチャンネルへ判断依頼を送り、その PR は人に渡したものとして起動し直さない。
// AskUserQuestion の hook の入力待ちには、問いつきの判断依頼を停止ごとに 1 度だけ送る（答えはタブで本人が返す）。印はすべて PR に書く。
import { failsLikeMain, mainState } from "../../takt/scripts/main-state.mjs";
import { awaitsHookInput, decisionMarker, lastQuestion, stallCause, stallReason, tabTitle } from "./session-watch.mjs";

export const DEPS_FINISH_LABEL = "deps:finish";
export const RENOVATE_PREFIX = "renovate/";
export const DEPS_FINISH_LAUNCH_LIMIT = 2;
export const DEPS_FINISH_SESSIONS = 1;
// 対象 repo の root からの、依存のグループごとの仕上げの手順の索引
export const DEPS_INDEX = "docs/agents/dependency-updates.md";
export const FINISH_REPORT_HEADING = "## 依存の仕上げ";

const LAUNCHING_PREFIX = "案内役: deps-finish を起動する（head ";
const LAUNCHED_PREFIX = "案内役: deps-finish を起動した（head ";
export const depsFinishLaunchingMarker = (head) => `${LAUNCHING_PREFIX}${head}）`;
export const depsFinishLaunchedMarker = (head, handle, at) => `${LAUNCHED_PREFIX}${head} / ターミナル ${handle} / ${at}）`;
// セッションが直せないときに書く。セッションはこの後ろに `: <理由>` を足す
export const depsFinishGaveUpMarker = (pr) => `案内役: deps-finish が直せなかった（PR #${pr}）`;
const LAUNCHED = /^案内役: deps-finish を起動した（head \w+ \/ ターミナル (\S+) \/ ([^）]+)）/;
const NO_GAVE_UP_REASON = "（理由の記録が PR に無い）";

// 判断依頼の原因。上限・停止・直せなかったの 3 つは、印が 1 つでもあればその PR を人に渡したものとする（起動も数えもしない）。
export const CAUSE_DEPS_STALL = stallCause("deps-finish");
export const CAUSE_DEPS_CAP = "deps-finish の起動が上限";
export const CAUSE_DEPS_GAVE_UP = "deps-finish が直せなかった";
export const depsQuestionCause = (since) => `deps-finish の問い ${since}`;
const HANDED_OVER = [CAUSE_DEPS_STALL, CAUSE_DEPS_CAP, CAUSE_DEPS_GAVE_UP];
const QUESTION_MARK = /^案内役: Discord に判断依頼を送る（#(\d+) deps-finish の問い (.+)）$/;

const isRenovate = (pr) => typeof pr.headBranch === "string" && pr.headBranch.startsWith(RENOVATE_PREFIX);
const isLabeled = (pr) => (pr.labels ?? []).includes(DEPS_FINISH_LABEL);

// コメントとチェックを読む PR。snapshot.pullRequests の OPEN なもののうち、ラベル付きか renovate/ のブランチのもの。番号の小さい順。
export function depsPullRequestsToRead(snapshot) {
  return (snapshot.pullRequests ?? [])
    .filter((pr) => pr.state === "OPEN" && (isLabeled(pr) || isRenovate(pr)))
    .sort((a, b) => a.number - b.number);
}

// required: 必須チェックの名前（main の ruleset から読んだもの）
export function isDepsTarget(pr, required) {
  const red = mainState({ required, checks: pr.checks ?? [] }).state === "red";
  return (isLabeled(pr) && !pr.autoMerge) || ((isLabeled(pr) || isRenovate(pr)) && red);
}

// viewer のコメントを順にたどった、PR の印の要約。最後の 1 段目の印より後のもの（cycle・session・gaveUp・questionAt）は、1 段目の印のたびに戻す。
// cycle: none / launching（1 段目だけ）/ running（2 段目あり）/ finished（`## 依存の仕上げ`）/ gaveUp（直せなかった印）
function readMarks(pr, viewer) {
  const marks = { launches: 0, cycle: "none", session: null, gaveUp: null, questionAt: null, asked: new Set(), handedOver: null };
  const gaveUp = depsFinishGaveUpMarker(pr.number);
  for (const { author, body, createdAt } of pr.comments ?? []) {
    if (author !== viewer || typeof body !== "string") continue;
    const q = QUESTION_MARK.exec(body);
    const handedOver = HANDED_OVER.find((cause) => body === decisionMarker(pr.number, cause));
    if (body.startsWith(LAUNCHING_PREFIX)) {
      marks.launches += 1;
      Object.assign(marks, { cycle: "launching", session: null, gaveUp: null, questionAt: null });
    } else if (body.startsWith(LAUNCHED_PREFIX)) {
      if (marks.cycle !== "launching") continue;
      const m = LAUNCHED.exec(body);
      Object.assign(marks, { cycle: "running", session: m === null ? null : { handle: m[1], startedAt: m[2] } });
    } else if (q !== null && Number(q[1]) === pr.number) {
      marks.asked.add(q[2]);
      if (marks.cycle !== "none") marks.questionAt = createdAt ?? null;
    } else if (handedOver !== undefined) {
      marks.handedOver ??= handedOver;
    } else if (marks.cycle === "launching" || marks.cycle === "running") {
      if (body.split("\n")[0].startsWith(FINISH_REPORT_HEADING)) marks.cycle = "finished";
      else if (body.startsWith(gaveUp)) {
        marks.cycle = "gaveUp";
        marks.gaveUp = body.slice(gaveUp.length).replace(/^\s*[:：]/, "").trim() || NO_GAVE_UP_REASON;
      }
    }
  }
  return marks;
}

const laterOf = (a, b) => (b !== null && Date.parse(b) > Date.parse(a) ? b : a);

// PR の仕上げの段階。毎周、PR の印と観測から導き、どこにも保存しない。順に見るので段階は重ならない。
//   decided   { launches, cause }                判断依頼（上限・停止・直せなかった）の印がある。人に渡した（吸収する）
//   gaveUp    { launches, reason }               最後の 1 段目の印より後に直せなかった印がある
//   asking    { launches, session, since }       2 段目あり・結果なしで、セッションが hook の入力待ち（AskUserQuestion）
//   stalled   { launches, session, reason, tail } 2 段目あり・結果なしで、stallReason が止まったと判定した
//   running   { launches, session }              2 段目あり・結果なしで、止まっていない（観測が無いときを含む）
//   launching { launches }                       1 段目だけ（起動中）
//   idle      { launches }                       対象でない、または main と同じ必須チェックで落ちた（main-fix に任せる。review-fix と同じ）
//   capped    { launches }                       対象で、起動が上限に達し、最後のセッションは終わった
//   ready     { launches }                       対象で、起動が上限未満
// 停止の時間切れは、2 段目の起動時刻と、最後の問いの判断依頼の印の時刻の遅いほうから数える（本人を待った時間で切らない）。
// 時間切れは手が止まっている（idle）ときだけ数える。Evals まで回す仕上げは 60 分を超えることがあり、動いているのに止まった扱いにすると枠が空いて 2 本目を起動してしまう。
// ctx: { viewer, main, sessions, now, stallMinutes }
export function depsLifecycle(pr, ctx) {
  const marks = readMarks(pr, ctx.viewer);
  const { launches, session } = marks;
  if (marks.handedOver !== null) return { phase: "decided", launches, cause: marks.handedOver };
  if (marks.cycle === "gaveUp") return { phase: "gaveUp", launches, reason: marks.gaveUp };
  if (marks.cycle === "running") {
    const observation = session === null ? undefined : ctx.sessions?.[session.handle];
    if (observation === undefined) return { phase: "running", launches, session };
    if (awaitsHookInput(observation)) return { phase: "asking", launches, session, since: String(observation.waitSince) };
    if (observation.found && !observation.waiting && observation.idle !== true) return { phase: "running", launches, session };
    const reason = stallReason(observation, laterOf(session.startedAt, marks.questionAt), ctx);
    return reason === null ? { phase: "running", launches, session } : { phase: "stalled", launches, session, reason, tail: observation.tail ?? [] };
  }
  if (marks.cycle === "launching") return { phase: "launching", launches };
  if (!isDepsTarget(pr, ctx.main?.required ?? []) || (ctx.main !== undefined && failsLikeMain(ctx.main, pr.checks ?? []))) return { phase: "idle", launches };
  return { phase: launches >= DEPS_FINISH_LAUNCH_LIMIT ? "capped" : "ready", launches };
}

const ACTIVE = new Set(["launching", "running", "asking", "stalled"]);
const openDeps = (snapshot) => (snapshot.depsPullRequests ?? []).filter((pr) => pr.state === "OPEN").sort((a, b) => a.number - b.number);
const lifecycles = (snapshot) => openDeps(snapshot).map((pr) => ({ pr, life: depsLifecycle(pr, snapshot) }));

// 観測するセッション。印だけで見て running（2 段目あり・結果なし・人に渡していない）の PR の、最後の 2 段目の handle。
export function depsSessionsToObserve(snapshot) {
  return lifecycles({ ...snapshot, sessions: {} })
    .filter(({ life }) => life.phase === "running" && life.session !== null)
    .map(({ pr, life }) => ({ pr: pr.number, handle: life.session.handle, startedAt: life.session.startedAt }));
}

// 観測の後に、コメントを読み直す PR の番号。hook の入力待ち S で、S の問いの判断依頼の印がまだ無いもの（問いのコメントは入力待ちの直前に書かれる）。
export function depsQuestionsToRefresh(snapshot) {
  return lifecycles(snapshot)
    .filter(({ pr, life }) => life.phase === "asking" && !readMarks(pr, snapshot.viewer).asked.has(life.since))
    .map(({ pr }) => pr.number);
}

const ASKING_REASON = "セッションが本人の判断（AskUserQuestion）を待っている";

// 段階から、送る判断依頼の原因と中身を返す。送らない段階は null。
function requestOf(pr, life, viewer) {
  if (life.phase === "gaveUp") return { cause: CAUSE_DEPS_GAVE_UP, reason: life.reason };
  if (life.phase === "capped") return { cause: CAUSE_DEPS_CAP, reason: `起動が上限（${DEPS_FINISH_LAUNCH_LIMIT} 回）に達しても、PR が仕上げの対象のまま残っている` };
  if (life.phase === "stalled") return { cause: CAUSE_DEPS_STALL, reason: life.reason, tail: life.tail };
  if (life.phase === "asking") return { cause: depsQuestionCause(life.since), reason: ASKING_REASON, since: life.since, question: lastQuestion(pr, viewer) };
  return null;
}

// 判断依頼（PR ごと原因ごとに 1 度）と、起動する deps-finish（高々 1 件）を返す。
// 動いているセッション（launching・running・asking・stalled）があれば起動しない。止まったセッションは、判断依頼の印が読めて decided になってから外れる。
// 先頭の起動の候補を出し済み（dispatched）なら、次の候補へ進まずに何も起動しない。書いた 1 段目の印がまだ読めない周に、2 件目を起動しないため。
export function decideDeps(snapshot, dispatched) {
  const { viewer } = snapshot;
  const lives = lifecycles(snapshot);
  const actions = [];
  for (const { pr, life } of lives) {
    const request = requestOf(pr, life, viewer);
    if (request === null) continue;
    const key = `request-deps-decision:${pr.number}:${request.cause}`;
    if (dispatched.has(key) || (request.since !== undefined && readMarks(pr, viewer).asked.has(request.since))) continue;
    actions.push({ kind: "request-deps-decision", key, pr: pr.number, title: pr.title, tab: tabTitle("deps-finish", pr.number), ...request });
  }
  if (lives.filter(({ life }) => ACTIVE.has(life.phase)).length >= DEPS_FINISH_SESSIONS) return actions;
  const next = lives.find(({ life }) => life.phase === "ready");
  if (next === undefined) return actions;
  const { pr, life } = next;
  const key = `deps-finish:${pr.number}:${life.launches + 1}`;
  if (dispatched.has(key)) return actions;
  const group = isRenovate(pr) ? pr.headBranch.slice(RENOVATE_PREFIX.length) : null;
  return [...actions, { kind: "deps-finish", key, pr: pr.number, title: pr.title, head: pr.head, branch: pr.headBranch, group }];
}
