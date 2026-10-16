// スナップショットの組み立て。GitHub の issue に、承認依頼を送り済みの OPEN な仕様（承認済みを含む）の Discord リアクションを足す。
// 読み取りだけで、書き込みはしない。リアクションの取得失敗は例外にして、呼び出し側の再試行に任せる。
import { awaitsReaction, sentApprovalRequest } from "./decide.mjs";

export function createReadSnapshot({ repo, viewer, discordUserId, github, discord, taktIssueNumbers }) {
  return async () => {
    const issues = await Promise.all(
      github.readIssues().map(async (issue) => {
        if (!awaitsReaction(issue, viewer)) return issue;
        const reactions = await discord.readReactions(sentApprovalRequest(issue, viewer));
        return { ...issue, reactions };
      }),
    );
    return { repo, viewer, discordUserId, issues, taktIssues: taktIssueNumbers(), pullRequests: github.readPullRequests() };
  };
}
