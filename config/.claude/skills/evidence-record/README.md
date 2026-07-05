# evidence-record

ブラウザ操作のエビデンス動画を撮る [Claude Code](https://claude.com/claude-code) スキル。

指示した操作を [`playwright-cli`](https://www.npmjs.com/package/@playwright/cli) の `page.screencast` で録画し、**ステップタイトル付き・疑似カーソル/クリック強調つき**の動画にします。出力（スクリプトと動画）は `~/Downloads/evidence-record-<timestamp>/` にまとめて置くので、リポジトリに誤ってコミットされません。

> このディレクトリは [dninomiya/evidence-record](https://github.com/dninomiya/evidence-record)（MIT）を dotfiles にベンダリングしたものです。dotfiles では `config/.claude/skills/` が `~/.claude/skills/` に symlink されるため、追加の導入手順は不要（このリポジトリを pull するだけで全プロジェクトから使える）。

## 前提

- [`playwright-cli`](https://www.npmjs.com/package/@playwright/cli) … 録画に必須。無ければ `ni -g @playwright/cli@latest`。
- `ffmpeg` … webm → mp4 変換に使用。無ければ webm のみ出力。

## 使い方

Claude Code で次のように起動します。

```
/evidence-record <録画したい操作の自由記述>
```

例:

```
/evidence-record ログインしてダッシュボードで新規プロジェクトを作成する様子を撮って
```

スキルは操作を「セットアップ（録画しない前準備）」と「録画するテストステップ」に仕分け、ステップ一覧を提示してから録画します。

## テストに関係ないフローを動画に含めない

ログイン・Cookie 同意・初期ナビなど、テスト本体に関係ない前準備は **録画開始前に実行**するため動画には映りません。`page.screencast` に pause/resume は無いので、映したくない操作は `screencast.start()` の前に `setup()` で済ませる方式を採っています（操作自体は実行されるのでアプリは正しい状態になります）。

## 構成

```
evidence-record/
├── SKILL.md                      # スキル本体（手順・規約）
└── scripts/
    ├── recorder-helpers.md       # 生成スクリプトに inline する正典ヘルパー
    └── example-evidence.mjs      # 生成結果の完成例（TodoMVC 題材）
```

## アップデートの取り込み方

上流の [dninomiya/evidence-record](https://github.com/dninomiya/evidence-record) が更新されたら、`SKILL.md` / `scripts/*` の差分を確認し、`ni -g` への置き換えなど dotfiles 側の調整を保ったまま手動でマージする。

## ライセンス

MIT
