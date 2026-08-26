# レーンの語彙と builtin カタログ

フェーズ 2「内容からの判定」で、プロジェクト固有レーンが無く builtin から選ぶときに読む。
callable sub-workflow の判別レシピと素通り挙動の説明は SKILL.md 本文側に残っている
(毎回の投入で通す branch のため)。

## 意図の語彙(プロジェクト固有レーンがある場合)

**プロジェクト固有レーンがあればその設計に従う**。意図別レーンは `<prefix>-<意図>` の命名で、
prefix はリポジトリごとに違う(`yt-auto-` / `tayk-`)。**意図の語彙も揃っていない**:

| 状況 | 意図の語 | 実在例 |
| --- | --- | --- |
| 壊れている(バグ・回帰) | `fix` | `yt-auto-fix` / `tayk-fix` |
| コードを変えず文書 / skill だけ | `docs` | `yt-auto-docs`(tayk には無い) |
| 挙動を変えずに構造を変える(refactor) | `maintenance` | `yt-auto-maintenance`(tayk には無い) |
| 調査して報告するだけ | `audit` | `yt-auto-audit` / `tayk-audit-architecture` |
| workflow / facet / 実行トレース自体を点検する | `audit-runs` | `tayk-audit-runs` / `yt-auto-audit-runs`(`00-automation` のみ) |
| それ以外(新機能・機能拡張) | `feature` | `yt-auto-feature` / `tayk-feature` |

この表は**語彙の対応であって実在の保証ではない**。同じ意図の語が全リポジトリにあるとは限らない
(実測: `docs` / `maintenance` は yt-auto 系にしか無く、`audit-runs` は yt-auto 系でも
リポジトリによって有無が分かれる)。必ず実在一覧と突き合わせる。

## builtin の選択軸・深度(プロジェクト固有レーンが無い場合)

**builtin だけの場合、選択軸は意図ではなく「対象スタック × 深度」**になる:

- スタック: `frontend` / `backend` / `dual`(両方) / `cli` / `terraform` / 無印(汎用)
- 深度: `simple-*`(最小) → `*-mini`(軽量) → 無印
- 監査・レビューは `audit-*` / `review-*`、調査だけなら `research` / `deep-research`
- takt / tayk 自身の開発は `takt-default*`(🎵 TAKT開発 カテゴリ)

0.54〜0.55 で builtin の構成が動いたので、以前の選び方をそのまま持ち込まない:

- **`simple` 系列が 🚀 Quick Start の先頭に来た**。モデルの判断を信じて orchestration を
  最小化する設計で、`simple` / `simple-mini` + スタック別 5 本
- **`default-high` / `dual` は Team Leader 委譲をやめて直接実装するようになった**。
  leader 経路が欲しいときは `takt-default-team` を明示する
- **QA reviewer は撤去された**(`qa-reviewer` persona / `qa` policy / `qa-review` output contract
  が削除され、観点は coding policy に統合)。これらを参照する自作 workflow が残っていれば
  投入先として選ぶ前に facet 参照を張り替える

本数・実名の一覧はここには書かない(takt の更新のたび黙って腐るため)。実在するレーン・
builtin カタログ・callable の実名は SKILL.md 本文のレシピ(`ls .takt/workflows/`、
`ls "$BUILTIN/workflows/"`、`grep -l "callable: true" *.yaml`)をその場で実行して確認する。
