# Native sub-issue の接続

`--parent <N>` または親子関係を要求された場合に使う。本文中のリンクだけでは native sub-issue にならない。

親と子の node ID を取得し、GraphQL `addSubIssue` の `issueId` に親、`subIssueId` に子を渡す。`gh api repos/<owner>/<repo>/issues/<N> --jq .node_id` で ID を取得できる。

```graphql
mutation($parent: ID!, $child: ID!) {
  addSubIssue(input: { issueId: $parent, subIssueId: $child }) {
    issue { number }
    subIssue { number }
  }
}
```

接続後に親の sub-issue 一覧をページネーション込みで取得し、対象の子が揃っていることを確認する。失敗時は既存の関係を確認し、未接続分だけ再試行する。親子 URL と未完了の接続を報告する。
