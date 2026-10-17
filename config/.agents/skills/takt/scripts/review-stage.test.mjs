// review-stage.mjs の判定テスト。gh・takt は呼ばない。
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_FIX_WAIT_MINUTES, FIX_LAUNCH_LIMIT, REVIEWED, REVIEW_FAILED,
  fixLaunchedHead, fixLaunchedMarker, fixLaunchingHead, fixLaunchingMarker, redoHead, redoMarker, reviewStage,
} from "./review-stage.mjs";

const A = "a".repeat(40);
const B = "b".repeat(40);
const VIEWER = "me";
const at = (hhmm) => `2026-10-17T${hhmm}:00Z`;
const NOW = new Date(at("10:09"));

const comment = (body, createdAt, login = VIEWER) => ({ author: { login }, body, createdAt });
const failed = (head, createdAt, login) => comment(`${REVIEW_FAILED} for head ${head}: 指摘が残っている\n詳細`, createdAt, login);
const launching = (head, createdAt, login) => comment(fixLaunchingMarker(head), createdAt, login);
const launched = (head, createdAt, login) => comment(fixLaunchedMarker(head, "h1", createdAt), createdAt, login);
const redo = (head, createdAt, login) => comment(redoMarker(head), createdAt, login);
const merge = (kind, head, createdAt) => ({ kind, createdAt, data: { merge_task: true, pr_number: 7, merge_initial_head_sha: head } });
const run = (over = {}) => reviewStage({ head: A, viewer: VIEWER, comments: [], merges: [], attempts: [], running: false, now: NOW, waitMinutes: 10, ...over });

test("既定の待ち時間は 10 分、起動の上限は 2 回", () => {
  assert.equal(DEFAULT_FIX_WAIT_MINUTES, 10);
  assert.equal(FIX_LAUNCH_LIMIT, 2);
});

test("印の文言は仕様どおり", () => {
  assert.equal(fixLaunchingMarker(A), `案内役: review-fix を起動する（head ${A}）`);
  assert.equal(fixLaunchedMarker(A, "h1", "2026-10-17T10:01:00Z"), `案内役: review-fix を起動した（head ${A} / ターミナル h1 / 2026-10-17T10:01:00Z）`);
  assert.equal(redoMarker(A), `案内役: レビューのやり直しを頼む for head ${A}`);
});

const table = [
  ["失敗のコメントがなければレビューを起動する", {}, "review"],
  ["現在の head の成功のコメントで reviewed", { comments: [comment(`${REVIEWED} for head ${A}; ok`, at("10:00"))] }, "reviewed"],
  ["成功でも子プロセスが生きていれば waiting", { running: true, comments: [comment(`${REVIEWED} for head ${A}; ok`, at("10:00"))] }, "waiting"],
  ["成功でも merge タスクが running なら waiting", { merges: [merge("running", A, at("10:00"))], comments: [comment(`${REVIEWED} for head ${A}; ok`, at("10:00"))] }, "waiting"],
  ["失敗があっても子プロセスが生きていれば waiting", { running: true, comments: [failed(A, at("09:00"))] }, "waiting"],
  ["失敗があっても merge タスクが pending なら waiting", { merges: [merge("pending", A, at("10:00"))], comments: [failed(A, at("09:00"))] }, "waiting"],
  ["失敗・起動の印なし・待ち時間内 → waiting", { comments: [failed(A, at("10:00"))] }, "waiting"],
  ["失敗・起動の印なし・待ち時間ちょうど → stuck", { now: new Date(at("10:10")), comments: [failed(A, at("10:00"))] }, "stuck"],
  ["失敗・起動の印なし・待ち時間を過ぎた → stuck", { now: new Date(at("10:30")), comments: [failed(A, at("10:00"))] }, "stuck"],
  ["待ち時間を引数で伸ばせば過ぎていても waiting", { now: new Date(at("10:30")), waitMinutes: 60, comments: [failed(A, at("10:00"))] }, "waiting"],
  ["待ち時間を引数で縮めれば内でも stuck", { waitMinutes: 3, comments: [failed(A, at("10:00"))] }, "stuck"],
  ["現在の head の 2 段目の印があれば待ち時間を過ぎても waiting", { now: new Date(at("11:00")), comments: [failed(A, at("10:00")), launched(A, at("10:01"))] }, "waiting"],
  ["現在の head の 1 段目の印だけでも waiting", { now: new Date(at("11:00")), comments: [failed(A, at("10:00")), launching(A, at("10:01"))] }, "waiting"],
  ["前の head の印では waiting にしない（待ち時間を過ぎれば stuck）", { now: new Date(at("11:00")), comments: [failed(A, at("10:00")), launched(B, at("10:01"))] }, "stuck"],
  ["第三者の起動の印は数えない", { now: new Date(at("11:00")), comments: [failed(A, at("10:00")), launched(A, at("10:01"), "other")] }, "stuck"],
  ["印が 2 行目に引用されているだけなら数えない", { now: new Date(at("11:00")), comments: [failed(A, at("10:00")), comment(`> 引用\n${fixLaunchedMarker(A, "h1", at("10:01"))}`, at("10:01"))] }, "stuck"],
  ["起動の印が上限に達し、現在の head に印なし → 待ち時間内でも stuck", { comments: [failed(A, at("10:08")), launching(B, at("09:00")), launching("c".repeat(40), at("09:30"))] }, "stuck"],
  ["上限に達していても現在の head に印があれば waiting", { comments: [failed(A, at("10:08")), launching(B, at("09:00")), launching(A, at("09:30"))] }, "waiting"],
  ["起動の印が上限未満（1 件）なら待ち時間内は waiting", { comments: [failed(A, at("10:08")), launching(B, at("09:00"))] }, "waiting"],
  ["1 回の起動の 1 段目と 2 段目は 1 回と数える（上限に達しない）", { comments: [failed(A, at("10:08")), launching(B, at("09:00")), launched(B, at("09:01"))] }, "waiting"],
  ["現在の head で merge タスクが 2 回 failed → stuck", { merges: [merge("failed", A, at("10:00")), merge("failed", A, at("10:01"))] }, "stuck"],
  ["現在の head で merge タスクが 1 回 failed ならレビューを起動する", { merges: [merge("failed", A, at("10:00"))] }, "review"],
  ["この実行で同じ head を 2 回起動していたら stuck", { attempts: [{ head: A, redo: null }, { head: A, redo: null }] }, "stuck"],
  ["この実行の起動が別 head で 2 回でもレビューを起動する（head が変わった）", { attempts: [{ head: B, redo: null }, { head: B, redo: null }] }, "review"],
  ["head が変わった → 前の head の失敗・落ちた回数・起動回数を数えない", {
    comments: [failed(B, at("10:00"))], merges: [merge("failed", B, at("10:00")), merge("failed", B, at("10:01"))], attempts: [{ head: B, redo: null }, { head: B, redo: null }],
  }, "review"],
  ["head の先頭数桁だけ一致する失敗は現在の head の失敗として数えない", { comments: [comment(`${REVIEW_FAILED} for head ${A.slice(0, 7)}: x`, at("10:00"))] }, "review"],
  ["第三者の失敗のコメントは数えない", { comments: [failed(A, at("10:00"), "other")] }, "review"],
  ["やり直しの印があり、その前の失敗だけ → レビューを起動し直す", { comments: [failed(A, at("10:00")), redo(A, at("10:05"))] }, "review"],
  ["やり直しの印の前の failed merge タスク 2 件は数えない", { comments: [redo(A, at("10:05"))], merges: [merge("failed", A, at("10:00")), merge("failed", A, at("10:01"))] }, "review"],
  ["やり直しの印の前の起動記録 2 件はリセットされる", {
    comments: [redo(A, at("10:05"))], attempts: [{ head: A, redo: null }, { head: A, redo: null }],
  }, "review"],
  ["やり直しの印の後の failed merge タスク 2 件 → stuck", { comments: [redo(A, at("10:05"))], merges: [merge("failed", A, at("10:06")), merge("failed", A, at("10:07"))] }, "stuck"],
  ["やり直しの後の起動記録 2 件 → stuck", { comments: [redo(A, at("10:05"))], attempts: [{ head: A, redo: at("10:05") }, { head: A, redo: at("10:05") }] }, "stuck"],
  ["やり直しの印より後に同じ head でまた失敗 → stuck（待ち時間内でも）", { comments: [failed(A, at("10:00")), redo(A, at("10:05")), failed(A, at("10:08"))] }, "stuck"],
  ["やり直しの後の失敗は、起動の印があっても stuck", { comments: [redo(A, at("10:05")), failed(A, at("10:06")), launched(A, at("10:07"))] }, "stuck"],
  ["やり直しは head ごとに 1 回: 最初のやり直しの後の失敗は 2 つ目の印でリセットしない", {
    comments: [redo(A, at("10:01")), failed(A, at("10:02")), redo(A, at("10:03"))],
  }, "stuck"],
  ["他の head のやり直しの印ではリセットしない", { now: new Date(at("11:00")), comments: [failed(A, at("10:00")), redo(B, at("10:05"))] }, "stuck"],
  ["第三者のやり直しの印ではリセットしない", { now: new Date(at("11:00")), comments: [failed(A, at("10:00")), redo(A, at("10:05"), "other")] }, "stuck"],
];
for (const [name, input, stage] of table) {
  test(name, () => assert.equal(run(input).stage, stage));
}

test("有効なやり直しの印の時刻を redo として返す", () => {
  assert.equal(run({ comments: [failed(A, at("10:00")), redo(A, at("10:05")), redo(A, at("10:06"))] }).redo, at("10:05"));
  assert.equal(run({ comments: [failed(A, at("10:00"))] }).redo, null);
});

test("やり直し後の起動記録だけを、やり直しの印と照合して数える", () => {
  const r = run({ comments: [redo(A, at("10:05"))], attempts: [{ head: A, redo: null }, { head: A, redo: at("10:05") }] });
  assert.equal(r.stage, "review");
});

test("判定は理由の文字列を返す", () => {
  assert.equal(typeof run({ comments: [failed(A, at("10:00"))] }).reason, "string");
});

// takt-sequence.mjs の配線と同じ形で、戻り値の redo を起動記録 { head, redo } に残して次周へ渡す連続実行
test("起動ごとに { head, redo } を記録して次周へ渡す: 同じ head・redo は 2 回で stuck、head が変われば再び review", () => {
  const attempts = [];
  const round = (over) => {
    const r = run({ attempts, ...over });
    if (r.stage === "review") attempts.push({ head: over.head ?? A, redo: r.redo });
    return r.stage;
  };
  assert.equal(round({}), "review");
  assert.equal(round({}), "review");
  assert.equal(round({}), "stuck");
  assert.equal(round({ head: B }), "review");
  const redoComments = [redo(A, at("10:05"))];
  assert.equal(round({ comments: redoComments }), "review");
  assert.equal(round({ comments: redoComments }), "review");
  assert.equal(round({ comments: redoComments }), "stuck");
});

// 印の照合（案内役の判定が import して使う）。本文の 1 行目が印に一致すれば head を、しなければ undefined を返す。
test("fixLaunchingHead・fixLaunchedHead・redoHead: 各印の本文から head を取り出す。ほかの印・別の文言・40 桁でない head は undefined", () => {
  assert.equal(fixLaunchingHead(fixLaunchingMarker(A)), A);
  assert.equal(fixLaunchedHead(fixLaunchedMarker(A, "h1", at("10:00"))), A);
  assert.equal(redoHead(redoMarker(A)), A);
  assert.equal(fixLaunchingHead(fixLaunchedMarker(A, "h1", at("10:00"))), undefined);
  assert.equal(fixLaunchedHead(fixLaunchingMarker(A)), undefined);
  assert.equal(redoHead(fixLaunchingMarker(A)), undefined);
  assert.equal(redoHead("案内役: レビューのやり直しを頼む for head abc"), undefined);
  assert.equal(fixLaunchingHead(""), undefined);
});

test("fixLaunchingHead: 本文の 1 行目だけを見る（2 行目以降に印があっても拾わない）", () => {
  assert.equal(redoHead(`関係ない行\n${redoMarker(A)}`), undefined);
  assert.equal(redoHead(`${redoMarker(A)}\n補足`), A);
});
