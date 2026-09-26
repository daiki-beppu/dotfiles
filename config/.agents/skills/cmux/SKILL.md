---
name: cmux
description: cmux の別 workspace・window の移動や配置変更に使う。呼び出し元内だけの操作は cmux-workspace。
---

# cmux control

別 workspace / window の操作はユーザーが指定した対象に限定する。呼び出し元の環境と画面のフォーカスは一致するとは限らないので、`cmux identify --json` と `list-*` の結果から操作先を特定する。呼び出し元内の操作・helper pane は [cmux-workspace](../cmux-workspace/SKILL.md) に従う。

コマンドと引数は `cmux --help`・`cmux <command> --help`・`cmux guide` を正とする。設定変更は `cmux docs settings` の手順に従う。`cmux` が PATH に無ければ `/Applications/cmux.app/Contents/Resources/bin/cmux` を使う。

作成・移動には `--focus false` を渡し、フォーカス変更はユーザーが依頼した場合だけ行う。永続的な記録には短い ref ではなく UUID（`--id-format uuids`）を使う。操作後に対象の配置や設定を一覧で確認する。
