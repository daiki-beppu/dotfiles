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
        { number: 1, state: "open", merged_at: null, user: { login: "v" }, body: "b", auto_merge: { merge_method: "squash" } },
        { number: 2, state: "open", merged_at: null, user: { login: "v" }, body: null, auto_merge: null },
        { number: 3, state: "closed", merged_at: "2026-01-01T00:00:00Z", user: { login: "v" }, body: "", auto_merge: null },
      ],
    ]),
  );
  const prs = createGithub({ repo: "o/r", cwd: "/x", execFile }).readPullRequests();
  assert.deepEqual(prs, [
    { number: 1, state: "OPEN", author: "v", body: "b", autoMerge: true },
    { number: 2, state: "OPEN", author: "v", body: "", autoMerge: false },
    { number: 3, state: "MERGED", author: "v", body: "", autoMerge: false },
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
  "repos/o/r/issues/21/comments": [{ user: { login: "me" }, body: "案内役: wayfinder を起動する" }],
  "repos/o/r/issues/22/comments": [],
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

test("readIssues: 子 ticket のコメント（起動の印）を author と body で読む", () => {
  const { by } = readWf();
  assert.deepEqual(by(21).comments, [{ author: "me", body: "案内役: wayfinder を起動する" }]);
});

test("readIssues: map と子の labels と state を保つ", () => {
  const { by } = readWf();
  assert.deepEqual(by(20).labels, ["wayfinder:map"]);
  assert.equal(by(20).state, "OPEN");
  assert.deepEqual(by(20).subIssues, [{ number: 21, state: "OPEN" }, { number: 22, state: "OPEN" }, { number: 23, state: "CLOSED" }]);
  assert.equal(by(23).state, "CLOSED");
});

test("readIssues: map の子でない issue と、closed な子の comments・blocked_by は読まない", () => {
  const { paths } = readWf();
  for (const n of [23, 30]) {
    assert.ok(!paths.some((p) => p.startsWith(`repos/o/r/issues/${n}/`)), `#${n} を読んだ: ${paths.join(", ")}`);
  }
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
});

test("readIssues: spec で既にコメントを読んだ子は、コメントを読み直さない", () => {
  const routes = wfRoutes();
  routes["repos/o/r/issues?state=all"][2] = ghIssue(22, { labels: [{ name: "wayfinder:research" }, { name: "spec" }] });
  const { paths, execFile } = routed(routes);
  createGithub({ repo: "o/r", cwd: "/x", execFile }).readIssues();
  assert.equal(paths.filter((p) => p.startsWith("repos/o/r/issues/22/comments")).length, 1);
});
