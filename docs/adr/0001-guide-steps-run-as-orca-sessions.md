# 案内役は工程を Orca の対話セッションとして起動し、終わりを GitHub の結果で判定する

[案内役](../../GLOSSARY.md)は、[工程](../../GLOSSARY.md)（formal-spec・to-tickets・knowledge）を `claude -p` で headless に起動して終了コードを待つのをやめ、`orca agent launch` で Orca のタブに対話セッションとして起動する。終わりは終了コードではなく、GitHub に残る結果（親 issue・学びの PR・Formal Spec コメント）で判定する（仕様 [#325](https://github.com/daiki-beppu/dotfiles/issues/325)）。headless では、詰まっても人から見えず、確認や許可で止まると答える相手がいなかった。そのため `--allowedTools` で許可を前もって絞るしかなく、足りなければ失敗した。また、状態を GitHub に持つ案内役の設計の中で、終わりの判定だけが終了コードに頼っていた。

## Considered Options

- **headless のまま `--allowedTools` を広げる**: 見えない・答えられない問題が残る。
- **対話セッションにして終了コードを待つ**: 対話セッションには終了コードの契約が無い。人がタブで答えて続きから進めることとも両立しない。

## Consequences

- 許可は、ユーザーの Claude Code の設定に任せる。その代わり、セッションは確認や許可で止まりうる。案内役はこれを[セッションの停止](../../GLOSSARY.md)として観測し、[判断依頼](../../GLOSSARY.md)を送る。人は止まったタブで答える。
- 起動の[印](../../GLOSSARY.md)には、ターミナルの handle と起動時刻を書く。案内役は state ファイルを持たないまま、次の周でそのセッションを見に行ける。
- 起動した周と結果を拾う周が分かれる。学びの PR の自動マージは、knowledge を起動した execute ではなく、次の周以降の merge-auto の遷移が予約する。
