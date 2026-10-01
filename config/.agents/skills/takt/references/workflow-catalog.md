# レーンの語彙と builtin カタログ

プロジェクト固有レーンが無く builtin から選ぶときに読む。現在の実在・用途は投入先で確認する。

## 意図の語彙(プロジェクト固有レーンがある場合)

**プロジェクト固有レーン(`.takt/workflows/`)があればその設計に従う**。レーンの命名と意図の語彙(fix / docs / audit / feature など)は
リポジトリごとに違うので、必ず投入先の実在一覧と突き合わせる。

## builtin の選択軸・深度(プロジェクト固有レーンが無い場合)

**builtin だけの場合、選択軸は意図ではなく「対象スタック × 深度」**になる:

- スタック: `frontend` / `backend` / `dual`(両方) / `cli` / `terraform` / 無印(汎用)
- 深度: `simple-*`(最小) → `*-mini`(軽量) → 無印
- 監査・レビューは `audit-*` / `review-*`、調査だけなら `research` / `deep-research`
- takt 自身の開発は `takt-default*`(🎵 TAKT開発 カテゴリ)

builtin の構成(現行版の実在は投入先で確認する):

- **`simple` 系列が 🚀 Quick Start の先頭**。モデルの判断を信じて orchestration を
  最小化する設計で、`simple` / `simple-mini` + スタック別 5 本
- **`default-high` / `dual` は Team Leader に委譲せず直接実装する**。
  leader 経路が欲しいときは `takt-default-team` を明示する
- **QA reviewer は存在しない**(`qa-reviewer` persona / `qa` policy / `qa-review` output contract
  は無く、観点は coding policy にある)。これらを参照する自作 workflow が残っていれば
  投入先として選ぶ前に facet 参照を張り替える

実在するレーンは `.takt/workflows/` とインストールされた takt の `builtins/<language>/workflows/` を確認する。language は設定から選ぶ。builtin の `workflow-categories.yaml` があれば用途と推奨順を照合する。各 YAML の `subworkflow.callable` を確認し、callable な部品や `.takt/steps/` の fragment を直接投入しない。
