import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SEQUENCE_DONE } from "./decide.mjs";
import { SPLIT_DOWN } from "./pane.mjs";
import { mergeTasks, startTaktSequence, taktRunDirs, taktTasks } from "./takt.mjs";
// レビュー失敗の判断依頼で読むレポートの読み取り（新しい公開物）は名前空間で読む（未実装でも他のテストは動かす）。
import * as T from "./takt.mjs";

test("taktRunDirs: main checkout に写した run と、片付けていないクローンの run を、対象 issue の分だけ slug の順に返す", () => {
  const root = mkdtempSync(join(tmpdir(), "takt-run-dirs-"));
  const repo = join(root, "repo");
  const run = (base, slug, file = "trace.md") => {
    const d = join(base, ".takt", "runs", slug);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, file), "x");
    return d;
  };
  const archived = run(repo, "20261028-010000-issue-21-a");
  run(repo, "20261028-020000-issue-21-b", "interventions.jsonl");
  run(repo, "20261028-030000-issue-99-c");
  run(repo, "20261028-040000-merge-pr-70-d");
  const [a, b] = ["A", "B"].map((n) => join(root, n));
  run(a, "20261028-010000-issue-21-a");
  const unarchived = run(a, "20261028-050000-issue-22-e");
  mkdirSync(join(b, ".takt", "runs", "20261028-060000-issue-21-f", "reports"), { recursive: true });
  const tasks = [
    { issueNumber: 21, worktreePath: a },
    { data: { issue: 22 }, worktreePath: a },
    { issueNumber: 21, worktreePath: b },
    { issueNumber: 21, worktreePath: join(root, "gone") },
    { issueNumber: 21 },
  ];
  assert.deepEqual(taktRunDirs(repo, [21, 22], (cwd) => (assert.equal(cwd, repo), tasks)), [
    archived,
    unarchived,
    join(b, ".takt", "runs", "20261028-060000-issue-21-f"),
  ]);
});

test("taktTasks: タスクを issue・kind・createdAt・step・error・worktreePath・prUrl に正規化し、issue が整数にならないものは除く", () => {
  const raw = [
    { issueNumber: 21, kind: "failed", createdAt: "2026-10-16T10:00:00Z", worktreePath: "/w/21", prUrl: "https://github.com/o/r/pull/70", failure: { step: "implement", error: "blocked", last_message: "m" } },
    { data: { issue: 22 }, kind: "running", createdAt: "2026-10-16T11:00:00Z" },
    { kind: "completed", createdAt: "2026-10-16T12:00:00Z" },
    { issueNumber: "abc", kind: "failed", createdAt: "2026-10-16T12:00:00Z" },
  ];
  assert.deepEqual(taktTasks("/x", (cwd) => (assert.equal(cwd, "/x"), raw)), [
    { issue: 21, kind: "failed", createdAt: "2026-10-16T10:00:00Z", step: "implement", error: "blocked", worktreePath: "/w/21", prUrl: "https://github.com/o/r/pull/70" },
    { issue: 22, kind: "running", createdAt: "2026-10-16T11:00:00Z", step: undefined, error: undefined, worktreePath: undefined, prUrl: undefined },
  ]);
});

test("startTaktSequence: terminal が無ければ、今のとおり Orca の新しいタブ（orca terminal create）で起動し、応答の result.terminal.handle を返す。takt-sequence の後に終わりの行を出す", () => {
  const calls = [];
  const run = (args, opts) => {
    calls.push({ args, opts });
    return JSON.stringify({ ok: true, result: { terminal: { handle: "term_seq", title: "takt sequence o/r" } } });
  };
  assert.deepEqual(startTaktSequence({ cwd: "/w", repo: "o/r", issues: [21, 22] }, run), { handle: "term_seq" });
  const [{ args, opts }] = calls;
  assert.deepEqual(args.slice(0, 7), ["terminal", "create", "--worktree", "path:/w", "--title", "takt sequence o/r", "--json"]);
  assert.equal(args[7], "--command");
  assert.match(args[8], /takt-sequence\.mjs' '21' '22'; echo "案内役: takt-sequence が終わった（exit \$\?）"$/);
  assert.ok(args[8].includes(SEQUENCE_DONE));
  assert.equal(opts.cwd, "/w");
});

test("startTaktSequence: 動いている takt-sequence に足せたら、orca を呼ばずにその handle を返す。足すのは issue の番号だけ", () => {
  const appended = [];
  const append = (cwd, issues) => (appended.push({ cwd, issues }), { handle: "term_running" });
  const run = () => assert.fail("orca は呼ばない");
  assert.deepEqual(startTaktSequence({ cwd: "/w", repo: "o/r", issues: [21, "#22", "--workflow", "x"], terminal: "term_guide" }, run, append), { handle: "term_running", appended: true });
  assert.deepEqual(appended, [{ cwd: "/w", issues: ["21", "22"] }]);
});

test("startTaktSequence: 足せなければ（append が null）、今のとおり起動する", () => {
  const run = () => JSON.stringify({ ok: true, result: { terminal: { handle: "term_seq" } } });
  assert.deepEqual(startTaktSequence({ cwd: "/w", repo: "o/r", issues: [21] }, run, () => null), { handle: "term_seq" });
});

test("startTaktSequence: 応答から handle が取れなければ、応答の頭を入れて例外にする", () => {
  assert.throws(() => startTaktSequence({ cwd: "/w", repo: "o/r", issues: [21] }, () => "not json"), /handle が取れない.*not json/);
  assert.throws(() => startTaktSequence({ cwd: "/w", repo: "o/r", issues: [21] }, () => JSON.stringify({ ok: true, result: {} })), /result\.terminal\.handle/);
});

test("startTaktSequence: terminal（案内役のペインの handle）があれば、そのペインを下へ分割して起動し、応答の result.split.handle を返す", () => {
  const calls = [];
  const run = (args, opts) => {
    calls.push({ args, opts });
    return JSON.stringify({ ok: true, result: { split: { handle: "term_pane" } } });
  };
  assert.deepEqual(startTaktSequence({ cwd: "/w", repo: "o/r", issues: [21, 22], terminal: "term_guide" }, run), { handle: "term_pane" });
  const [{ args, opts }] = calls;
  assert.equal(calls.length, 1);
  assert.deepEqual(args.slice(0, 7), ["terminal", "split", "--terminal", "term_guide", "--direction", SPLIT_DOWN, "--command"]);
  assert.match(args[7], /takt-sequence\.mjs' '21' '22'; echo "案内役: takt-sequence が終わった（exit \$\?）"$/);
  assert.deepEqual(args.slice(8), ["--json"]);
  assert.ok(!args.includes("create"));
  assert.equal(opts.cwd, "/w");
});

test("startTaktSequence: 分割の応答から result.split.handle が取れなければ、例外にする", () => {
  const reply = JSON.stringify({ ok: true, result: { terminal: { handle: "term_x" } } });
  assert.throws(() => startTaktSequence({ cwd: "/w", repo: "o/r", issues: [21], terminal: "term_guide" }, () => reply), /orca terminal split.*result\.split\.handle/);
});

// merge タスクの記録。TaskRunner の項目は takt list --format json に出ないので、takt-node.sh 経由のスクリプトの JSON を受け取る（実行は偽物を注入）。
const item = (over = {}, data = {}) => ({ kind: "failed", createdAt: "2026-10-17T00:30:00Z", runSlug: "run-1", data: { merge_task: true, pr_number: 70, merge_initial_head_sha: "a".repeat(40), merge_pushed_head_sha: "b".repeat(40), ...data }, ...over });

test("mergeTasks: merge タスクだけを残し、PR 番号・状態・作成時刻・head・レポートの場所（<cwd>/.takt/runs/<runSlug>）に正規化する", () => {
  const calls = [];
  const run = (args, opts) => (calls.push({ args, cwd: opts?.cwd }), JSON.stringify([item(), item({ kind: "completed", runSlug: undefined }, { merge_pushed_head_sha: undefined })]));
  assert.deepEqual(mergeTasks("/repo", run), [
    { prNumber: 70, kind: "failed", createdAt: "2026-10-17T00:30:00Z", initialHead: "a".repeat(40), pushedHead: "b".repeat(40), reports: join("/repo", ".takt", "runs", "run-1") },
    { prNumber: 70, kind: "completed", createdAt: "2026-10-17T00:30:00Z", initialHead: "a".repeat(40), pushedHead: undefined, reports: null },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, "/repo");
  assert.match(JSON.stringify(calls[0].args), /merge-tasks\.mjs/);
});

test("mergeTasks: merge_task が true でないタスクと、pr_number が整数でないタスクは除く", () => {
  const rows = [item({}, { merge_task: false }), item({ data: { pr_number: 7 } }), item({}, { pr_number: "abc" }), item({}, { pr_number: undefined }), item({}, { pr_number: 71 })];
  const result = mergeTasks("/repo", () => JSON.stringify(rows));
  assert.deepEqual(result.map((m) => m.prNumber), [71]);
});

test("mergeTasks: 実行が失敗したら例外を伝え、JSON でない出力は例外にする（黙って空にしない）", () => {
  assert.throws(() => mergeTasks("/repo", () => { throw new Error("takt-node.sh が失敗"); }), /takt-node\.sh が失敗/);
  assert.throws(() => mergeTasks("/repo", () => "not json"));
});

// ---- レビュー失敗の判断依頼に載せる、merge タスクの run のレポート（final-gate の review-resolution.md） ----
// 偽のレポートを一時ディレクトリに置いて読む。形は takt 0.71.0 の builtin（supervisor-validation）の `## 結果:` と `## 判定不能の理由（BLOCKED の場合）`。
const NO_VERDICT = "（レポートに判定が無い）";
const NO_UNDECIDABLE = "（判定不能の理由の記録なし）";
const resolution = (result, undecidable) =>
  `# 最終検証結果\n\n## 結果: ${result}\n\n## 概要\n要約\n${undecidable === undefined ? "" : `\n## 判定不能の理由（BLOCKED の場合）\n${undecidable}\n\n## 次の確認\n- 別の節\n`}`;
const putReport = (runDir, rel, text, mtimeSec) => {
  const file = join(runDir, "reports", ...rel.split("/"));
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
  if (mtimeSec !== undefined) utimesSync(file, mtimeSec, mtimeSec);
};
const newRun = () => mkdtempSync(join(tmpdir(), "takt-run-"));

test("readReviewReport: 入れ子の reports/call-…/review-resolution.md から、判定と判定不能の理由（次の見出しの手前まで）を読む", () => {
  const run = newRun();
  putReport(run, "call-1/call-2/review-resolution.md", resolution("BLOCKED", "- 実機の結果が無い\n- 再現手順が不明"));
  assert.deepEqual(T.readReviewReport(run), { verdict: "BLOCKED", undecidable: "- 実機の結果が無い\n- 再現手順が不明" });
});

test("readReviewReport: REJECT のレポートに判定不能の理由の節が無ければ、判定は REJECT、理由は「記録なし」の文言にする", () => {
  const run = newRun();
  putReport(run, "call-1/review-resolution.md", resolution("REJECT"));
  assert.deepEqual(T.readReviewReport(run), { verdict: "REJECT", undecidable: NO_UNDECIDABLE });
});

test("readReviewReport: review-resolution.md が複数あれば、更新時刻が最も新しいものを読む", () => {
  const run = newRun();
  putReport(run, "call-1/review-resolution.md", resolution("BLOCKED", "- 古い理由"), 1_000_000);
  putReport(run, "call-2/review-resolution.md", resolution("REJECT", undefined), 2_000_000);
  putReport(run, "call-3/review-resolution.md", resolution("APPROVE", undefined), 1_500_000);
  assert.equal(T.readReviewReport(run).verdict, "REJECT");
});

test("readReviewReport: review-resolution.md 以外のレポートの判定と、.takt-report-internal の履歴は判定に使わない", () => {
  const run = newRun();
  putReport(run, "call-1/architecture-review.md", "## 結果: APPROVE\n", 3_000_000);
  putReport(run, ".takt-report-internal/review-resolution.md", resolution("REJECT", "- 内部の理由"), 4_000_000);
  putReport(run, "call-1/.takt-report-internal/review-resolution.md", resolution("REJECT", "- 内部の理由"), 4_000_000);
  assert.deepEqual(T.readReviewReport(run), { verdict: NO_VERDICT, undecidable: NO_UNDECIDABLE });
  putReport(run, "call-1/review-resolution.md", resolution("BLOCKED", "- 本物の理由"), 1_000_000);
  assert.deepEqual(T.readReviewReport(run), { verdict: "BLOCKED", undecidable: "- 本物の理由" });
});

test("readReviewReport: run のディレクトリ・reports が無い、レポートの場所が「記録なし」の文言、review-resolution.md に判定の行が無い場合は、例外にせず決まった文言を返す", () => {
  const empty = newRun();
  const missing = join(empty, "nothing");
  const noVerdict = newRun();
  putReport(noVerdict, "call-1/review-resolution.md", "# 結果なし\n本文だけ\n");
  for (const dir of [missing, empty, "（merge タスクの記録なし）", noVerdict]) {
    assert.deepEqual(T.readReviewReport(dir), { verdict: NO_VERDICT, undecidable: NO_UNDECIDABLE }, String(dir));
  }
});
