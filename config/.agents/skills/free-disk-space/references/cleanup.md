# 回収手段

対象パッケージマネージャの実在と現行 CLI を確認し、承認されたものだけ実行する。

| 対象 | 計測先の取得例 | 回収 |
|---|---|---|
| pnpm | `pnpm store path` | `pnpm store prune` |
| npm | `npm config get cache` | `npm cache clean --force` |
| bun | `~/.bun/install/cache` | `bun pm cache rm` |
| uv | `uv cache dir` | `uv cache prune` |
| Homebrew | `brew --cache` | `brew cleanup --prune=all` |

bun の cache 操作が package.json 不在で失敗する版では、適切な作業ディレクトリから実行するか、承認済みのダウンロードキャッシュのみ `trash` に移す。

成果物を先に Trash へ移し、次にキャッシュを整理する。pnpm のハードリンクが Trash に残る場合など、prune の見積もりどおりに即時解放されるとは限らない。

## Nix

`nh clean all --dry` で見積もる。週次 cleanup の現状は dotfiles の launchd 設定から確認する。`useUserPackages = true` のシステムプロファイルは root 所有なので `nh clean user` だけでは世代を削除できない。

このスキルの `--nix` は見積もりまで。実削除を依頼されたら `nix` スキルの保持ポリシーと権限に従う。store ディレクトリは直接削除しない。

## 容量が変わらないとき

`tmutil listlocalsnapshots /` でローカルスナップショットの有無を確認できる。スナップショット削除を通常のキャッシュ整理に混ぜない。
