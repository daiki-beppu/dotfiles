# 動画エビデンス

各段の実装後、親がその段の issue 要件と差分を読み、ブラウザ上で確認できる振る舞いを録画する。dev server の起動、テストデータの準備、確認シナリオの選定、PR 添付は親が担当し、録画手順は `evidence-record` スキルに委譲する。

## 録画

- ブラウザで確認する変更がある場合、開始 URL、前準備、操作、各操作後の期待結果を `evidence-record` に渡す。正常系と、今回変更した重要な分岐を含める。録画前のステップ提示も同スキルに従う。
- CLI・内部処理・ドキュメントのみなど、ブラウザで確認できる変更が無い段は録画対象外とし、理由と代わりに実施した検証を PR 本文に記す。
- `evidence-record` が一覧に無ければ user scope の `evidence-record/SKILL.md` を探して読む。見つからない場合や、起動・認証・録画が失敗した場合は動画エビデンス未完了として原因を報告する。対象外扱いで ready に進めない。
- 録画対象のブランチと commit SHA を控え、そのコードで起動したアプリを使う。複数段でも動画と PR の対応を保つ。
- 出力は同スキルが指定する `~/Downloads/evidence-record-<timestamp>/` に保持する。成功した動画を再生して期待結果と機密情報の映り込みが無いことを確認し、MP4 を優先する(WebM のみならそれを使う)。失敗途中の動画は成功の証拠として添付しない。

## PR 添付

GitHub CLI **2.99.0 以上**の標準 `--attach` を使う。実際に添付するシェルで `gh --version` と `gh pr edit --help` を確認する。未対応なら公式リリースの対応版を checksum 照合して作業用ディレクトリへ展開し、そのバイナリの絶対パスで実行する。Cloud の導入は後述の bootstrap を使う。認証は対象リポジトリへの書き込み権限を持つ OAuth トークン、classic PAT、fine-grained PAT が対応する（[CLI 2.99.0 の実装](https://github.com/cli/cli/blob/v2.99.0/internal/attachments/client.go)）。トークン種別だけで添付成功とは判定しない。

録画終了・MP4 変換終了後に `test -s "<動画の絶対パス>"` と `ffprobe -v error -show_entries format=duration,size -of json "<動画の絶対パス>"` で、空でない再生可能な動画とサイズを確認する。動画の上限は Free 10 MB、有料プラン 100 MB。添付中はファイルを書き換えない。

既存本文を取得し、`## 動画エビデンス` 欄に確認した操作・期待結果・録画時の commit SHA と、独立した段落の `![](<動画の絶対パス>)` を置く。この欄だけを更新した一時ファイルを渡す:

```bash
gh pr edit <PR_NUM> -R <owner/repo> --body-file <本文ファイル> --attach "<動画の絶対パス>"
```

本文参照と `--attach` には同じパスを使う。gh が参照をアップロード済み URL に置換し、PR 上で動画プレイヤーとして表示する。`Closes`、変更説明、検証結果、スタック情報を保持し、再実行でも欄を重複させない。

`gh pr view <PR_NUM> -R <owner/repo> --json body,url,headRefOid` でローカルパスが添付 URL に置換されたことを確認し、PR 上で動画が再生できることまで確認する。録画した SHA と最新 HEAD の対応も確認する。GitHub Enterprise Server は未対応。

### 添付失敗の復旧

1. まず本文を再取得し、保存済みの添付 URL があれば再利用する。動画が未添付なら draft を維持し、既に ready の PR は `gh pr ready <PR_NUM> -R <owner/repo> --undo` で draft に戻す。
2. `HTTP 400: Bad Content-Length` は送信経路の切り分けが必要。実行したコマンド、CLI 版、ファイルのバイト数、HTTP ステータスを記録する（トークン・認証ヘッダーは出力しない）。独自の Uploads API 呼び出しを使っていた場合は、上記の標準 `--attach` に戻す。標準 CLI はファイルサイズを Content-Length に設定するため、このエラーだけで CLI の旧版・認証・空ファイルのどれかが原因と断定しない。
3. ファイルと CLI を確認しても同じ環境で失敗する場合は、利用できる別の実行環境の標準 `--attach`、または Browser / Computer Use による GitHub の添付 UI で復旧する。別環境から元動画にアクセスできなければ、最新 HEAD のローカルサイト、または commit SHA と一致するデプロイ済みプレビューで再録画する。プレビューを使った場合は録画元 URL と SHA を本文に記す。
4. 成功後は未添付の説明を実際の確認内容・SHA・動画 URL に置き換え、PR 上で再生確認する。再現できなかった元環境の原因は未確定として報告する。復旧できなければ試した経路・エラー・動画の保存先を報告し、draft のまま残す。

Cloud では `scripts/setup-codex-cloud.sh` で導入後、独立したエージェントシェルから `scripts/check-codex-cloud-evidence.sh` を実行する。このチェックは録画と変換のみで、アップロードは検証しない。同 bootstrap のブラウザー設定が `~/.config/dotfiles/evidence-browser.json` にあれば、録画時の `playwright-cli open` に `--config="$HOME/.config/dotfiles/evidence-browser.json"` を渡す。録画専用の headless Chromium 設定であり、他のブラウザー設定は変更しない。

出典: [GitHub CLI のメディア添付](https://github.blog/changelog/2026-09-01-github-cli-media-in-issues-pull-requests-and-comments/)、[本文への動画埋め込み](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli)。

## 修正後の鮮度

CI-fix や下段からの伝播で録画した挙動が変わった段は、その段を checkout して再録画・再添付する。挙動が変わらない修正や rebase だけなら、旧 SHA の動画が引き続き有効である理由を添える。添付失敗・未検証・古い挙動の動画が残る段は ready にしない。
