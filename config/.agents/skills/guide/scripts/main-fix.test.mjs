// main-fix.mjs のテスト。orca と git fetch は偽物を注入し、呼ばれた argv と cwd で、起動する場所と渡すプロンプトを確かめる。
// orca worktree create --json の応答の形は { ok, result: { worktree: { path } } }（review-fix.test.mjs と同じ）。
import assert from "node:assert/strict";
import { test } from "node:test";
import { mainFixFailedMarker } from "./decide.mjs";
import { launchMainFix } from "./main-fix.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const INPUT = {
  cwd: "/repo", repo: "o/r", sha: SHA, checks: ["Nix flake evaluation"], runs: [777], lastGreen: "a".repeat(40),
  pullRequests: [{ number: 50, title: "feat: x", closes: [41] }, { number: 49, title: "fix: y", closes: [] }],
};

const launchReply = (handle = "term_m") => JSON.stringify({ result: { outcome: { kind: "terminal", handle } } });
const worktreeReply = (path) => JSON.stringify({ ok: true, result: { worktree: { id: "wt_9", path } } });

const fakes = ({ worktree = worktreeReply("/wt/main-fix") } = {}) => {
  const calls = [];
  const run = (args, opts) => {
    calls.push({ tool: "orca", args, cwd: opts.cwd });
    const reply = args[0] === "worktree" ? worktree : args[0] === "agent" ? launchReply() : "{}";
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const fetch = (cwd) => calls.push({ tool: "git", args: ["fetch", "origin"], cwd });
  return { calls, run, fetch };
};
const arg = (args, flag) => args[args.indexOf(flag) + 1];
const orca = (calls, name) => calls.filter((c) => c.tool === "orca" && c.args[0] === name);

test("origin/main から worktree を作ってそこで起動する: fetch → worktree create → agent launch → タブの改名の順。handle を返す", () => {
  const { calls, run, fetch } = fakes();
  assert.deepEqual(launchMainFix(INPUT, run, fetch), { handle: "term_m" });
  assert.deepEqual(calls.map((c) => `${c.tool} ${c.args[0]}`), ["git fetch", "orca worktree", "orca agent", "orca terminal"]);
  assert.equal(calls[0].cwd, "/repo");
});

test("worktree create: 対象 repo を --repo、origin/main を --base-branch、名前 main-fix-<C の先頭 7 桁> で、--json を付けて作る", () => {
  const { calls, run, fetch } = fakes();
  launchMainFix(INPUT, run, fetch);
  const [create] = orca(calls, "worktree");
  assert.deepEqual(create.args, ["worktree", "create", "--repo", "path:/repo", "--name", "main-fix-0123456", "--base-branch", "origin/main", "--json"]);
  assert.equal(create.cwd, "/repo");
});

test("agent launch: 作った worktree で claude を起動し、タブの題名を main-fix <C の先頭 7 桁> にする", () => {
  const { calls, run, fetch } = fakes();
  launchMainFix(INPUT, run, fetch);
  const [launch] = orca(calls, "agent");
  assert.deepEqual(launch.args.slice(0, 6), ["agent", "launch", "--agent", "claude", "--worktree", "path:/wt/main-fix"]);
  assert.equal(launch.cwd, "/wt/main-fix");
  const [rename] = orca(calls, "terminal");
  assert.equal(arg(rename.args, "--terminal"), "term_m");
  assert.equal(arg(rename.args, "--title"), "main-fix 0123456");
});

test("プロンプト: C・落ちたチェック・失敗した run・最後に緑だった commit・範囲の PR と閉じた issue・直せなかった印と、references/main-fix.md を渡す", () => {
  const { calls, run, fetch } = fakes();
  launchMainFix(INPUT, run, fetch);
  const prompt = arg(orca(calls, "agent")[0].args, "--prompt");
  for (const s of [
    SHA, "Nix flake evaluation", "https://github.com/o/r/actions/runs/777", "a".repeat(40),
    "#50 feat: x（https://github.com/o/r/pull/50） 閉じた issue: #41", "#49 fix: y（https://github.com/o/r/pull/49）",
    `${mainFixFailedMarker(SHA)}: <理由>`,
    "確認を省いて結果まで進める", "gh pr merge <PR> --squash --auto", "revert の PR は出さない",
  ]) assert.ok(prompt.includes(s), s);
});

test("worktree create の応答から path が取れなければ、起動せずに例外にする", () => {
  const { calls, run, fetch } = fakes({ worktree: JSON.stringify({ ok: true, result: {} }) });
  assert.throws(() => launchMainFix(INPUT, run, fetch), /result\.worktree\.path/);
  assert.deepEqual(orca(calls, "agent"), []);
});
