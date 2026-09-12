# レーンの語彙と builtin カタログ

プロジェクト固有レーンが無く builtin から選ぶときに読む。以下は過去の版での語彙例であり、現在の実在・用途は投入先で確認する。

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

実在するレーンは `.takt/workflows/` とインストールされた takt の `builtins/<language>/workflows/` を確認する。language は設定から選ぶ。builtin の `workflow-categories.yaml` があれば用途と推奨順を照合する。各 YAML の `subworkflow.callable` を確認し、callable な部品や `.takt/steps/` の fragment を直接投入しない。
