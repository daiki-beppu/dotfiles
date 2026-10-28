// status.mjs のテスト。スナップショットは decide.test.mjs と同じ形の最小のものを組み立てる。
import assert from "node:assert/strict";
import { test } from "node:test";
import { boardOf, mainLineOf, renderBoard, truncate, widthOf } from "./status.mjs";

const VIEWER = "daiki-beppu";
const issue = (number, over = {}) => ({ number, title: `issue ${number}`, state: "OPEN", labels: [], body: "", comments: [], subIssues: [], ...over });
const by = (...bodies) => bodies.map((body) => ({ author: VIEWER, body }));
const snapshot = (issues, over = {}) => ({ repo: "o/r", viewer: VIEWER, issues, taktIssues: [], ...over });

const SENT = ["案内役: Discord に承認依頼を送る", "案内役: Discord に承認依頼を送った（スレッド 555 / メッセージ 777）"];
const FS_LAUNCHED = "案内役: formal-spec を起動した（ターミナル term_f / 2026-10-17T00:00:00.000Z）";
const FS_PASSED = "## Formal Spec（takt 0.71.0 の検証器で passed）";
const FS_FAILED = "## Formal Spec（takt 0.71.0 の検証器で failed）\n\n検証器の作業ディレクトリ: /tmp/run";
const TT_LAUNCHED = "案内役: to-tickets を起動した（ターミナル term_t / 2026-10-17T00:00:00.000Z）";
const HANDED = "案内役: takt-sequence に渡した #21 #22";
const SEQ_LAUNCHED = "案内役: takt-sequence を起動した（ターミナル term_s / 2026-10-17T00:00:00.000Z）";

const approvedSpec = (comments, over = {}) => issue(12, { title: "仕様のタイトル", labels: ["spec", "spec-approved"], comments: by(...SENT, FS_LAUNCHED, FS_PASSED, ...comments), ...over });
const parent = (subs, comments = [HANDED, SEQ_LAUNCHED]) => issue(20, { body: "仕様: #12", subIssues: subs, comments: by(...comments) });
const row = (snap, subject = "仕様 #12") => boardOf(snap).find((r) => r.subject === subject);

test("仕様: 承認依頼を送る前は 承認依頼前", () => {
  assert.equal(row(snapshot([issue(12, { labels: ["spec"] })])).phase, "承認依頼前");
});

test("仕様: 承認依頼を送り、承認されていなければ 承認待ち", () => {
  const r = row(snapshot([issue(12, { labels: ["spec"], comments: by(...SENT, FS_LAUNCHED, FS_PASSED) })]));
  assert.equal(r.phase, "承認待ち");
  assert.match(r.detail, /passed/);
});

test("仕様: formal-spec を起動して結果がまだ無ければ 形式検証中（承認済みでも）", () => {
  assert.equal(row(snapshot([issue(12, { labels: ["spec", "spec-approved"], comments: by(...SENT, FS_LAUNCHED) })])).phase, "形式検証中");
});

test("仕様: 最後の Formal Spec が failed なら 形式検証で失敗", () => {
  assert.equal(row(snapshot([issue(12, { labels: ["spec"], comments: by(...SENT, FS_LAUNCHED, FS_FAILED) })])).phase, "形式検証で失敗");
});

test("仕様: 承認済みで形式検証が通り、親がまだ無ければ 起票中", () => {
  assert.equal(row(snapshot([approvedSpec([])])).phase, "起票中");
  const launched = row(snapshot([approvedSpec([TT_LAUNCHED])]));
  assert.equal(launched.phase, "起票中");
  assert.match(launched.detail, /to-tickets のタブ/);
});

test("仕様: 親を takt-sequence に渡したら 実装中。詳細は親ごとの閉じた数と、takt が扱っている sub-issue", () => {
  const snap = snapshot([approvedSpec([TT_LAUNCHED]), parent([{ number: 21, state: "CLOSED" }, { number: 22, state: "OPEN" }, { number: 23, state: "OPEN" }]), issue(21, { state: "CLOSED" }), issue(22), issue(23)], {
    taktTasks: [{ issue: 22, kind: "running", createdAt: "2026-10-17T00:00:00Z" }, { issue: 23, kind: "pending", createdAt: "2026-10-17T00:00:00Z" }, { issue: 21, kind: "completed", createdAt: "2026-10-16T00:00:00Z" }],
  });
  const r = row(snap);
  assert.equal(r.phase, "実装中");
  assert.equal(r.detail, "親 #20 1/3 閉・takt #22 実行中・#23 待ち");
});

test("仕様: 親の sub-issue がすべて閉じたら 学びをまとめ中、学びの PR が OPEN なら 学びの PR のマージ待ち", () => {
  const issues = [approvedSpec([TT_LAUNCHED]), parent([{ number: 21, state: "CLOSED" }]), issue(21, { state: "CLOSED" })];
  assert.equal(row(snapshot(issues)).phase, "学びをまとめ中");
  const pr = { number: 50, state: "OPEN", author: VIEWER, body: "学びの元の仕様: #12", autoMerge: true };
  const r = row(snapshot(issues, { pullRequests: [pr] }));
  assert.equal(r.phase, "学びの PR のマージ待ち");
  assert.match(r.detail, /PR #50（自動マージ予約済み）/);
});

test("仕様: 判断依頼を送り、対象がまだ止まったままなら、他の段階より 判断待ち を優先して原因を出す", () => {
  const issues = [
    approvedSpec([TT_LAUNCHED, "案内役: Discord に判断依頼を送る（#22 takt の ABORT）"]),
    parent([{ number: 21, state: "CLOSED" }, { number: 22, state: "OPEN" }]),
    issue(21, { state: "CLOSED" }),
    issue(22),
  ];
  const r = row(snapshot(issues));
  assert.equal(r.phase, "判断待ち");
  assert.equal(r.detail, "#22 takt の ABORT・親 #20 1/2 閉");
});

test("仕様: 判断依頼の対象が片付いた（sub-issue が閉じた・形式検証が通り直した）なら判断待ちにしない", () => {
  const closed = [
    approvedSpec([TT_LAUNCHED, "案内役: Discord に判断依頼を送る（#22 takt の ABORT）"]),
    parent([{ number: 22, state: "CLOSED" }]),
    issue(22, { state: "CLOSED" }),
  ];
  assert.equal(row(snapshot(closed)).phase, "学びをまとめ中");
  const refixed = issue(12, { labels: ["spec"], comments: by(...SENT, FS_LAUNCHED, FS_FAILED, "案内役: Discord に判断依頼を送る（#12 formal-spec の検証失敗）", FS_PASSED) });
  assert.equal(row(snapshot([refixed])).phase, "承認待ち");
});

const ABORT_SENDING = "案内役: Discord に判断依頼を送る（#22 takt の ABORT）";
const ABORT_SENT = "案内役: Discord に判断依頼を送った（#22 takt の ABORT / スレッド 555 / メッセージ M1）";
const ABORT_ANSWERED = "案内役: 判断依頼に答えた（#22 takt の ABORT）";
const abortIssues = (decisionComments) => [
  approvedSpec([TT_LAUNCHED, ...decisionComments]),
  parent([{ number: 21, state: "CLOSED" }, { number: 22, state: "OPEN" }]),
  issue(21, { state: "CLOSED" }),
  issue(22),
];

test("仕様: 判断依頼に答えた印があれば、対象が止まったままでも判断待ちから外し、元の段階に戻す", () => {
  const r = row(snapshot(abortIssues([ABORT_SENDING, ABORT_SENT, ABORT_ANSWERED])));
  assert.equal(r.phase, "実装中");
  assert.equal(r.detail, "親 #20 1/2 閉");
});

test("仕様: 本人が手で書いた答えた印（送った後の印の無い古い判断依頼）でも判断待ちから外す。答えた印が無ければ判断待ちのまま", () => {
  assert.equal(row(snapshot(abortIssues([ABORT_SENDING, ABORT_ANSWERED]))).phase, "実装中");
  assert.equal(row(snapshot(abortIssues([ABORT_SENDING, `${ABORT_ANSWERED}\r\n`]))).phase, "実装中");
  assert.equal(row(snapshot(abortIssues([ABORT_SENDING, ABORT_SENT]))).phase, "判断待ち");
});

test("仕様: 答えた後に印を消して送り直した判断依頼は、前の答えでは外さない", () => {
  assert.equal(row(snapshot(abortIssues([ABORT_ANSWERED, ABORT_SENDING]))).phase, "判断待ち");
});

test("仕様: fromSpec より前の仕様と、閉じた仕様は出さない", () => {
  const rows = boardOf(snapshot([issue(5, { labels: ["spec"] }), issue(12, { labels: ["spec"] }), issue(13, { labels: ["spec"], state: "CLOSED" })], { fromSpec: 10 }));
  assert.deepEqual(rows.map((r) => r.subject), ["仕様 #12"]);
});

const MAP_THREAD = "案内役: Discord に map のスレッドを立てた（スレッド 900）";
const map = (children, over = {}) => issue(30, { title: "地図", labels: ["wayfinder:map"], subIssues: children, comments: by(MAP_THREAD), ...over });

test("map: 子が残っていれば 探索中。詳細は open な子の数と、起動したセッションの数", () => {
  const ticket = issue(31, { labels: ["wayfinder:task"], comments: by("案内役: wayfinder を起動した（ターミナル term_w / 2026-10-17T00:00:00.000Z）") });
  const r = row(snapshot([map([{ number: 31, state: "OPEN" }, { number: 32, state: "OPEN" }, { number: 33, state: "CLOSED" }]), ticket, issue(32, { labels: ["wayfinder:research"] }), issue(33, { state: "CLOSED" })]), "map #30");
  assert.equal(r.phase, "探索中");
  assert.equal(r.detail, "子 open 2/3・セッション 1");
  assert.equal(r.title, "地図");
});

test("map: 子がすべて閉じて霧が無ければ 仕様化中、霧が残れば 霧の残り、仕様ができたら 仕様ができた", () => {
  const children = [{ number: 31, state: "CLOSED" }];
  assert.equal(row(snapshot([map(children), issue(31, { state: "CLOSED" })]), "map #30").phase, "仕様化中");
  assert.equal(row(snapshot([map(children, { body: "## Not yet specified\n- まだ決めていない\n" }), issue(31, { state: "CLOSED" })]), "map #30").phase, "霧の残り");
  const specced = row(snapshot([map(children), issue(31, { state: "CLOSED" }), issue(40, { labels: ["spec"], body: "元の map: #30" })]), "map #30");
  assert.equal(specced.phase, "仕様ができた");
  assert.equal(specced.detail, "仕様 #40");
});

test("map: grilling の問いを送って回答が書き戻されていなければ 判断待ち", () => {
  const ticket = issue(31, {
    labels: ["wayfinder:grilling"],
    comments: by("案内役: wayfinder を起動した（ターミナル term_w / 2026-10-17T00:00:00.000Z）", "案内役: Discord に判断依頼を送った（#31 grilling の問い 17 / スレッド 900 / メッセージ M1）"),
  });
  const r = row(snapshot([map([{ number: 31, state: "OPEN" }]), ticket]), "map #30");
  assert.equal(r.phase, "判断待ち");
  assert.match(r.detail, /#31 grilling の問い/);
});

test("map: 判断依頼に答えた印があれば、霧が残っていても判断待ちから外す", () => {
  const children = [{ number: 31, state: "CLOSED" }];
  const foggy = (extra) => map(children, { body: "## Not yet specified\n- まだ\n", comments: by(MAP_THREAD, "案内役: Discord に判断依頼を送る（#30 霧の残り）", ...extra) });
  assert.equal(row(snapshot([foggy([]), issue(31, { state: "CLOSED" })]), "map #30").phase, "判断待ち");
  assert.equal(row(snapshot([foggy(["案内役: 判断依頼に答えた（#30 霧の残り）"]), issue(31, { state: "CLOSED" })]), "map #30").phase, "霧の残り");
});

test("map: 保留の map は出さない", () => {
  assert.deepEqual(boardOf(snapshot([map([], { labels: ["wayfinder:map", "wayfinder:on-hold"] })])), []);
});

test("renderBoard: 1 行目に JST の時刻と件数、続けて 1 件 1 行で列を表示幅でそろえる", () => {
  const rows = [
    { subject: "仕様 #12", title: "短い", phase: "実装中", detail: "親 #20 1/3 閉" },
    { subject: "map #300", title: "地図", phase: "判断待ち", detail: "#31 grilling の問い" },
  ];
  const [header, ...lines] = renderBoard(rows, new Date("2026-10-27T03:38:27Z")).split("\n");
  assert.equal(header, "2026/10/27 12:38:27 状況: 仕様 1 件・map 1 件（判断待ち 1 件）");
  assert.equal(lines.length, 2);
  const titleColumn = (line) => widthOf(line.slice(0, line.lastIndexOf("  ") + 2));
  assert.equal(titleColumn(lines[0]), titleColumn(lines[1]));
  assert.ok(lines[0].endsWith("短い"));
});

test("renderBoard: 長い題名は表示幅で切って … を付ける", () => {
  const title = "あ".repeat(60);
  const [, line] = renderBoard([{ subject: "仕様 #1", title, phase: "承認待ち", detail: "x" }], new Date(0)).split("\n");
  assert.ok(line.endsWith("…"));
  assert.ok(widthOf(line) < widthOf(title));
  assert.equal(truncate("abc", 10), "abc");
});

const mainOf = (nix, sc) => ({
  sha: "c".repeat(40),
  required: ["Nix flake evaluation", "ShellCheck (severity=error)"],
  checks: [
    { id: 1, name: "Nix flake evaluation", status: "completed", conclusion: nix, runId: 7 },
    { id: 2, name: "ShellCheck (severity=error)", status: "completed", conclusion: sc, runId: 7 },
  ],
  comments: [],
});

test("main の行: 赤い間は落ちたチェックの名前を出し、一覧のヘッダの次（仕様より前）に置く", () => {
  const snap = snapshot([issue(12, { labels: ["spec"] })], { main: mainOf("failure", "timed_out") });
  assert.equal(mainLineOf(snap), "main: 赤（Nix flake evaluation、ShellCheck (severity=error)）・再実行中");
  const lines = renderBoard(boardOf(snap), new Date(0), mainLineOf(snap)).split("\n");
  assert.equal(lines[1], "  main: 赤（Nix flake evaluation、ShellCheck (severity=error)）・再実行中");
  assert.match(lines[2], /^ {2}仕様 #12/);
  assert.equal(renderBoard([], new Date(0), mainLineOf(snap)).split("\n")[1], lines[1]);
});

test("main の行: 緑・未定・main が無いときは出さない", () => {
  const green = snapshot([], { main: mainOf("success", "success") });
  assert.equal(mainLineOf(green), null);
  assert.equal(mainLineOf(snapshot([], { main: { ...mainOf("failure", "success"), checks: [] } })), null);
  assert.equal(mainLineOf(snapshot([])), null);
  assert.equal(renderBoard([], new Date(0), mainLineOf(green)).split("\n")[1], "  （扱う仕様も map も無い）");
});

test("main の行: C に viewer の main-fix の起動の印があれば、段階を修正中（main-fix <C の先頭 7 桁>）にする", () => {
  const launching = { author: VIEWER, body: `案内役: main-fix を起動する（commit ${"c".repeat(40)}）` };
  const fixing = snapshot([], { main: { ...mainOf("failure", "success"), comments: [launching] } });
  assert.equal(mainLineOf(fixing), "main: 赤（Nix flake evaluation）・修正中（main-fix ccccccc）");
  const other = snapshot([], { main: { ...mainOf("failure", "success"), comments: [{ ...launching, author: "someone" }] } });
  assert.equal(mainLineOf(other), "main: 赤（Nix flake evaluation）・再実行中");
});

test("main の行: C に判断依頼を送っていれば（C の commit comment か仕様の issue の印）、段階を判断待ちにする。修正中より優先する", () => {
  const C = "c".repeat(40);
  const launching = { author: VIEWER, body: `案内役: main-fix を起動する（commit ${C}）` };
  const decided = { author: VIEWER, body: `案内役: Discord に判断依頼を送る（commit ${C} main の修復）` };
  const onCommit = snapshot([], { main: { ...mainOf("failure", "success"), comments: [launching, decided] } });
  assert.equal(mainLineOf(onCommit), "main: 赤（Nix flake evaluation）・判断待ち");
  const stalled = { author: VIEWER, body: `案内役: Discord に判断依頼を送る（commit ${C} main-fix のセッションの停止）` };
  const onSpec = snapshot([issue(12, { labels: ["spec"], comments: [stalled] })], { main: { ...mainOf("failure", "success"), comments: [launching] } });
  assert.equal(mainLineOf(onSpec), "main: 赤（Nix flake evaluation）・判断待ち");
  // 前の commit への判断依頼は今の C の段階に数えない
  const old = { author: VIEWER, body: `案内役: Discord に判断依頼を送る（commit ${"b".repeat(40)} main の修復）` };
  assert.equal(mainLineOf(snapshot([], { main: { ...mainOf("failure", "success"), comments: [old] } })), "main: 赤（Nix flake evaluation）・再実行中");
});
