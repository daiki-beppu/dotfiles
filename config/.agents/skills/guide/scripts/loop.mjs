// 案内役の常駐ループ。スナップショットの取得・行動の実行・待機は呼び出し側が注入し、ここはアダプタを import しない。
import { decide } from "./decide.mjs";

const MAX_READ_ERRORS = 3;

const DESCRIBE = {
  "request-approval": (a) => `${a.key}: 仕様 #${a.spec} の承認依頼を Discord に送る`,
  "approve-spec": (a) => `${a.key}: 仕様 #${a.spec} に spec-approved を付ける`,
  "reject-spec": (a) => `${a.key}: 仕様 #${a.spec} に差し戻しのコメントを書く`,
  "formal-spec": (a) => `${a.key}: 仕様 #${a.spec} の形式検証 formal-spec を Orca のタブで起動する`,
  "to-tickets": (a) => `${a.key}: 仕様 #${a.spec} を to-tickets で親 issue と sub-issue にする`,
  "takt-sequence": (a) => `${a.key}: 親 #${a.parent} の sub-issue ${a.issues.map((n) => `#${n}`).join(" ")} を takt-sequence に渡す`,
  "merge-auto": (a) => `${a.key}: 仕様 #${a.spec} の学びの PR #${a.pr} に自動マージを予約する`,
  "request-decision": (a) => `${a.key}: 仕様 #${a.spec} のスレッドに #${a.issue} の判断依頼を送る`,
  "request-review-decision": (a) => `${a.key}: 仕様 #${a.spec} のスレッドに PR #${a.pr}（sub-issue #${a.issue}）の takt のレビュー失敗の判断依頼を送る`,
  wayfinder: (a) =>
    `${a.key}: map #${a.map} の ticket #${a.ticket}（${a.type}）を /wayfinder で Orca のタブに起動する（task は origin/main からの worktree、他は main checkout）`,
  "to-spec": (a) => `${a.key}: 晴れた map #${a.map} から to-spec を Orca のタブで起動する`,
  "create-map-thread": (a) => `${a.key}: map #${a.map} の Discord スレッドを立てる`,
  "notify-human-ticket": (a) => `${a.key}: map #${a.map} のスレッドに人が見る ticket #${a.ticket} を知らせる`,
  "request-map-decision": (a) => `${a.key}: map #${a.map} のスレッドに ticket #${a.issue} の判断依頼を送る`,
  "request-grilling-decision": (a) => `${a.key}: map #${a.map} のスレッドに ticket #${a.ticket} の grilling の問い（判断依頼）を送る`,
  "post-provisional-decision": (a) => `${a.key}: map #${a.map} のスレッドに ticket #${a.ticket} の仮決め ${a.n} を流す`,
  "reject-provisional-decision": (a) => `${a.key}: ticket #${a.ticket} の仮決め ${a.provisionals.map((p) => p.n).join(",")} の差し戻しを書き戻し、ticket を開き直して claim を外す`,
  "write-back-answer": (a) => `${a.key}: 本人の返信を ticket #${a.ticket} のコメントに書き戻す`,
  "inject-answer": (a) => `${a.key}: ticket #${a.ticket} の回答をタブ ${a.handle} に orca terminal send で流し込む`,
  "review-fix": (a) => `${a.key}: PR #${a.pr}（sub-issue #${a.issue}）の takt のレビューの失敗を直す review-fix を、head ブランチの worktree の Orca のタブで起動する`,
  knowledge: (a) => `${a.key}: 仕様 #${a.spec} の学びをまとめる knowledge を Orca のタブで起動する`,
};
const describe = (a) => DESCRIBE[a.kind](a);

export async function runRound({ readSnapshot, execute, log, dryRun = false }, dispatched) {
  const snapshot = { ...(await readSnapshot()), dispatched: [...dispatched] };
  const actions = decide(snapshot);
  if (dryRun) {
    if (actions.length === 0) log("することなし");
    for (const a of actions) log(`行動: ${describe(a)}`);
    return actions;
  }
  for (const a of actions) {
    log(`実行: ${describe(a)}`);
    await execute(a);
    dispatched.add(a.key);
  }
  return actions;
}

// 取得の失敗は一時的なので再試行する。実行の失敗はマーカーの状態が不確かになるので止める。
export async function runLoop({ readSnapshot, execute, log, sleep }, { intervalSec, maxRounds = Infinity }) {
  const dispatched = new Set();
  let readFailed = false;
  const read = async () => {
    readFailed = true;
    const snapshot = await readSnapshot();
    readFailed = false;
    return snapshot;
  };
  let errors = 0;
  for (let round = 1; round <= maxRounds; round += 1) {
    try {
      await runRound({ readSnapshot: read, execute, log }, dispatched);
      errors = 0;
    } catch (e) {
      if (!readFailed) throw e;
      log(`監視エラー: ${String(e.message).split("\n")[0]}`);
      errors += 1;
      if (errors >= MAX_READ_ERRORS) throw e;
    }
    if (round < maxRounds) await sleep(intervalSec * 1000);
  }
}
