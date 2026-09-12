# Nix 世代整理

整理依頼のときだけ読む。Determinate Nix (`nix.enable = false`) の環境では nix-darwin の `nix.gc` / `nix.optimise` の代わりに `nh` を使う。現在の自動実行は `flake.nix` の launchd 設定を確認する。

保持方針は直近 30 日の全世代と、それ以前の最低 1 世代。異なる方針を依頼された場合はその範囲を確認する。

```bash
nh clean all --dry --keep 1 --keep-since 30d
sudo nh clean all --keep 1 --keep-since 30d --optimise
```

見積もりを確認し、依頼された削除範囲で実行する。`--dry-run` は最初のコマンドだけ。システムプロファイルの整理には root が必要。`--keep-one` は direnv プロジェクトごとの gcroot 保持であり、世代数の `--keep <N>` と異なる。

`/nix/store` を直接削除しない。結果と保持・削除した世代を確認して報告する。
