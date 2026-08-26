# --organize: 既存 open issue 群の再構造化

open な issue を sub-issue 階層 + `addBlockedBy` 依存チェーン + `[category]` プレフィックスに整理する。依存チェーンはそのまま gh-stack のスタックの積み順になる(1 段目 = blocker を持たない子)。

バッチは subagent に分散せず自分で回す(`gh` 呼び出しの列挙であり、委任するとユーザー承認の所在が分裂する)。スコープは依頼されたカテゴリの整理のみ — ついでのラベル整理・本文の書き換えはしない。

## 1. 現状を取り、方針を合意する

```bash
gh issue list --state open --limit 200 --json number,title,labels \
  --jq '.[] | "\(.number)\t\(.title)\t\(.labels | map(.name) | join(","))"'
```

既存の sub-issue 構造:

```bash
gh api graphql -f query='
query($owner:String!,$repo:String!){
  repository(owner:$owner,name:$repo){
    issues(first:20,states:OPEN,labels:["epic"]){
      nodes{ number title subIssues(first:50){ totalCount nodes{ number title state } } }
    }
  }
}' -F owner=<owner> -F repo=<repo>
```

ユーザーと合意するもの: カテゴリ名とプレフィックス / 各カテゴリの選定基準 / 親は既存 issue か新規作成か / 子 issue 間の実装順(= 依存チェーン)。曖昧な分類は AskUserQuestion で確認してから進める。

## 2. 親 issue を作る

既存 epic の body を 1 件読んで書式を踏襲する。body には完了条件と sub-issue への参照だけを置き、子 issue の内容を要約し直さない(子側との二重管理になる)。親のタイトルにも `[category]` プレフィックスを付ける。

## 3. 階層と依存を接続する

親子(`addSubIssue`)は**階層**、実装順(`addBlockedBy`)は**依存**。別物として両方張る。どちらも `gh issue edit` 未サポートのため GraphQL mutation を使い、バッチではヘルパーをループで回す:

```bash
add_sub_issue() {   # add_sub_issue <親番号> <子番号>
  local parent_id child_id result
  parent_id=$(gh issue view "$1" --json id --jq .id)
  child_id=$(gh issue view "$2" --json id --jq .id)
  result=$(gh api graphql -f query="mutation { addSubIssue(input: { issueId: \"$parent_id\", subIssueId: \"$child_id\" }) { issue { number } subIssue { number } } }" 2>&1)
  if echo "$result" | rg -q '"number"'; then echo "OK: #$2 → #$1"
  else echo "SKIP: #$2 (already has parent or duplicate)"; fi
}

add_blocked_by() {  # add_blocked_by <塞がれる番号> <塞ぐ番号> — 塞ぐ側を先に実装する
  local blocked_id blocker_id result
  blocked_id=$(gh issue view "$1" --json id --jq .id)
  blocker_id=$(gh issue view "$2" --json id --jq .id)
  result=$(gh api graphql -f query='
    mutation($issueId:ID!,$blockingIssueId:ID!){
      addBlockedBy(input:{issueId:$issueId, blockingIssueId:$blockingIssueId}){
        issue{ number issueDependenciesSummary{ totalBlockedBy } }
      }
    }' -F issueId="$blocked_id" -F blockingIssueId="$blocker_id" 2>&1)
  if echo "$result" | rg -q 'totalBlockedBy'; then echo "OK: #$1 blocked by #$2"
  else echo "FAIL: #$1 ← #$2 ($result)"; fi
}
```

- 1 issue に親は 1 つだけ。「already has parent」は SKIP であってエラーではない(既に整理済み)
- **親 issue に `blockedBy` を張らない**(親は器で PR を持たず、スタックの段にならない)
- **依存の無い子同士は直列化しない**。gh-stack のスタックは線形なので、順序の必然性が無い子は並列のまま別スタックになる
- 依存を本文に `Blocked by` と書かない(2 箇所に持つと食い違う — ネイティブ側が唯一の正)。誤った依存は `removeBlockedBy` を同じ引数で呼べば外せる

## 4. プレフィックスを付け、重複を閉じる

```bash
gh issue edit <N> --title "[category] 既存タイトル"
```

- 既存の `[xxx]` は置換、`feat(xxx):` 等の conventional prefix は除去して `[category]` に統一
- `P1:` 等のドメイン固有プレフィックスは残す(`[audit] P1: ...` の形)

同一タイトル・同一 body の重複は close する:

```bash
gh issue close <N> --comment "Duplicate of #<原本>" --reason "not planned"
```

**close / title 変更はバッチ実行前に対象一覧をプレビューし、ユーザー承認を得てから流す。**

## 5. 結果を報告する

接続の成否はヘルパーの OK / SKIP / FAIL が正 — 再照会で検算しない。issue 1 件ごとに実況せず、段階ごとに 1 つの表で示す。依存チェーンは積み順ツリーとしてチェーンごとに提示する(実装側はこれをそのまま gh-stack のスタックに積む):

```
#12 (blocker なし)            → 1 段目
 └── #13 (blocked by #12)     → 2 段目
```
