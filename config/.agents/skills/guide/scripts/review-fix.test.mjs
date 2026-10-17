// review-fix.mjs のテスト。orca と git は偽物を注入し、呼ばれた argv と cwd で、起動する場所と渡すプロンプトを確かめる。
// orca worktree create --json の応答の形は { ok, result: { worktree: { path } } }（wayfinder.test.mjs と同じ）。実機の応答は未取得。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { tabTitle } from "./decide.mjs";
import { redoMarker } from "../../takt/scripts/review-stage.mjs";
import { launchReviewFix } from "./review-fix.mjs";

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const INPUT = { cwd: "/repo", repo: "o/r", pr: 70, issue: 21, head: HEAD, branch: "feat/21-x", reports: "/repo/.takt/runs/run-1" };

const launchReply = (handle = "term_f") => JSON.stringify({ result: { outcome: { kind: "terminal", handle } } });
const worktreeReply = (path) => JSON.stringify({ ok: true, result: { worktree: { id: "wt_9", path } } });

// orca と git の呼び出しを 1 本の時系列 calls に記録する
const porcelain = (entries) => entries.map(([path, branch]) => `worktree ${path}\nHEAD ${"0".repeat(40)}\n${branch === null ? "detached" : `branch refs/heads/${branch}`}\n`).join("\n");
const fakes = ({ worktree = worktreeReply("/wt/fix"), launch = launchReply(), gitFails = null, worktrees = porcelain([["/repo", "main"]]) } = {}) => {
  const calls = [];
  const run = (args, opts) => {
    calls.push({ tool: "orca", args, cwd: opts.cwd });
    const reply = args[0] === "worktree" ? worktree : args[0] === "agent" ? launch : "{}";
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const git = (args, opts) => {
    calls.push({ tool: "git", args, cwd: opts?.cwd });
    if (gitFails !== null && args.includes(gitFails)) throw new Error(`git ${gitFails} failed`);
    return args[0] === "worktree" ? worktrees : "";
  };
  return { calls, run, git };
};
const arg = (args, flag) => args[args.indexOf(flag) + 1];
const orca = (calls, name) => calls.filter((c) => c.tool === "orca" && c.args[0] === name);
const gitCalls = (calls) => calls.filter((c) => c.tool === "git");
const promptOf = (calls) => arg(orca(calls, "agent")[0].args, "--prompt");

test("PR の head ブランチの worktree を作ってそこで起動する: fetch → worktree 一覧 → worktree create → ブランチへ切り替え → agent launch の順。handle を返す", () => {
  const { calls, run, git } = fakes();
  assert.deepEqual(launchReviewFix(INPUT, run, git), { handle: "term_f" });
  const kinds = calls.map((c) => `${c.tool} ${c.args[0]}`);
  assert.deepEqual(kinds, ["git fetch", "git worktree", "orca worktree", "git switch", "orca agent", "orca terminal"]);
});

test("fetch は対象 repo の cwd で origin を取る", () => {
  const { calls, run, git } = fakes();
  launchReviewFix(INPUT, run, git);
  const [fetch] = gitCalls(calls);
  assert.deepEqual(fetch.args, ["fetch", "origin"]);
  assert.equal(fetch.cwd, "/repo");
});

test("worktree create: 対象 repo を --repo、origin/<head ブランチ> を --base-branch、PR と head の先頭 7 桁を含む名前で、--json を付けて作る", () => {
  const { calls, run, git } = fakes();
  launchReviewFix(INPUT, run, git);
  const [create] = orca(calls, "worktree");
  assert.deepEqual(create.args.slice(0, 2), ["worktree", "create"]);
  assert.equal(arg(create.args, "--repo"), "path:/repo");
  assert.equal(arg(create.args, "--base-branch"), "origin/feat/21-x");
  assert.equal(arg(create.args, "--name"), "review-fix-70-0123456");
  assert.ok(create.args.includes("--json"));
  assert.equal(create.cwd, "/repo");
});

test("同じ PR の 2 回目（別の head）では worktree の名前が重ならない", () => {
  const names = ["a".repeat(40), "b".repeat(40)].map((head) => {
    const { calls, run, git } = fakes();
    launchReviewFix({ ...INPUT, head }, run, git);
    return arg(orca(calls, "worktree")[0].args, "--name");
  });
  assert.notEqual(names[0], names[1]);
});

const switchOf = (calls) => gitCalls(calls).find((c) => c.args[0] === "switch");

test("どの worktree も head ブランチを持っていなければ、作った worktree の中で head ブランチを origin/<ブランチ> に追従させて切り替える", () => {
  const { calls, run, git } = fakes();
  launchReviewFix(INPUT, run, git);
  const sw = switchOf(calls);
  assert.equal(sw.cwd, "/wt/fix");
  assert.deepEqual(sw.args, ["switch", "--track", "-C", "feat/21-x", "origin/feat/21-x"]);
});

test("[SCN-RF-WORKTREE-BRANCH-P1] 前回の worktree が head ブランチを持っていれば detach で起動する（ブランチを共有もリセットもしない）", () => {
  const worktrees = porcelain([["/repo", "main"], ["/wt/prev", "feat/21-x"]]);
  const { calls, run, git } = fakes({ worktrees });
  launchReviewFix(INPUT, run, git);
  const switches = gitCalls(calls).filter((c) => c.args[0] === "switch");
  assert.equal(switches.length, 1);
  assert.deepEqual(switches[0].args, ["switch", "--detach", "origin/feat/21-x"]);
  assert.equal(switches[0].cwd, "/wt/fix");
  assert.equal(arg(orca(calls, "agent")[0].args, "--worktree"), "path:/wt/fix");
});

test("[SCN-RF-WORKTREE-BRANCH-N1] 名前の前半が同じ別ブランチを持つ worktree があっても、head ブランチの checkout をやめない", () => {
  const worktrees = porcelain([["/repo", "main"], ["/wt/other", "feat/21-x-2"], ["/wt/det", null]]);
  const { calls, run, git } = fakes({ worktrees });
  launchReviewFix(INPUT, run, git);
  assert.deepEqual(switchOf(calls).args, ["switch", "--track", "-C", "feat/21-x", "origin/feat/21-x"]);
});

test("worktree 一覧の取得は fetch の後・worktree create の前に、対象 repo の cwd で行う", () => {
  const { calls, run, git } = fakes();
  launchReviewFix(INPUT, run, git);
  const list = gitCalls(calls).find((c) => c.args[0] === "worktree");
  assert.deepEqual(list.args, ["worktree", "list", "--porcelain"]);
  assert.equal(list.cwd, "/repo");
});

test("agent launch: 作った worktree の path を --worktree に渡し、その path を cwd にして、対話セッションとして起動する（--allowedTools は渡さない）", () => {
  const { calls, run, git } = fakes();
  launchReviewFix(INPUT, run, git);
  const [launch] = orca(calls, "agent");
  assert.equal(arg(launch.args, "--worktree"), "path:/wt/fix");
  assert.equal(launch.cwd, "/wt/fix");
  assert.ok(!calls.flatMap((c) => c.args).includes("--allowedTools"));
});

test("対象 repo の main checkout（cwd）では起動しない", () => {
  const { calls, run, git } = fakes();
  launchReviewFix(INPUT, run, git);
  assert.ok(!orca(calls, "agent").some((c) => arg(c.args, "--worktree") === "path:/repo"));
});

test("タブの題名は review-fix と PR の番号", () => {
  const { calls, run, git } = fakes();
  launchReviewFix(INPUT, run, git);
  const [rename] = orca(calls, "terminal");
  assert.equal(arg(rename.args, "--terminal"), "term_f");
  assert.equal(arg(rename.args, "--title"), tabTitle("review-fix", 70));
});

test("プロンプトに PR・sub-issue・失敗した head・head ブランチ・レポートの場所・書くべきやり直しの印を渡す", () => {
  const { calls, run, git } = fakes();
  launchReviewFix(INPUT, run, git);
  const prompt = promptOf(calls);
  for (const needle of ["#70", "https://github.com/o/r/pull/70", "#21", HEAD, "feat/21-x", "git push origin HEAD:feat/21-x", "/repo/.takt/runs/run-1", redoMarker(HEAD)]) {
    assert.ok(prompt.includes(needle), `プロンプトに ${needle} が無い`);
  }
});

test("プロンプトに 3 つの分岐（コードの指摘・証跡が無い・直せない）が書かれている", () => {
  const { calls, run, git } = fakes();
  launchReviewFix(INPUT, run, git);
  const prompt = promptOf(calls);
  assert.match(prompt, /コードの指摘/);
  assert.match(prompt, /push/);
  assert.match(prompt, /証跡/);
  assert.match(prompt, /直せない/);
  assert.match(prompt, /レポート/);
});

test("プロンプトに、issue の本文・完了条件・ラベルを変えないことと、確認を省いて結果まで進めることが書かれている", () => {
  const { calls, run, git } = fakes();
  launchReviewFix(INPUT, run, git);
  const prompt = promptOf(calls);
  assert.match(prompt, /本文/);
  assert.match(prompt, /完了条件/);
  assert.match(prompt, /ラベル/);
  assert.match(prompt, /変えない/);
  assert.match(prompt, /確認を省いて/);
});

test("fetch が失敗したら worktree を作らず、起動もせずに例外を伝える", () => {
  const { calls, run, git } = fakes({ gitFails: "fetch" });
  assert.throws(() => launchReviewFix(INPUT, run, git), /git fetch failed/);
  assert.deepEqual(orca(calls, "worktree"), []);
  assert.deepEqual(orca(calls, "agent"), []);
});

test("worktree create の応答に result.worktree.path が無ければ、path の名前を入れた例外にして起動しない", () => {
  for (const worktree of [JSON.stringify({ ok: true, result: { worktree: {} } }), JSON.stringify({ ok: true, result: {} }), "not json"]) {
    const { calls, run, git } = fakes({ worktree });
    assert.throws(() => launchReviewFix(INPUT, run, git), /result\.worktree\.path/);
    assert.deepEqual(orca(calls, "agent"), []);
  }
});

test("worktree の作成が失敗したら起動せずに例外を伝える", () => {
  const { calls, run, git } = fakes({ worktree: new Error("name already exists") });
  assert.throws(() => launchReviewFix(INPUT, run, git), /name already exists/);
  assert.deepEqual(orca(calls, "agent"), []);
});

test("ブランチの切り替えが失敗したら起動せずに例外を伝える（別のブランチの worktree で修正を始めない）", () => {
  const { calls, run, git } = fakes({ gitFails: "switch" });
  assert.throws(() => launchReviewFix(INPUT, run, git), /git switch failed/);
  assert.deepEqual(orca(calls, "agent"), []);
});

test("worktree 一覧の取得が失敗したら worktree を作らず、起動もせずに例外を伝える", () => {
  const { calls, run, git } = fakes({ gitFails: "worktree" });
  assert.throws(() => launchReviewFix(INPUT, run, git), /git worktree failed/);
  assert.deepEqual(orca(calls, "worktree"), []);
  assert.deepEqual(orca(calls, "agent"), []);
});

// 実際の git で、前回の worktree を残したまま 2 回目を起動する
// ユーザーの git 設定（署名・フック・テンプレート）を継承しないよう、設定ファイルを空にして commit の署名とフックを切る
const ISOLATED = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TEMPLATE_DIR: "" };
const ISOLATED_CONFIG = ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"];
const sh = (args, cwd) => execFileSync("git", [...ISOLATED_CONFIG, ...args], { cwd, encoding: "utf8", env: ISOLATED }).trim();

test("[SCN-RF-WORKTREE-BRANCH-P2] 実際の git: 1 回目の worktree を残したまま 2 回目を起動しても、前回の worktree の HEAD・ブランチ・作業ファイルは変わらず、2 回目から head ブランチへ push できる", () => {
  const root = mkdtempSync(join(tmpdir(), "review-fix-git-"));
  const origin = join(root, "origin.git");
  const repo = join(root, "repo");
  sh(["init", "--bare", "-b", "feat", origin], root);
  sh(["clone", origin, repo], root);
  sh(["checkout", "-b", "feat"], repo);
  writeFileSync(join(repo, "a.txt"), "a\n");
  sh(["add", "."], repo);
  sh(["commit", "-m", "A"], repo);
  sh(["push", "-u", "origin", "feat"], repo);
  const headA = sh(["rev-parse", "HEAD"], repo);
  sh(["checkout", "-b", "main"], repo);
  // Orca の worktree create の代役: --base-branch の ref から新しいブランチを作る
  const run = (args, { cwd }) => {
    if (args[0] !== "worktree") return launchReply();
    const name = arg(args, "--name");
    const path = join(root, name);
    sh(["worktree", "add", "-b", name, path, arg(args, "--base-branch")], cwd);
    return worktreeReply(path);
  };
  const git = (args, { cwd }) => execFileSync("git", args, { cwd, encoding: "utf8", env: ISOLATED });
  const input = { ...INPUT, cwd: repo, head: headA, branch: "feat" };
  launchReviewFix(input, run, git);
  const wt1 = join(root, `review-fix-70-${headA.slice(0, 7)}`);
  assert.equal(sh(["rev-parse", "--abbrev-ref", "HEAD"], wt1), "feat");
  writeFileSync(join(wt1, "b.txt"), "b\n");
  sh(["add", "."], wt1);
  sh(["commit", "-m", "B"], wt1);
  writeFileSync(join(wt1, "dirty.txt"), "dirty\n");
  const headB = sh(["rev-parse", "HEAD"], wt1);
  const status1 = sh(["status", "--porcelain"], wt1);

  const head2 = "f".repeat(40);
  launchReviewFix({ ...input, head: head2 }, run, git);
  const wt2 = join(root, `review-fix-70-${head2.slice(0, 7)}`);
  assert.equal(sh(["rev-parse", "HEAD"], wt2), headA);
  writeFileSync(join(wt2, "c.txt"), "c\n");
  sh(["add", "."], wt2);
  sh(["commit", "-m", "C"], wt2);
  const headC = sh(["rev-parse", "HEAD"], wt2);
  sh(["push", "origin", "HEAD:feat"], wt2);

  assert.equal(sh(["rev-parse", "HEAD"], wt1), headB);
  assert.equal(sh(["rev-parse", "refs/heads/feat"], repo), headB);
  assert.equal(sh(["status", "--porcelain"], wt1), status1);
  assert.equal(sh(["rev-parse", "refs/heads/feat"], origin), headC);
  const owners = sh(["worktree", "list", "--porcelain"], repo).split("\n").filter((l) => l === "branch refs/heads/feat");
  assert.equal(owners.length, 1);
});
