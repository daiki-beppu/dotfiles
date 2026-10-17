// スナップショットの組み立て。GitHub の issue に、承認依頼を送り済みの OPEN な仕様（承認済みを含む）の Discord リアクションを足す。
// 起動した工程のセッションと takt-sequence のタブ、wayfinder で起動した ticket のセッションと晴れた map の to-spec のセッションは Orca で観測して sessions に入れる（結果が GitHub に出たものは観測しない。ただし工程と takt-sequence は、閉じる候補として閉じた印が付くまで観測する）。現在時刻 now と stallMinutes も渡す。
// 渡した sub-issue の OPEN な PR は、コメントと merge タスクの記録を読む（review-fix の判定用）。その PR の修正のセッションも、結果が出ていなければ観測する。
// 読み取りだけで、書き込みはしない。リアクションの取得失敗は例外にして、呼び出し側の再試行に任せる。
import { awaitsReaction, grillingQuestionsToRefresh, mapSessionsToObserve, grillingRepliesToRead, provisionalRejectionsToRead, reviewFixSessionsToObserve, reviewPullRequestsToRead, sentApprovalRequest, sequencesToObserve, sessionsToObserve, tabsToClose, ticketSessionsToObserve } from "./decide.mjs";

export function createReadSnapshot({ repo, viewer, discordUserId, fromSpec, github, discord, taktTasks, mergeTasks, now = () => new Date(), stallMinutes, observeSession }) {
  return async () => {
    const issues = await Promise.all(
      github.readIssues().map(async (issue) => {
        if (!awaitsReaction(issue, viewer)) return issue;
        const reactions = await discord.readReactions(sentApprovalRequest(issue, viewer));
        return { ...issue, reactions };
      }),
    );
    const tasks = taktTasks();
    const observed = { repo, viewer, discordUserId, fromSpec, issues, taktIssues: tasks.map((t) => t.issue), taktTasks: tasks, pullRequests: github.readPullRequests() };
    // 渡した sub-issue の OPEN な PR だけ、コメントを読む（PR を持たない issue の読み取りは増やさない）。親の印は grilling の読み直しの影響を受けないので、観測より前に読む。
    // 修正のセッションの観測（2 段目の印の handle）にも、merge タスクの判定にも使う。
    const targets = reviewPullRequestsToRead(observed);
    const reviewPullRequests = targets.map((pr) => ({ ...pr, comments: github.readComments(pr.number) }));
    const merges = targets.length > 0 ? await mergeTasks() : [];
    const sessions = {};
    const toObserve = [...sessionsToObserve(observed), ...sequencesToObserve(observed), ...ticketSessionsToObserve(observed), ...mapSessionsToObserve(observed), ...reviewFixSessionsToObserve({ ...observed, reviewPullRequests })];
    for (const { handle, startedAt } of toObserve) {
      sessions[handle] = { ...(await observeSession({ handle })), startedAt };
    }
    // 結果が出て閉じる候補のタブ（停止の観測とは重ならない）。startedAt は使わない
    for (const { handle } of tabsToClose(observed)) {
      if (!(handle in sessions)) sessions[handle] = await observeSession({ handle });
    }
    // 入力待ちの観測より前に書かれた「判断の問い」を拾うため、観測の後で対象の ticket のコメントだけを読み直す。
    const refreshed = new Map();
    for (const ticket of grillingQuestionsToRefresh({ ...observed, sessions })) refreshed.set(ticket, github.readComments(ticket));
    const base = { ...observed, issues: observed.issues.map((i) => (refreshed.has(i.number) ? { ...i, comments: refreshed.get(i.number) } : i)) };
    // 判断依頼を送り済みで書き戻し前の grilling だけ、本人の返信を読む（メッセージの ID をキーに入れる）。
    const decisionReplies = {};
    for (const { threadId, messageId } of grillingRepliesToRead(base)) {
      decisionReplies[messageId] = await discord.readReplies({ threadId, messageId });
    }
    // 閉じた ticket の、流した印があり書き戻し前の仮決めだけ、本人の差し戻し（❌）を読む（メッセージの ID をキーに入れる）。
    const provisionalReactions = {};
    for (const { threadId, messageId } of provisionalRejectionsToRead(base)) {
      provisionalReactions[messageId] = await discord.readReactions({ threadId, messageId });
    }
    return { ...base, reviewPullRequests, mergeTasks: merges, now: now().toISOString(), stallMinutes, sessions, decisionReplies, provisionalReactions };
  };
}
