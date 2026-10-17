// takt-sequence の「PR のレビューの段階」の判定と、PR に書く印の文言。import も gh・takt の呼び出しも持たない純粋なモジュール。
// 子プロセスの起動・片付け・時計の読み取りは呼び出し側（takt-sequence.mjs）が行い、結果をここへ渡す。
// 印の文言はここが正本。案内役（guide スキル）の書き手は、この定数・関数を import して使う（依存の向きは案内役 → takt）。

export const REVIEWED = "TAKT review completed";
export const REVIEW_FAILED = "TAKT evaluation failed";
export const FIX_LAUNCH_LIMIT = 2;
export const DEFAULT_FIX_WAIT_MINUTES = 10;

// 修正の起動の印（案内役が書く 2 段）と、やり直しの印（修正のセッションが書く）
export const fixLaunchingMarker = (head) => `案内役: review-fix を起動する（head ${head}）`;
export const fixLaunchedMarker = (head, handle, launchedAt) => `案内役: review-fix を起動した（head ${head} / ターミナル ${handle} / ${launchedAt}）`;
export const redoMarker = (head) => `案内役: レビューのやり直しを頼む for head ${head}`;

const HEAD = "([0-9a-f]{40})";
const LAUNCHING = new RegExp(`^案内役: review-fix を起動する（head ${HEAD}）$`);
const LAUNCHED = new RegExp(`^案内役: review-fix を起動した（head ${HEAD} / `);
const REDO = new RegExp(`^案内役: レビューのやり直しを頼む for head ${HEAD}$`);

const active = (t) => t.kind === "pending" || t.kind === "running";
const time = (s) => new Date(s).getTime();
const firstLine = (body) => body.split("\n")[0];

// 戻り値: { stage, reason, redo }
// stage: reviewed（済み）/ waiting（実行中・修正待ち）/ stuck（人の手が要る）/ review（レビューを起動する）
// reason: waiting（修正待ち）と stuck の理由。それ以外は null
// redo: 現在の head の有効なやり直しの印の createdAt（無ければ null）。呼び出し側が起動記録 { head, redo } に残す
// comments: [{ author: { login }, body, createdAt }] / merges: その PR の merge タスク / attempts: この実行の起動記録 [{ head, redo }]
// now: Date・ISO 文字列・ミリ秒のどれでもよい
export function reviewStage({ head, viewer, comments, merges, attempts, running, now, waitMinutes }) {
  const mine = comments.filter((c) => c.author?.login === viewer);
  const markedHead = (re, c) => (firstLine(c.body).match(re) ?? [])[1];

  const redoComment = mine.find((c) => markedHead(REDO, c) === head);
  const redo = redoComment?.createdAt ?? null;
  const result = (stage, reason = null) => ({ stage, reason, redo });
  const busy = running || merges.some(active);

  if (mine.some((c) => c.body.startsWith(`${REVIEWED} for head ${head};`))) return result(busy ? "waiting" : "reviewed");
  if (busy) return result("waiting");

  // やり直しの印より前の失敗は数えない
  const afterRedo = (createdAt) => redo === null || time(createdAt) > time(redo);
  const failures = mine.filter((c) => c.body.startsWith(`${REVIEW_FAILED} for head ${head}:`) && afterRedo(c.createdAt));
  const failure = failures.at(-1);
  const reasonOf = failure ? firstLine(failure.body) : "";

  if (redo !== null && failure) return result("stuck", `やり直しの後も失敗: ${reasonOf}`);

  const crashedMerges = merges.filter((m) => m.kind === "failed" && (m.data?.merge_initial_head_sha === head || m.data?.merge_pushed_head_sha === head) && afterRedo(m.createdAt)).length;
  const launched = attempts.filter((a) => a.head === head && a.redo === redo).length;
  if (Math.max(crashedMerges, launched) >= 2) return result("stuck", "takt merge が 2 回落ちた（takt list の merge タスクを見る）");

  if (!failure) return result("review");

  // 起動の回数は 1 段目の印で数える（1 回の起動が 2 段で 1 回）
  const hasMark = mine.some((c) => markedHead(LAUNCHING, c) === head || markedHead(LAUNCHED, c) === head);
  if (!hasMark && mine.filter((c) => markedHead(LAUNCHING, c)).length >= FIX_LAUNCH_LIMIT) {
    return result("stuck", `修正の起動が上限（${FIX_LAUNCH_LIMIT} 回）に達した: ${reasonOf}`);
  }
  if (hasMark) return result("waiting", `修正中: ${reasonOf}`);
  if (time(now) - time(failure.createdAt) < waitMinutes * 60_000) return result("waiting", `修正の起動待ち: ${reasonOf}`);
  return result("stuck", `修正の起動を待つ時間（${waitMinutes} 分）を過ぎた: ${reasonOf}`);
}
