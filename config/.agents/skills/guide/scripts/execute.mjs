// 行動の実行。マーカーのコメントを起動より先に書く（起動の成否が不明なときに、流し直しても二重に起動しないため）。
// 外部の操作（GitHub・Discord・formal-spec・to-tickets・knowledge・takt-sequence）は注入する。
import {
  MARKER_APPROVAL_SENDING,
  MARKER_FORMAL_SPEC_LAUNCHING,
  MARKER_APPROVAL_SENT_PREFIX,
  MARKER_HANDED_PREFIX,
  MARKER_KNOWLEDGE_LAUNCHING,
  MARKER_MAP_THREAD_CREATED_PREFIX,
  MARKER_MAP_THREAD_CREATING,
  MARKER_REJECTED,
  MARKER_WAYFINDER_LAUNCHING,
  MARKER_TO_SPEC_LAUNCHING,
  MARKER_TO_TICKETS_LAUNCHING,
  decisionMarker,
  grillingInjectMarker,
  grillingSendingMarker,
  grillingSentMarker,
  grillingWrittenMarker,
  humanTicketMarker,
  launchedMarker,
  provisionalRejectedMarker,
  provisionalSendingMarker,
  provisionalSentMarker,
} from "./decide.mjs";

export function createExecute({ github, discord, cwd, repo, launchToTickets, launchToSpec, launchFormalSpec, now, startTaktSequence, launchKnowledge, launchWayfinder, taktRunDirs, sendToSession }) {
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
    } else if (action.kind === "formal-spec") {
      // to-tickets と同じ 2 段の印。結果は仕様の Formal Spec コメントで、次の周以降に判定する。
      github.comment(action.spec, MARKER_FORMAL_SPEC_LAUNCHING);
      const launchedAt = now().toISOString();
      const { handle } = await launchFormalSpec({ cwd, spec: action.spec });
      github.comment(action.spec, launchedMarker("formal-spec", handle, launchedAt));
    } else if (action.kind === "to-tickets") {
      // 起動前の印 → 起動 → handle と起動時刻の印。handle は起動の応答からしか取れないので 2 段に分ける。
      github.comment(action.spec, MARKER_TO_TICKETS_LAUNCHING);
      const launchedAt = now().toISOString();
      const { handle } = await launchToTickets({ cwd, spec: action.spec });
      github.comment(action.spec, launchedMarker("to-tickets", handle, launchedAt));
    } else if (action.kind === "to-spec") {
      // to-tickets と同じ 2 段の印を、晴れた map に書く。結果は map を指す仕様の issue で、次の周以降に判定する。
      github.comment(action.map, MARKER_TO_SPEC_LAUNCHING);
      const launchedAt = now().toISOString();
      const { handle } = await launchToSpec({ cwd, map: action.map });
      github.comment(action.map, launchedMarker("to-spec", handle, launchedAt));
    } else if (action.kind === "knowledge") {
      // to-tickets と同じ 2 段の印。PR は待たない（できたかどうかは次の周以降に merge-auto の遷移が判定する）。
      const runDirs = taktRunDirs(cwd, [...action.subIssues]);
      github.comment(action.spec, MARKER_KNOWLEDGE_LAUNCHING);
      const launchedAt = now().toISOString();
      const { handle } = await launchKnowledge({ cwd, spec: action.spec, parents: action.parents, subIssues: action.subIssues, runDirs });
      github.comment(action.spec, launchedMarker("knowledge", handle, launchedAt));
    } else if (action.kind === "wayfinder") {
      // to-tickets と同じ 2 段の印を、map ではなく起動する ticket に書く（1 ticket 1 セッション）。
      github.comment(action.ticket, MARKER_WAYFINDER_LAUNCHING);
      const launchedAt = now().toISOString();
      const { handle } = await launchWayfinder({ cwd, map: action.map, ticket: action.ticket, type: action.type });
      github.comment(action.ticket, launchedMarker("wayfinder", handle, launchedAt));
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
        step: action.step,
        tab: action.tab,
        tail: action.tail,
      });
    } else if (action.kind === "create-map-thread") {
      // 承認依頼と同じ 2 段の印を map に書く。スレッドの ID は作成の応答からしか取れない。
      const channelId = await discord.ensureChannel(repo.split("/")[1].toLowerCase());
      github.comment(action.map, MARKER_MAP_THREAD_CREATING);
      const { threadId } = await discord.createMapThread({ channelId, map: action.map, title: action.title });
      github.comment(action.map, `${MARKER_MAP_THREAD_CREATED_PREFIX}（スレッド ${threadId}）`);
    } else if (action.kind === "notify-human-ticket") {
      // 印は送信より先に map に書く（prototype の ticket ではセッションを起動しない）。
      github.comment(action.map, humanTicketMarker(action.ticket));
      await discord.sendHumanTicket({
        threadId: action.threadId,
        map: action.map,
        ticket: action.ticket,
        title: action.title,
        url: `https://github.com/${repo}/issues/${action.ticket}`,
      });
    } else if (action.kind === "post-provisional-decision") {
      // 送る前の印 → 送信 → スレッドとメッセージの ID つきの印。印は ticket に書き、送信より先（再起動しても再送しない）。ID は差し戻しの受け付けに使う。
      github.comment(action.ticket, provisionalSendingMarker(action.ticket, action.n));
      const { messageId } = await discord.sendProvisionalDecision({
        threadId: action.threadId,
        map: action.map,
        ticket: action.ticket,
        title: action.title,
        url: `https://github.com/${repo}/issues/${action.ticket}`,
        question: action.question,
        answer: action.answer,
        reason: action.reason,
        evidence: action.evidence,
      });
      github.comment(action.ticket, provisionalSentMarker(action.ticket, action.n, action.threadId, messageId));
    } else if (action.kind === "reject-provisional-decision") {
      // 書き戻し（印）→ 開き直し → claim の解除。印は行動より先（途中で失敗して再起動しても書き戻しをやり直さない）。
      for (const p of action.provisionals) github.comment(action.ticket, provisionalRejectedMarker(action.ticket, p.n, p.question, p.answer));
      github.reopen(action.ticket);
      github.removeAssignees(action.ticket, action.assignees);
    } else if (action.kind === "request-map-decision") {
      // 仕様の判断依頼と同じ印の形を、map に書く。
      github.comment(action.map, decisionMarker(action.issue, action.cause));
      await discord.sendDecisionRequest({
        threadId: action.threadId,
        map: action.map,
        issue: action.issue,
        title: action.title,
        url: `https://github.com/${repo}/issues/${action.issue}`,
        reason: action.reason,
        step: action.step,
        tab: action.tab,
        tail: action.tail,
      });
    } else if (action.kind === "request-grilling-decision") {
      // 送る前の印 → 問いつきで送信 → スレッドとメッセージの ID つきの印。印は送信より先（再起動しても再送しない）。
      github.comment(action.ticket, grillingSendingMarker(action.ticket, action.since));
      const { messageId } = await discord.sendDecisionRequest({
        threadId: action.threadId,
        map: action.map,
        issue: action.ticket,
        title: action.title,
        url: `https://github.com/${repo}/issues/${action.ticket}`,
        reason: "grilling が不可逆な判断を人に聞いている（AskUserQuestion の入力待ち）",
        step: "wayfinder",
        tab: action.tab,
        tail: action.tail,
        question: action.question,
      });
      github.comment(action.ticket, grillingSentMarker(action.ticket, action.since, action.threadId, messageId));
    } else if (action.kind === "write-back-answer") {
      github.comment(action.ticket, grillingWrittenMarker(action.ticket, action.since, action.answer));
    } else if (action.kind === "inject-answer") {
      // 印は送信より先。改行は空白にして 1 行で送る（改行で入力が途中で確定しないように）。
      github.comment(action.ticket, grillingInjectMarker(action.ticket, action.since));
      await sendToSession({ handle: action.handle, text: action.answer.replace(/\s*\r?\n\s*/g, " ").trim() });
    } else if (action.kind === "takt-sequence") {
      // to-tickets と同じ 2 段の印を親に書く。handle は、タブが消えたか終わったかを次の周以降に観測するため。
      github.comment(action.parent, `${MARKER_HANDED_PREFIX} ${action.issues.map((n) => `#${n}`).join(" ")}`);
      const launchedAt = now().toISOString();
      const { handle } = await startTaktSequence({ cwd, repo, issues: action.issues });
      github.comment(action.parent, launchedMarker("takt-sequence", handle, launchedAt));
    }
  };
}
