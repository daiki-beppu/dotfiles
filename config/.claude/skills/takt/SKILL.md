---
name: takt
description: >-
  起票済みの GitHub issue を takt のタスクキューへ非対話で積み、必要なら cmux の別 pane で
  workflow を回して完了まで見守る(workflow 判定 → order.md 作成 → TaskRunner.addTask →
  検証 → pane 起動 → 完了検知)。「takt に積んで」「takt task 追加」「#N を takt で回して」
  「タスクだけ積んでおいて」「PR に積み増して」「takt 回して」など、takt へのタスク投入・実行を
  頼まれたときに使用すること。`takt add` は対話専用、`takt run` は stdout が数十万 token に
  なるため、投入は store API を直接呼び、実行は cmux の別 pane に逃がす。
  issue の起票・PR のマージは対象外(起票は issue スキル)。
  --run で pane 起動と完了検知まで、--dry-run で order.md 作成まで、
  --workflow / --branch / --pr で選択を明示できる。
---

# takt タスク投入・実行(非対話)

## 概要

起票済み issue を takt のキューへ積み、`--run` が渡されたときだけ cmux の別 pane で回す。

**bare invocation では `takt run` を回さない**(いつ走らせるかは人間の判断であり、
積んだ瞬間に走り出す構成もあるため)。回すのは `--run` を明示されたときだけ。

設計の骨子:

- **order.md が仕様の正本、issue はその写し**。yt-auto-* の intake は両者を突き合わせ、
  食い違いや自己矛盾を仕様矛盾として blocked にする。**片方だけ直さない**
- **`takt add` を呼ばない**。workflow 選択 / worktree / auto_pr を prompt する対話 UI に落ちる。
  未知サブコマンド(`takt task list` など)も同じく対話モードに落ちるので非対話では叩かない
- **tasks.yaml を書かない**。TaskStore は `.takt/tasks.yaml.lock` のファイルロック + tmp→rename で
  書くため、手書きは実行中の `takt run` と競合して他タスクの記録を飛ばす
- **積む = すぐ走り得る**。実行中の `takt run` は `claimNextTasks` で空きスロット分の pending を
  ポーリングして拾う。「積んでおいて後で回す」つもりでも即実行になり得る
- **`takt run` の stdout をエージェントが読まない**。完了時に stdout / trace / JSONL が
  数十万 token になる。pane に流して人間が視認し、エージェントは完了シグナルと `tail -80` だけ見る

## Invocation variants

- Bare / `<issue番号>` → フェーズ 1〜5 を通す(積むまで)。`takt run` は回さない。
- `--run` → フェーズ 6。cmux の別 pane で `takt -q run` を起動し、完了まで見守る。
  単独なら既存の pending を回すだけ、`<issue番号> --run` なら積んでから回す。
- `--dry-run` → order.md を作るところで止め、`addTask` は実行しない。
- `--workflow <name>` → フェーズ 2 の判定を省略して明示する。
- `--pr <番号>` / `--branch <name>` → 既存 PR / ブランチへの積み増し(フェーズ 4)。
- `--no-auto-pr` → PR を作らせない(検証だけ回したいとき)。

## フェーズ 1: 前提確認

```sh
ls .takt/workflows/                                  # レーン一覧。無ければこのリポジトリは takt 経路ではない
gh issue view <N> --json number,title,body,state,labels
git fetch origin
```

- **pending / running を必ず見る**(下記)。実行中の run があれば積んだ瞬間に走り出すため、
  ユーザーに「今から走る」ことを伝えてから積む
- **issue が無ければ先に起票する**。yt-auto-* の intake は「issue 番号を確定できない実行は blocked」を
  明示規約にしており、order.md だけ渡すと 3 回とも blocked → auto-requeue 上限(2/2)で failed する
  (実装には一切入らない)。builtin の `simple-*` にはこの制約が無い
- 新規ブランチで走らせるなら投入前に main を `git pull --ff-only`。takt はクローン元のローカルブランチから
  複製するため、main が origin より遅れているとマージ済みの workflow 定義がクローンに入らず run が壊れる
  (既存ブランチへの積み増しはリモート優先なので影響しない)

### 状態確認

`takt task list` は**存在しない**。tasks.yaml を直接読むか、store API を使う。

```sh
grep -n "^    name: \|^    status: " .takt/tasks.yaml | tail -12
```

## フェーズ 2: workflow の選択

**レーン名も選択軸もリポジトリごとに違う。このスキルに書かれた名前は例であって、実在確認なしに
`--workflow` へ渡してはいけない**。`add-task.mjs` は実在検証をしないので、存在しないレーン名でも
黙って積まれ、`takt run` で初めて落ちる。

実測(2026-08 時点):

| リポジトリ | プロジェクト固有レーン | 選択軸 |
| --- | --- | --- |
| `youtube-automation` | `yt-auto-{audit,docs,feature,fix,impl-review,intake,maintenance}` / `audit-unit-split` | 意図別 |
| `libecity` | `article-rewrite` / `knowhow-article` | 成果物別 |
| `specv` / `dotfiles` | 無し(builtin のみ) | builtin の軸に従う |

### 実在レーンの確認(毎回やる)

```sh
ls .takt/workflows/ 2>/dev/null    # プロジェクト固有レーン。無ければ builtin だけが対象

# builtin(0.54.1 で 62 本)。言語は .takt/config.yaml の language に対応
BUILTIN=$(dirname "$(dirname "$(realpath "$(which takt)")")")/lib/node_modules/takt/builtins/ja
ls "$BUILTIN/workflows/" | sed 's/\.yaml$//'
cat "$BUILTIN/workflow-categories.yaml"    # カテゴリ別の並びと推奨順
```

### 判定順

1. **`docs/takt-operations.md`** — あればこれを正とする(`youtube-automation` にはある)
2. **issue のラベル** — 下記
3. **内容からの推定** — 下記

### issue のラベルを見る

```sh
gh issue view <N> --json labels --jq '.labels[].name'
```

- **`takt:<name>` 形式は workflow の直接指定**。dotfiles は `takt:default-mini` / `takt:lite` /
  `takt:docs` / `takt:manual` を運用している
- **`takt:manual` は「takt に積まない・手動実装が妥当」の意思表示**。積む前にユーザーへ確認する
- **ラベルが指すレーンが実在しないことがある**。workflow 資産を撤去してもラベルは GitHub 側に
  残るため(実測: dotfiles の `takt:lite` / `takt:docs` が指す `lite` / `docs` は builtin に無い)。
  実在一覧に無ければラベルを鵜呑みにせず、内容から選び直して理由を一言添える
- 汎用ラベル(`bug` / `documentation` / `enhancement`)は役割のヒントに留める。ラベル体系も
  リポジトリごとに違うので `gh label list` で実在を確認してから対応付ける

### 内容からの判定

**プロジェクト固有レーンがあればその設計に従う**。意図別レーンを持つ `youtube-automation` の場合:

| 状況 | レーン |
| --- | --- |
| 壊れている(バグ・回帰) | `yt-auto-fix` |
| コードを変えず文書 / skill だけ | `yt-auto-docs` |
| 挙動を変えずに構造を変える(refactor) | `yt-auto-maintenance` |
| 調査して報告するだけ | `yt-auto-audit` |
| それ以外(新機能・機能拡張) | `yt-auto-feature` |

**builtin だけの場合、選択軸は意図ではなく「対象スタック × 深度」**になる:

- スタック: `frontend` / `backend` / `dual`(両方) / `cli` / `terraform` / 無印(汎用)
- 深度: `simple-*`(最小) → `*-mini`(軽量) → 無印 → `*-high`(厚い)
- 監査・レビューは `audit-*` / `review-*`、調査だけなら `research` / `deep-research`
- takt 自身の開発は `takt-default*`

**callable sub-workflow は直接投入しない**(他の workflow から呼ばれる部品)。
`youtube-automation` では `yt-auto-intake` / `yt-auto-impl-review` が該当する。

判定できたら選んだレーンと理由を一言添えて進む。2 つのレーンに割れる issue(バグ修正と機能拡張が
混ざる等)は、積む前にどちらで回すか確認する。

## フェーズ 3: order.md を書く

`.takt/tasks/<slug>/order.md` に置く。slug は `[a-z0-9](?:[a-z0-9-]*[a-z0-9])?` で、
`YYYYMMDD-<主題>`(例 `20260801-pytest-lane-registry`)を慣例とする。

構造は **タスク固有のヘッダ + `---` + issue 本文の逐語コピー**。

| ヘッダの節 | 内容 |
| --- | --- |
| 位置づけ | 積み増し先 PR / 段構成の何段目か / 前段の完了状況 |
| 起票後に変わった数値 | issue 本文の実測値が古くなっていれば対照表を置き、「実装時はブランチ上の実測を正とする」と明記する |
| 進め方の注意 | issue の完了条件を実行手順へ翻訳する。順序・戻し忘れ・両側同時修正など |

- **issue 本文は要約せず逐語コピーする**。`gh issue view <N> --json body --jq .body` の出力を
  `---` の後ろへ追記し、`diff` で一致を確認する
- **自己矛盾を残さない**。「削除以外の変更は行わない」と「CHANGELOG 更新が必須」の併記のような
  食い違いは intake が正しく検出して blocked にする。完了条件で要求する文書更新は
  「変更種別の限定」節で明示的に例外化しておく
- **例外は手順で書く**。ベースライン flake の例外を「テスト名の列挙」で書くと次の flake で必ず破れる。
  「失敗テストを単独再実行して green なら flake と判定」という手順にし、限界も併記する
  (単独実行で green を実証したものに限る / skip・緩和による green 化は禁止 /
  変更対象に関連するテストは flake 扱いにしない)
- order.md を直したら **issue 本文も同時に直す**

## フェーズ 4: 投入

```sh
node ~/.claude/skills/takt/references/add-task.mjs \
  --slug <slug> --workflow <name> --issue <N> \
  --summary '# タスク: <一行要約>（#<N>）' \
  [--branch <既存ブランチ>] [--dry-run]
```

オプションの全量はスクリプト冒頭の doc comment を見る。

### 既存 PR への積み増し

`--branch <既存ブランチ名>` を渡すだけで成立し、新しい PR は作られない。根拠は 3 点:

- `clone.js::createSharedClone` の分岐順は **リモートに同名ブランチあり → clone して origin から
  fetch → `checkout -B`** が最優先。メインチェックアウトの HEAD やローカルブランチに依存しないので、
  メインが別ブランチにいても起点は push 済みの PR HEAD に確定する
- `postExecution.js` は完了後に `findExistingPr(branch)` を引き、見つかれば新規作成せず
  **push + PR へのコメント追記**で終わる(`gh pr create` の重複エラーにはならない)
- `activeTaskTarget.js::findActiveTaskTargetConflict` の競合判定対象は **pending / running のみ**。
  同じ branch の completed タスクが既にあっても積める

## フェーズ 5: 検証と申し送り

```sh
tail -18 .takt/tasks.yaml    # status: pending / workflow / branch / issue / task_dir を確認
```

報告に含める: 積んだ slug、選んだ workflow とその理由、積み増し先 PR、
`takt run` を誰がいつ回すか(`--run` なら続けてフェーズ 6 に進む旨)、
running があれば即実行になる旨。

## フェーズ 6: cmux の別 pane で回す(`--run`)

`takt run` を前景で回すとエージェントが stdout を読んでしまう。**pane に流して人間が視認し、
エージェントはログを読まない**のが原則。`--run` が無ければこのフェーズには入らない。

### pane の確保

pane の作り方はここでは決め打ちせず、[cmux-workspace](../cmux-workspace/SKILL.md) スキルの
**Right-Side Helper Pane** ポリシーに従う(既存の helper pane があれば surface を足す /
無ければ右に 1 つだけ作る / 作成系には `--focus false`)。

このスキル側で足す制約は 2 つだけ:

- **surface ref は作成コマンドの戻り値から取る**。`cmux new-pane` / `new-surface` は
  `OK surface:85 pane:83 workspace:20` を返すので、それをそのまま使う。推測で `surface:<N>` を
  打たない。一覧から拾うなら `--pane <ref>` が要る —
  `cmux list-pane-surfaces --workspace <ws>` だけでは **caller pane の surface しか出ない**
  (全体を見るなら `cmux tree --workspace <ws>`)
- **フォーカスを奪わない**。`select-workspace` / `focus-pane` は呼ばない
  (ユーザーは別 workspace を見ている可能性がある)

### 起動

pane 側で takt を起動し、終了時に **sentinel ファイルと cmux の同期トークンの両方**を発火させる。
`-q` はトップレベル option なので `takt -q run` の順で指定する。

```sh
SLUG=<slug>; LOG=/tmp/takt_${SLUG}.log; DONE=/tmp/takt_${SLUG}.done; TOKEN=takt-${SLUG}
rm -f "$DONE"

cmux send --surface surface:<N> \
  "cd <repo_root> && takt -q run 2>&1 | tee ${LOG}; touch ${DONE}; cmux wait-for -S ${TOKEN}\n"
```

末尾の `\n` が実行トリガ(`cmux send` が改行として解釈する)。付け忘れるとコマンドは pane の
プロンプトに入力されたまま実行されず、完了シグナルも永遠に来ない。

複数 task を積んでいても **起動は 1 回・pane 1 つだけ**。takt の worker pool
(`runAllTasks` → `claimNextTasks` → `runWithWorkerPool`)が pending を消化する
(グローバル設定は `concurrency: 1` なので逐次)。多重起動すると実効並列度が
`concurrency × 起動数` に膨らみ、worktree 競合とトークン暴走を招く。

### 完了検知

`cmux wait-for` を主、sentinel ファイルを保険にした 1 行で待つ。

```sh
cmux wait-for takt-<slug> --timeout 7200 || while [ ! -f /tmp/takt_<slug>.done ]; do sleep 30; done
echo done
```

- **Claude Code**: この 1 行を `Bash` の `run_in_background: true` で投げる。exit で harness が
  自動再呼び出しするので**こちらから poll しない**。timeout は `3600000ms` 程度
- **Codex / その他 CLI**: 自動再呼び出しが無いので、同じ 1 行を前景で実行してブロックさせる

二段構えにする理由:

- `cmux wait-for` は signal が先に来ても取りこぼさない(トークンが保持される)。消費されるのは
  wait 成功時だけなので、`--timeout` で切れても同じ行を再実行してよい
- ただし `--timeout` の上限は未検証で、長時間 run で早期に `exit 1` する可能性が残る。
  そのとき `||` の後ろの sentinel ループが受け止める
- sentinel ファイルは下記 fallback とも経路が揃う

**作らない・使わない**: 別 wait スクリプト、30s 進捗 echo ループ、`ScheduleWakeup`、`Monitor`、
`cmux read-screen` の poll。いずれも token を無駄に食う。`[ -f ... ]` の単発チェックで次へ進むのも
不可(実行中のまま後続が走る)。shell 内で完結する 1 コマンドの `while` はこれに該当しない。

### cmux 非搭載環境の fallback

`CMUX_WORKSPACE_ID` が空、または `cmux` が PATH に無いときは pane を使わず detach する。
検知は sentinel ファイルだけで行う(`cmux wait-for` の行は使わない)。

```sh
# Claude Code: run_in_background: true
takt -q run > "$LOG" 2>&1; touch "$DONE"

# Codex
nohup sh -c "takt -q run > \"$LOG\" 2>&1; touch \"$DONE\"" &
```

### 完了時の確認

単一の `takt -q run` は pending を全消化してから exit するので、この 1 判定で全件を待てる。
`tasks.yaml` で各 task の最終 status を読む。

| status | 見るもの |
| --- | --- |
| `completed` | `tail -80 "$LOG"` で `Auto-committed: <SHA>` と所要時間。PR URL は `tasks.yaml` の `pr_url`、無ければ `gh pr list --head <branch>` |
| `failed` / `aborted` | `tail -80 "$LOG"` で原因。詳細は `.takt/runs/<run_slug>/reports/` の該当セクションだけ |

`.takt/runs/**/logs/*.jsonl` と `trace.md` は全文表示しない。`wc -c` / `du -sh` / `jq` で
集計してから必要行だけ読む。完了後の報告は status・PR URL・テスト結果・review verdict に絞る。

## 落とし穴

- **`--workflow` の実在検証は誰もしない**。`add-task.mjs` は値の有無しか見ず、TaskStore も
  レーン名を検証しない。存在しない名前は積めてしまい、`takt run` の実行時に初めて落ちる。
  フェーズ 2 の「実在レーンの確認」を飛ばさない
- **pending の実行順を入れ替える API は無い**。`claimNextTasks` は先頭から拾い `addTask` は末尾に足す。
  割り込ませたいときは「先行 pending を `deleteTask(name, 'pending')` → 割り込みを `addTask` →
  先行を積み直す」。task_dir 配下の order.md は消えないので、積み直しは
  summary / workflow / task_dir の再指定だけでよい
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
- **`.takt/tasks/` が gitignore 済みか確認する**。除外されていればメインチェックアウトに
  order.md を置いても作業ツリーは汚れない。新しいリポジトリでは投入前に `git check-ignore -v` で見る
- **nix store のパスを直書きしない**。takt バイナリは flake 管理でバージョンごとにハッシュが変わる。
  スクリプトは `which takt` + realpath から `dist/` を解決している
- **`cmux` は PATH に無いことがある**。cask 由来で実体は
  `/Applications/cmux.app/Contents/Resources/bin/cmux`。`config/.zshrc` で PATH の**末尾**に
  追加してあるが、反映前のシェルでは解決できない。**先頭に足してはいけない** — 同じ bin に
  `open` と `ghostty` が同居しており、先頭に置くと macOS 標準の `/usr/bin/open` を覆い隠す
- **pane に送るコマンドは repo root への `cd` から始める**。helper pane の cwd は caller と
  同じとは限らず、`.takt/` を見つけられないまま `takt run` が空振りする
