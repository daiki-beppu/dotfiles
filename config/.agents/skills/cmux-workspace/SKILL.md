---
name: cmux-workspace
description: cmux の呼び出し元 workspace 内で helper pane・surface・状態表示を操作するときに使う。
---

# cmux Workspace

操作先はエージェントを起動した workspace。画面で選択中の workspace とは限らない。

## 対象とフォーカス

`CMUX_WORKSPACE_ID` / `CMUX_SURFACE_ID` を既定の対象にし、必要なら `cmux identify --json` で照合する。環境変数がなければ focused context しか分からないことを明示し、それが依頼対象と確認できてから変更する。

操作には明示的な `--workspace` / `--surface` を使い、対応するコマンドには `--focus false` を渡す。`select-workspace`・`focus-pane`・`focus-panel` などのフォーカス変更は、その操作をユーザーが依頼した場合だけ行う。別 workspace の依頼は [cmux](../cmux/SKILL.md) で扱う。

## Right-Side Helper Pane

プレビュー・ログ・TUI などの補助出力は呼び出し元ターミナルの右側にまとめる。

- `list-panes` と各 pane の `list-pane-surfaces --pane <ref>`、または `cmux tree` で配置を確認する。
- この作業用の helper pane があればそこへ surface を追加する。なければ右側に一つ作る。
- `new-pane` / `new-surface` で内容を伴って作成し、返された surface ref へコマンドを送る。作成後に移動・フォーカスを重ねて配置を整える必要はない。
- 片付けを依頼された場合も、終了済みの自分の補助出力と確認できるものだけ閉じる。

有効な ref が拒否された場合、一覧を更新して対象や対応コマンドを確認する。別の明示的な対象指定で回復できれば続ける。フォーカス変更を復旧手段にせず、操作不能な部分だけ報告する。

コマンドの構文は [commands.md](references/commands.md) または現行 `cmux --help` を参照する。サンプルの ref は実際の戻り値に置き換える。

## Socket と開発時の reload

`CMUX_SOCKET_PATH` があれば使い、なければ CLI の自動検出に任せる。推測した socket パスを export しない。接続不能なら `cmux capabilities --json` / `cmux ping` で調べる。

cmux 自体のソース変更を確認するときだけ、worktree の `./scripts/reload.sh --tag <tag>` を使う。tag ごとの app・socket・DerivedData で隔離し、untagged の `cmux DEV` を起動しない。

対象 workspace の配置・surface・状態表示が依頼どおりになったことを確認して報告する。
