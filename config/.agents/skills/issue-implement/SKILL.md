---
name: issue-implement
description: >-
  GitHub issue を実装し、gh-stack で PR 化して CI green + ready for review まで進める。
  単一 issue の対応、親 issue の未完了の子 issue 全件を依存順に実装するときに使う。
  takt への投入は takt スキル、マージは別の依頼で扱う。
---

# issue-implement

GitHub issue の実装を Matt Pocock の `implement` に、ブランチと PR の管理を `gh-stack` に従って進める。

## スタックを用意する

親 issue が指定されたら、ページネーションを含めて子 issue を全件取得し、未完了の子を全て対象にする。
明示された対象の限定があればそれに従う。各子の本文、GitHub の blocking 関係、既存 PR を確認し、
対象一覧を依存順に並べる。1 子 issue = 1 ブランチ = 1 PR として積む。単一 issue は 1 段として扱う。

blocker や循環で進めない子も対象一覧に残し、未対応の理由と依存先を明示する。
着手可能な子は続け、既存 PR がある子はその作業を再利用して完了条件を確認する。

`gh-stack` スキルを読み、リポジトリの worktree 規約に従って作業場所を用意する。
既存スタックなら再利用し、新規なら `gh stack init`、上段の追加は `gh stack top` → `gh stack add` を使う。

## 各段を実装する

Matt Pocock の [implement](https://github.com/mattpocock/skills/blob/main/skills/engineering/implement/SKILL.md) を読んで実装する。
導入済みならその `implement/SKILL.md` を使い、無ければリンク先の原文を取得して読む。
対象 issue とリポジトリの規約、現在の段のブランチを入力として渡す。
実装・テスト・レビュー・コミットの進め方は同スキルを正とする。

実装を委任する場合も `implement` の参照先を渡す。ブランチ移動と PR 操作は呼び出し元が行い、
同じ worktree での実装完了を待ってから次段へ進む。

## PR と CI

`gh stack submit --auto` で draft PR を作り、各 PR のタイトルと本文を変更内容に合わせて編集する。
本文に `Closes #<issue番号>` を記し、既存のスタック情報と動画エビデンス欄を保持する。

[動画エビデンス](references/evidence.md) に従って各段の最終変更を録画・添付する。
ブラウザで確認できる変更が無ければ、対象外の理由と代わりの検証を本文に記す。

各 PR の最新 HEAD の CI と conflict を確認する。GitHub Actions の監視に権限上の制約がある場合は
[watch-pr-actions.sh](references/watch-pr-actions.sh) を使う（引数: PR 番号、間隔秒、期限秒）。
同スクリプトは Actions のみを監視するため、外部の required check は別途確認する。

失敗は下段から修正し、`gh stack rebase --upstack` → `gh stack push` で上段へ伝播させる。
conflict と同期の復旧は `gh-stack` に従う。変更された段は CI と動画の鮮度を再確認する。

## 完了

対象一覧の全件について、最新 HEAD の CI 成功、conflict なし、PR 本文の動画 URL と再生（または対象外の理由）を確認し、
各 PR を `gh pr ready` で ready にするまで継続する。一部の PR が完了しても親 issue 全体の完了とはしない。
未解決の段は draft に保ち、PR 未作成の子も含めて未対応の issue 番号・理由・blocker を報告する。
issue / PR URL、検証結果、動画 URL または対象外の理由を報告し、worktree を残す。
マージと worktree 削除は含めない。
