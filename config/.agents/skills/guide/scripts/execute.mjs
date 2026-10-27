// 行動の実行。マーカーのコメントを起動より先に書く（起動の成否が不明なときに、流し直しても二重に起動しないため）。
// 外部の操作（GitHub・Discord・formal-spec・to-tickets・knowledge・takt-sequence・review-fix・タブを閉じる）は注入する。
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
  archivedThreadMarker,
  closedTabMarker,
  decisionAnsweredMarker,
  decisionMarker,
  decisionSentMarker,
  fogTicketMarker,
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
import { fixLaunchedMarker, fixLaunchingMarker } from "../../takt/scripts/review-stage.mjs";

export function createExecute({ github, discord, cwd, repo, launchToTickets, launchToSpec, launchFormalSpec, now, startTaktSequence, launchKnowledge, launchWayfinder, launchReviewFix, taktRunDirs, readReviewReport, sendToSession, closeTab }) {
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
    } else if (action.kind === "create-fog-ticket") {
      // 印は起こす前に書く（作成の成否が不明でも二重に起こさない。起こせていなければ、次の周から霧の残りの判断依頼になる）。
      github.comment(action.map, fogTicketMarker(action.children));
      github.createSubIssue(action.map, { title: action.title, body: action.body, labels: ["wayfinder:grilling"] });
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
    } else if (action.kind === "review-fix") {
      // 2 段の印（#360 の文言）を、sub-issue ではなく PR に書く。起動前の印が先なので、起動が失敗しても次の周で起動し直さない。
      github.comment(action.pr, fixLaunchingMarker(action.head));
      const launchedAt = now().toISOString();
      const { handle } = await launchReviewFix({ cwd, repo, pr: action.pr, issue: action.issue, head: action.head, branch: action.branch, reports: action.reports });
      github.comment(action.pr, fixLaunchedMarker(action.head, handle, launchedAt));
    } else if (action.kind === "merge-auto") {
      github.mergeAuto(action.pr);
    } else if (action.kind === "request-decision") {
      // 修正のセッションの停止（pr がある）だけ、レポートを読む。読み取りは副作用が無いので印より先。
      const report = action.pr === undefined ? {} : readReviewReport(action.reports);
      // マーカーは送信より先に書く（送信の成否が不明なまま流し直しても二度送らないため）。
      github.comment(action.spec, decisionMarker(action.issue, action.cause));
      const { messageId } = await discord.sendDecisionRequest({
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
        pr: action.pr,
        subIssue: action.subIssue,
        verdict: report.verdict,
        undecidable: report.undecidable,
      });
      // 送った後の印（2 段目）。メッセージへの本人の返信・✅ を、次の周から答えとして読む。
      github.comment(action.spec, decisionSentMarker(action.issue, action.cause, action.threadId, messageId));
    } else if (action.kind === "request-review-decision") {
      // レポートの読み取りは副作用が無いので印より先に読む。印は PR の番号で仕様に書き、送信より先（成否が不明なまま流し直しても二度送らない）。
      const { verdict, undecidable } = readReviewReport(action.reports);
      github.comment(action.spec, decisionMarker(action.pr, action.cause));
      const { messageId } = await discord.sendDecisionRequest({
        threadId: action.threadId,
        spec: action.spec,
        issue: action.pr,
        title: action.title,
        url: `https://github.com/${repo}/pull/${action.pr}`,
        reason: action.reason,
        reports: action.reports,
        pr: action.pr,
        subIssue: action.issue,
        verdict,
        undecidable,
      });
      github.comment(action.spec, decisionSentMarker(action.pr, action.cause, action.threadId, messageId));
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
      const { messageId } = await discord.sendDecisionRequest({
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
      github.comment(action.map, decisionSentMarker(action.issue, action.cause, action.threadId, messageId));
    } else if (action.kind === "record-decision-answer") {
      // 判断依頼の印と同じ issue（仕様か map）に書く。Discord には何も送らない。
      github.comment(action.spec ?? action.map, decisionAnsweredMarker(action.issue, action.cause));
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
    } else if (action.kind === "close-tab") {
      // 閉じ直しは害が無い（閉じ済みのタブも ok で返る）ので、起動と逆に印は後に書く。close が失敗すれば印を書かずに止まる。
      if (!action.gone) await closeTab({ cwd, handle: action.handle });
      github.comment(action.issue, closedTabMarker(action.step, action.handle));
    } else if (action.kind === "archive-thread") {
      // close-tab と同じく印は後に書く（アーカイブし直しは害が無い）。失敗すれば印を書かずに止まり、次に流したときにやり直す。
      await discord.archiveThread({ threadId: action.threadId });
      github.comment(action.issue, archivedThreadMarker(action.threadId));
    } else if (action.kind === "takt-sequence") {
      // to-tickets と同じ 2 段の印を親に書く。handle は、タブが消えたか終わったかを次の周以降に観測するため。
      github.comment(action.parent, `${MARKER_HANDED_PREFIX} ${action.issues.map((n) => `#${n}`).join(" ")}`);
      const launchedAt = now().toISOString();
      const { handle } = await startTaktSequence({ cwd, repo, issues: action.issues });
      github.comment(action.parent, launchedMarker("takt-sequence", handle, launchedAt));
    }
  };
}
