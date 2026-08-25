# Plan 021: takt スキルを takt 0.62.0 の実体に再整合し、参照素材を references/ へ分割する

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f9948f8..HEAD -- config/.claude/skills/takt`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED（fallback 表・落とし穴は失敗経路でだけ読まれる素材 — 分割でポインタが
  弱いと、いざという時にエージェントが即興で動く）
- **Depends on**: none（takt スキルのファイルだけを触る）
- **Category**: docs
- **Planned at**: commit `f9948f8`, 2026-08-26

## Why this matters

`config/.claude/skills/takt/SKILL.md`（589 行）は 0.54〜0.55.1 時点の実測で書かれており、
インストール済みの takt は **0.62.0**。実測で確認済みのドリフト（下記）は 2 種類の実害を持つ:
存在しないレーン（`takt-default-team-high`）を推薦して enqueue が `Workflow not found` で
止まる、そして callable ブラックリストの 7 本の漏れが「投入は成功し `takt run` で初めて
failed になる」— スキル自身が「投入時に検出できない」と警告している事故そのもの。

あわせて、589 行のうち約 220 行は失敗時にだけ読む参照素材（落とし穴 90 行・fallback 表・
builtin カタログ）であり、毎回の起動でロードする必要が無い。再整合で書き直すこの機会に
references/ へ分割する（同居スキル gh-stack / improve が既にこの構造）。

**改訂（2026-08-26、eli5 / writing-for-agents 基準）**: 本数・実名の列挙は、スキル自身が
持つレシピ（`ls "$BUILTIN/workflows/"` / `grep -l "callable: true"`）の**キャッシュ**であり、
takt を更新するたび黙って腐る。今回の腐敗（66→72 本、callable 12→18）はその実例。
方針は「新しい数字に更新する」ではなく「**数字と実名の列挙を削除し、レシピを唯一の正とする**」。
消えない事実（概念軸・死んだラベル・挙動の理由）だけを本文に残す。

## Current state

対象は `config/.claude/skills/takt/SKILL.md` 1 ファイル（`references/` ディレクトリは
**存在しない**）。0.62.0 に対する実測（2026-08-26、この計画の作成時に検証済み）:

| 主張（現行 SKILL.md） | 0.62.0 の実体 |
|---|---|
| `:152` 「builtin(0.55.1 で 66 本)」 | **72 本** |
| `:212` 深度の梯子「`simple-*` → `*-mini` → 無印 → `*-high`」 | `*-high` は **0 本**（梯子の右端が消えた） |
| `:220-221` 「leader 経路が欲しいときは `takt-default-team-high` を明示する」 | 存在しない。実在は `takt-default-team` |
| `:226-229` callable は「0.55.1 時点で 12 本」+ 列挙（`merge-readiness-{,dual-,finding-contract-}final-gate` 等） | **18 本**。`merge-readiness-*` 3 本は消滅、`development-implement` 系など 7 本が列挙に無い |
| `:179-180` 「dotfiles は `takt:default-mini` / `takt:lite` / `takt:docs` / `takt:manual` を運用している」（死んでいるのは lite / docs だけという書きぶり） | builtin に `default-mini` は無い。**`takt:manual` 以外の 3 ラベルすべてが実在しないレーンを指す** |
| `:305` 「0.55.1 で 3 つの import パスと引数の形はそのまま通る(実測)」 | 0.62.0 でも 3 パスとも解決し export も現存（本計画作成時に確認済みだが、Step 1 で再検証する） |

バージョンスタンプは `:84, :138, :152, :158, :216, :227, :305, :531, :533, :540, :544` に
0.54 / 0.55.0 / 0.55.1 として散在する。

そのほか修正対象の実バグ 1 件 — `:462-468`（cmux 非搭載環境の fallback）:

```sh
LOG=/tmp/takt_<slug>.log; DONE=/tmp/takt_<slug>.done; rm -f "$DONE"

# Claude Code: run_in_background: true
takt run > "$LOG" 2>&1; touch "$DONE"

# Codex
nohup sh -c "takt run > \"$LOG\" 2>&1; touch \"$DONE\"" &
```

Claude Code の Bash ツールはシェル状態を呼び出し間で持ち越さない。1 行目と `takt run` 行を
別々の Bash 呼び出しにすると `$LOG` / `$DONE` が空展開になり、`takt run > ""` が即失敗して
sentinel が永遠に作られず、`:474` の検知ループが永久待ちになる（検知ループはリテラルパス
`/tmp/takt_<slug>.done` を使っており、ブロック内で変数とリテラルが混在しているのが原因）。

構造の手本: `config/.claude/skills/gh-stack/references/`（commands / stack-design /
troubleshooting の 3 分割）と `config/.claude/skills/improve/references/`。

builtin の一覧・callable の導出は、スキル自身が書いているレシピ（`:153` と `:234`）を使う:

```sh
BUILTIN=$(dirname "$(dirname "$(realpath "$(which takt)")")")/lib/node_modules/takt/builtins/ja
ls "$BUILTIN/workflows/" | wc -l
cd "$BUILTIN/workflows" && grep -l "callable: true" *.yaml | sed 's/\.yaml$//'
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| takt バージョン | `takt -V` | `0.62.0`（違ったら STOP 条件参照） |
| builtin 総数 | `ls "$BUILTIN/workflows/" \| wc -l` | `72` |
| callable 数 | `cd "$BUILTIN/workflows" && grep -l "callable: true" *.yaml \| wc -l` | `18` |
| `*-high` 不在 | `ls "$BUILTIN/workflows/" \| grep -c -- '-high'` | `0` |
| team 系実在 | `ls "$BUILTIN/workflows/" \| grep team` | `takt-default-team.yaml` を含む |
| ラベル実在 | `gh label list --json name --jq '.[].name' \| grep '^takt:'` | 4 ラベル（default-mini / lite / docs / manual） |
| import 検証 | 下記 Step 1 | エラーなし |
| shellcheck | `bash scripts/check.sh shellcheck` | exit 0（本プランは .md のみだが最終確認に含める） |

## Scope

**In scope**:

- `config/.claude/skills/takt/SKILL.md` — 書き換え
- `config/.claude/skills/takt/references/gotchas.md` — 新規
- `config/.claude/skills/takt/references/workflow-catalog.md` — 新規
- `config/.claude/skills/takt/references/fallbacks.md` — 新規
- `plans/README.md` — 自分の status 行

**Out of scope**:

- frontmatter の `description`（`:3-13`）— Plan 023（description 手術）の担当。
  本文と同時に直したくなっても触らない（コンフリクト回避）
- 他スキルからの参照（`issue-direct` が takt の policy ファイルを読む記述等）
- takt 本体・`.takt/` 配下・`scripts/`（かつて存在した contracts チェックと
  `scripts/takt-builtin-workflows.txt` は `dd218c5` で意図的に撤去済み。復活させない）

## Git workflow

- Branch: `docs/takt-062-realignment`（worktree: `$REPO_ROOT/.claude/worktrees/takt-062-realignment/`）
- コミット例: `docs(skills): takt スキルを 0.62.0 実測に再整合し references/ へ分割`
- 編集は必ず `config/.claude/skills/takt/` 側で行う（`~/.claude/skills/` は symlink）

## Steps

### Step 1: 0.62.0 の実体を自分で採取する

上の Commands をすべて実行し、結果を控える。加えて内部 API の import 検証
（読み取り専用 — enqueue はしない）:

```sh
TAKT_ROOT=$(dirname "$(dirname "$(realpath "$(which takt)")")")/lib/node_modules/takt
TAKT_NODE=$(grep -o '/nix/store/[^ ]*/bin/node' "$(realpath "$(which takt)")" | head -1)
TAKT_ROOT="$TAKT_ROOT" "${TAKT_NODE:-node}" --input-type=module -e "
const root = process.env.TAKT_ROOT;
const a = await import(\`\${root}/dist/features/tasks/execute/selectAndExecute.js\`);
const b = await import(\`\${root}/dist/infra/git/index.js\`);
const c = await import(\`\${root}/dist/infra/task/enqueuedTaskFile.js\`);
console.log(typeof a.determineWorkflow, typeof b.resolveIssueTask, typeof c.saveEnqueuedTaskFile);
"
```

**Verify**: `function function function` が出力される。callable 一覧（18 本の名前）を
控えておく — Step 3 でスキルに書く内容の一次資料はこの採取結果であり、本プランの表ではない。

### Step 2: 事実の修正を SKILL.md に入れる

references/ 分割の**前に**、現行ファイル上で事実を直す（分割と混ぜると diff がレビュー
不能になる）。個別に:

1. `:152` — コメント「builtin(0.55.1 で 66 本)」から**本数を削除**する:
   `# builtin の一覧(本数は実行結果が正)。言語は .takt/config.yaml の language に対応`
2. `:212` — 深度の梯子から `*-high` を外す: `simple-*`(最小) → `*-mini`(軽量) → 無印
3. `:216-221` — 「0.54〜0.55 で builtin の構成が動いた」ブロックを 0.62 実測で書き直す。
   `takt-default-team-high` への言及を `takt-default-team` に置換。`simple` 系・QA reviewer
   撤去の記述は 0.62.0 でも変わっていないか `ls` / `grep` で確認してから残す
4. `:226-235` — callable の**実名列挙と本数を削除**し、判別レシピ
   （`grep -l "callable: true"`、`:231-234`）を唯一の正とする。残すのは事実の説明だけ:
   「callable は投入時に素通りし `takt run` で初めて failed になる(積んだ時点で気づけない)」
   「`ls` の一覧に普通のレーンと並んで出るため名前では区別できない」「プロジェクト固有レーン
   では `intake` / `impl-review` が該当しがち」。列挙を再作成しない — 更新のたび腐るのは
   Step 1 で実測したとおり
5. `:179-184` — ラベル運用の記述を「`takt:manual` 以外（`default-mini` / `lite` / `docs`）は
   指すレーンが builtin に実在しない」事実に合わせる。`gh label list` の実測に基づく
6. `:305-307` — 「0.55.1 で…そのまま通る」→ Step 1 の import 検証結果で「0.62.0 で検証済み」に更新
7. `:462-468` — fallback ブロックを検知ループ（`:474`）と同じ**リテラルパス**に統一する:

```sh
rm -f /tmp/takt_<slug>.done

# Claude Code: run_in_background: true(1 回の Bash 呼び出しに収める。変数は呼び出し間で持ち越されない)
takt run > /tmp/takt_<slug>.log 2>&1; touch /tmp/takt_<slug>.done

# Codex
nohup sh -c 'takt run > /tmp/takt_<slug>.log 2>&1; touch /tmp/takt_<slug>.done' &
```

8. 散在するバージョンスタンプを整理する: 見出し `# takt タスク投入・実行` の直下に
   `> 最終検証: takt 0.62.0(2026-08-26)。バージョン付きの記述はその版での実測を示す。` を
   1 行置き、`:84, :138, :158` などの「0.55.x で入った/変わった」という**歴史的事実の記述は
   残し**、「0.55.1 時点で N 本」のような**現在形の在庫数**からはバージョンを外す
   （在庫数は冒頭スタンプが管掌する）。`:531-547` の 0.55.0 BREAKING 3 件はバージョンが
   論点そのものなので残す

**Verify**:
`grep -c 'takt-default-team-high' config/.claude/skills/takt/SKILL.md` → `0`、
`grep -c '0.55.1 で 66' config/.claude/skills/takt/SKILL.md` → `0`、
`grep -c 'merge-readiness-\|development-core\|simple-core' config/.claude/skills/takt/SKILL.md` → `0`（実名列挙が消えている）、
`grep -c '最終検証: takt 0.62.0' config/.claude/skills/takt/SKILL.md` → `1`

### Step 3: references/ へ分割する

`config/.claude/skills/takt/references/` を作り、次を**移動**する（要約して書き直さない。
Step 2 適用後の本文をそのまま移す）:

| 新ファイル | 移す内容（Step 2 適用後の行位置は前後する — 見出しで特定する） |
|---|---|
| `references/gotchas.md` | `## 落とし穴` セクション全体（現 `:500-589`） |
| `references/workflow-catalog.md` | フェーズ 2 内の「意図の語彙表」（現 `:191-207`）と「builtin の選択軸・深度」（現 `:209-224`、Step 2 適用後の姿）。callable の**判別レシピと素通り挙動の説明は本文に残す**（毎回の投入で必要な branch のため） |
| `references/fallbacks.md` | 「内部 API が壊れたときの fallback」（現 `:327-349`、6 問の対話表を含む）と「cmux 非搭載環境の fallback」（現 `:456-477`） |

本文側には、それぞれの移動元の位置に**読み時機を明記したポインタ**を置く。書式:

```markdown
レーンの語彙・builtin カタログ・callable 実名一覧は [references/workflow-catalog.md](references/workflow-catalog.md)。
**プロジェクト固有レーンが無く builtin から選ぶ場合は必ず読む**。
```

```markdown
import が失敗したら**続行せず** [references/fallbacks.md](references/fallbacks.md) の
「内部 API が壊れたとき」に従う(対話 6 問の値の入れ方まで書いてある)。
```

```markdown
`CMUX_WORKSPACE_ID` が空 / `cmux` が無いときは [references/fallbacks.md](references/fallbacks.md) の
「cmux 非搭載環境」に従う(sentinel 検知の 1 コマンド版がある)。
```

```markdown
初見の症状・エラーは対処の前に [references/gotchas.md](references/gotchas.md) を確認する
(--pipeline の 3 段ずれ、report ディレクトリ改名、skills 無効化など 17 項目)。
```

**本文に必ず残すもの**（分割対象にしない）: 概要と設計の骨子（`:16-45`）、
Invocation variants（`:47-60`）、フェーズ 1 全体、フェーズ 2 の「実在レーンの確認(毎回やる)」
（`:146-161`）と判定順（`:163-190`）と callable **判別レシピ**、フェーズ 3 の投入スクリプト
（`:267-325`）と「落としてはいけないもの」、フェーズ 4、フェーズ 5 の pane 起動・完了検知・
`-q`/`tee` 禁止（`:383-455` と `:479-498`）。

**Verify**:

```bash
wc -l config/.claude/skills/takt/SKILL.md config/.claude/skills/takt/references/*.md
for f in $(grep -o 'references/[a-z-]*\.md' config/.claude/skills/takt/SKILL.md | sort -u); do
  test -f "config/.claude/skills/takt/$f" && echo "OK $f" || echo "MISSING $f"
done
```

→ SKILL.md が **400 行以下**、references 3 ファイルが存在、`MISSING` 0 件。

### Step 4: 内容の欠落が無いことを確認する

```bash
git diff --stat -- config/.claude/skills/takt/
grep -c 'wait-for' config/.claude/skills/takt/SKILL.md          # 完了検知が本文に残っている
grep -rc 'Right-Side Helper Pane' config/.claude/skills/takt/   # cmux-workspace への委譲が残っている
grep -c 'callable: true' config/.claude/skills/takt/SKILL.md    # 判別レシピが本文に残っている
```

**Verify**: 上 3 つの grep がすべて 1 以上。diff --stat の削除行数と references 3 ファイルの
追加行数が概ね釣り合う（±30 行以内。大きく減っていたら内容を落としている）。

### Step 5: 全チェック

```bash
bash scripts/check.sh
```

**Verify**: `all checks passed`、exit 0

## Test plan

CI にスキル文書の整合テストは無い（かつての contracts チェックは `dd218c5` で撤去済み）。
検証は Step 1 の実測採取と Step 2〜4 の grep / wc ゲートが担う。レビュー時の実地確認として、
可能なら takt 導入済みリポジトリで `--dry-run` 相当（フェーズ 2 の実在確認まで）を
なぞり、更新後のカタログで矛盾が出ないことを見る。

## Done criteria

- [ ] Step 2 の 4 grep がすべて期待値どおり
- [ ] `wc -l config/.claude/skills/takt/SKILL.md` ≤ 400
- [ ] `ls config/.claude/skills/takt/references/` → `fallbacks.md gotchas.md workflow-catalog.md`
- [ ] 本文からの references リンク切れ 0 件（Step 3 の for ループ）
- [ ] `bash scripts/check.sh` exit 0
- [ ] In scope 外の変更なし（`git status`）— 特に frontmatter description が無変更であること
- [ ] `plans/README.md` の status 行を更新済み

## STOP conditions

Stop and report back (do not improvise) if:

- `takt -V` が 0.62.x でない（このプランの実測表が無効。**プランの数字を書き写さず**、
  新バージョンで Step 1 を採り直した結果を報告して指示を仰ぐ）
- Step 1 の import 検証が失敗する（`dist/` 構造が動いた — スキルの `:327` fallback 経路が
  現実になっている。本文の該当記述の書き換え方針ごと報告する）
- builtin 総数・callable 数が本プラン記載（72 / 18）と 3 以上ずれる（takt が更新された。
  数字は実測に従い、その旨を README の status に書く）
- 分割後の SKILL.md が 400 行に収まらない（残すべき本文の判断がプランと食い違っている —
  何をどちらに置いたかの一覧を添えて報告）

## Maintenance notes

- **takt を更新したら**（`chore(nix): takt を vX.Y.Z に更新` のコミット時）、
  冒頭の「最終検証」スタンプを更新し、深度の梯子・選択軸が実体と合っているかを
  スキル自身のレシピで確認する（実名・本数の列挙は削除済みなので採り直し作業は無い —
  それがこの改訂の狙い）。スキル本文の「更新後は最初の 1 件で tasks.yaml を必ず確認する」
  ルールの文書版
- レビュアーの注視点: (1) 移動と書き換えが同じ hunk に混ざっていないか
  （Step 2 と Step 3 は別コミットにすると読みやすい）、(2) 「本文に必ず残すもの」の
  リストが実際に本文に残っているか
- description の圧縮（`:3-13`）は Plan 023 が行う。本プランとどちらが先でも
  コンフリクトしない（frontmatter と本文で領域が分かれている）が、同時実行は避ける
