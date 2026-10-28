// takt-sequence の「PR のレビューの段階」の判定と、PR に書く印の文言。import も gh・takt の呼び出しも持たない純粋なモジュール。
// 子プロセスの起動・片付け・時計の読み取りは呼び出し側（takt-sequence.mjs）が行い、結果をここへ渡す。
// 印の文言はここが正本。案内役（guide スキル）の書き手は、この定数・関数を import して使う（依存の向きは案内役 → takt）。
// main の状態と「main と同じチェックで落ちたか」の判定は main-state.mjs（案内役と同じ判定）を使う。

import { failsLikeMain, mainState } from "./main-state.mjs";

export const REVIEWED = "TAKT review completed";
export const REVIEW_FAILED = "TAKT evaluation failed";
export const FIX_LAUNCH_LIMIT = 2;
export const DEFAULT_FIX_WAIT_MINUTES = 10;

// 修正の起動の印（案内役が書く 2 段）と、やり直しの印（修正のセッションが書く）
export const fixLaunchingMarker = (head) => `案内役: review-fix を起動する（head ${head}）`;
export const fixLaunchedMarker = (head, handle, launchedAt) => `案内役: review-fix を起動した（head ${head} / ターミナル ${handle} / ${launchedAt}）`;
export const redoMarker = (head) => `案内役: レビューのやり直しを頼む for head ${head}`;
// main の修復待ちの印（takt-sequence が書く）。この印より前の失敗は main の壊れとみなし、main が緑に戻ったらレビューし直す
export const mainWaitMarker = (head, checks) => `takt-sequence: main の修復待ち for head ${head}（落ちたチェック: ${checks.join(", ")}）`;

const HEAD = "([0-9a-f]{40})";
const LAUNCHING = new RegExp(`^案内役: review-fix を起動する（head ${HEAD}）$`);
const LAUNCHED = new RegExp(`^案内役: review-fix を起動した（head ${HEAD} / `);
const LAUNCHED_FULL = new RegExp(`^案内役: review-fix を起動した（head ${HEAD} / ターミナル (\\S+) / ([^）]+)）`);
const REDO = new RegExp(`^案内役: レビューのやり直しを頼む for head ${HEAD}$`);
const MAIN_WAIT = new RegExp(`^takt-sequence: main の修復待ち for head ${HEAD}（`);

const active = (t) => t.kind === "pending" || t.kind === "running";
const time = (s) => new Date(s).getTime();
const firstLine = (body) => body.split("\n")[0];
const markedHead = (re) => (body) => (firstLine(body).match(re) ?? [])[1];

// 本文の 1 行目が印に一致すれば head を返し、一致しなければ undefined を返す（案内役の判定も同じ照合を使う）
export const fixLaunchingHead = markedHead(LAUNCHING);
export const fixLaunchedHead = markedHead(LAUNCHED);
export const redoHead = markedHead(REDO);
export const mainWaitHead = markedHead(MAIN_WAIT);

// 2 段目の印の本文の 1 行目から { head, handle, launchedAt } を取り出す。一致しなければ undefined（案内役が修正のセッションの停止を観測するとき使う）
export function fixLaunchedOf(body) {
  const m = firstLine(body).match(LAUNCHED_FULL);
  return m ? { head: m[1], handle: m[2], launchedAt: m[3] } : undefined;
}

// 戻り値: { stage, reason, redo, mainWait }
// stage: reviewed（済み）/ waiting（実行中・修正待ち・main の修復待ち）/ stuck（人の手が要る）/ review（レビューを起動する）
// reason: waiting（修正待ち・main の修復待ち）と stuck の理由。それ以外は null
// redo: 失敗を数え直す起点の createdAt（現在の head の有効なやり直しの印か、main が緑に戻った後の main の修復待ちの印の新しい方。無ければ null）。
//   呼び出し側が起動記録 { head, redo } に残す
// mainWait: main の修復待ちの印を書くときの、main で落ちている必須チェックの名前の配列（書かないときは null）。呼び出し側が mainWaitMarker で PR に書く
// comments: [{ author: { login }, body, createdAt }] / merges: その PR の merge タスク / attempts: この実行の起動記録 [{ head, redo }]
// main: main の最新の commit の { required, checks }（main-state.mjs の mainState の入力。読まなければ undefined）
// checks: PR の現在の head の check-runs [{ id, name, status, conclusion }]
// now: Date・ISO 文字列・ミリ秒のどれでもよい
export function reviewStage({ head, viewer, comments, merges, attempts, running, now, waitMinutes, main, checks = [] }) {
  const mine = comments.filter((c) => c.author?.login === viewer);

  const redoComment = mine.find((c) => redoHead(c.body) === head);
  const redoAt = redoComment?.createdAt ?? null;
  // main の修復待ちの印は、main が緑に戻ったときだけ数え直しの起点にする（赤・未定の間は待ち続ける）
  const waitMark = mine.filter((c) => mainWaitHead(c.body) === head).at(-1);
  const state = main === undefined ? undefined : mainState(main);
  const recovered = waitMark && state?.state === "green" ? waitMark.createdAt : null;
  const redo = [redoAt, recovered].filter((t) => t !== null).sort((a, b) => time(a) - time(b)).at(-1) ?? null;
  const result = (stage, reason = null, mainWait = null) => ({ stage, reason, redo, mainWait });
  const busy = running || merges.some(active);

  if (mine.some((c) => c.body.startsWith(`${REVIEWED} for head ${head};`))) return result(busy ? "waiting" : "reviewed");
  if (busy) return result("waiting");

  // 起点（やり直しの印・main が緑に戻った後の修復待ちの印）より前の失敗は数えない
  const afterRedo = (createdAt) => redo === null || time(createdAt) > time(redo);
  const failures = mine.filter((c) => c.body.startsWith(`${REVIEW_FAILED} for head ${head}:`) && afterRedo(c.createdAt));
  const failure = failures.at(-1);
  const reasonOf = failure ? firstLine(failure.body) : "";

  // 落ちたチェックがすべて main でも落ちている必須チェックなら、PR の失敗でなく main の壊れとみなし、修正の起動も待ち時間も数えない。
  // 印を書いた後は、main が緑に戻るまで（未定の間も）待つ
  if (failure) {
    if (waitMark && time(waitMark.createdAt) > time(failure.createdAt)) return result("waiting", `main の修復待ち: ${reasonOf}`);
    if (main !== undefined && failsLikeMain(main, checks)) return result("waiting", `main の修復待ち: ${reasonOf}`, state.failed.map((c) => c.name));
  }

  if (redoAt !== null && failure) return result("stuck", `やり直しの後も失敗: ${reasonOf}`);

  const crashedMerges = merges.filter((m) => m.kind === "failed" && (m.data?.merge_initial_head_sha === head || m.data?.merge_pushed_head_sha === head) && afterRedo(m.createdAt)).length;
  const launched = attempts.filter((a) => a.head === head && a.redo === redo).length;
  if (Math.max(crashedMerges, launched) >= 2) return result("stuck", "takt merge が 2 回落ちた（takt list の merge タスクを見る）");

  if (!failure) return result("review");

  // 起動の回数は 1 段目の印で数える（1 回の起動が 2 段で 1 回）
  const hasMark = mine.some((c) => fixLaunchingHead(c.body) === head || fixLaunchedHead(c.body) === head);
  if (!hasMark && mine.filter((c) => fixLaunchingHead(c.body)).length >= FIX_LAUNCH_LIMIT) {
    return result("stuck", `修正の起動が上限（${FIX_LAUNCH_LIMIT} 回）に達した: ${reasonOf}`);
  }
  if (hasMark) return result("waiting", `修正中: ${reasonOf}`);
  if (time(now) - time(failure.createdAt) < waitMinutes * 60_000) return result("waiting", `修正の起動待ち: ${reasonOf}`);
  return result("stuck", `修正の起動を待つ時間（${waitMinutes} 分）を過ぎた: ${reasonOf}`);
}
