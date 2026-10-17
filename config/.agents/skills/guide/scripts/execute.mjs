// 行動の実行。マーカーのコメントを起動より先に書く（起動の成否が不明なときに、流し直しても二重に起動しないため）。
// 外部の操作（GitHub・Discord・to-tickets・takt-sequence）は注入する。
import {
  MARKER_APPROVAL_SENDING,
  MARKER_APPROVAL_SENT_PREFIX,
  MARKER_HANDED_PREFIX,
  MARKER_KNOWLEDGE_STARTED,
  MARKER_REJECTED,
  MARKER_TO_TICKETS_LAUNCHING,
  decisionMarker,
  knowledgePrOf,
  toTicketsLaunchedMarker,
} from "./decide.mjs";

export function createExecute({ github, discord, cwd, repo, viewer, launchToTickets, now, startTaktSequence, runKnowledge, taktRunDirs }) {
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
      // 起動前の印 → 起動 → handle と起動時刻の印。handle は起動の応答からしか取れないので 2 段に分ける。
      github.comment(action.spec, MARKER_TO_TICKETS_LAUNCHING);
      const launchedAt = now().toISOString();
      const { handle } = await launchToTickets({ cwd, spec: action.spec });
      github.comment(action.spec, toTicketsLaunchedMarker(handle, launchedAt));
    } else if (action.kind === "knowledge") {
      github.comment(action.spec, MARKER_KNOWLEDGE_STARTED);
      const runDirs = taktRunDirs(cwd, [...action.subIssues]);
      const { code, logFile } = await runKnowledge({ cwd, repo, spec: action.spec, parents: action.parents, subIssues: action.subIssues, runDirs });
      if (code !== 0) throw new Error(`knowledge (#${action.spec}) が exit ${code} で終了（ログ: ${logFile}）`);
      const pr = knowledgePrOf(github.readPullRequests(), viewer, action.spec);
      if (pr === null) throw new Error(`knowledge (#${action.spec}) の後に学びの PR が見つからない（ログ: ${logFile}）`);
      github.mergeAuto(pr.number);
    } else if (action.kind === "merge-auto") {
      github.mergeAuto(action.pr);
    } else if (action.kind === "request-decision") {
      // マーカーは送信より先に書く（送信の成否が不明なまま流し直しても二度送らないため）。
      github.comment(action.spec, decisionMarker(action.issue, action.cause));
      await discord.sendDecisionRequest({
        threadId: action.threadId,
        spec: action.spec,
        issue: action.issue,
        title: action.title,
        url: `https://github.com/${repo}/issues/${action.issue}`,
        reason: action.reason,
        reports: action.reports,
      });
    } else if (action.kind === "takt-sequence") {
      github.comment(action.parent, `${MARKER_HANDED_PREFIX} ${action.issues.map((n) => `#${n}`).join(" ")}`);
      startTaktSequence({ cwd, repo, issues: action.issues });
    }
  };
}
