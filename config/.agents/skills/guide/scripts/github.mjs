// GitHub アダプタ。issue・コメント・sub-issue を読んで判定用のスナップショットの形にそろえ、マーカーのコメントとラベルを書く。
// 参照の解析やマーカーの判定は decide.mjs の責務で、ここでは取得対象を絞るだけにする。
import { execFileSync } from "node:child_process";

export function createGithub({ repo, cwd, execFile = execFileSync }) {
  const gh = (args) =>
    execFile("gh", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
  const paged = (path) => JSON.parse(gh(["api", path, "--paginate", "--slurp"])).flat();

  return {
    viewer: () => JSON.parse(gh(["api", "user"])).login,
    repoName: () => JSON.parse(gh(["repo", "view", "--json", "nameWithOwner"])).nameWithOwner,

    // PR を除いた全 issue。コメントは spec ラベル付きと sub-issue を持つ issue だけ、sub-issue は持つ issue だけ読む。
    readIssues() {
      return paged(`repos/${repo}/issues?state=all&per_page=100`)
        .filter((i) => !i.pull_request)
        .map((i) => {
          const labels = i.labels.map((l) => (typeof l === "string" ? l : l.name));
          const hasSubs = (i.sub_issues_summary?.total ?? 0) > 0;
          const wantsComments = labels.includes("spec") || hasSubs;
          return {
            number: i.number,
            title: i.title,
            state: i.state.toUpperCase(),
            labels,
            body: i.body ?? "",
            comments: wantsComments
              ? paged(`repos/${repo}/issues/${i.number}/comments?per_page=100`).map((c) => ({ author: c.user?.login, body: c.body ?? "" }))
              : [],
            subIssues: hasSubs
              ? paged(`repos/${repo}/issues/${i.number}/sub_issues?per_page=100`).map((s) => ({ number: s.number, state: s.state.toUpperCase() }))
              : [],
          };
        });
    },

    // 全状態の PR。学びの PR の照合（decide.mjs の knowledgePrOf）に使う。
    readPullRequests() {
      return paged(`repos/${repo}/pulls?state=all&per_page=100`).map((p) => ({
        number: p.number,
        state: p.merged_at ? "MERGED" : p.state.toUpperCase(),
        author: p.user?.login,
        body: p.body ?? "",
        autoMerge: p.auto_merge != null,
      }));
    },

    mergeAuto(number) {
      gh(["pr", "merge", String(number), "--repo", repo, "--auto", "--squash"]);
    },

    comment(number, body) {
      gh(["api", `repos/${repo}/issues/${number}/comments`, "-f", `body=${body}`]);
    },

    addLabel(number, label) {
      gh(["issue", "edit", String(number), "--repo", repo, "--add-label", label]);
    },
  };
}
