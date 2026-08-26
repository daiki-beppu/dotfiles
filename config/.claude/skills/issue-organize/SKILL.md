---
name: issue-organize
description: |
  open な GitHub issue 群を sub-issue 階層 + addBlockedBy 依存チェーン + [category] プレフィックスに整理する。
  「issue 整理」「sub-issue 化」「プレフィックス付けて」で発動。
  既存 issue の再構造化専用 — 新規作成・分割起票は /issue(分割は --split)を使う。
---

# issue-organize

open な GitHub issue を sub-issue 階層 + 依存チェーン + カテゴリプレフィックスで整理する。依存チェーンは実装時にそのまま gh-stack のスタックの積み順になる。

## 実行スタイル

- **バッチは自分で回す**: 分類・接続・プレフィックス付与を subagent に分散しない。`gh` 呼び出しの列挙であり、委任するとユーザー承認の所在が分裂する
- **実況しない**: 進捗は段階ごとに1つの表で示す。issue 1件ごとの成否を逐一書かない
- **スコープを広げない**: 依頼されたカテゴリの整理だけ行う。ついでのラベル整理・本文書き換え・open issue の内容修正はしない

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
- **子 issue 間の実装順** — 依存があるものは `blockedBy` で直列に繋ぐ。それがそのまま gh-stack の積み順になる

AskUserQuestion で選択肢を提示し、曖昧な分類は確認してから進める。

### 3. Create parents — 親 issue を作成

リポジトリの既存 epic フォーマットに合わせる。フォーマットが不明な場合は既存 epic の body を 1 件読んで踏襲する。body は完了条件と sub-issue への参照だけを置き、子 issue の内容を要約し直さない(子側と二重管理になる)。

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

### 4. Connect — 階層と依存を接続

sub-issue の親子は**階層**であって依存関係ではない。実装順は別に `addBlockedBy` で表し、**両方を持たせる**。

#### 4-a. 階層を接続する — `addSubIssue`

`gh issue edit --add-sub-issue` は未サポート。GraphQL `addSubIssue` mutation を使う。

```bash
# node ID 取得(gh issue view の id がそのまま GraphQL node ID)
PARENT_ID=$(gh issue view "$PARENT" --json id --jq .id)
CHILD_ID=$(gh issue view "$CHILD" --json id --jq .id)

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
  local parent_id=$(gh issue view "$parent" --json id --jq .id)
  local child_id=$(gh issue view "$child" --json id --jq .id)
  local result=$(gh api graphql -f query="mutation { addSubIssue(input: { issueId: \"$parent_id\", subIssueId: \"$child_id\" }) { issue { number } subIssue { number } } }" 2>&1)
  if echo "$result" | rg -q '"number"'; then
    echo "OK: #$child → #$parent"
  else
    echo "SKIP: #$child (already has parent or duplicate)"
  fi
}
```

**制約**: 1 つの issue に親は 1 つだけ。既に親を持つ issue は SKIP（エラーではない）。

#### 4-b. 依存を接続する — `addBlockedBy`

同じ親の子同士に実装順の依存があるなら `addBlockedBy` を張る。**この依存チェーンがそのまま gh-stack の積み順になる**（1段目 = blocker を持たない子）。

```bash
add_blocked_by() {
  local blocked=$1 blocker=$2   # blocked を blocker が塞ぐ(blocker を先に実装する)
  local blocked_id=$(gh issue view "$blocked" --json id --jq .id)
  local blocker_id=$(gh issue view "$blocker" --json id --jq .id)
  local result=$(gh api graphql -f query='
    mutation($issueId:ID!,$blockingIssueId:ID!){
      addBlockedBy(input:{issueId:$issueId, blockingIssueId:$blockingIssueId}){
        issue{ number issueDependenciesSummary{ totalBlockedBy } }
      }
    }' -F issueId="$blocked_id" -F blockingIssueId="$blocker_id" 2>&1)
  if echo "$result" | rg -q 'totalBlockedBy'; then
    echo "OK: #$blocked blocked by #$blocker"
  else
    echo "FAIL: #$blocked ← #$blocker ($result)"
  fi
}
```

ルール:

- **親 issue には `blockedBy` を張らない**。親は器であって PR を持たず、スタックの段にならない
- **依存が無い子同士は並列**であり、別々のスタックになる。gh-stack のスタックは線形（1つの段が持てる子は1つ）なので、順序の必然性が無いものを直列化しない
- 依存関係は**本文に `Blocked by` と書かない**。ネイティブ側を唯一の正とする（2箇所に持つと食い違う）
- 誤って張った依存は `removeBlockedBy` を同じ引数で呼べば外せる

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

### 7. 結果を報告

接続の成否は Step 4 の `add_sub_issue()` / `add_blocked_by()` が返す OK / SKIP / FAIL が正なので、再照会で検算し直さない。ユーザーに見せるサマリ表を組むためだけに親ごとの件数を取る:

```bash
for n in $PARENT_NUMBERS; do
  gh api graphql -f query="{ repository(owner: \"$OWNER\", name: \"$REPO\") {
    issue(number: $n) { title subIssues { totalCount } }
  } }" --jq ".data.repository.issue | \"#$n \(.title): \(.subIssues.totalCount) sub-issues\""
done
```

結果を表形式でユーザーに表示する。あわせて、張った依存を**積み順**として提示する。実装側はこれをそのまま gh-stack のスタックとして積む。

```
#12 (blocker なし)         → 1段目
 └── #13 (blocked by #12)  → 2段目
      └── #14 (blocked by #13) → 3段目
```

依存の無い子は別スタックになるため、チェーンごとに分けて示す。

## Rules

- **破壊的操作（close / title 変更）はバッチ実行前にプレビューを表示し、ユーザー承認を得る**
- sub-issue 接続の「already has parent」エラーは正常系として SKIP 処理する（既に整理済み）
- 階層（`addSubIssue`）と依存（`addBlockedBy`）は別物として両方張る。親 issue には依存を張らない（親は段にならない）
- 依存チェーンは gh-stack の積み順そのものなので、順序の必然性が無い子同士を直列化しない（並列な子は別スタックになる）
- 200 件超の issue は `--limit` を引き上げるか複数回取得する
- issue が多い場合はカテゴリごとに段階実行し、各段階で結果を報告する
- 親 issue のフォーマットは既存 epic に合わせる（リポジトリ慣習を踏襲）
- プレフィックスは `[category]` 角括弧形式に統一する
