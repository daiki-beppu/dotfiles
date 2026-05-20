# finalize-pr — commit + push + PR 作成

このファイルは Claude Code の `pr` skill (`~/.claude/skills/pr/SKILL.md`) の **PR 作成部分** と同じ動作を takt workflow の最終 step として再現するためのもの。`pr` skill 側の PR 作成挙動を変更したら、こちらも追従させること（self-review / CI 検証は別 instruction `self-review` / `ci-verify` に切り出されている）。

takt の auto-commit 済みブランチに対して **追加 commit + push + `gh pr create`** を順番に実行し、PR を作成する。self-review / CI ローカル検証は前段の `self_review` / `ci_verify` step で完了している前提。

## 前提

- takt が `takt/<N>/<slug>` ブランチを作り、auto-commit 済みである
- 作業ディレクトリは worktree 内
- 前段 `self_review` step が修正を行っていれば、worktree に未コミット差分がある場合がある
- 前段 `ci_verify` step が成功している（失敗していれば `fix` step に戻っている）

## Step 1: commit + push

```bash
git status --short
```

前段 `self_review` で修正が発生した場合のみ追加コミット:

```bash
git add -A
git commit -m "chore: self-review fixes"
```

takt の auto-commit を **書き換えない** こと（`git commit --amend` 禁止）。

push:

```bash
BRANCH=$(git branch --show-current)
git push -u origin "$BRANCH"
```

## Step 2: PR 化（新規作成 or 既存 PR 積み上げ）

base branch によって動作を切り替える。

```bash
BRANCH=$(git branch --show-current)
BASE_BRANCH=$(git for-each-ref --format='%(upstream:short)' "$(git symbolic-ref -q HEAD)" 2>/dev/null | sed 's|origin/||')
# fallback: tracking branch がない場合は main を base とみなす
[ -z "$BASE_BRANCH" ] && BASE_BRANCH=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|origin/||' || echo main)
```

判定:

- `BASE_BRANCH` が `main` / `master` → **新規 PR 作成モード**: 2-A〜2-F を実行
- それ以外（既存の feature/release/chore ブランチ等） → **既存 PR 積み上げモード**: 2-G にジャンプ

### 2-A. issue 番号の抽出

```bash
BRANCH=$(git branch --show-current)            # 例: takt/127/refactor-auth
ISSUE_N=$(echo "$BRANCH" | sed -nE 's|^takt/([0-9]+)/.*|\1|p')
```

`ISSUE_N` が空ならコミットメッセージから抽出を試みる:

```bash
git log main..HEAD --format=%B | grep -oE '#[0-9]+' | head -1 | tr -d '#'
```

それでも見つからない場合は closing keyword なしで PR を作成（人手で後追記）。

### 2-B. ラベルからテンプレート判定

```bash
gh issue view "$ISSUE_N" --json labels,title,state -q '.labels[].name' 2>/dev/null
```

| ラベル | 採用テンプレート | closing keyword |
|--------|------------------|-----------------|
| `bug` / `fix` を含む | `~/.claude/skills/pr/references/pr-template-fix.md` | `Fixes #<N>` |
| `feature` / `enhancement` を含む | `~/.claude/skills/pr/references/pr-template-feat.md` | `Closes #<N>` |
| それ以外 (`chore` / `docs` / `refactor` 等) | `pr-template-feat.md` をベースに簡略化（Summary と Test plan のみ残す） | `Closes #<N>` |

テンプレート本体は Read ツールで読み、`Closes #番号` / `Fixes #番号` の行を実 issue 番号で置換する。

### 2-C. draft フラグ

```bash
cat .takt/config.yaml 2>/dev/null | grep -E '^draft_pr:\s*true' && DRAFT_FLAG=--draft || DRAFT_FLAG=
```

### 2-D. PR 本文の組み立て

`git log main..HEAD --format='%s%n%n%b'` の全コミットメッセージを分析して、テンプレートの各セクションを埋める:

- **概要**: 1〜3 文で「何を / なぜ」
- **設計判断** (feat): plan.md / architect-review.md / supervisor-validation.md の `output_contracts` レポートから抽出
- **変更内容**: 主要な変更点を箇条書き
- **テスト計画**: write_tests.md の出力 or 手動 e2e 手順

closing keyword は **issue ごとに 1 行**（`Closes #14 #15` は GitHub が認識しないので NG）。

### 2-E. PR 作成

```bash
gh pr create $DRAFT_FLAG \
  --base "$(git rev-parse --abbrev-ref @{u} | sed 's|origin/||' || echo main)" \
  --title "<commit-convention タイプ>: <要約>（70 字以内・日本語）" \
  --body "$(cat /tmp/finalize-pr-body.md)"
```

PR URL を `output_contracts/finalize-pr.md` に記録する。

### 2-F. 既存 PR チェック

PR 作成前に既存 PR を確認:

```bash
gh pr list --head "$BRANCH" --json number,url --jq '.[0].url'
```

既に PR が存在する場合は新規作成せず URL を `finalize-pr.md` に記録して step を終了（COMPLETE）。「重複作成しない」のは pr skill と同じ挙動。

### 2-G. 既存 PR 積み上げ

`BASE_BRANCH` が `main` / `master` 以外の場合に実行する。worktree ブランチを既存 PR ブランチに merge して push し、PR 本文に `Closes #<N>` を追記する。

```bash
# 1. main repo に戻る
MAIN_REPO=$(git rev-parse --show-toplevel | xargs dirname | xargs dirname)  # worktree path から逆算
cd "$MAIN_REPO"

# 2. 既存 PR ブランチに切り替えて worktree ブランチを merge
git checkout "$BASE_BRANCH"
git pull --ff-only origin "$BASE_BRANCH"
git merge --no-ff "$BRANCH" -m "Merge $BRANCH into $BASE_BRANCH"
git push origin "$BASE_BRANCH"

# 3. 既存 PR 本文に Closes #<N> を追記
EXISTING_PR=$(gh pr list --head "$BASE_BRANCH" --state open --json number -q '.[0].number')
if [ -n "$EXISTING_PR" ] && [ -n "$ISSUE_N" ]; then
  CURRENT_BODY=$(gh pr view "$EXISTING_PR" --json body -q '.body')
  echo "$CURRENT_BODY" | grep -qE "^(Closes|Fixes) #${ISSUE_N}$" || {
    NEW_BODY="${CURRENT_BODY}

Closes #${ISSUE_N}"
    gh pr edit "$EXISTING_PR" --body "$NEW_BODY"
  }
fi
```

積み上げ先の PR URL を `output_contracts/finalize-pr.md` の `## PR` セクションに「積み上げモード」と明記して記録する。

## 失敗時の挙動

| 失敗内容 | 次の step |
|----------|-----------|
| `gh pr create` が認証エラー / 既存 PR エラー | `COMPLETE`（人手で takt-issue skill 経由で対応） |

## output_contracts/finalize-pr.md フォーマット

```
# finalize-pr 実行結果

## commit + push
- 追加コミット: yes / no
- push 結果: 成功 / 失敗

## PR
- モード: 新規作成 / 積み上げ
- URL: <https://github.com/...>
- closing keyword: Closes #<N>
- テンプレート: feat / fix / 簡略版
- draft: true / false
```

## Rules

- takt の auto-commit メッセージ（`takt: <slug>`）は書き換えない
- 前段 `self_review` の修正分のみ追加コミットする
- `Skill()` ツールに依存しない（workflow の provider 非対応のため、すべてインラインで実行）
- `Closes #N` / `Fixes #N` は issue ごとに 1 行
- 既存 PR があれば重複作成しない（URL を記録して COMPLETE）
- Node プロジェクトでは必ず `ni` / `nr` / `nlx` 経由で実行
