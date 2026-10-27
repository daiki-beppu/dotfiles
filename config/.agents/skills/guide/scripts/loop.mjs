// 案内役の常駐ループ。スナップショットの取得・行動の実行・待機・表示（log・board・status）は呼び出し側が注入し、ここはアダプタを import しない。
import { decide } from "./decide.mjs";
import { boardOf, renderBoard, timeOf } from "./status.mjs";

const MAX_READ_ERRORS = 3;
// ターミナルの handle（term_ + UUID）は先頭 8 桁で見分けられる。行の頭が長い識別子で埋まらないように縮める。
const shortHandle = (h) => (h.startsWith("term_") ? h.slice(0, "term_".length + 8) : h);

const DESCRIBE = {
  "request-approval": (a) => `仕様 #${a.spec} の承認依頼を Discord に送る`,
  "approve-spec": (a) => `仕様 #${a.spec} に spec-approved を付ける`,
  "reject-spec": (a) => `仕様 #${a.spec} に差し戻しのコメントを書く`,
  "formal-spec": (a) => `仕様 #${a.spec} の形式検証 formal-spec を Orca のタブで起動する`,
  "to-tickets": (a) => `仕様 #${a.spec} を to-tickets で親 issue と sub-issue にする`,
  "takt-sequence": (a) => `親 #${a.parent} の sub-issue ${a.issues.map((n) => `#${n}`).join(" ")} を takt-sequence に渡す`,
  "merge-auto": (a) => `仕様 #${a.spec} の学びの PR #${a.pr} に自動マージを予約する`,
  "request-decision": (a) => `仕様 #${a.spec} のスレッドに #${a.issue}（${a.cause}）の判断依頼を送る`,
  "request-review-decision": (a) => `仕様 #${a.spec} のスレッドに PR #${a.pr}（sub-issue #${a.issue}）の takt のレビュー失敗の判断依頼を送る`,
  wayfinder: (a) =>
    `map #${a.map} の ticket #${a.ticket}（${a.type}）を /wayfinder で Orca のタブに起動する（task は origin/main からの worktree、他は main checkout）`,
  "to-spec": (a) => `晴れた map #${a.map} から to-spec を Orca のタブで起動する`,
  "create-fog-ticket": (a) => `子がすべて閉じても霧が残る map #${a.map} に、霧を晴らす grilling の ticket を起こす`,
  "create-map-thread": (a) => `map #${a.map} の Discord スレッドを立てる`,
  "notify-human-ticket": (a) => `map #${a.map} のスレッドに人が見る ticket #${a.ticket} を知らせる`,
  "request-map-decision": (a) => `map #${a.map} のスレッドに ticket #${a.issue}（${a.cause}）の判断依頼を送る`,
  "record-decision-answer": (a) => `${a.spec === undefined ? `map #${a.map}` : `仕様 #${a.spec}`} の #${a.issue}（${a.cause}）の判断依頼に本人が答えたと記録する`,
  "request-grilling-decision": (a) => `map #${a.map} のスレッドに ticket #${a.ticket} の grilling の問い（判断依頼）を送る`,
  "post-provisional-decision": (a) => `map #${a.map} のスレッドに ticket #${a.ticket} の仮決め ${a.n} を流す`,
  "reject-provisional-decision": (a) => `ticket #${a.ticket} の仮決め ${a.provisionals.map((p) => p.n).join(",")} の差し戻しを書き戻し、ticket を開き直して claim を外す`,
  "write-back-answer": (a) => `本人の返信を ticket #${a.ticket} のコメントに書き戻す`,
  "inject-answer": (a) => `ticket #${a.ticket} の回答をタブ ${shortHandle(a.handle)} に orca terminal send で流し込む`,
  "review-fix": (a) => `PR #${a.pr}（sub-issue #${a.issue}）の takt のレビューの失敗を直す review-fix を、head ブランチの worktree の Orca のタブで起動する`,
  "archive-thread": (a) => `閉じた${a.subject === "map" ? " map" : "仕様"} #${a.issue} の Discord スレッドをアーカイブする`,
  "close-tab": (a) => `終わった ${a.step} のタブ（#${a.issue}）を${a.gone ? "閉じた記録だけ残す（既に無い）" : "閉じる"}`,
  knowledge: (a) => `仕様 #${a.spec} の学びをまとめる knowledge を Orca のタブで起動する`,
};
const describe = (a) => DESCRIBE[a.kind](a);
const noop = () => {};

// 1 周: 読む → 決める → 実行する。status には今の段階を、board には状況の一覧（renderBoard の文字列）を渡す。
export async function runRound({ readSnapshot, execute, log, board = noop, status = noop, dryRun = false }, dispatched) {
  status("読み取り中…");
  const snapshot = { ...(await readSnapshot()), dispatched: [...dispatched] };
  status("判断中…");
  const actions = decide(snapshot);
  board(renderBoard(boardOf(snapshot), snapshot.now ? new Date(snapshot.now) : new Date()));
  if (dryRun) {
    if (actions.length === 0) log("することなし");
    for (const a of actions) log(`行動: ${describe(a)}`);
    return actions;
  }
  for (const a of actions) {
    status(`実行中: ${describe(a)}`);
    log(`実行: ${describe(a)}`);
    await execute(a);
    dispatched.add(a.key);
  }
  return actions;
}

// 取得の失敗は一時的なので再試行する。実行の失敗はマーカーの状態が不確かになるので止める。
// 状況の一覧は、1 行目（時刻）を除いて前に出したものと変わったときだけ渡す（毎周同じ一覧でペインを流さない）。
export async function runLoop({ readSnapshot, execute, log, sleep, board = noop, status = noop, now = () => new Date() }, { intervalSec, maxRounds = Infinity }) {
  const dispatched = new Set();
  let readFailed = false;
  const read = async () => {
    readFailed = true;
    const snapshot = await readSnapshot();
    readFailed = false;
    return snapshot;
  };
  let shown = null;
  const boardIfChanged = (text) => {
    const rows = text.split("\n").slice(1).join("\n");
    if (rows === shown) return;
    shown = rows;
    board(text);
  };
  let errors = 0;
  for (let round = 1; round <= maxRounds; round += 1) {
    let acted = 0;
    try {
      acted = (await runRound({ readSnapshot: read, execute, log, board: boardIfChanged, status }, dispatched)).length;
      errors = 0;
    } catch (e) {
      if (!readFailed) throw e;
      log(`監視エラー: ${String(e.message).split("\n")[0]}`);
      errors += 1;
      if (errors >= MAX_READ_ERRORS) throw e;
    }
    if (round < maxRounds) {
      const next = timeOf(new Date(now().getTime() + intervalSec * 1000));
      status(`待機中（次は ${next}。周 ${round}、この周の行動 ${acted} 件）`);
      await sleep(intervalSec * 1000);
    }
  }
}
