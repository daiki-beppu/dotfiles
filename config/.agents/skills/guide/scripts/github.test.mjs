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
