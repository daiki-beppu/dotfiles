---
name: free-memory
description: macOS のメモリ（RAM）の計測と解放に使う。孤児プロセスや使っていないアプリを探して止める。--dry-run は計測と計画だけ。
---

# Free memory

承認されたプロセスを止めて、`memory_pressure -Q` の free percentage と `sysctl vm.swapusage` の前後差を報告する。RSS は共有ページを重複して数え、圧縮されたページを数えないため、プロセスごとの比較には `top` の MEM（phys_footprint）を使う。

## 調査

```sh
memory_pressure -Q
sysctl vm.swapusage
top -l 1 -o mem -n 30 -stats pid,ppid,command,mem
ps -U "$USER" -o pid=,ppid=,etime=,rss=,command= | awk '$2==1' \
  | grep -vE ' (/System|/usr/(libexec|sbin|bin)|/Applications/[^ ]*\.app|/Library/)'
```

launchd が直接起動したデーモンも PPID 1 になるため、孤児の候補はユーザー権限のプロセスに限り、システムやアプリ本体のパスを除いて絞る。

上位のプロセスを持ち主ごとにまとめる。持ち主は親をたどるか、`lsof -a -p <pid> -d cwd` で作業ディレクトリを見て決める。同じ名前の `node` でも、MCP サーバー・dev server・`tsc --watch` などが混ざっている。

次の 3 つに分ける。

- **孤児**: PPID が 1 で、起動元のセッションやエディタがもう無いもの。終了したエージェントのセッションが残した MCP サーバー（`chrome-devtools-mcp`、`chrome-headless-shell` など）、閉じた worktree の dev server や watcher が典型。エージェントのバックグラウンドのシェル（`zsh -c source …/shell-snapshots/…`）も、待ち合わせのループが終わらずに残る。`pgrep -f "<パターン>"` で待つループは、自分のコマンドラインに一致して永久に回る。
- **使っていないアプリ**: 起動しているが、今の作業で使っていない GUI アプリ。
- **報告のみ**: 使用中のもの、または判断がつかないもの。

一覧はサイズ・持ち主・止めたときの影響と並べて出し、承認を得てから止める。同じ対象への既存の承認は再確認しない。

## 解放

- GUI アプリは `osascript -e 'quit app "<名前>"'` で終了する。未保存の内容があれば、アプリ側が保存を確認する。
- 孤児は `kill <pid>`（SIGTERM）で止め、数秒後に残っていれば報告する。`kill -9` は、ユーザーが承認した場合だけ使う。
- 止める対象から外すもの: このセッションとその祖先（`claude`、Orca、`orca-terminal-host`、ログインシェル）、他のエージェントのセッションで動いているもの（`codex`、`claude`、takt の run）、WindowServer など macOS のシステムプロセス。
- `sudo purge` はファイルキャッシュを捨てるだけで、すぐに埋め直されるため使わない。

## 完了

`memory_pressure -Q` と `sysctl vm.swapusage` を再計測し、止めたもの・止めなかったもの・失敗したものを分けて報告する。スワップは使用中のページが読み戻されるまで減らないため、free percentage が上がってもスワップが減らないことがある。その場合も、数字は実測のまま報告する。
