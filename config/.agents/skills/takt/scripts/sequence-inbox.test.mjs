// sequence-inbox.mjs のテスト。受け口は一時ディレクトリに作り、pid の生死は偽物を渡す。
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendToInbox, closeInbox, openInbox, takeFromInbox } from "./sequence-inbox.mjs";

const fresh = () => join(mkdtempSync(join(tmpdir(), "sequence-inbox-")), "inbox");
const alive = () => true;
const dead = () => false;

test("開いた受け口へ足した issue は、足した順に 1 回だけ読めて、足した側は owner の handle を受け取る", () => {
  const dir = fresh();
  assert.equal(openInbox(dir, { pid: 1, handle: "term_seq" }, alive), true);
  assert.deepEqual(appendToInbox(dir, [31, 32], alive), { handle: "term_seq" });
  assert.deepEqual(appendToInbox(dir, ["33"], alive), { handle: "term_seq" });
  assert.deepEqual(takeFromInbox(dir), ["31", "32", "33"]);
  assert.deepEqual(takeFromInbox(dir), []);
});

test("受け口が無い・owner が死んでいる・owner に handle が無いときは足さずに null", () => {
  assert.equal(appendToInbox(fresh(), [31], alive), null);
  const dir = fresh();
  openInbox(dir, { pid: 1, handle: "term_seq" }, alive);
  assert.equal(appendToInbox(dir, [31], dead), null);
  const noHandle = fresh();
  openInbox(noHandle, { pid: 1, handle: undefined }, alive);
  assert.equal(appendToInbox(noHandle, [31], alive), null);
});

test("生きている別の owner の受け口は開かない。死んだ owner の受け口は届いていたものごと消して開き直す", () => {
  const dir = fresh();
  openInbox(dir, { pid: 1, handle: "term_a" }, alive);
  appendToInbox(dir, [31], alive);
  assert.equal(openInbox(dir, { pid: 2, handle: "term_b" }, alive), false);
  assert.equal(openInbox(dir, { pid: 2, handle: "term_b" }, dead), true);
  assert.deepEqual(takeFromInbox(dir), []);
  assert.deepEqual(appendToInbox(dir, [32], alive), { handle: "term_b" });
});

test("閉じると、閉じる前に届いていた issue を返して受け口を消し、その後に足そうとすると null", () => {
  const dir = fresh();
  openInbox(dir, { pid: 1, handle: "term_seq" }, alive);
  appendToInbox(dir, [31], alive);
  assert.deepEqual(closeInbox(dir), ["31"]);
  assert.equal(existsSync(dir), false);
  assert.equal(appendToInbox(dir, [32], alive), null);
  assert.deepEqual(closeInbox(dir), []);
});
