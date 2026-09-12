# 非対話の投入

起票済み issue を投入するときに読む。以下は takt 0.62.0 での実測。現行版の API と CLI を照合し、互換性を確認できない場合は fallback を使う。


**`takt add` は使わない**。ユーザーに 6 問のプロンプトを手入力させる代わりに、
takt の内部 API を直呼びして対話ゼロで積む。pane も要らない。

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

### この経路で落としてはいけないもの

- **`determineWorkflow` を必ず通す**。`takt add -w` が持っていた実在確認がこれ。省いて
  `workflow` を直書きすると、**存在しないレーン名がそのまま tasks.yaml に積まれる**
  (`Workflow not found` で止まる防護が消える)
- **`worktree: true` を必ず渡す**。落とすと run が隔離クローンを作らず、worktree 必須の規約が崩れる
- **`resolveIssueTask` で issue 本文を取る**。自前の文字列に替えると「issue が仕様の正本」が
  崩れる(SKILL.md の投入条件)
- **`baseBranch` の実在は呼び出し側で確認する**。対話版の `resolveExistingBaseBranch` は
  実在しない base を聞き直すが、**内部 API にその検証は無い**。渡す前に
  `git rev-parse --verify <base>` を通す

### draft の既定が対話 UI と逆になる

対話 UI の `Create as draft?` は**既定 Yes**(Enter 連打で draft PR)。この経路では
`TAKT_DRAFT` を明示するので、**指定しなければ通常 PR** になる。draft が欲しいときだけ
`--draft` を受けて `TAKT_DRAFT=true` にする。

### 内部 API が壊れたときの fallback

import が失敗したら**続行せず** [fallbacks.md](fallbacks.md) の
「内部 API が壊れたとき」に従う(対話 6 問の値の入れ方まで書いてある)。

### 既存 PR への積み増し

`TAKT_BRANCH` に既存ブランチ名を入れるだけで成立し、新しい PR は作られない。
`--pr <番号>` で渡されたときは head ブランチを引いてから入れる:

```sh
gh pr view <番号> --json headRefName --jq .headRefName
```

既存ブランチは push 済みリモート HEAD が起点になる。ローカルの未 push 変更は入らない。
完了後は既存 PR へ push とコメント追記を行う。同じ branch の pending / running は競合対象だが、completed タスクがあっても積める。
