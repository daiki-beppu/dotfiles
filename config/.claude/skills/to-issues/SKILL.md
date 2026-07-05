---
name: to-issues
description: |
  plan / spec / PRD を独立した vertical slice の GitHub issue 群に分割して起票するスキル。
  takt workflow で AFK 実装可能な issue 構造（参照資料 / 影響ファイル / 要件 / スコープ外）を出力する。
  「issue に分割して」「plan を issue 化して」「チケット切って」で発動。
---

# To Issues

plan を独立した vertical slice（tracer bullet）の issue 群に分割して起票する。各 issue は takt の plan.md instruction が解釈できる構造で出力し、AFK agent による自動実装を前提とする。

## Process

### 1. Context 収集

会話コンテキストにある plan / spec / PRD から作業する。引数で issue 番号・URL・パスが渡された場合は `gh issue view` で取得する。

```bash
gh repo view --json nameWithOwner
gh label list --json name,description,color
gh issue list --limit 30 --state all --json number,title,labels
```

### 2. コードベース探索（任意）

未探索なら Explore subagent で調査する。issue タイトル・本文はプロジェクトのドメイン用語（CONTEXT.md / ADR）に揃える。

### 3. Vertical slice 分割

plan を **tracer bullet** issue に分割する。各 issue は水平レイヤーの切り出し（「DB だけ」「API だけ」）ではなく、**全レイヤーを貫く薄い垂直スライス**にする。

<vertical-slice-rules>
- 各スライスは全レイヤー（schema / API / UI / テスト）を貫通する完全なパスを 1 本提供する
- 完了すればそれ単体でデモ可能 or 検証可能
- 太いスライスより薄いスライスを多く作る
</vertical-slice-rules>

#### スコープ上限ガード

1 issue あたりのスコープが takt の 1 run で完結するサイズに収まるよう、以下を上限の目安にする:

| 指標 | 上限目安 | 超えた場合 |
|---|---|---|
| 要件数 | **7 件以下** | さらに分割 |
| 影響ファイル数 | **9 ファイル以下** | さらに分割 |
| 独立した機能領域 | **1 つだけ** | 領域ごとに分割 |

上限を超えそうなスライスは分割を優先する。「薄すぎて 1 issue にする意味がない」レベルまで細かくする必要はないが、**太すぎて takt が発散する** 方がコスト大。

スライスは HITL（人手判断が必要）または AFK（自動実装可能）に分類する。AFK を優先。

### 4. ユーザー確認

分割案を番号付きリストで提示する:

- **タイトル**: 短い日本語タイトル（50 文字以内。takt-issue の PR タイトルに直結するためスコープを正確に反映）
- **種別**: HITL / AFK
- **依存**: 先行する他スライス（あれば）
- **要件数 / 影響ファイル数**: スコープの目安（上限ガードの根拠）

確認事項:
- 粒度は適切か（粗すぎ / 細かすぎ）
- 依存関係は正しいか
- さらに統合・分割すべきスライスはあるか
- HITL / AFK の分類は正しいか

承認されるまで反復する。

### 5. Issue 起票

承認済みスライスを依存順（blocker 先行）で `gh issue create` する。本文は以下の **takt 互換テンプレート** に従う。

<issue-template>

```markdown
## 親 issue

#<N>（元の plan / spec / PRD の issue。存在しない場合は省略）

## 概要

この vertical slice が提供する end-to-end の振る舞いを 1-3 文で説明する。レイヤー別の実装手順ではなく、ユーザー視点の動作を記述する。

## 背景・目的

（任意。親 issue で説明済みなら「親 issue 参照」で十分）

## 参照資料

（実装時に読むべきファイル・ディレクトリを相対パス箇条書きで列挙。takt の plan instruction が自動抽出して Read/Glob で開く）
- path/to/relevant-file.ts
- path/to/relevant-dir/

ファイルが特定できない場合は `(plan step で確定する)` と明記する。

## 影響ファイル

（スコープ明示。新規 / 変更 / 削除を区別）
- **新規**: path/to/new.ts
- **変更**: path/to/existing.ts

特定できない場合は `(plan step で確定する)` と明記する。

## 要件

（完了条件。番号付きリストで、各項目を「入力/操作 → 期待される観測結果」の検証可能な受入条件として書く）
1. ◯◯を実行する → △△が出力される
2. 設定キー □□ を追加する → default 値と override 値の両方が観測可能に効く

## スコープ外

（Non-goals。別 issue 化の境界を明示する。**省略不可**）
- ◯◯は本 issue では扱わない（→ #<sibling-issue> で対応）
- △△の改修は対象外

## 依存

- #<blocking-issue>（先行する sibling の issue 番号）

または「なし — すぐ着手可能」

## 実装方針（takt）

- workflow: default-mini / default / 不要（手動実装が妥当）
- 理由: ...
```

</issue-template>

#### テンプレートルール

- **`## 参照資料`**: 相対パスで箇条書き。takt の plan.md が regex 抽出するため形式厳守。具体的なファイルパスやコードスニペットは避けるという旧テンプレートの方針より、**takt の plan 品質を優先** する。ただしスニペットを貼る場合はプロトタイプ由来の設計判断に限定し、意思決定を体現する部分のみ（動くデモの全文ではなく）
- **`## 要件`**: チェックリスト形式（`- [ ]`）ではなく番号付きリスト（`1.`）で書く。各項目は「入力/操作 → 期待される観測結果」の検証可能な受入条件にする（実装者が充足表で 1 対 1 照合できる粒度。「〜を改善する」のような観測結果のない要件は書かない）。「設定可能に（デフォルト N）」型の要求は「default 値と override 値の両方が観測可能に効くこと」まで書く
- **`## スコープ外`**: 省略不可。兄弟スライスの担当範囲を明記することで、takt が隣のスライスの仕事を取り込むのを防ぐ
- **`## 実装方針（takt）`**: スライスの特徴から `default` / `default-mini` / `不要` を判断。bugfix / chore / 少ファイル → `default-mini`、feature / テスト先行が価値を持つ → `default`、1 行修正 → `不要`。迷ったら `default-mini`
- **タイトル**: 日本語で簡潔に（50 文字以内）。`[prefix] 説明` 形式を推奨（例: `[#1143-01a] feat: shared/constants.ts に定数追加`）。takt-issue が PR タイトルに転用する

#### ラベル

`issue` スキルと同じラベル運用に従う:
- カテゴリラベル: `bug` / `enhancement` / `refactor` / `chore` / `documentation`
- takt ラベル: `takt:default` / `takt:default-mini` / `takt:manual`
- 過去 issue の共通ラベル（出現率 80% 以上）

親 issue を close したり変更したりしない。
