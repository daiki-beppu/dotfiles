// 依存の PR の仕上げ（deps-finish）の判定と印の文言。I/O を持たない純粋なモジュール。
// takt は deps-finish の印を読まないので、review-fix の印と違って takt の review-stage.mjs には置かない。
//
// 対象: OPEN な PR のうち、deps:finish のラベル付き（自動マージを予約済みなら必須チェックが落ちるまで外す）と、
//       renovate/ のブランチで必須チェックが落ちたもの。`## 依存の仕上げ` のコメントでは対象を決めない。
// 起動は 1 度に 1 件、対象を番号の小さい順に見て、PR ごとに 2 回まで（1 段目の印の数で数える）。
import { failsLikeMain, mainState } from "../../takt/scripts/main-state.mjs";

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

const isRenovate = (pr) => typeof pr.headBranch === "string" && pr.headBranch.startsWith(RENOVATE_PREFIX);
const isLabeled = (pr) => (pr.labels ?? []).includes(DEPS_FINISH_LABEL);

// コメントとチェックを読む PR。snapshot.pullRequests の OPEN なもののうち、ラベル付きか renovate/ のブランチのもの。番号の小さい順。
export function depsPullRequestsToRead(snapshot) {
  return (snapshot.pullRequests ?? [])
    .filter((pr) => pr.state === "OPEN" && (isLabeled(pr) || isRenovate(pr)))
    .sort((a, b) => a.number - b.number);
}

// viewer のコメントを順にたどった、PR の仕上げのセッションの段階と起動の回数。
// 結果（`## 依存の仕上げ` か直せなかった印）は、最後の 1 段目の印より後にあるものだけを数える。
export function phaseOf(pr, viewer) {
  let phase = "none";
  let launches = 0;
  const gaveUp = depsFinishGaveUpMarker(pr.number);
  for (const { author, body } of pr.comments ?? []) {
    if (author !== viewer || typeof body !== "string") continue;
    if (body.startsWith(LAUNCHING_PREFIX)) {
      launches += 1;
      phase = "marked";
    } else if (body.startsWith(LAUNCHED_PREFIX)) {
      if (phase === "marked") phase = "running";
    } else if (phase === "marked" || phase === "running") {
      if (body.split("\n")[0].startsWith(FINISH_REPORT_HEADING)) phase = "finished";
      else if (body.startsWith(gaveUp)) phase = "gaveUp";
    }
  }
  return { phase, launches };
}

// required: 必須チェックの名前（main の ruleset から読んだもの）
export function isDepsTarget(pr, required) {
  const red = mainState({ required, checks: pr.checks ?? [] }).state === "red";
  return (isLabeled(pr) && !pr.autoMerge) || ((isLabeled(pr) || isRenovate(pr)) && red);
}

const isActive = ({ phase }) => phase === "marked" || phase === "running";

// 起動する deps-finish を高々 1 件返す。動いているセッションがあれば起動しない。
// main と同じ必須チェックで落ちた PR は main の壊れなので除く（main-fix に任せる。review-fix と同じ）。
// 先頭の候補を出し済み（dispatched）なら、次の候補へ進まずに何も出さない。書いた 1 段目の印がまだ読めない周に、2 件目を起動しないため。
export function decideDepsFinish(snapshot, dispatched) {
  const { viewer, main } = snapshot;
  const prs = (snapshot.depsPullRequests ?? []).filter((pr) => pr.state === "OPEN").sort((a, b) => a.number - b.number);
  const phases = new Map(prs.map((pr) => [pr.number, phaseOf(pr, viewer)]));
  if (prs.filter((pr) => isActive(phases.get(pr.number))).length >= DEPS_FINISH_SESSIONS) return [];
  const required = main?.required ?? [];
  for (const pr of prs) {
    const { launches } = phases.get(pr.number);
    if (!isDepsTarget(pr, required) || launches >= DEPS_FINISH_LAUNCH_LIMIT) continue;
    const key = `deps-finish:${pr.number}:${launches + 1}`;
    if (main !== undefined && failsLikeMain(main, pr.checks ?? [])) continue;
    if (dispatched.has(key)) return [];
    const group = isRenovate(pr) ? pr.headBranch.slice(RENOVATE_PREFIX.length) : null;
    return [{ kind: "deps-finish", key, pr: pr.number, title: pr.title, head: pr.head, branch: pr.headBranch, group }];
  }
  return [];
}
