---
name: clean-branch
description: 不要な Git ブランチ・worktree の調査と一括削除に使う。--dry-run は一覧提示のみ。
---

# Clean branch

削除対象と失われる作業を調べ、承認された対象を削除し、残件を確認する。

## 範囲

- `--dry-run`: 調査と分類一覧だけ。fetch は `--no-prune` を使い、prune・remove・push を実行しない。
- `--local` / `--remote`: ローカル／リモートに限定する。
- `--worktrees`: worktree だけを扱い、ブランチは削除しない。
- `--merged-only`: MERGED だけ。`--include-no-pr`: NO_PR も候補に含めるが、安全確認は省略しない。

`--dry-run` は他のフラグに優先する。スコープ指定は削除対象一覧への承認を免除しない。同じ対象の既存承認は有効とし、追加対象や新たに判明した損失だけ確認する。

## 分類と削除判断

デフォルトブランチ、対象ブランチの現在の tip、PR、worktree の対応を確認する。削除対象外のブランチまで詳細調査する必要はない。

マージ判定は PR state を主な根拠にする。`git branch --merged` だけでは squash / rebase マージを拾えない。ブランチ名の再利用やマージ後の追加コミットがあれば、現在の tip がその PR と対応するか確かめる。

| 分類 | 判断 |
|---|---|
| MERGED | 現在の tip までの作業が統合済みか確認 |
| CLOSED | 未マージ作業の内容と損失を確認。close だけで安全と扱わない |
| OPEN | 削除対象外 |
| NO_PR | 未統合作業を個別に調べる |
| 未確認 | API 失敗・取得上限など。NO_PR と区別し、削除しない |

デフォルトブランチは保護する。PR の一覧は必要に応じてページネーションまたは対象ブランチ別の検索で補完する。

worktree ごとに未コミット変更・未追跡ファイル・未 push／未統合コミットを確認する。`.claude/worktrees/` にあることや古いことだけで不要と判断しない。`git worktree prune --dry-run -v` は登録残骸の調査に使える。

## 実行と完了

対象、分類、削除前 SHA、失われる作業を一覧にする。未承認ならこの具体的な一覧への承認を得る。tag・stash・reflog の整理や rebase は対象に含めない。

1. 承認済みの worktree を `git worktree remove <path>` で削除する。`--force` は失われる変更まで承認済みの場合だけ使う。
2. ローカルブランチを削除する。squash マージで `-d` が拒否する場合は、調査済みの tip と承認を確認して `-D` を使う。
3. 承認済みのリモートブランチを `git push <remote> --delete <branch>` で削除する。登録の prune も承認範囲に含める。

ブランチと worktree の一覧を再取得し、削除・失敗・未実行と対象外の保持を確認する。復元が必要なら削除前 SHA や PR の Restore branch を案内する。reflog の保存や復元可能期間は保証しない。
