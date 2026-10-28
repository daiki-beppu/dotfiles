// takt-sequence の 1 周の判断。issue ごとの段階と並列数から、この周に積む issue と終わり方を返す純粋関数。I/O は持たない。
// stages: 並びの順の [issue, 段階]。段階は takt-sequence の stage() と同じ done / waiting / manual / stuck / new。
// ready(n): 積めるか（help wanted が無く、blocked_by が全部閉じている）。GitHub を読むので、空きがある間だけ並びの順に呼ぶ。
// concurrency: 同時に進める issue（waiting）の上限。人が引き取った PR（manual）と止まった issue（stuck）は数えない。
// 戻り値: { enqueue: 積む issue（並びの順）, end: 続けるなら null、終わるなら { line, code } }
export function planRound({ stages, ready, concurrency }) {
  const all = stages.map(([, s]) => s);
  if (all.every((s) => s === "done")) return { enqueue: [], end: { line: "全件マージ完了", code: 0 } };
  const enqueue = [];
  let free = concurrency - all.filter((s) => s === "waiting").length;
  for (const [n, s] of stages) {
    if (free <= 0) break;
    if (s === "new" && ready(n)) {
      enqueue.push(n);
      free -= 1;
    }
  }
  // 進行中の issue があれば、止まった issue があっても見届ける。手で対応中の PR だけが残っていれば、そのマージを待つ
  if (enqueue.length > 0 || all.includes("waiting")) return { enqueue, end: null };
  if (all.includes("manual") && !all.includes("stuck")) return { enqueue, end: null };
  const line = all.includes("stuck") ? "停止: 人の手が要る issue がある" : "停止: 積める issue が無い（依存が未解除か help wanted）";
  return { enqueue, end: { line, code: 1 } };
}
