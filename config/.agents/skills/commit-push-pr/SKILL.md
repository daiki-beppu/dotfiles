---
name: commit-push-pr
description: 手元の変更を commit・push・PR 作成／更新から最新 HEAD の CI 成功まで進める。マージは別依頼。
---

# Commit, push, PR

手元の変更を PR にし、最新 head SHA に適用される CI がすべて成功するまで対応する。commit のみなど明示された範囲があれば、その範囲を完了条件にする。

- 差分・ブランチ・既存 PR から今回の変更を特定し、リポジトリの worktree 規約に従う。
- commit・PR・CI 修復に使える導入済みスキルがあれば、該当する場面で読む。既存 stack の操作は `gh-stack`、単独 PR は `git` / `gh` で進める。
- 今回の変更を検証して commit・push し、PR のタイトルと本文を最終差分に合わせる。
- CI の失敗を調査・修正して再 push し、更新された head の結果を確認する。CI の無効化や弱体化で成功させない。

PR URL、最新 head SHA、検証・CI の結果を報告する。CI 未設定・未実行は green と区別し、権限や外部障害が残る場合は未完了部分と必要な対応を示す。マージは別の依頼で扱う。
