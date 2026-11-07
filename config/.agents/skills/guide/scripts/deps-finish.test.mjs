// deps-finish.mjs のテスト。orca と git は偽物を注入し、呼ばれた argv と cwd で、起動する場所と渡すプロンプトを確かめる。
// head ブランチの worktree の作り方（持ち主がいるときの detach など）は review-fix.test.mjs が launchOnHeadBranch を通して確かめている。
import assert from "node:assert/strict";
import { test } from "node:test";
import { tabTitle } from "./decide.mjs";
import { DEPS_INDEX, depsFinishGaveUpMarker } from "./deps-finish-stage.mjs";
import { launchDepsFinish } from "./deps-finish.mjs";

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const INPUT = { cwd: "/repo", repo: "o/r", pr: 1953, title: "chore(deps): update vite", head: HEAD, branch: "renovate/vite", group: "vite" };

const fakes = ({ launch = JSON.stringify({ result: { outcome: { kind: "terminal", handle: "term_d" } } }) } = {}) => {
  const calls = [];
  const run = (args, opts) => {
    calls.push({ tool: "orca", args, cwd: opts.cwd });
    if (args[0] === "worktree") return JSON.stringify({ ok: true, result: { worktree: { id: "wt_1", path: "/wt/deps" } } });
    return args[0] === "agent" ? launch : "{}";
  };
  const git = (args, opts) => {
    calls.push({ tool: "git", args, cwd: opts?.cwd });
    return args[0] === "worktree" ? `worktree /repo\nHEAD ${"0".repeat(40)}\nbranch refs/heads/main\n` : "";
  };
  return { calls, run, git };
};
const arg = (args, flag) => args[args.indexOf(flag) + 1];
const orca = (calls, name) => calls.filter((c) => c.tool === "orca" && c.args[0] === name);
const launched = (input = INPUT) => {
  const { calls, run, git } = fakes();
  const result = launchDepsFinish(input, run, git);
  return { calls, result, prompt: arg(orca(calls, "agent")[0].args, "--prompt") };
};

test("PR の head ブランチの worktree を作ってそこで起動する: fetch → worktree 一覧 → worktree create → ブランチへ切り替え → agent launch → タブの改名の順。handle を返す", () => {
  const { calls, result } = launched();
  assert.deepEqual(result, { handle: "term_d" });
  assert.deepEqual(calls.map((c) => `${c.tool} ${c.args[0]}`), ["git fetch", "git worktree", "orca worktree", "git switch", "orca agent", "orca terminal"]);
});

test("worktree create: origin/<head ブランチ> を base にし、名前は deps-finish-<PR>-<head の先頭 7 桁>。起動は作った worktree で claude の対話セッションとして行う", () => {
  const { calls } = launched();
  const [create] = orca(calls, "worktree");
  assert.equal(arg(create.args, "--repo"), "path:/repo");
  assert.equal(arg(create.args, "--base-branch"), "origin/renovate/vite");
  assert.equal(arg(create.args, "--name"), "deps-finish-1953-0123456");
  const [launch] = orca(calls, "agent");
  assert.equal(arg(launch.args, "--agent"), "claude");
  assert.equal(arg(launch.args, "--worktree"), "path:/wt/deps");
  assert.equal(launch.cwd, "/wt/deps");
});

test("タブの題名は deps-finish と PR の番号", () => {
  const { calls } = launched();
  assert.equal(arg(orca(calls, "terminal")[0].args, "--title"), tabTitle("deps-finish", 1953));
});

test("プロンプトの 1 行目は /poteto-mode", () => {
  assert.equal(launched().prompt.split("\n")[0], "/poteto-mode");
});

test("プロンプトに PR・題・グループ・head・head ブランチと push のコマンド・索引の場所・直せなかった印を渡す", () => {
  const { prompt } = launched();
  for (const needle of ["#1953", "https://github.com/o/r/pull/1953", "chore(deps): update vite", "グループ: vite", HEAD, "git push origin HEAD:renovate/vite", DEPS_INDEX, depsFinishGaveUpMarker(1953)]) {
    assert.ok(prompt.includes(needle), `プロンプトに ${needle} が無い`);
  }
});

test("グループが未定（renovate/ のブランチでない）なら、索引から依存名で引くようにプロンプトに書く", () => {
  const { prompt } = launched({ ...INPUT, branch: "feat/x", group: null });
  assert.match(prompt, /グループ: 未定。索引の行の引き方で依存名から引く/);
});

test("プロンプトに 1〜8 の番号つきの手順が順に並び、/how・pin・architect・pstack:poteto-agent への委任・Checks・`## 依存の仕上げ` のコメントを含む", () => {
  const { prompt } = launched();
  const steps = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => prompt.indexOf(`\n${n}. `));
  assert.ok(steps.every((i) => i >= 0), `番号つきの手順が足りない: ${steps}`);
  assert.deepEqual([...steps].sort((a, b) => a - b), steps);
  const step = (n) => prompt.slice(steps[n - 1], n < 8 ? steps[n] : undefined);
  assert.match(step(1), /--disable-auto/);
  assert.match(step(2), /\/how/);
  assert.match(step(3), /pin/);
  assert.match(step(4), /architect/);
  assert.match(step(5), /pstack:poteto-agent/);
  assert.match(step(6), /Checks/);
  assert.match(step(6), /Evals/);
  assert.match(step(7), /## 依存の仕上げ/);
  assert.match(step(8), /--squash --auto/);
});

test("自動マージの予約を外すのは、予約し直すより前", () => {
  const { prompt } = launched();
  assert.ok(prompt.indexOf("--disable-auto") < prompt.indexOf("--squash --auto"));
});

test("プロンプトに、人の手が要る段は AskUserQuestion を 1 件に絞ること・直せないときは印と理由を書いて予約せずに止まること・起動の印と issue・ラベルを変えないことが書かれている", () => {
  const { prompt } = launched();
  assert.match(prompt, /AskUserQuestion/);
  assert.match(prompt, /: <理由>/);
  assert.match(prompt, /予約しない/);
  assert.match(prompt, /案内役: deps-finish を起動…` の印は案内役が書く/);
  assert.match(prompt, /issue とラベルは変えない/);
});
