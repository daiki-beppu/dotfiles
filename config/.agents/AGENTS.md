# 開発ワークフロー

## worktree

開発作業（コード編集・コミット・PR 化）は、Orca で作った worktree 上で行う。メインチェックアウトは並行する他の作業が使っている。

```sh
git fetch origin
orca worktree create --repo name:<repo> --name <slug> --base-branch origin/main
```

古い main から切ると、main に入っている変更を再実装してしまい、マージ時まで気付けない。repo が Orca に未登録なら `orca repo add` で登録する。

worktree には gitignore 済みの `.env` 等が無い。Orca の worktree へは repo の setup script でコピーする。エージェントが作る worktree（サブエージェントの isolation 等。Codex と共通）向けには、リポジトリルートの `.worktreeinclude`（`.gitignore` 構文）に列挙する。

## Wayfinder 完了後の起票

map と決定 ticket を `to-spec` で仕様にまとめ、`to-tickets` で実装 issue に分割して起票する（仕様が完成済みなら `to-tickets` から）。実装全体の目的・仕様への参照・完了条件を持つ親 issue を作り（同じ範囲の親があれば再利用）、全実装 issue を GitHub ネイティブの sub-issue として紐付ける。親から sub-issue 一覧を取得して紐付けを確認し、親と子の URL を報告する。
