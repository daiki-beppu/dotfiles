# 落とし穴

- **直接実行は worktree を作らない(実装ハードコード)**。`takt "#N"` / `takt -w <wf> "#N"` /
  `takt -i <N>` が通る `selectAndExecuteTask` は `execCwd = cwd` を使い、
  `worktree: false` をログに直書きしている。worktree を作る `confirmAndCreateWorktree` は
  **この経路から呼ばれない**。つまり**メインチェックアウトの現ブランチが直接書き換わる**。
  worktree が要るなら**積んで `takt run` で回す**経路を通す(投入時に `worktree: true` を渡し、
  `run` が `<repo-parent>/takt-worktrees/` に隔離クローンを作る)。`--pipeline` も worktree を
  作らない(help に *non-interactive, no worktree, direct branch creation* と明記。CI 用)
- **`--auto-pr` / `--draft` は `--pipeline` 専用になった**。非 pipeline で渡すと実行に入る前に
  `[ERROR] --auto-pr/--draft are supported only in --pipeline mode` で exit する
  (`routing.js::executeDefaultAction` の最初のガード)。**他所の手順書が
  `takt --auto-pr -w <wf> "#<N>"` を指していたらそれは古い**。このスキルの経路では
  PR 自動作成は投入時の `autoPr` フラグ(フェーズ 3)で表現するので、CLI の `--auto-pr` は使わない
- **`--pipeline` に切り替えても素直には通らない。3 段階でずれる**。1 つ直すと次が出るので、
  行き当たりばったりに直さず最初から 3 つとも満たす:
  1. **`-w` が必須**。無いと `--workflow (-w) is required in pipeline mode`
  2. **issue は `-i <N>` でしか渡らない**。positional の `"#<N>"` は pipeline では読まれず
     (`resolveTaskContent` が見るのは `prNumber` → `issueNumber` → `-t` だけ)、
     `Either --issue, --pr, or --task must be specified` になる
  3. **必ず `git checkout -b <branch>` を cwd で実行する**(`steps.js::resolveExecutionContext`)。
     つまり**ブランチの作成権は takt 側にある**。worktree 必須の規約と両立させたいなら
     `git worktree add -b <branch>` で**ブランチまで作ってはいけない** — detached で worktree を
     作り、`-b <branch>` は takt に渡す。先にブランチを作ると `already exists` で衝突する
- **投入は order.md を上書きする**。`enqueueService.js` が
  `options.orderContent ?? taskContent` を `<task_dir>/order.md` へ書き込むため、事前に置いた
  内容は残らない。仕様は issue 本文の側で整える(フェーズ 1「issue 本文がそのまま order.md になる」)
- **内部 API は `dist/` の構造に依存する**。import パスや `SaveEnqueuedTaskFileOptions` の形は
  takt のバージョン更新で変わり得る(CLI の互換保証の外側)。**更新後は最初の 1 件で
  `branch` / `base_branch` / `draft_pr` が tasks.yaml に入ったかを必ず確認する**。
  壊れていたらフェーズ 3 の fallback へ落とし、このスキルの修正が要るサインとして報告する。
  実際 `enqueueService.js` は 0.55.1 までに `dist/infra/task/` へ移動しており(`saveEnqueuedTaskFile`
  の import 元は変わっていない)、**パスの移動は起きる前提で扱う**
- **takt 経由の run では Claude が自分のスキルを見ない**。0.55.0 の BREAKING で
  `provider_options.claude.skills.enabled` の既定が `false` になり、`claude-sdk` は `skills: []`、
  CLI 系(`claude` / `claude-terminal`)は `--disable-slash-commands` 付きで起動する
  (custom slash command も同時に死ぬ)。**「あのスキルを使って実装して」と issue 本文に書いても
  効かない**ので、手順が要るなら issue 本文に直接書く。復活させるなら
  `.takt/config.yaml` で `provider_options.claude.skills.enabled: true`(検証済み最低版は
  Claude Code 2.1.220)
- **`max_steps` は workflow ツリー全体の共有予算になった**(0.55.0 BREAKING)。`workflow_call` は
  ステップ数にカウントされない制御ノードで、予算は root の `max_steps` だけが持つ。
  **callable workflow に `max_steps` を書くとロード時に落ちる**。上限に当たって止まった run を
  そのまま伸ばしたいときは `takt run --ignore-exceed`(共有予算を延長する。pane に送る行に足す)
- **run の report ディレクトリ名が変わった**(0.55.0 BREAKING)。`.takt/runs/*/reports/` 配下は
  `iteration-N--step-X--workflow-Y` から `call-…` セグメントになり、**旧形式の run を読む /
  resume する経路は削除された**(移行措置なし)。0.55.0 より前に走った run のログを漁るときは
  パス形式が違う前提で探す
- **レーン名の実在確認は `determineWorkflow` に委ねる。省かない**。存在しない名前は
  `Workflow not found` で止まる(積まれない)。ただしフェーズ 2 の判定を省くと、**存在はするが
  意図と違うレーン**を黙って渡すことになる。名前の実在と選択の妥当性は別物
- **`determineWorkflow` は callable sub-workflow を弾かない**。callable な部品名を
  渡すと投入は成功し、`takt run` が拾った瞬間に
  `callable workflow "<name>" must be started from a workflow_call` で failed になる。
  実在確認だけでは防げないので、フェーズ 2 の `grep -l "callable: true"` を通す
- **pending の実行順を入れ替える手段は乏しい**。`claimNextTasks` は先頭から拾い、投入は末尾に
  足す。割り込ませたいときは先行 pending を
  `takt list --non-interactive --action delete --branch <name>` で外し、割り込みを積んでから
  先行を積み直す(`--branch` は省略不可)
- **`--branch` は `takt list --help` に出ないが効く**。グローバル option (`-b, --branch`) を
  サブコマンド側が `optsWithGlobals()` で拾う構造なので、ローカル option 一覧
  (`--non-interactive` / `--action` / `--format` / `--yes`)には現れない。
  **help に無い = 廃止された、と読まない**
- **完了済みタスクの記録は tasks.yaml から消えることがある**(実測あり)。run の実績を追うときは
  `.takt/clone-meta/*.json` の `clonePath` 配下を辿る。takt はタスクを隔離クローンで実行するため、
  メインチェックアウトの `.takt/runs` には builtin workflow の run しか無い
- **safety_net ABORT をエージェントの報告だけで信じない**。takt は codex を
  `--sandbox workspace-write` で起動するため、通常シェルでは green のテストが takt 環境でだけ落ちる
  ことがある(Mach lookup を要する処理など)。切り分けは
  `sandbox-exec -p '(version 1)(allow default)(deny mach-lookup)'` で再現する
- **重い run を他リポジトリの takt run と同時に走らせない**。クローン置き場
  `<repo-parent>/takt-worktrees/` は同じ親を持つ別リポジトリと共有されており、外部リソースを
  実際に掴むテスト(実 ffmpeg・npm 実ダウンロード等)が並行負荷で落ちる
- **`.takt/tasks/` が gitignore 済みか確認する**。投入が order.md を置くので、除外されて
  いないとメインチェックアウトの作業ツリーが汚れる。新しいリポジトリでは投入前に
  `git check-ignore -v` で見る
- **nix store のパスを直書きしない**。takt バイナリは flake 管理でバージョンごとにハッシュが
  変わる。builtin レーン一覧を引くときも `which takt` + `realpath` から辿る(フェーズ 2)
- **draft の既定が経路によって逆になる**。内部 API 経路は `TAKT_DRAFT` を明示するので
  **指定しなければ通常 PR**、対話 fallback の `Create as draft?` は**既定 Yes**(Enter 連打で
  draft PR)。fallback に落ちたときだけ、通常 PR が欲しければ明示的に No を選ぶよう伝える
- **`cmux` は PATH に無いことがある**。cask 由来で実体は
  `/Applications/cmux.app/Contents/Resources/bin/cmux`。`config/.zshrc` で PATH の**末尾**に
  追加してあるが、反映前のシェルでは解決できない。**先頭に足してはいけない** — 同じ bin に
  `open` と `ghostty` が同居しており、先頭に置くと macOS 標準の `/usr/bin/open` を覆い隠す
- **pane に送るコマンドは repo root への `cd` から始める**。helper pane の cwd は caller と
  同じとは限らず、`.takt/` を見つけられないまま `takt run` が空振りする
- **pane では `-q` を付けない・`tee` を挟まない**。`-q` は AI 出力を落とす CI 向けオプションで、
  `tee` はバッファ遅延を招く。どちらも「止まっているのか進んでいるのか」の判断材料を潰す。
  pane に出力を素通しさせることが、この経路の存在意義そのもの
