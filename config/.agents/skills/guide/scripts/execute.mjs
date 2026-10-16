// 行動の実行。マーカーのコメントを起動より先に書く（起動の成否が不明なときに、流し直しても二重に起動しないため）。
// 外部の操作（GitHub・Discord・to-tickets・takt-sequence）は注入する。
import {
  MARKER_APPROVAL_SENDING,
  MARKER_APPROVAL_SENT_PREFIX,
  MARKER_FINISHED_PREFIX,
  MARKER_HANDED_PREFIX,
  MARKER_REJECTED,
  MARKER_STARTED,
} from "./decide.mjs";

export function createExecute({ github, discord, cwd, repo, runToTickets, startTaktSequence }) {
  return async (action) => {
    if (action.kind === "request-approval") {
      // チャンネルの確保は繰り返しても安全なので、マーカーより先に行う（失敗しても流し直せる）。マーカーは二重送信の防止用。
      const channelId = await discord.ensureChannel(repo.split("/")[1].toLowerCase());
      github.comment(action.spec, MARKER_APPROVAL_SENDING);
      const url = `https://github.com/${repo}/issues/${action.spec}`;
      const { threadId, messageId } = await discord.sendApprovalRequest({ channelId, spec: action.spec, title: action.title, url });
      github.comment(action.spec, `${MARKER_APPROVAL_SENT_PREFIX}（スレッド ${threadId} / メッセージ ${messageId}）`);
    } else if (action.kind === "approve-spec") {
      github.addLabel(action.spec, "spec-approved");
    } else if (action.kind === "reject-spec") {
      github.comment(action.spec, MARKER_REJECTED);
    } else if (action.kind === "to-tickets") {
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
