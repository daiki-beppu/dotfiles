// 起動したセッションの見張りに使う、印の文言と停止の判定。I/O を持たない葉のモジュール。
// decide.mjs と deps-finish-stage.mjs の両方が使う（decide.mjs は deps-finish-stage.mjs を import するので、共有するものはここに置いて循環を避ける）。

// viewer が書き、本文が接頭辞で始まるコメントだけをマーカーとして数える
export const markers = (issue, viewer) =>
  (issue.comments ?? []).filter((c) => c.author === viewer && typeof c.body === "string").map((c) => c.body);

// Orca のタブの題名。起動時にタブへ付け、セッションが見つからないときの判断依頼でも同じ値を使う。
export const tabTitle = (step, spec) => `${step} #${spec}`;

// 判断依頼: 送る前に仕様の issue へ書く。閉じ括弧まで含めて照合する（#2 が #21 に前方一致しないように）。
export const MARKER_DECISION_PREFIX = "案内役: Discord に判断依頼を送る";
export const stallCause = (step) => `${step} のセッションの停止`;
export const decisionMarker = (issue, cause) => `${MARKER_DECISION_PREFIX}（#${issue} ${cause}）`;

// grilling が AskUserQuestion の前に ticket へ書く問いのコメントの 1 行目。判断依頼の本文に載せる。
export const QUESTION_HEADING = "## 判断の問い";
export const NO_QUESTION = "（問いの記録が ticket に無い）";

export const DEFAULT_STALL_MINUTES = 60;

// 止まった理由を 1 つだけ選ぶ（見つからない → 入力待ち → 時間切れ）。止まっていなければ null。
export function stallReason(observation, startedAt, snapshot) {
  if (!observation.found) return "起動したセッションが Orca に見つからない";
  if (observation.waiting) return "セッションが入力待ち（確認・許可）で止まっている";
  const minutes = snapshot.stallMinutes ?? DEFAULT_STALL_MINUTES;
  if (Date.parse(snapshot.now) - Date.parse(startedAt) >= minutes * 60_000) {
    return `起動から ${minutes} 分経っても結果が GitHub に出ていない`;
  }
  return null;
}

// viewer の最後の「判断の問い」コメント（1 行目が見出し）の 2 行目以降。無ければ NO_QUESTION。
export function lastQuestion(ticket, viewer) {
  const body = markers(ticket, viewer)
    .filter((b) => b.split(/\r?\n/)[0].trimEnd() === QUESTION_HEADING)
    .at(-1);
  const text = body === undefined ? "" : body.split(/\r?\n/).slice(1).join("\n").trim();
  return text === "" ? NO_QUESTION : text;
}

// セッションが hook の入力待ち（停止の識別子つき）か。
export const awaitsHookInput = (observation) => Boolean(observation?.found && observation.waitSource === "hook" && observation.waitSince);
