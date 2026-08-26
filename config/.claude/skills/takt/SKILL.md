---
name: takt
description: >-
  起票済みの GitHub issue を takt のタスクキューへ積み、cmux の別 pane で workflow を回して
  完了まで見守る(workflow 判定 → 非対話で投入 → 検証 → pane で takt run → 完了検知)。
  「takt に積んで」「takt task 追加」「#N を takt で回して」「タスクだけ積んでおいて」
  「PR に積み増して」「takt 回して」など、takt へのタスク投入・実行を頼まれたときに使用すること。
  投入は takt の内部 API を直呼びして対話ゼロで済ませ(branch / base / draft まで指定できる)、
  stdout が数十万 token になる takt run だけを cmux の別 pane に逃がす。
  PR のマージは対象外。issue が未起票なら issue スキルへ
  委譲して起票してから積む(issue 無しで積む経路は用意しない)。
  --run で run と完了検知まで、--dry-run で実行予定の提示まで、
  --workflow / --branch / --base / --draft / --pr で選択を明示できる。
---

# takt タスク投入・実行

> 最終検証: takt 0.62.0(2026-08-26)。バージョン付きの記述はその版での実測を示す。

## 概要

起票済み issue を takt のキューへ積み、`--run` が渡されたときだけ続けて回す。
**投入は対話ゼロで行い、`takt run` だけを cmux の別 pane で実行する**。

**bare invocation では `takt run` を回さない**(いつ走らせるかは人間の判断であり、
積んだ瞬間に走り出す構成もあるため)。回すのは `--run` を明示されたときだけ。

設計の骨子:

- **issue が仕様の正本**。投入時に issue 本文を取得して order.md に書き込むので、
  **issue 本文の品質がそのまま実装の入力になる**。事前に置いた order.md は上書きされるため、
  自前で書かず issue 側を直す
- **`takt add` は使わず、内部 API を直呼びして積む**。`takt add` は worktree / branch /
  auto_pr を prompt する対話 UI で、**グローバル option を 1 つも受け付けない**
  (`addTask` が読むのは `opts.workflow` と `opts.prNumber` だけ)。`saveEnqueuedTaskFile` を
  直接呼べば branch / base / draft まで指定して対話ゼロで積める(フェーズ 3)。
  未知サブコマンド(`takt task list` など)は対話モードに落ちるので叩かない
- **直接実行(`takt "#N"` / `takt -w <wf> "#N"` / `takt -i <N>`)は使わない**。worktree を作らず
  **現ブランチをそのまま書き換える**ので、worktree 必須の規約と正面から衝突する(下記「落とし穴」)。
  積んで `takt run` で回す経路だけを使う
- **tasks.yaml を書かない**。TaskStore は `.takt/tasks.yaml.lock` のファイルロック + tmp→rename で
  書くため、手書きは実行中の `takt run` と競合して他タスクの記録を飛ばす
- **積む = すぐ走り得る**。実行中の `takt run` は `claimNextTasks` で空きスロット分の pending を
  ポーリングして拾う。「積んでおいて後で回す」つもりでも即実行になり得る
- **`takt run` の stdout をエージェントが読まない**。完了時に stdout / trace / JSONL が
  数十万 token になる。pane にそのまま流して人間が視認し、エージェントは完了シグナルと
  `tasks.yaml` の status だけ見る

## Invocation variants

- Bare / `<issue番号>` → フェーズ 1〜4 を通す(積むまで)。`takt run` は回さない。
- `--run` → フェーズ 5。cmux の別 pane で `takt run` を起動し、完了まで見守る。
  単独なら既存の pending を回すだけ、`<issue番号> --run` なら積んでから回す。
- `--dry-run` → 投入の直前で止め、選んだ workflow と投入予定の設定
  (branch / base / auto_pr / draft)を提示するだけ。
- `--workflow <name>` → フェーズ 2 の判定を省略して明示する。**実在確認だけは飛ばさない**。
- `--branch <name>` → 投入する branch を明示する。既存ブランチへの積み増しもこれ。
- `--pr <番号>` → その PR の head ブランチへ積み増す(`--branch` に入れる値を
  `gh pr view` で引いてから渡す)。
- `--base <name>` → base branch を明示する。省略時は takt の既定解決に任せる。
- `--draft` → draft PR で作る。**省略時は通常 PR**(対話 UI の既定とは逆。フェーズ 3)。
- `--no-auto-pr` → PR を自動作成しない(`autoPr: false`)。

## フェーズ 1: 前提確認

```sh
ls .takt/workflows/                                  # レーン一覧。無ければこのリポジトリは takt 経路ではない
gh issue view <N> --json number,title,body,state,labels
git fetch origin
```

- **pending / running を必ず見る**(下記)。実行中の run があれば積んだ瞬間に走り出すため、
  ユーザーに「今から走る」ことを伝えてから積む
- **issue が無ければ `issue` スキルを呼んで起票し、採番された番号で積む**。会話の流れで
  「これも積んで」と言われた場合も同じで、**issue 無しで積む経路は用意しない**。起票の品質ゲート
  (インタビューでの合意・検証可能な要件・影響範囲)は `issue` スキルに一元化されており、そこを
  迂回すると仕様の出所が消える。`issue` スキル自身が 1 問ずつのインタビューを挟むので、
  起票内容はそこでユーザーと合意される
- **intake を持つレーンでは issue が実質必須**。takt 本体は issue 番号が無くても
  `{ exists: false }` を返すだけでエラーにしない(`DefaultSystemStepServices` の `issue_context`)。
  blocked にするのは workflow 側の規約で、yt-auto-* / tayk-* の intake は「issue 番号を確定
  できない実行は blocked」を明示している。order.md だけ渡すと 3 回とも blocked →
  auto_requeue 上限(2/2)で failed する(実装には一切入らない)。builtin の `simple-*` には
  intake が無いのでこの制約もかからない
- **intake の組み込み方は 2 通りある**。`kind: workflow_call` で別 workflow を呼ぶ形と、
  0.55.0 で入った step fragment(`uses: intake` で `.takt/steps/intake.yaml` を展開)の形。
  **後者は `.takt/workflows/` に出てこない**ので、レーン一覧に `*-intake` が無いことを
  「intake 無し」と読み違えない(実測: `00-automation` は fragment 形式、
  `youtube-automation` / `tayk` は workflow 形式)
- 新規ブランチで走らせるなら投入前に main を `git pull --ff-only`。takt はクローン元のローカルブランチから
  複製するため、main が origin より遅れているとマージ済みの workflow 定義がクローンに入らず run が壊れる
  (既存ブランチへの積み増しはリモート優先なので影響しない)

### issue 本文がそのまま order.md になる

投入時に `resolveIssueTask("#N")` が issue 本文を取得し、`.takt/tasks/<slug>/order.md` へ
書き込まれる(`dist/infra/task/enqueueService.js` の `options.orderContent ?? taskContent`)。つまり
**issue 本文の品質がそのまま実装の入力になる**。積む前に本文を読み、下記があれば
**issue 側を直してから**積む:

- **自己矛盾**。「削除以外の変更は行わない」と「CHANGELOG 更新が必須」の併記のような食い違いは
  intake が仕様矛盾として blocked にする。完了条件で要求する文書更新は「変更種別の限定」節で
  明示的に例外化しておく
- **列挙で書かれた例外**。ベースライン flake の例外を「テスト名の列挙」で書くと次の flake で必ず
  破れる。「失敗テストを単独再実行して green なら flake と判定」という手順に書き換え、限界も併記する
  (単独実行で green を実証したものに限る / skip・緩和による green 化は禁止 /
  変更対象に関連するテストは flake 扱いにしない)
- **古くなった実測値**。起票後に数値が変わっていれば本文を更新する(「実装時はブランチ上の実測を
  正とする」と添える)
- **位置づけの欠落**。積み増し先 PR や段構成の何段目かは、order.md に後付けできないので
  issue 本文に書く

**事前に order.md を置いても上書きされる**。自前で書かず、直すのは issue 本文の側。

### 状態確認

`takt task list` は**存在しない**。tasks.yaml を直接読むか、store API を使う。

```sh
grep -n "^    name: \|^    status: " .takt/tasks.yaml | tail -12
```

## フェーズ 2: workflow の選択

**レーン名も選択軸もリポジトリごとに違う。このスキルに書かれた名前は例であって、実在確認なしに
投入してはいけない**。存在しない名前ならフェーズ 3 の `determineWorkflow` が止めるので事故には
ならないが、**存在はするが意図と違うレーン**と**存在はするが callable な部品**は黙って積まれる
(後者は run まで発覚しない。下記)。

実測(2026-08-04 時点):

| リポジトリ | プロジェクト固有レーン | 選択軸 |
| --- | --- | --- |
| `~/ghq/github.com/daiki-beppu/tayk` | `tayk-{audit-architecture,audit-runs,feature,fix,intake}` (5) | 意図別 |
| `~/ghq/github.com/daiki-beppu/youtube-automation` | `yt-auto-*` + `audit-unit-split` | 意図別 |
| `~/ghq/github.com/daiki-beppu/libecity` | `article-rewrite` / `knowhow-article` | 成果物別 |
| `~/ghq/github.com/daiki-beppu/{dotfiles,takt,specv}` | 無し(builtin のみ) | スタック × 深度 |

**本数が減ってもレーンの廃止とは限らない**。`youtube-automation` は 2026-08-01 時点で 8 本だったが、
0.55.0 の step fragment 化で `.takt/steps/` へ移った分だけ `.takt/workflows/` から消えている
(実測: `intake.yaml` が `.takt/steps/` にあり、各レーンが `uses: intake` で展開している。
review 系も `reviewers.yaml` / `design-review.yaml` などとして同じ場所にある)。
**投入対象として選べるレーンが減った**のは事実だが、機能が消えたわけではない。

レーン構成は更新で変わり得るため、表だけで判断せず、
**作業ディレクトリの `.takt/workflows/` を直接見る**。

### 実在レーンの確認(毎回やる)

```sh
ls .takt/workflows/ 2>/dev/null    # プロジェクト固有レーン。無ければ builtin だけが対象
ls .takt/steps/ 2>/dev/null        # step fragment。レーンではないので投入対象にはならない

# builtin の一覧(本数は実行結果が正)。言語は .takt/config.yaml の language に対応
BUILTIN=$(dirname "$(dirname "$(realpath "$(which takt)")")")/lib/node_modules/takt/builtins/ja
ls "$BUILTIN/workflows/" | sed 's/\.yaml$//'
cat "$BUILTIN/workflow-categories.yaml"    # カテゴリ別の並びと推奨順
```

`.takt/steps/` は 0.55.0 で入った再利用可能な単一ステップ部品(`uses: <name>` で展開される)。
探索先は `.takt/steps/` / `~/.takt/steps/` / builtin `steps/` / repertoire パッケージの `steps/`
の 4 か所で、**レーンとしては投入できない**。一覧に出てこない機能がレーンに埋まっていることの
説明になるので、「思ったより本数が少ない」ときはここを見る。

### 判定順

0. **`--workflow <name>` の明示指定** — あればこれに従う。ただし**実在確認は省かない**。
   実在一覧に無ければその場で指摘し、近い名前を候補として出して確認を取る。
   `docs/takt-operations.md` やラベルが指すレーンと食い違うときは、指定を優先しつつ
   食い違いを一言告げる(意図的な振り替えなのか取り違えなのかはユーザーにしか分からない)
1. **`docs/takt-operations.md`** — あればこれを正とする(yt-auto 系の 2 つにはある。tayk には無い)
2. **issue のラベル** — 下記
3. **内容からの推定** — 下記

### issue のラベルを見る

```sh
gh issue view <N> --json labels --jq '.labels[].name'
```

- **`takt:<name>` 形式は workflow の直接指定**。dotfiles は `takt:default-mini` / `takt:lite` /
  `takt:docs` / `takt:manual` の 4 ラベルを運用している
- **`takt:manual` は「takt に積まない・手動実装が妥当」の意思表示**。積む前にユーザーへ確認する
- **ラベルが指すレーンが実在しないことがある**。workflow 資産を撤去してもラベルは GitHub 側に
  残るため(実測: dotfiles では `takt:manual` を除く 3 ラベル ── `default-mini` / `lite` /
  `docs` ── がいずれも builtin に実在しないレーンを指している)。
  実在一覧に無ければラベルを鵜呑みにせず、内容から選び直して理由を一言添える
- 汎用ラベル(`bug` / `documentation` / `enhancement`)は役割のヒントに留める。ラベル体系も
  リポジトリごとに違うので `gh label list` で実在を確認してから対応付ける
- **ラベルはレーン選択だけでなく実装にも効く**。`issue_context` は body だけでなく labels も
  workflow へ渡すので、intake を持つレーンではラベルの過不足がそのまま intake の判断に入る。
  起票時にラベルを付け忘れていたら、積む前に `gh issue edit <N> --add-label` で補う

### 内容からの判定

**プロジェクト固有レーンがあればその設計に従う**。意図別レーンは `<prefix>-<意図>` の命名で、
prefix はリポジトリごとに違う(`yt-auto-` / `tayk-`)。**意図の語彙も揃っていない**。

レーンの語彙・builtin の選択軸(スタック × 深度)は
[references/workflow-catalog.md](references/workflow-catalog.md)。
**プロジェクト固有レーンが無く builtin から選ぶ場合は必ず読む**。

**callable sub-workflow は直接投入しない**(他の workflow から呼ばれる部品)。
`ls builtins/ja/workflows/` には**普通のレーンと並んで出てくる**ので名前だけでは区別できない。
本数・実名の一覧はここには書かない(takt の更新で黙って増減するため、レシピを毎回実行して
確認する)。判別は `subworkflow.callable` を直接見る:

```sh
cd "$BUILTIN/workflows" && grep -l "callable: true" *.yaml | sed 's/\.yaml$//'
```

**投入は素通りする。落ちるのは run のとき**。`determineWorkflow` は callable を弾かず
そのまま tasks.yaml に積み(実測)、`WorkflowEngine` の構築時に初めて
`Configuration error: callable workflow "<name>" must be started from a workflow_call` を投げる。
つまり**存在しないレーン名と違って積んだ時点では気づけない**ので、ここで確認する。

プロジェクト固有レーンでは `intake` / `impl-review` が該当しがち(`00-automation` のように
step fragment に移行済みのものはそもそも一覧に出ない)。

判定できたら選んだレーンと理由を一言添えて進む。2 つのレーンに割れる issue(バグ修正と機能拡張が
混ざる等)は、積む前にどちらで回すか確認する。

## フェーズ 3: 非対話で積む

**`takt add` は使わない**。ユーザーに 6 問のプロンプトを手入力させる代わりに、
takt の内部 API を直呼びして対話ゼロで積む。pane も要らない。

### なぜ CLI ではなく内部 API なのか

`takt add` の対話は**グローバル option では 1 つも埋められない**。`addTask` が読むのは
`opts.workflow` と `opts.prNumber` だけで、worktree 設定は必ず `promptWorktreeSettings(cwd)`
から取るため、**`-b` / `--auto-pr` / `--draft` を渡しても捨てられる**。

`TAKT_NO_TTY=1`(`shared/prompt/tty.js` の公式分岐)を立てれば `promptInput` は `null`、
`confirm` は既定値かパイプ入力を返すので対話ゼロにはなる。だが **`promptInput` はパイプを
読まないので `Branch name` だけが auto に固定される**(`confirm` にはパイプ経路があるのに
`promptInput` には無い、takt 側の非対称)。`script(1)` で疑似 TTY を与える手は、入力が
先読みされて EOF で落ちるため成立しない(実測)。gh-stack 前提で branch を指定する運用では
どれも足りないので、`saveEnqueuedTaskFile` を直接呼ぶ。

### 投入

```sh
TAKT_ROOT=$(dirname "$(dirname "$(realpath "$(which takt)")")")/lib/node_modules/takt
TAKT_NODE=$(grep -o '/nix/store/[^ ]*/bin/node' "$(realpath "$(which takt)")" | head -1)
TAKT_NODE=${TAKT_NODE:-$(command -v node)}

TAKT_ROOT="$TAKT_ROOT" TAKT_CWD="<repo_root>" \
TAKT_WF="<workflow>" TAKT_ISSUE="<N>" \
TAKT_BRANCH="<branch|空>" TAKT_BASE="<base|空>" \
TAKT_AUTO_PR=true TAKT_DRAFT=false \
"$TAKT_NODE" --input-type=module <<'EOF'
const root = process.env.TAKT_ROOT, cwd = process.env.TAKT_CWD;
const { determineWorkflow } = await import(`${root}/dist/features/tasks/execute/selectAndExecute.js`);
const { resolveIssueTask } = await import(`${root}/dist/infra/git/index.js`);
const { saveEnqueuedTaskFile } = await import(`${root}/dist/infra/task/enqueuedTaskFile.js`);

const wf = await determineWorkflow(cwd, process.env.TAKT_WF);
if (!wf) { console.error('Workflow not found'); process.exit(1); }

const issue = Number(process.env.TAKT_ISSUE);
const body = resolveIssueTask(`#${issue}`, cwd);

const created = await saveEnqueuedTaskFile(cwd, body, {
  workflow: wf, issue, worktree: true,
  branch: process.env.TAKT_BRANCH || undefined,
  baseBranch: process.env.TAKT_BASE || undefined,
  autoPr: process.env.TAKT_AUTO_PR !== 'false',
  draftPr: process.env.TAKT_DRAFT === 'true',
});
console.log(JSON.stringify({ ...created, workflow: wf }));
EOF
```

値は**環境変数で渡す**(ヒアドキュメントに直書きするとブランチ名や issue 本文の quoting 事故に
なる)。`<<'EOF'` のクォートも外さない。node は takt 同梱のものを使う — nix ラッパーの
shebang から引くので、**store パスは直書きしない**。

**0.62.0 で検証済み**: 3 つの import パスと引数の形はそのまま通る(実測)。`SaveEnqueuedTaskFileOptions` は
`managedPr` / `shouldPublishBranchToOrigin` / `contextPrNumber` が増えたが、いずれも
省略時は従来の挙動なので上のスクリプトは変えなくてよい。

### この経路で落としてはいけないもの

- **`determineWorkflow` を必ず通す**。`takt add -w` が持っていた実在確認がこれ。省いて
  `workflow` を直書きすると、**存在しないレーン名がそのまま tasks.yaml に積まれる**
  (`Workflow not found` で止まる防護が消える)
- **`worktree: true` を必ず渡す**。落とすと run が隔離クローンを作らず、worktree 必須の規約が崩れる
- **`resolveIssueTask` で issue 本文を取る**。自前の文字列に替えると「issue が仕様の正本」が
  崩れる(フェーズ 1)
- **`baseBranch` の実在は呼び出し側で確認する**。対話版の `resolveExistingBaseBranch` は
  実在しない base を聞き直すが、**内部 API にその検証は無い**。渡す前に
  `git rev-parse --verify <base>` を通す

### draft の既定が対話 UI と逆になる

対話 UI の `Create as draft?` は**既定 Yes**(Enter 連打で draft PR)。この経路では
`TAKT_DRAFT` を明示するので、**指定しなければ通常 PR** になる。draft が欲しいときだけ
`--draft` を受けて `TAKT_DRAFT=true` にする。

### 内部 API が壊れたときの fallback

import が失敗したら**続行せず** [references/fallbacks.md](references/fallbacks.md) の
「内部 API が壊れたとき」に従う(対話 6 問の値の入れ方まで書いてある)。

### 既存 PR への積み増し

`TAKT_BRANCH` に既存ブランチ名を入れるだけで成立し、新しい PR は作られない。
`--pr <番号>` で渡されたときは head ブランチを引いてから入れる:

```sh
gh pr view <番号> --json headRefName --jq .headRefName
```

根拠は 3 点:

- `clone.js::createSharedClone` の分岐順は **リモートに同名ブランチあり → clone して origin から
  fetch → `checkout -B`** が最優先。メインチェックアウトの HEAD やローカルブランチに依存しないので、
  メインが別ブランチにいても起点は push 済みの PR HEAD に確定する
- `postExecution.js` は完了後に `findExistingPr(branch)` を引き、見つかれば新規作成せず
  **push + PR へのコメント追記**で終わる(`gh pr create` の重複エラーにはならない)
- `activeTaskTarget.js::findActiveTaskTargetConflict` の競合判定対象は **pending / running のみ**。
  同じ branch の completed タスクが既にあっても積める

## フェーズ 4: 検証と申し送り

積んだ内容を確認する。投入コマンドの戻り値(`taskName` / `tasksFile`)だけでなく、
**実際に書かれたレコードを読む**(`branch` / `base_branch` / `draft_pr` が意図どおり入ったか)。

```sh
tail -18 .takt/tasks.yaml    # status: pending / workflow / branch / base_branch / draft_pr / issue / task_dir
```

報告に含める: 積んだ slug、選んだ workflow とその理由、branch と draft の別、積み増し先 PR、
`takt run` を誰がいつ回すか(`--run` なら続けてフェーズ 5 に進む旨)、
running があれば即実行になる旨。

## フェーズ 5: cmux の別 pane で回す(`--run`)

`takt run` を前景で回すとエージェントが stdout を読んでしまう。**pane に流して人間が視認し、
エージェントはログを読まない**のが原則。`--run` が無ければこのフェーズには入らない。

### pane の確保

pane の作り方はここでは決め打ちせず、[cmux-workspace](../cmux-workspace/SKILL.md) スキルの
**Right-Side Helper Pane** ポリシーに従う(既存の helper pane があれば surface を足す /
無ければ右に 1 つだけ作る / 作成系には `--focus false`)。フェーズ 3 は pane を使わないので、
**このスキルが pane を要するのはここだけ**(フェーズ 3 が fallback に落ちた場合を除く)。

このスキル側で足す制約は 2 つだけ:

- **surface ref は作成コマンドの戻り値から取る**。`cmux new-pane` / `new-surface` は
  `OK surface:85 pane:83 workspace:20` を返すので、それをそのまま使う。推測で `surface:<N>` を
  打たない。一覧から拾うなら `--pane <ref>` が要る —
  `cmux list-pane-surfaces --workspace <ws>` だけでは **caller pane の surface しか出ない**
  (全体を見るなら `cmux tree --workspace <ws>`)
- **フォーカスを奪わない**。`select-workspace` / `focus-pane` は呼ばない
  (ユーザーは別 workspace を見ている可能性がある)

### 起動

pane 側では **`takt run` をそのまま実行する**。終了後に完了トークンを発火させるだけ。

```sh
SLUG=<slug>; TOKEN=takt-${SLUG}

cmux send --surface surface:<N> "cd <repo_root> && takt run; cmux wait-for -S ${TOKEN}\n"
```

**`-q` を付けない**。`-q` / `--quiet` は *Minimal output mode: suppress AI output (for CI)* で、
AI の出力そのものを落とす。pane は人間が視認するためにあるので、**出力が流れている = 進んでいる /
止まっている = 詰まっている** が一目で分かる状態を保つ。`-q` はその判断材料を消す。

**`tee` も挟まない**。takt 自身が実行クローンの `.takt/runs/<run_slug>/` に `trace.md` /
`logs/*.jsonl` / `reports/` を残すので、別途ログを取る必要が無い。パイプを挟むとバッファリングで
出力が遅延し、やはり視認性が落ちる。

末尾の `\n` が実行トリガ(`cmux send` が改行として解釈する)。付け忘れるとコマンドは pane の
プロンプトに入力されたまま実行されず、完了シグナルも永遠に来ない。

複数 task を積んでいても **起動は 1 回・pane 1 つだけ**。takt の worker pool
(`runAllTasks` → `claimNextTasks` → `runWithWorkerPool`)が pending を消化する
(グローバル設定は `concurrency: 1` なので逐次)。多重起動すると実効並列度が
`concurrency × 起動数` に膨らみ、worktree 競合とトークン暴走を招く。

### 完了検知

トークンの出現を 1 行で待つ。

```sh
cmux wait-for takt-<slug> --timeout 7200
```

- **Claude Code**: この 1 行を `Bash` の `run_in_background: true` で投げる。exit で harness が
  自動再呼び出しするので**こちらから poll しない**。timeout は `3600000ms` 程度
- **Codex / その他 CLI**: 自動再呼び出しが無いので、同じ 1 行を前景で実行してブロックさせる

`cmux wait-for` の性質(いずれも実測):

- **signal が先に来ても取りこぼさない**。トークンは保持されるので、待ち始める前に takt が
  終わってしまうレースを踏まない
- **消費されるのは wait 成功時だけ**。timeout では消費しないので、切れたら同じ行を再実行してよい
  (sentinel ファイルのような事前クリーンアップも不要)
- **`--timeout 7200` は受理され、クランプされずに待機を継続する**
- timeout の exit code は `1`

**作らない・使わない**: 別 wait スクリプト、30s 進捗 echo ループ、`ScheduleWakeup`、`Monitor`、
`cmux read-screen` の繰り返し poll。いずれも token を無駄に食う。
shell 内で完結する 1 コマンドの待機はこれに該当しない。

### cmux 非搭載環境の fallback

`CMUX_WORKSPACE_ID` が空 / `cmux` が無いときは
[references/fallbacks.md](references/fallbacks.md) の
「cmux 非搭載環境」に従う(sentinel 検知の 1 コマンド版がある)。

### 完了時の確認

単一の `takt run` は pending を全消化してから exit するので、この 1 判定で全件を待てる。
`tasks.yaml` で各 task の最終 status を読む。

| status | 見るもの |
| --- | --- |
| `completed` | PR URL は `tasks.yaml` の `pr_url`、無ければ `gh pr list --head <branch>` |
| `failed` / `aborted` | 下記のログで原因を読む |

**ログの所在に注意**。takt はタスクを隔離クローンで実行するため、**メインチェックアウトの
`.takt/runs/` には builtin workflow の run しか無い**。実行の実績を辿るときは
`.takt/clone-meta/<name>.json` の `clonePath` を読み、その配下の
`.takt/runs/<run_slug>/reports/` を見る。

pane の出力を読みたいときは `cmux read-screen --surface <N> --lines 80` を**完了後に 1 回だけ**
使う(`tee` を張らない代わりの手段。繰り返し poll はしない)。

`.takt/runs/**/logs/*.jsonl` と `trace.md` は全文表示しない。`wc -c` / `du -sh` / `jq` で
集計してから必要行だけ読む。完了後の報告は status・PR URL・テスト結果・review verdict に絞る。

## 落とし穴

初見の症状・エラーは対処の前に [references/gotchas.md](references/gotchas.md) を確認する
(`--pipeline` の 3 段ずれ、report ディレクトリ改名、skills 無効化などが並ぶ)。
