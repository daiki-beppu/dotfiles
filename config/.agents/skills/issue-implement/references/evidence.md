# 動画エビデンス

各段の実装後、親がその段の issue 要件と差分を読み、ブラウザ上で確認できる振る舞いを録画する。dev server の起動、テストデータの準備、確認シナリオの選定、PR 添付は親が担当し、録画手順は `evidence-record` スキルに委譲する。

## 録画

- ブラウザで確認する変更がある場合、開始 URL、前準備、操作、各操作後の期待結果を `evidence-record` に渡す。正常系と、今回変更した重要な分岐を含める。録画前のステップ提示も同スキルに従う。
- CLI・内部処理・ドキュメントのみなど、ブラウザで確認できる変更が無い段は録画対象外とし、理由と代わりに実施した検証を PR 本文に記す。
- `evidence-record` が一覧に無ければ user scope の `evidence-record/SKILL.md` を探して読む。見つからない場合や、起動・認証・録画が失敗した場合は動画エビデンス未完了として原因を報告する。対象外扱いで ready に進めない。
- 録画対象のブランチと commit SHA を控え、そのコードで起動したアプリを使う。複数段でも動画と PR の対応を保つ。
- 出力は同スキルが指定する `~/Downloads/evidence-record-<timestamp>/` に保持する。成功した動画を再生して期待結果と機密情報の映り込みが無いことを確認し、MP4 を優先する(WebM のみならそれを使う)。失敗途中の動画は成功の証拠として添付しない。

## PR 添付

GitHub CLI **2.99.0 以上**の標準 `--attach` を使う。`gh --version` と `gh pr edit --help` で確認する。認証は対象リポジトリへの書き込み権限を持つ OAuth トークンまたは classic PAT が必要。fine-grained PAT の対応は公式発表で保証されていないため、添付成功を確認するまでは利用可能と判定しない。拡張やブラウザー Cookie は不要。

既存本文を取得し、`## 動画エビデンス` 欄に確認した操作・期待結果・録画時の commit SHA と、独立した段落の `![](<動画の絶対パス>)` を置く。この欄だけを更新した一時ファイルを渡す:

```bash
gh pr edit <PR_NUM> -R <owner/repo> --body-file <本文ファイル> --attach "<動画の絶対パス>"
```

本文参照と `--attach` には同じパスを使う。gh が参照をアップロード済み URL に置換し、PR 上で動画プレイヤーとして表示する。`Closes`、変更説明、検証結果、スタック情報を保持し、再実行でも欄を重複させない。

`gh pr view <PR_NUM> --json body,url` でローカルパスが添付 URL に置換されたことを確認し、PR 上で動画が開けることまで確認する。失敗時は本文を再取得して添付済みか確認し、既に保存された URL は再利用する。認証・サイズ・通信の問題で添付できない場合は原因と動画のローカルパスを報告して draft に保つ。動画の上限は Free 10 MB、有料プラン 100 MB。GitHub Enterprise Server は未対応。

Cloud では `scripts/setup-codex-cloud.sh` で導入後、独立したエージェントシェルから `scripts/check-codex-cloud-evidence.sh` を実行する。同 bootstrap のブラウザー設定が `~/.config/dotfiles/evidence-browser.json` にあれば、録画時の `playwright-cli open` に `--config="$HOME/.config/dotfiles/evidence-browser.json"` を渡す。録画専用の headless Chromium 設定であり、他のブラウザー設定は変更しない。

出典: [GitHub CLI のメディア添付](https://github.blog/changelog/2026-09-01-github-cli-media-in-issues-pull-requests-and-comments/)、[本文への動画埋め込み](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli)。

## 修正後の鮮度

CI-fix や下段からの伝播で録画した挙動が変わった段は、その段を checkout して再録画・再添付する。挙動が変わらない修正や rebase だけなら、旧 SHA の動画が引き続き有効である理由を添える。添付失敗・未検証・古い挙動の動画が残る段は ready にしない。
