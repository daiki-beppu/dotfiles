import assert from "node:assert/strict";
import { test } from "node:test";
import { createGithub } from "./github.mjs";

const fakeGh = (respond) => {
  const calls = [];
  const execFile = (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts.cwd });
    return respond(args);
  };
  return { calls, execFile };
};

test("mergeAuto: gh pr merge <N> --repo <repo> --auto --squash を渡す", () => {
  const { calls, execFile } = fakeGh(() => "");
  createGithub({ repo: "o/r", cwd: "/x", execFile }).mergeAuto(50);
  assert.deepEqual(calls, [{ cmd: "gh", args: ["pr", "merge", "50", "--repo", "o/r", "--auto", "--squash"], cwd: "/x" }]);
});

test("readPullRequests: REST の auto_merge が null かどうかを autoMerge に写す", () => {
  const { calls, execFile } = fakeGh(() =>
    JSON.stringify([
      [
        { number: 1, state: "open", merged_at: null, user: { login: "v" }, body: "b", auto_merge: { merge_method: "squash" }, head: { sha: "s1", ref: "r1" } },
        { number: 2, state: "open", merged_at: null, user: { login: "v" }, body: null, auto_merge: null, head: { sha: "s2", ref: "r2" } },
        { number: 3, state: "closed", merged_at: "2026-01-01T00:00:00Z", user: { login: "v" }, body: "", auto_merge: null, head: { sha: "s3", ref: "r3" } },
      ],
    ]),
  );
  const prs = createGithub({ repo: "o/r", cwd: "/x", execFile }).readPullRequests();
  assert.deepEqual(prs, [
    { number: 1, state: "OPEN", author: "v", body: "b", autoMerge: true, head: "s1", headBranch: "r1" },
    { number: 2, state: "OPEN", author: "v", body: "", autoMerge: false, head: "s2", headBranch: "r2" },
    { number: 3, state: "MERGED", author: "v", body: "", autoMerge: false, head: "s3", headBranch: "r3" },
  ]);
  assert.equal(calls[0].args[1], "repos/o/r/pulls?state=all&per_page=100");
});

test("addLabel: REST の labels に POST する（無いラベルは GitHub が作る）", () => {
  const { calls, execFile } = fakeGh(() => "[]");
  createGithub({ repo: "o/r", cwd: "/x", execFile }).addLabel(12, "spec-approved");
  assert.deepEqual(calls, [{ cmd: "gh", args: ["api", "repos/o/r/issues/12/labels", "-f", "labels[]=spec-approved"], cwd: "/x" }]);
});

test("失敗: gh の stderr の 1 行目を、例外のメッセージの 1 行目に足す", () => {
  const execFile = () => {
    const e = new Error("Command failed: gh api repos/o/r/issues/12/comments\nlong output");
    e.stderr = "HTTP 404: Not Found (https://api.github.com/repos/o/r/issues/12/comments)\nmore";
    throw e;
  };
  assert.throws(
    () => createGithub({ repo: "o/r", cwd: "/x", execFile }).comment(12, "x"),
    (e) => e.message.split("\n")[0] === "Command failed: gh api repos/o/r/issues/12/comments: HTTP 404: Not Found (https://api.github.com/repos/o/r/issues/12/comments)",
  );
});

test("失敗: stderr が空なら、メッセージを変えずに投げ直す", () => {
  const execFile = () => {
    throw new Error("spawn gh ENOENT");
  };
  assert.throws(() => createGithub({ repo: "o/r", cwd: "/x", execFile }).viewer(), { message: "spawn gh ENOENT" });
});

// ---- readIssues: wayfinder の map と子 ticket ----
// 偽の gh: `gh api <path> --paginate --slurp` のパスごとに応答（ページの配列を 1 ページ分）を返し、呼ばれたパスを記録する。
const ghIssue = (number, over = {}) => ({
  number,
  title: `issue ${number}`,
  state: "open",
  labels: [],
  body: "",
  assignees: [],
  sub_issues_summary: { total: 0 },
  ...over,
});
const routed = (routes) => {
  const paths = [];
  const execFile = (cmd, args) => {
    const path = args[1];
    paths.push(path);
    const hit = Object.entries(routes).find(([prefix]) => path.startsWith(prefix));
    if (!hit) throw new Error(`想定外のパス: ${path}`);
    return JSON.stringify([hit[1]]);
  };
  return { paths, execFile };
};
const wfRoutes = (over = {}) => ({
  "repos/o/r/issues?state=all": [
    ghIssue(20, { labels: [{ name: "wayfinder:map" }], sub_issues_summary: { total: 3 } }),
    ghIssue(21, { labels: [{ name: "wayfinder:task" }], assignees: [{ login: "me" }] }),
    ghIssue(22, { labels: [{ name: "wayfinder:research" }] }),
    ghIssue(23, { state: "closed", labels: [{ name: "wayfinder:grilling" }] }),
    ghIssue(30, { labels: [{ name: "bug" }] }),
  ],
  "repos/o/r/issues/20/sub_issues": [
    { number: 21, state: "open" },
    { number: 22, state: "open" },
    { number: 23, state: "closed" },
  ],
  "repos/o/r/issues/20/comments": [],
  "repos/o/r/issues/21/comments": [{ user: { login: "me" }, body: "案内役: wayfinder を起動する", created_at: "2026-10-17T00:00:00Z" }],
  "repos/o/r/issues/22/comments": [],
  "repos/o/r/issues/23/comments": [{ user: { login: "me" }, body: "## 仮決め\n\n### Q\n- 答え: A\n- 振り分け: ⓪\n- 理由: R\n- 根拠: なし" }],
  "repos/o/r/issues/21/dependencies/blocked_by": [{ number: 9, state: "open" }],
  "repos/o/r/issues/22/dependencies/blocked_by": [{ number: 9, state: "closed" }],
  ...over,
});
const readWf = (over) => {
  const { paths, execFile } = routed(wfRoutes(over));
  const issues = createGithub({ repo: "o/r", cwd: "/x", execFile }).readIssues();
  return { paths, issues, by: (n) => issues.find((i) => i.number === n) };
};

test("readIssues: 子 ticket の assignee のログイン名を assignees に入れる", () => {
  const { by } = readWf();
  assert.deepEqual(by(21).assignees, ["me"]);
  assert.deepEqual(by(22).assignees, []);
});

test("readIssues: open な map の open な子の blocked by を { number, state(大文字) } で入れる", () => {
  const { by } = readWf();
  assert.deepEqual(by(21).blockedBy, [{ number: 9, state: "OPEN" }]);
  assert.deepEqual(by(22).blockedBy, [{ number: 9, state: "CLOSED" }]);
});

test("readIssues: 子 ticket のコメント（起動の印）を author・body・createdAt で読む", () => {
  const { by } = readWf();
  assert.deepEqual(by(21).comments, [{ author: "me", body: "案内役: wayfinder を起動する", createdAt: "2026-10-17T00:00:00Z" }]);
});

test("readIssues: map と子の labels と state を保つ", () => {
  const { by } = readWf();
  assert.deepEqual(by(20).labels, ["wayfinder:map"]);
  assert.equal(by(20).state, "OPEN");
  assert.deepEqual(by(20).subIssues, [{ number: 21, state: "OPEN" }, { number: 22, state: "OPEN" }, { number: 23, state: "CLOSED" }]);
  assert.equal(by(23).state, "CLOSED");
});

test("readIssues: map の子でない issue は読まない。closed な子の blocked_by は読まない", () => {
  const { paths } = readWf();
  assert.ok(!paths.some((p) => p.startsWith("repos/o/r/issues/30/")), `#30 を読んだ: ${paths.join(", ")}`);
  assert.ok(!paths.some((p) => p.startsWith("repos/o/r/issues/23/dependencies")), `#23 の blocked_by を読んだ: ${paths.join(", ")}`);
});

test("readIssues: open な map の closed な子の comments（resolution コメント）を {author, body} で読む", () => {
  const { by } = readWf();
  assert.equal(by(23).comments.length, 1);
  assert.equal(by(23).comments[0].author, "me");
  assert.ok(by(23).comments[0].body.startsWith("## 仮決め"));
  assert.deepEqual(by(23).blockedBy, []);
});

test("readIssues: map の子でない issue の assignees は空、blockedBy は空配列", () => {
  const { by } = readWf();
  assert.deepEqual(by(30).assignees, []);
  assert.deepEqual(by(30).blockedBy, []);
});

test("readIssues: closed な map の子は読まない", () => {
  const routes = wfRoutes();
  routes["repos/o/r/issues?state=all"][0] = ghIssue(20, { state: "closed", labels: [{ name: "wayfinder:map" }], sub_issues_summary: { total: 3 } });
  const { paths, execFile } = routed(routes);
  createGithub({ repo: "o/r", cwd: "/x", execFile }).readIssues();
  assert.ok(!paths.some((p) => p.includes("/dependencies/blocked_by")), paths.join(", "));
  assert.ok(!paths.some((p) => p.startsWith("repos/o/r/issues/23/")), paths.join(", "));
});

test("readIssues: spec で既にコメントを読んだ子は、コメントを読み直さない", () => {
  const routes = wfRoutes();
  routes["repos/o/r/issues?state=all"][2] = ghIssue(22, { labels: [{ name: "wayfinder:research" }, { name: "spec" }] });
  const { paths, execFile } = routed(routes);
  createGithub({ repo: "o/r", cwd: "/x", execFile }).readIssues();
  assert.equal(paths.filter((p) => p.startsWith("repos/o/r/issues/22/comments")).length, 1);
});

test("readComments: issue のコメントを {author, body, createdAt} の形で読む（createdAt は GitHub の created_at。やり直しの印より前の merge タスクを数えないために使う）", () => {
  const { paths, execFile } = routed({ "repos/o/r/issues/21/comments": { user: { login: "me" }, body: "本文", created_at: "2026-10-17T00:20:00Z" } });
  const comments = createGithub({ repo: "o/r", cwd: "/x", execFile }).readComments(21);
  assert.deepEqual(paths, ["repos/o/r/issues/21/comments?per_page=100"]);
  assert.deepEqual(comments, [{ author: "me", body: "本文", createdAt: "2026-10-17T00:20:00Z" }]);
});

test("reopen: REST の issue を PATCH して state=open にする", () => {
  const { calls, execFile } = fakeGh(() => "{}");
  createGithub({ repo: "o/r", cwd: "/x", execFile }).reopen(21);
  assert.deepEqual(calls, [{ cmd: "gh", args: ["api", "-X", "PATCH", "repos/o/r/issues/21", "-f", "state=open"], cwd: "/x" }]);
});

test("removeAssignees: REST の assignees を DELETE で外す（指定したログインを assignees[] に渡す）", () => {
  const { calls, execFile } = fakeGh(() => "{}");
  createGithub({ repo: "o/r", cwd: "/x", execFile }).removeAssignees(21, ["a", "b"]);
  assert.deepEqual(calls, [{ cmd: "gh", args: ["api", "-X", "DELETE", "repos/o/r/issues/21/assignees", "-f", "assignees[]=a", "-f", "assignees[]=b"], cwd: "/x" }]);
});

test("removeAssignees: 外す assignee が無ければ gh を呼ばない", () => {
  const { calls, execFile } = fakeGh(() => "{}");
  createGithub({ repo: "o/r", cwd: "/x", execFile }).removeAssignees(21, []);
  assert.deepEqual(calls, []);
});

test("readPullRequests: head の sha と head ブランチを head・headBranch に写す（読み取りの回数は増やさない）", () => {
  const { calls, execFile } = fakeGh(() =>
    JSON.stringify([[{ number: 1, state: "open", merged_at: null, user: { login: "v" }, body: "", auto_merge: null, head: { sha: "a".repeat(40), ref: "feat/1" } }]]),
  );
  const [pr] = createGithub({ repo: "o/r", cwd: "/x", execFile }).readPullRequests();
  assert.equal(pr.head, "a".repeat(40));
  assert.equal(pr.headBranch, "feat/1");
  assert.equal(calls.length, 1);
});

test("createSubIssue: issue を起こしてから、応答の id で parent の sub-issue に紐付け、番号を返す", () => {
  const { calls, execFile } = fakeGh((args) => (args[1] === "repos/o/r/issues" ? JSON.stringify({ id: 777, number: 31 }) : "{}"));
  const number = createGithub({ repo: "o/r", cwd: "/x", execFile }).createSubIssue(20, { title: "題", body: "本文", labels: ["wayfinder:grilling"] });
  assert.equal(number, 31);
  assert.deepEqual(calls.map((c) => c.args), [
    ["api", "repos/o/r/issues", "-f", "title=題", "-f", "body=本文", "-f", "labels[]=wayfinder:grilling"],
    ["api", "repos/o/r/issues/20/sub_issues", "-F", "sub_issue_id=777"],
  ]);
});
