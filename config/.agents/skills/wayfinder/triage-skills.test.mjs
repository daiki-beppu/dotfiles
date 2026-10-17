import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// 案内役（guide）やスキルの読み込みが機械的に読む形だけを確かめる。
// 対象は frontmatter と、wayfinder の `## 仮決め` コードブロックの形。自然言語の本文は固定しない。
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const wayfinder = read("./SKILL.md");
const grilling = read("../grilling/SKILL.md");

function fencedBlocks(text) {
  return [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------- wayfinder

test("wayfinder: frontmatter（name と disable-model-invocation）を維持する", () => {
  assert.match(wayfinder, /^---\nname: wayfinder\n/);
  assert.match(wayfinder.split("\n---\n")[0], /^disable-model-invocation: true$/m);
});

// 仮決めの書き方（resolution コメント）

const PROVISIONAL_LINE_ORDER = ["## 仮決め", "### ", "- 答え:", "- 振り分け:", "- 理由:", "- 根拠:"];
const provisionalBlocks = () => fencedBlocks(wayfinder).filter((b) => b.split("\n").some((l) => l === "## 仮決め"));

test("wayfinder: 仮決めの書き方が 1 つの形に決まっている（見出し → 問い → 答え・振り分け・理由・根拠の順）", () => {
  const blocks = provisionalBlocks();
  assert.ok(blocks.length >= 1, "## 仮決め を含むコードブロックがない");
  for (const b of blocks) {
    // 行頭から探して、項目が決まった順で現れる
    const lines = b.split("\n");
    let from = 0;
    for (const prefix of PROVISIONAL_LINE_ORDER) {
      const i = lines.findIndex((l, idx) => idx >= from && (prefix === "## 仮決め" ? l === prefix : l.startsWith(prefix)));
      assert.ok(i >= 0, `"${prefix}" が順序どおりに見つからない:\n${b}`);
      from = i + 1;
    }
  }
});

test("wayfinder: 仮決めの形に具体例が 1 つ以上あり、振り分けの値は ⓪ か ③ だけ", () => {
  const blocks = provisionalBlocks();
  const examples = blocks.filter((b) => !/<[^>\n]+>/.test(b));
  assert.ok(examples.length >= 1, "プレースホルダを含まない具体例がない");
  for (const b of blocks) {
    for (const l of b.split("\n").filter((x) => x.startsWith("- 振り分け:"))) {
      const v = l.slice("- 振り分け:".length).trim();
      assert.ok(v === "⓪" || v === "③" || /^<.+>$/.test(v), `振り分けの値が不正: ${l}`);
    }
  }
  for (const b of examples) {
    assert.match(b, /^- 振り分け: [⓪③]$/m);
  }
});

// ---------------------------------------------------------------- grilling

test("grilling: frontmatter の name を維持する", () => {
  assert.match(grilling, /^---\nname: grilling\n/);
});
