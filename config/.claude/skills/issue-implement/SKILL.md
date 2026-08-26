---
name: issue-implement
description: >-
  GitHub issue を自セッションで直接実装し、gh-stack で PR 化して全段 CI green まで走り切る。
  「issue #N を対応して」(単一 issue)、「親 issue #N をまとめて対応して」(子 issue を依存順の段として積む)で発動。
  takt のキューに任せて別 pane で回すのは takt スキル。レビューとマージは対象外(CI green + ready for review で完了)。
---

# issue-implement

対象 issue を段(1 issue = 1 ブランチ = 1 PR)の列にし、gh-stack のスタックとして下から積み上げ、**全段 CI green + `gh pr ready` で完了**する。レビュー・マージ・worktree 削除はスコープ外。`gh stack` のコマンド作法・exit code・復旧手順は gh-stack スキルに従う。

## 1. 段の列を決める

子 issue と依存関係は 1 クエリで取る(GitHub ネイティブの blocking 関係が正。本文の記述は見ない):

```bash
gh api graphql -f query='
query($owner:String!,$repo:String!,$num:Int!){
  repository(owner:$owner,name:$repo){
    issue(number:$num){
      number title
      blockedBy(first:20){ nodes{ number title state url } }
      subIssues(first:50){
        nodes{ number title state url
          blockedBy(first:20){ nodes{ number state } } }
      }
    }
  }
}' -F owner=<owner> -F repo=<repo> -F num=<N>
```

- **親 issue**: CLOSED の子を除外し、子集合内の `blockedBy` だけを辺としてトポロジカルソートし 1 本に直列化する(blocker 無し同士は番号昇順)。循環は積まずに停止してユーザーへ。独立な段に順序を付けた場合は完了報告に 1 行添える。「#N だけやって」と明示されたらその 1 段のみ。
- **単一 issue**: 1 振る舞い(完了時に利用者から見て何が 1 つ変わるかを 1 文で言い切れる)に収まるか判定する。収まらなければ(迷う場合も)分割案を AskUserQuestion で確認し、合意なら issue スキルの `references/organize.md` の手順で子 issue を作成して親 issue のフローへ。
- **集合外の blocker**: state でなく **PR の有無**で判定する — `gh pr list --search "<B> in:body" --state open`。PR があれば(OPEN / MERGED とも)その上に積んで着手してよい。OPEN かつ PR 無しなら積む先が無いため着手せず、blocker 一覧を提示してユーザーに確認。

## 2. worktree を用意する(1 スタック = 1 worktree)

段はブランチで表し、**段ごとに worktree を分けない**(`gh stack` のナビゲーションは同一チェックアウト前提)。subagent も同じ worktree で作業させる(`isolation: worktree` は使わない — 別チェックアウトになりスタックが壊れる)。

- **既存スタックに積む**(blocker の PR がある場合): その PR のブランチを含む worktree を `git worktree list` で特定して使う。1 段目も `gh stack init` でなく `gh stack top` → `gh stack add`。blocker が複数で別スタックに割れる場合は最も密接な 1 本に積み、自明でなければユーザーに確認。
- **既存 worktree の再利用**: 他クライアントが同じ issue の worktree を作っていることがあるため、新規作成前に `git worktree list` を確認する。あればそのまま使う(`git log --oneline main..HEAD` でベースの古さを見て、必要なら `git merge main`)。
- **新規**: worktree 名はスタック全体の slug、切るブランチは 1 段目の名前にする(後の `gh stack init` が既存ブランチとして adopt する):

  ```bash
  cd <repo_root> && git checkout main && git pull --ff-only
  git worktree add ".claude/worktrees/<stack-slug>" -b "<1段目のブランチ>"
  # 手動 add では .worktreeinclude が効かないため自分でコピーする
  if [ -f .worktreeinclude ]; then
    rg -v '^\s*(#|$)' .worktreeinclude | while read -r p; do
      [ -e "$p" ] || continue
      mkdir -p ".claude/worktrees/<stack-slug>/$(dirname "$p")"
      cp -R "$p" ".claude/worktrees/<stack-slug>/$p"
    done
  fi
  ```

実装 policy は worktree 内で 1 回だけ解決し、**絶対パスだけ**控える(親は中身を開かない — 3 本で 60KB あり司令塔のコンテキストを圧迫する):

```bash
~/.claude/skills/issue-implement/references/resolve-policy.sh coding testing ai-antipattern
```

takt 未導入のリポジトリでは何も出力されない(exit 0)。policy 無しで進み、ここで止めない。Codex からの実行時は `~/.agents/skills/issue-implement/references/resolve-policy.sh`。

## 3. 段ループ(パイプライン — CI を待たずに次段へ)

各段 `i`(issue `<Ni>`)について:

1. **ブランチ**: 新規スタックの 1 段目は `gh stack init "<BRANCH>"`。それ以外は `gh stack top` してから `gh stack add "<BRANCH>"`(add は topmost でのみ実行できる)。
2. **実装**: 段が 2 つ以上なら subagent に委任する — `subagent_type: general-purpose`、**`run_in_background: false`(必須。既定の background だと実装完了前に次段へ進みスタックが壊れる)**、`isolation` 指定なし。プロンプトは [references/subagent-prompts.md](references/subagent-prompts.md) を委任のたびに開いて**逐語コピー**し `<...>` を埋める。issue 本文も policy 本文も親は読まず、**番号とパスだけ**渡す。段が 1 つだけなら親が自分で実装する(同ファイルの `## 進め方` に従う — tdd スキルの駆動と seam の決定はそこにある。この場合は policy も親が読む)。`STATUS: blocked` / commit 無しなら段ループを止め、理由を添えてユーザーへ(上段は下段に依存するため失敗段を飛ばして進めない)。
3. **submit**: `gh stack submit --auto`(冪等 — 毎段呼んでよい。`gh pr create` はその段をスタック外に落とすため使わない)。PR は draft のまま置く。exit 9(stacked PR 無効)なら、段が 1 つのときだけ `gh pr create --draft` にフォールバックして完了報告に 1 行添え、複数段なら停止してユーザーへ。
4. **タイトル・本文**: submit 直後に必ず `gh pr edit` で上書きする(`--auto` の自動生成はコミットが 2 個以上になるとブランチ名の humanize に劣化して body が落ちる)。本文は変更の実質のみ + `Closes #<Ni>`。

   ```bash
   PR_NUM=$(gh stack view --json | jq -r '.branches[] | select(.isCurrent) | .pr.number')
   ```

5. **CI を background へ**: fine-grained PAT では `gh pr checks` / `gh run watch` が使えないため同梱スクリプトで監視する(exit 0=green / 1=red / 8=timeout)。解決と起動は 1 回のシェル呼び出しに収める(変数は呼び出し間で持ち越されない):

   ```bash
   CI_WATCH="$HOME/.agents/skills/issue-implement/references/watch-pr-actions.sh"
   [ -x "$CI_WATCH" ] || CI_WATCH="$HOME/.claude/skills/issue-implement/references/watch-pr-actions.sh"
   "$CI_WATCH" "<PR番号>" 30 2400 > "/tmp/ci_pr<PR番号>.log" 2>&1
   ```

   Claude Code では `run_in_background: true` で投げれば exit 時に自動で再呼び出しされる(poll しない)。Codex 等の自動再呼び出しが無い CLI では `nohup ... & echo $! > /tmp/ci_pr<PR番号>.pid` で投げ、Step 4 でまとめて待つ。監視できるのは GitHub Actions の run のみ — 外部 CI の required check があるリポジトリでは green と判定しない。
6. **下段の red を検知したら**次段の実装に進まず先に fix する(壊れた土台に積むと後続全段が巻き添えで切り分け不能になる)。

## 4. CI 回収 → fix(段ごとに最大 3 周)

checks の合否だけで判断せず、各段の conflict も見る:

```bash
gh pr view <PR_NUM> --json mergeable,mergeStateStatus
```

- **CONFLICTING / DIRTY** → `gh stack sync` で解消する(手動 `git merge` / `git rebase` はスタックの追跡状態と食い違うため不可。exit 3 以降の復旧は gh-stack スキル)。解消後、その段の CI を投げ直す。
- **red の段は下から**直す(下段の修正が上段の red を解消することがある):

  ```bash
  gh stack checkout "<red の段のブランチ>"
  HEAD_SHA=$(gh pr view "<PR_NUM>" --json headRefOid --jq '.headRefOid')
  gh run list --commit "$HEAD_SHA" --event pull_request --json databaseId,workflowName,conclusion,url \
    --jq '.[] | select(.conclusion != null and (.conclusion | IN("success","neutral","skipped") | not))'
  gh run view <run-id> --log-failed
  ```

  fix も実装と同条件で subagent へ委任する(テンプレは同じく逐語コピー。段が 1 つなら親が直す)。修正後は `gh stack rebase --upstack` → `gh stack push` → `gh stack top` で上段へ伝播させ、内容が変わった段の CI を投げ直す。
- **同じ段で 3 周超過**、または `STATUS: out-of-scope` / `blocked` → ユーザーに報告して判断を仰ぐ。**親が代わりに裁定して直さない**(policy と要件の噛み合わなさは人間の裁定領域)。

## 5. 完了報告

全段 green を確認したら**段ごとに** `gh pr ready <PR_NUM>`(`gh stack submit --open` はスタック全体を ready 化し green でない段まで巻き込むため使わない)。worktree は残す(上に積むとき再利用する。削除は merge 後に clean-branch へ委譲)。

報告は結論から: 下段から順の PR 一覧(issue / PR URL / 1 行要約) → 段ごとの CI 結果と fix 周回数 → 直列化の注記 → subagent の NOTES。途中の実況はしない — 着手時に段の列を 1 回提示し、以降は方針が変わったとき(分割提示・blocker 検出・red 検出・fix 突入・停止)だけ短く報告する。subagent の出力は再点検せず、各段の品質担保は TDD と CI に置く。スコープは各 issue の要件のみ — 気づいた別の改善は実装せず報告に 1 行添える。
