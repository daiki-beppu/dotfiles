# 選択肢があるときの判断基準

既存プロジェクトでは、そのプロジェクトの設計とツール選択に従う。以下は新規に選ぶときの基準。

- JS/TS のツールチェーンとパッケージ管理は vite-plus（`vp`）。
- Node は 24 以上（LTS）を前提にする。
- 開発環境は各言語の標準ツールで用意する。Nix はこの Mac のホスト管理専用で、プロジェクトには flake.nix を置かない。
- PR は `gh stack` で積む。

## 作業場所: Orca の worktree

開発作業（コード編集・コミット・PR 化）は、Orca で作った worktree 上で行う。メインチェックアウトは並行する他の作業が使っている。

```sh
git fetch origin
orca worktree create --repo name:<repo> --name <slug> --base-branch origin/main
```

古い main から切ると、main に入っている変更を再実装してしまい、マージ時まで気付けない。repo が Orca に未登録なら `orca repo add` で登録する。

worktree には gitignore 済みの `.env` 等が無い。Orca の worktree へは repo の setup script でコピーする。エージェントが作る worktree（サブエージェントの isolation 等。Codex と共通）向けには、リポジトリルートの `.worktreeinclude`（`.gitignore` 構文）に列挙する。

## 起票の束ね方: 仕様 → 親 issue + sub-issue

実装を複数 issue に分けて起票するときは、先に仕様を issue にまとめる（完成済みの仕様があればそれを使う）。次に仕様とは別の親 issue を作り、本文に目的・仕様への参照・完了条件を書く（同じ範囲の親があれば再利用）。全実装 issue を GitHub ネイティブの sub-issue として親に紐付け、親から sub-issue 一覧を取得して確認し、親と子の URL を報告する。
