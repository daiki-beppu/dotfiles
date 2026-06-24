---
name: issue-organize
description: |
  open な GitHub issue を sub-issue 階層に整理するスキル。カテゴリ分類 → 親 issue 作成 → GraphQL addSubIssue 接続 → [category] プレフィックス付与 → 重複 close → 検証を一気通貫で実行する。
  「issue 整理」「issue を整理して」「sub-issue でまとめて」「sub-issue 化」「issue をカテゴリ分け」「orphan issue を整理」「プレフィックス付けて」で発動。
  既存 issue の閲覧・再構造化専用。新規 issue 作成は /issue、plan 分割は /to-issues を使う。
---

# issue-organize

open な GitHub issue を sub-issue 階層 + カテゴリプレフィックスで整理する。

## Process

### 1. Survey — 全 open issue を収集

```bash
OWNER=$(gh repo view --json owner --jq '.owner.login')
REPO=$(gh repo view --json name --jq '.name')
gh issue list --state open --limit 200 --json number,title,labels \
  --jq '.[] | "\(.number)\t\(.title)\t\(.labels | map(.name) | join(","))"'
```

既存の sub-issue 構造も確認する:

```bash
gh api graphql -f query='{ repository(owner: "OWNER", name: "REPO") {
  issues(first: 20, states: OPEN, labels: ["epic"]) {
    nodes { number title subIssues(first: 50) { totalCount nodes { number title state } } }
  }
} }'
```

### 2. Categorize — ユーザーとカテゴリを決定

ユーザーに以下を確認する:
- **カテゴリ名** と **プレフィックス** (例: `feedback`, `audit`, `ts-rewrite`)
- 各カテゴリに含める **issue の選定基準** (ラベル / issue 番号リスト / 条件)
- 既存の親 issue を使うか、新規作成するか
- `defer-until-ts-rewrite` 等の横断ラベルの扱い

AskUserQuestion で選択肢を提示し、曖昧な分類は確認してから進める。

### 3. Create parents — 親 issue を作成

リポジトリの既存 epic フォーマットに合わせる。フォーマットが不明な場合は既存 epic の body を 1 件読んで踏襲する。

デフォルトテンプレート:

```markdown
title: [prefix] descriptive title
labels: epic + category label

body:
## 完了条件

(カテゴリに応じた完了基準)

## 参照

(sub-issue のサマリやリンク)
```

### 4. Connect — sub-issue を接続

`gh issue edit --add-sub-issue` は未サポート。GraphQL `addSubIssue` mutation を使う。

```bash
# node_id 取得
PARENT_ID=$(gh api repos/$OWNER/$REPO/issues/$PARENT --jq '.node_id')
CHILD_ID=$(gh api repos/$OWNER/$REPO/issues/$CHILD --jq '.node_id')

# sub-issue 追加
gh api graphql -f query="mutation {
  addSubIssue(input: { issueId: \"$PARENT_ID\", subIssueId: \"$CHILD_ID\" }) {
    issue { number } subIssue { number }
  }
}"
```

バッチ処理では `add_sub_issue()` ヘルパー関数を定義してループ実行する:

```bash
add_sub_issue() {
  local parent=$1 child=$2
  local parent_id=$(gh api repos/$OWNER/$REPO/issues/$parent --jq '.node_id')
  local child_id=$(gh api repos/$OWNER/$REPO/issues/$child --jq '.node_id')
  local result=$(gh api graphql -f query="mutation { addSubIssue(input: { issueId: \"$parent_id\", subIssueId: \"$child_id\" }) { issue { number } subIssue { number } } }" 2>&1)
  if echo "$result" | rg -q '"number"'; then
    echo "OK: #$child → #$parent"
  else
    echo "SKIP: #$child (already has parent or duplicate)"
  fi
}
```

**制約**: 1 つの issue に親は 1 つだけ。既に親を持つ issue は SKIP（エラーではない）。

### 5. Prefix — タイトルにプレフィックスを付与

```bash
gh issue edit $NUMBER --title "[category] existing title"
```

ルール:
- 既に `[xxx]` プレフィックスがある issue は**既存プレフィックスを置換**する
- `feat(xxx):` 等の conventional prefix は除去して `[category]` に統一
- `P1:` / `P0-6:` 等のドメイン固有プレフィックスは**残す**（`[audit] P1: ...` の形）
- 親 issue 自体にもプレフィックスを付ける

### 6. Cleanup — 重複検出

同一タイトル・同一 body の issue を検出し、ユーザー確認後に close:

```bash
gh issue close $NUMBER --comment "Duplicate of #$ORIGINAL" --reason "not planned"
```

### 7. Verify — 接続結果を確認

```bash
for n in $PARENT_NUMBERS; do
  gh api graphql -f query="{ repository(owner: \"$OWNER\", name: \"$REPO\") {
    issue(number: $n) { title subIssues { totalCount } }
  } }" --jq ".data.repository.issue | \"#$n \(.title): \(.subIssues.totalCount) sub-issues\""
done
```

結果を表形式でユーザーに表示する。

## Rules

- **破壊的操作（close / title 変更）はバッチ実行前にプレビューを表示し、ユーザー承認を得る**
- sub-issue 接続の「already has parent」エラーは正常系として SKIP 処理する（既に整理済み）
- 200 件超の issue は `--limit` を引き上げるか複数回取得する
- issue が多い場合はカテゴリごとに段階実行し、各段階で結果を報告する
- 親 issue のフォーマットは既存 epic に合わせる（リポジトリ慣習を踏襲）
- プレフィックスは `[category]` 角括弧形式に統一する
