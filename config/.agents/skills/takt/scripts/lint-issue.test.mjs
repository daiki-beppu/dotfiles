// lint-issue の判定テスト。GitHub は呼ばない。
import assert from "node:assert/strict";
import { test } from "node:test";
import { lintIssue } from "./lint-issue-rules.mjs";

const MESSAGE = "レビューは PR の本文とコメントを読む。証跡は PR の本文に載せる、と書く";
const RECOMMENDED = "実装レポートに載せる（PR の本文に写る）";
const lint = (body, comments = []) => lintIssue({ body, comments });
const reportWarnings = (ws) => ws.filter((w) => w.includes(MESSAGE));
const afterRunWarnings = (ws) => ws.filter((w) => w.includes("run の中では満たせない"));

test("実装レポートに載せる項目で PR の本文が無ければ警告する", () => {
  const ws = lint("- [ ] `--dry-run` した結果を実装レポートに載せる");
  assert.equal(reportWarnings(ws).length, 1);
  assert.equal(ws.length, 1);
  assert.match(ws[0], /本文 1 行目/);
});

test("報告に書く項目で PR の本文が無ければ警告する", () => {
  const ws = lint("- [ ] 計測の結果を報告に書く");
  assert.equal(reportWarnings(ws).length, 1);
  assert.equal(ws.length, 1);
});

test("新しい警告は勧める書き方を示す", () => {
  const [w] = reportWarnings(lint("- [ ] 結果を実装レポートに載せる"));
  assert.ok(w.includes(RECOMMENDED));
});

test("実装レポートにも報告にも触れない項目には警告しない", () => {
  assert.deepEqual(lint("- [ ] lint のテストが通る"), []);
});

test("載せる先が PR の本文だと書いた項目には警告しない", () => {
  assert.deepEqual(lint(`- [ ] \`--dry-run\` した結果を${RECOMMENDED}`), []);
});

test("PR の本文が別の行にあるだけなら警告する", () => {
  const ws = lint("- [ ] 結果を実装レポートに載せる\n- PR の本文はテンプレートに従う");
  const rw = reportWarnings(ws);
  assert.equal(rw.length, 1);
  assert.match(rw[0], /本文 1 行目/);
});

test("コードフェンスの中・マージ後の節・チェック済み・チェック欄なしは拾わない", () => {
  const body = [
    "```",
    "- [ ] 結果を実装レポートに載せる",
    "```",
    "## マージ後に人が確かめること",
    "- [ ] 結果を実装レポートに載せる",
    "## 補足",
    "- [x] 結果を実装レポートに載せる",
    "- 結果を実装レポートに載せる",
  ].join("\n");
  assert.deepEqual(reportWarnings(lint(body)), []);
});

test("コメントの項目も点検し、出どころを示す", () => {
  const ws = lint("", [{ author: { login: "alice" }, body: "- [ ] 結果を報告に載せる" }]);
  const rw = reportWarnings(ws);
  assert.equal(rw.length, 1);
  assert.match(rw[0], /コメント 1（alice） 1 行目/);
});

test("PR の本文に直接書く項目には既存の警告が出て、新しい警告は出ない", () => {
  const ws = lint("- [ ] PR の本文に結果を書く");
  assert.equal(afterRunWarnings(ws).length, 1);
  assert.equal(reportWarnings(ws).length, 0);
});

test("CI を確かめる項目は、レポートに触れていても既存の警告が出る", () => {
  const ws = lint("- [ ] CI で通った結果を実装レポートに載せる（PR の本文に写る）");
  assert.equal(afterRunWarnings(ws).length, 1);
  assert.equal(reportWarnings(ws).length, 0);
});

test("既存の警告の文言は勧める書き方を示し、古い書き方を残さない", () => {
  const [w] = afterRunWarnings(lint("- [ ] PR の本文に結果を書く"));
  assert.ok(w.includes(RECOMMENDED));
  assert.ok(!w.includes("PR 本文へは PR を作るときに写す"));
});

test("既存の警告: 人の手が要る項目", () => {
  const ws = lint("- [ ] 実機で確かめる");
  assert.equal(ws.length, 1);
  assert.match(ws[0], /人の手が要る完了条件/);
});

test("既存の警告: リンク先の issue に頼る仕様", () => {
  const ws = lint("- 詳細は #12 を参照");
  assert.equal(ws.length, 1);
  assert.match(ws[0], /リンク先の issue \/ PR に頼っている/);
});

test("既存の警告: ほかのブランチ", () => {
  const ws = lint("- git fetch origin feature/x して読む");
  assert.equal(ws.length, 1);
  assert.match(ws[0], /ほかのブランチや fetch/);
});

test("掲載内容が助詞と動詞の間に入る表現も警告する", () => {
  for (const line of ["- [ ] 実装レポートに検証結果を書く", "- [ ] 報告に結果を載せる"]) {
    assert.equal(reportWarnings(lint(line)).length, 1, line);
  }
});

test("掲載内容が間に入っても、載せる先が PR の本文なら警告しない", () => {
  assert.deepEqual(lint("- [ ] 検証結果を実装レポートに載せる（PR の本文に写る）"), []);
  assert.deepEqual(lint("- [ ] 実装レポートに検証結果を載せる（PR の本文に写る）"), []);
});
