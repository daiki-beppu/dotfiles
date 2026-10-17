// align-behind の判定。自動マージを予約した open な PR のスナップショットから、次の一手を返す純粋関数。I/O は持たない。
// 規則は live-mindmap の仕様 #1188（ADR 0022）のとおり。main の ruleset が strict だと、予約済みの PR は main が進むたびに BEHIND で止まる。
// 一斉に揃えると 1 件が入るたびに残りがまた BEHIND になって空回りするので、1 件ずつ揃える。
//
// prs: [{ number, enabledAt, mergeState, upToDate, check, dirtyNotified, alignFailed }]
//   enabledAt: 自動マージを予約した時刻（ISO 8601）
//   mergeState: GitHub の mergeStateStatus（BEHIND・DIRTY・CLEAN・BLOCKED・UNSTABLE・UNKNOWN など）
//   upToDate: head が最新の main を含むか
//   check: head の必須チェックの状態。"none" | "pending" | "success" | "failure"
//   dirtyNotified: 今の head に、もう DIRTY を知らせたか
//   alignFailed: 今の head で、この実行の update-branch が失敗したか（フォークで編集が許可されていない等。列を止めないよう飛ばす）
// 戻り値: { align: 揃える PR の番号か null, notify: DIRTY を知らせる PR の番号, wait: 待つ理由か null, skipped: [{ number, reason }] }

const byReservation = (a, b) => a.enabledAt.localeCompare(b.enabledAt) || a.number - b.number;

export function decide(prs) {
  const notify = prs.filter((p) => p.mergeState === "DIRTY" && !p.dirtyNotified).map((p) => p.number);
  const skipped = [];
  // 規則 1: 最新の main を含み、衝突も失敗もしていない PR があれば、それがマージされる（か落ちる）まで次は揃えない。
  // 緑でも待つ。check が緑になった直後はまだ GitHub の自動マージが入っていないので、ここで次を揃えると先の PR が入ったときにまた BEHIND になる
  const inFlight = prs.filter((p) => p.upToDate && p.mergeState !== "DIRTY" && p.check !== "failure").sort(byReservation)[0];
  if (inFlight) return { align: null, notify, wait: `#${inFlight.number} がマージされるか落ちるのを待つ（check: ${inFlight.check}）`, skipped };
  // 規則 2: BEHIND のうち、check が落ちていないものから、予約が最も古い 1 件を揃える
  const behind = prs.filter((p) => p.mergeState === "BEHIND").sort(byReservation);
  for (const p of behind) {
    if (p.check === "failure") skipped.push({ number: p.number, reason: "check が落ちている" });
    else if (p.alignFailed) skipped.push({ number: p.number, reason: "この head で update-branch が失敗した" });
  }
  const next = behind.find((p) => p.check !== "failure" && !p.alignFailed);
  return { align: next?.number ?? null, notify, wait: next ? null : "揃える PR が無い", skipped };
}
