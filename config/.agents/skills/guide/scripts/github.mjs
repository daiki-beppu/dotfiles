// GitHub アダプタ。issue・コメント・sub-issue を読んで判定用のスナップショットの形にそろえ、マーカーのコメントとラベルを書く。
// 参照の解析やマーカーの判定は decide.mjs の責務で、ここでは取得対象を絞るだけにする。
import { execFileSync } from "node:child_process";

export function createGithub({ repo, cwd, execFile = execFileSync }) {
  // 失敗したら gh の stderr の 1 行目をメッセージの 1 行目に足す（案内役は止まるとき 1 行目だけを出すので、原因が見えるように）。
  const gh = (args) => {
    try {
      return execFile("gh", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
    } catch (e) {
      const detail = String(e.stderr ?? "").trim().split("\n")[0];
      if (detail) e.message = `${String(e.message).split("\n")[0]}: ${detail}`;
      throw e;
    }
  };
  const paged = (path) => JSON.parse(gh(["api", path, "--paginate", "--slurp"])).flat();
  const commentsAt = (path) => paged(path).map((c) => ({ author: c.user?.login, body: c.body ?? "", createdAt: c.created_at }));
  const readComments = (number) => commentsAt(`repos/${repo}/issues/${number}/comments?per_page=100`);
  // commit の check-runs。run の番号は details_url から取る（再実行に使う）。
  const readChecks = (sha) =>
    paged(`repos/${repo}/commits/${sha}/check-runs?per_page=100`)
      .flatMap((p) => p.check_runs)
      .map((c) => {
        const run = /\/actions\/runs\/(\d+)/.exec(c.details_url ?? "");
        return { id: c.id, name: c.name, status: c.status, conclusion: c.conclusion, runId: run ? Number(run[1]) : null };
      });

  return {
    readComments,
    readChecks,
    viewer: () => JSON.parse(gh(["api", "user"])).login,
    repoName: () => JSON.parse(gh(["repo", "view", "--json", "nameWithOwner"])).nameWithOwner,

    // PR を除いた全 issue。コメントは spec ラベル付きと sub-issue を持つ issue だけ、sub-issue は持つ issue だけ読む。
    // 加えて、open な wayfinder:map の子 ticket は、状態によらずコメント（起動の印・resolution）を読み、open な子だけ blocked by も読む（それ以外の issue の読み取りは増やさない）。
    readIssues() {
      const issues = paged(`repos/${repo}/issues?state=all&per_page=100`)
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
            assignees: (i.assignees ?? []).map((a) => a.login),
            blockedBy: [],
            comments: wantsComments ? readComments(i.number) : [],
            subIssues: hasSubs
              ? paged(`repos/${repo}/issues/${i.number}/sub_issues?per_page=100`).map((s) => ({ number: s.number, state: s.state.toUpperCase() }))
              : [],
            commentsRead: wantsComments,
          };
        });
      const byNumber = new Map(issues.map((i) => [i.number, i]));
      const mapChildren = new Set(
        issues
          .filter((i) => i.state === "OPEN" && i.labels.includes("wayfinder:map"))
          .flatMap((m) => m.subIssues.map((s) => s.number)),
      );
      for (const n of mapChildren) {
        const child = byNumber.get(n);
        if (child === undefined) continue;
        if (!child.commentsRead) child.comments = readComments(n);
        if (child.state !== "OPEN") continue;
        child.blockedBy = paged(`repos/${repo}/issues/${n}/dependencies/blocked_by?per_page=100`).map((b) => ({ number: b.number, state: b.state.toUpperCase() }));
      }
      return issues.map(({ commentsRead, ...issue }) => issue);
    },

    // 全状態の PR。学びの PR の照合（decide.mjs の knowledgePrOf）に使う。
    readPullRequests() {
      return paged(`repos/${repo}/pulls?state=all&per_page=100`).map((p) => ({
        number: p.number,
        state: p.merged_at ? "MERGED" : p.state.toUpperCase(),
        author: p.user?.login,
        body: p.body ?? "",
        autoMerge: p.auto_merge != null,
        head: p.head?.sha,
        headBranch: p.head?.ref,
      }));
    },

    // main の最新の commit と、その判定の材料（ruleset・check-runs・commit comment）。判定は takt の main-state.mjs が行う。
    readMain() {
      const sha = JSON.parse(gh(["api", `repos/${repo}/commits/main`])).sha;
      const checks = readChecks(sha);
      return {
        sha,
        rules: paged(`repos/${repo}/rules/branches/main`),
        checks,
        comments: commentsAt(`repos/${repo}/commits/${sha}/comments?per_page=100`),
      };
    },

    commitComment(sha, body) {
      gh(["api", `repos/${repo}/commits/${sha}/comments`, "-f", `body=${body}`]);
    },

    rerunFailed(runId) {
      gh(["run", "rerun", String(runId), "--failed", "--repo", repo]);
    },

    mergeAuto(number) {
      gh(["pr", "merge", String(number), "--repo", repo, "--auto", "--squash"]);
    },

    comment(number, body) {
      gh(["api", `repos/${repo}/issues/${number}/comments`, "-f", `body=${body}`]);
    },

    reopen(number) {
      gh(["api", "-X", "PATCH", `repos/${repo}/issues/${number}`, "-f", "state=open"]);
    },

    // claim（assignee）を外す。外す人がいなければ呼ばない。
    removeAssignees(number, logins) {
      if (logins.length === 0) return;
      gh(["api", "-X", "DELETE", `repos/${repo}/issues/${number}/assignees`, ...logins.flatMap((l) => ["-f", `assignees[]=${l}`])]);
    },

    // issue を起こして parent の sub-issue にする。紐付けには番号ではなく issue の id を渡す。
    createSubIssue(parent, { title, body, labels }) {
      const created = JSON.parse(gh(["api", `repos/${repo}/issues`, "-f", `title=${title}`, "-f", `body=${body}`, ...labels.flatMap((l) => ["-f", `labels[]=${l}`])]));
      gh(["api", `repos/${repo}/issues/${parent}/sub_issues`, "-F", `sub_issue_id=${created.id}`]);
      return created.number;
    },

    // REST で付ける。repo にまだ無いラベルは GitHub が作るので、spec-approved を前もって用意しなくてよい（gh issue edit は無いラベルで失敗する）。
    addLabel(number, label) {
      gh(["api", `repos/${repo}/issues/${number}/labels`, "-f", `labels[]=${label}`]);
    },
  };
}
