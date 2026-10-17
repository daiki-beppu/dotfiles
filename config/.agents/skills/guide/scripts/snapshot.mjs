// スナップショットの組み立て。GitHub の issue に、承認依頼を送り済みの OPEN な仕様（承認済みを含む）の Discord リアクションを足す。
// 起動した工程のセッションと takt-sequence のタブ、wayfinder で起動した ticket のセッションは Orca で観測して sessions に入れる（結果が GitHub に出たものは観測しない）。現在時刻 now と stallMinutes も渡す。
// 読み取りだけで、書き込みはしない。リアクションの取得失敗は例外にして、呼び出し側の再試行に任せる。
import { awaitsReaction, grillingQuestionsToRefresh, grillingRepliesToRead, sentApprovalRequest, sequencesToObserve, sessionsToObserve, ticketSessionsToObserve } from "./decide.mjs";

export function createReadSnapshot({ repo, viewer, discordUserId, fromSpec, github, discord, taktTasks, now = () => new Date(), stallMinutes, observeSession }) {
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
    const sessions = {};
    for (const { handle, startedAt } of [...sessionsToObserve(observed), ...sequencesToObserve(observed), ...ticketSessionsToObserve(observed)]) {
      sessions[handle] = { ...(await observeSession({ handle })), startedAt };
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
    return { ...base, now: now().toISOString(), stallMinutes, sessions, decisionReplies };
  };
}
