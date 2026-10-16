// 行動の実行。マーカーのコメントを起動より先に書く（起動の成否が不明なときに、流し直しても二重に起動しないため）。
// 外部の操作（コメント・to-tickets・takt-sequence）は注入する。
import { MARKER_FINISHED_PREFIX, MARKER_HANDED_PREFIX, MARKER_STARTED } from "./decide.mjs";

export function createExecute({ github, cwd, repo, runToTickets, startTaktSequence }) {
  return async (action) => {
    if (action.kind === "to-tickets") {
      github.comment(action.spec, MARKER_STARTED);
      const { code, logFile } = await runToTickets({ cwd, spec: action.spec });
      github.comment(action.spec, `${MARKER_FINISHED_PREFIX}${code}）`);
      if (code !== 0) throw new Error(`to-tickets (#${action.spec}) が exit ${code} で終了（ログ: ${logFile}）`);
    } else {
      github.comment(action.parent, `${MARKER_HANDED_PREFIX} ${action.issues.map((n) => `#${n}`).join(" ")}`);
      startTaktSequence({ cwd, repo, issues: action.issues });
    }
  };
}
