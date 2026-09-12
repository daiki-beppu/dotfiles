---
name: free-disk-space
description: macOS の空き容量の計測・回収やメディア退避に使う。--dry-run は計測と計画のみ。
---

# Free disk space

承認された成果物とキャッシュを片付け、`df -h /System/Volumes/Data` の前後差で空き容量を報告する。APFS のルートは封印スナップショット側なので、計測は Data ボリュームで行う。

## 範囲を選ぶ

- 通常: 容量の大きい場所を調べ、成果物・キャッシュ・報告のみの項目に分ける。
- `--builds` / `--caches`: 回収対象を限定する。
- `--nix`: `nh clean all --dry` の見積もりと提案だけ。
- `--archive`: [メディア退避](references/archive.md) を使う。
- `--dry-run`: 全モードで計測・計画だけ。cleanup・コピー・Trash 移動・symlink 作成をしない。

## 調査と回収

現在のプロジェクト配置とパッケージマネージャから大きい場所を絞って `du` で計測する。入れ子の成果物を二重計上しない。具体的な cleanup コマンドや Nix の注意点が必要なら [回収手段](references/cleanup.md) を読む。

サイズと対象を一覧にし、稼働中のプロジェクトへの影響も示す。再生成可能な `node_modules` でも利用中なら作業が止まるため、対象一覧への承認後に回収する。同じ対象への既存承認は再確認しない。

- ビルド成果物は `trash`、キャッシュはツール純正 cleanup を使う。`trash` が無ければ該当項目を未実行とし、他の承認済み処理を続ける。
- ゴミ箱を空にする操作はユーザーが行う。Trash へ移した量を解放済みに数えない。
- worktree の削除判断は `clean-branch` で扱う。空き容量調査だけで削除しない。
- メディアや GUI アプリデータは通常はサイズ報告に留める。退避を依頼された場合だけ対応する参照へ進む。

以下は削除対象から除外する: GUI アプリの Caches / Application Support、音源・ボイスライブラリ、Claude の projects / sessions、iCloud の `~/Library/Mobile Documents`。`/nix/store` を直接操作しない。

## 完了

Data ボリュームを再計測し、即時解放・Trash 内・未実行を区別する。失敗した項目と残件を報告する。APFS の purgeable 領域やスナップショットが影響して容量がすぐ変わらない場合も、見積もりを実測に置き換えない。
