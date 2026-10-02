# 落とし穴

- **直接実行は worktree を作らない(実装ハードコード)**。`takt "#N"` / `takt -w <wf> "#N"` /
  `takt -i <N>` が通る `selectAndExecuteTask` は `execCwd = cwd` を使い、
  `worktree: false` をログに直書きしている。worktree を作る `confirmAndCreateWorktree` は
  **この経路から呼ばれない**。つまり**メインチェックアウトの現ブランチが直接書き換わる**。
  worktree が要るなら**積んで `takt run` で回す**経路を通す(投入時に `worktree: true` を渡し、
  `run` が `<repo-parent>/takt-worktrees/` に隔離クローンを作る)。`--pipeline` も worktree を
  作らない(help に *non-interactive, no worktree, direct branch creation* と明記。CI 用)
- **`--auto-pr` / `--draft` は `--pipeline` 専用**。非 pipeline で渡すと実行に入る前に
  `[ERROR] --auto-pr/--draft are supported only in --pipeline mode` で exit する
  (`routing.js::executeDefaultAction` の最初のガード)。このスキルの経路では
  PR 自動作成は投入時の `autoPr` フラグ([enqueue.md](enqueue.md))で表現するので、CLI の `--auto-pr` は使わない
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
  内容は残らない。仕様は issue 本文の側で整える(SKILL.md の「投入条件」)
- **内部 API は `dist/` の構造に依存する**。import パスや `SaveEnqueuedTaskFileOptions` の形は
  takt のバージョン更新で変わり得る(CLI の互換保証の外側)。**更新後は最初の 1 件で
  `branch` / `base_branch` / `draft_pr` が tasks.yaml に入ったかを必ず確認する**。
  壊れていたら書き込まれた不完全なレコードを先に外し(残したまま fallback すると二重投入になる)、
  [fallbacks.md](fallbacks.md) へ落として、このスキルの修正が要るサインとして報告する。
  `dist/` 内のモジュールの移動は起きる前提で扱う
- **takt 経由の run では Claude が自分のスキルを見ない**。
  `provider_options.claude.skills.enabled` の既定が `false` で、`claude-sdk` は `skills: []`、
  CLI 系(`claude` / `claude-terminal`)は `--disable-slash-commands` 付きで起動する
  (custom slash command も同時に死ぬ)。**「あのスキルを使って実装して」と issue 本文に書いても
  効かない**ので、手順が要るなら issue 本文に直接書く。復活させるなら
  `.takt/config.yaml` で `provider_options.claude.skills.enabled: true`(検証済み最低版は
  Claude Code 2.1.220)
- **provider / model の割り当ては `runtime.yaml` だけに書く**。global の `~/.takt/runtime.yaml` が
  provider セクションを持つので、どのリポジトリの `.takt/config.yaml` に `provider` / `model` /
  `provider_routing` / `persona_providers` を足しても、`Mixed provider configuration detected` で
  agent 実行前に止まる。project で persona を上書きするなら `.takt/runtime.yaml` の `targets` に
  書くが、**project の `targets` は global の `targets` を丸ごと置き換える**（profiles は名前単位で
  合成される）ので、global の persona・companion の割り当てを全量写してから書き換える
- **`max_steps` は workflow ツリー全体の共有予算**。`workflow_call` は
  ステップ数にカウントされない制御ノードで、予算は root の `max_steps` だけが持つ。
  **callable workflow に `max_steps` を書くとロード時に落ちる**。上限に当たって止まった run を
  そのまま伸ばしたいときは `takt run --ignore-exceed`(共有予算を延長する。起動コマンドに足す)
- **run の report ディレクトリは `call-…` セグメント形式**(`.takt/runs/*/reports/` 配下)。
  0.55.0 より前の run は `iteration-N--step-X--workflow-Y` 形式で、takt から読む / resume する
  経路は無い。古い run のログはその形式で探す
- **レーン名の実在確認は `determineWorkflow` に委ねる。省かない**。存在しない名前は
  `Workflow not found` で止まる(積まれない)。ただしworkflow の選択条件を省くと、**存在はするが
  意図と違うレーン**を黙って渡すことになる。名前の実在と選択の妥当性は別物
- **`determineWorkflow` は callable sub-workflow を弾かない**。callable な部品名を
  渡すと投入は成功し、`takt run` が拾った瞬間に
  `callable workflow "<name>" must be started from a workflow_call` で failed になる。
  実在確認だけでは防げないので、[workflow-catalog.md](workflow-catalog.md) の callable 確認 を通す
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
  変わる。builtin レーン一覧を引くときも `which takt` + `realpath` から辿る([workflow-catalog.md](workflow-catalog.md))
- **外から止められたタスクは自動で積み直されない**(0.67.0 で実測)。runner のプロセスが殺されると
  (ホストの実行時間の上限など)、次の `takt run` が `Marked 1 interrupted running task(s) as failed.` と
  失敗に書き換えるが、`was not auto-requeued: failed step is missing` で積み直さない。積み直しは
  `takt list` の対話(前の workflow を使うか・開始位置の 2 問)しかないので、内部 API を同じ順に呼んで
  非対話で行う。開始位置は既定の `resume-checkpoint`(止まった工程から)を選ぶ:

  ```js
  const { TaskRunner } = await import(`${root}/dist/infra/task/index.js`);
  const { prepareFailedTaskRetry, buildFailedTaskRetryStartContext } = await import(`${root}/dist/features/tasks/taskRetryPreparation.js`);
  const { resolveTaskRetryStartOption, resolveTaskRetryStartOwnership } = await import(`${root}/dist/features/tasks/list/taskRetryStartSelection.js`);
  const { appendRetryNote, persistFailedTaskRetry } = await import(`${root}/dist/features/tasks/taskRetryPersistence.js`);
  const { buildAutoRequeueNote } = await import(`${root}/dist/features/tasks/list/requeueHelpers.js`);
  const task = new TaskRunner(cwd, {}).listFailedTasks().find((t) => t.name === name);
  const prep = prepareFailedTaskRetry(task, cwd);
  const ctx = buildFailedTaskRetryStartContext(prep, cwd, prep.previousWorkflow);
  const sel = resolveTaskRetryStartOption(ctx.workflowConfig, ctx.options, 'resume-checkpoint');
  const own = resolveTaskRetryStartOwnership(sel.selection, ctx.workflowConfig);
  persistFailedTaskRetry({ task, projectDir: cwd, worktreePath: prep.worktreePath, startStep: own.startStep,
    retryNote: appendRetryNote(task.data?.retry_note, buildAutoRequeueNote({ ...prep.failure, step: prep.failedStep })),
    resumePoint: own.resumePoint, workflow: ctx.workflowOverride, taskDir: undefined,
    sourceRunSlug: prep.matchedRunSlug, restartPoint: own.restartPoint });
  ```

  その後 `takt run` を起動し直す(`run.md` の `timeout` を付けて)
- **takt のエージェントは issue 本文のリンク先を読めない**。order.md に写るのは本文だけで、計画の工程は
  `gh` を許可されていない(「仕様の issue は未確認」と書いて進む)。実装に要る仕様は投入前に本文へ書き写す
