// スナップショットの組み立て。GitHub の issue に、承認依頼を送り済みの OPEN な仕様（承認済みを含む）の Discord リアクションを足す。
// 起動した工程のセッションは Orca で観測して sessions に入れる（結果が GitHub に出た工程は観測しない）。現在時刻 now と stallMinutes も渡す。
// 読み取りだけで、書き込みはしない。リアクションの取得失敗は例外にして、呼び出し側の再試行に任せる。
import { awaitsReaction, sentApprovalRequest, sessionsToObserve } from "./decide.mjs";

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
    const base = { repo, viewer, discordUserId, fromSpec, issues, taktIssues: tasks.map((t) => t.issue), taktTasks: tasks, pullRequests: github.readPullRequests() };
    const sessions = {};
    for (const { handle, startedAt } of sessionsToObserve(base)) {
      sessions[handle] = { ...(await observeSession({ handle })), startedAt };
    }
    return { ...base, now: now().toISOString(), stallMinutes, sessions };
  };
}
