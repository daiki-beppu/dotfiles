---
name: cmux
description: cmux の別 workspace・window の移動や配置変更に使う。呼び出し元内だけの操作は cmux-workspace。
---

# cmux control

別 workspace / window の操作はユーザーが指定した対象に限定する。呼び出し元の環境と画面のフォーカスは一致するとは限らない。`cmux identify --json` と対象一覧から操作先を特定する。

Window はウィンドウ、workspace はサイドバーの単位、pane は分割領域、surface は pane 内のターミナル／ブラウザのタブ。通常は `workspace:N` 等の短い ref、永続的な記録では UUID を使う。

依頼に必要な参照だけ読む。

| 操作 | 参照 |
|---|---|
| 呼び出し元内の操作・helper pane | [cmux-workspace](../cmux-workspace/SKILL.md) |
| 対象の特定・ID | [handles-and-identify.md](references/handles-and-identify.md) |
| window / workspace の作成・移動・並べ替え | [windows-workspaces.md](references/windows-workspaces.md) |
| pane / surface の分割・移動・フォーカス | [panes-surfaces.md](references/panes-surfaces.md) |
| flash・稼働状態 | [trigger-flash-and-health.md](references/trigger-flash-and-health.md) |
| 設定変更 | [settings.md](references/settings.md) |

現行の引数は `cmux --help` / `cmux docs <topic>` で補う。通常のブラウザ操作は実行環境の Browser / Computer Use の規約に従う。操作後に対象の配置や設定を確認する。
