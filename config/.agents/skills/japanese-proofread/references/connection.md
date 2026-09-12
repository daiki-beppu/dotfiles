# 接続設定

通常は `agy` の Google アカウント認証を使い、Google AI Pro の契約があるアカウントでログインする。CLI は Homebrew の `antigravity-cli` cask として dotfiles に定義している。

初回はターミナルで `agy` を起動してログインする。`agy models` で利用可能なモデルを確認する。既定の CLI モデルは `gemini-3.8-flash-medium`。API キー認証になっている場合は、公式の認証手順に従ってアカウント認証へ戻す。

`proofread.py` の接続モード:

- `--backend auto`（既定）: CLI を優先し、起動・認証・利用枠・応答の失敗時は Vertex AI API へ一度だけ切り替える。API 利用分は Google Cloud 側で課金される。
- `--backend agy`: CLI のみ。API に切り替えず、失敗を返す。
- `--backend vertex`: Vertex AI API を直接使う。`gcloud` の ADC 認証と、ユーザー指定済みの `life-video-digest` を使う。認証更新に失敗したら `gcloud auth application-default login` でログインする。
- `--backend gemini`: Gemini Developer API を直接使う。`GEMINI_API_KEY` または `GOOGLE_API_KEY` が必要。

CLI モデルは `--cli-model`、API モデルは `--model`（既定 `gemini-3.8-flash`）で指定する。モデル ID は接続方式ごとに異なる。API のプロジェクト・リージョンは `--help` を参照。キーやトークンをチャットや追跡ファイルに書かない。

公式: [インストール・認証](https://antigravity.google/docs/cli/install/)、[非対話実行](https://antigravity.google/docs/cli/headless/)、[プラン](https://antigravity.google/docs/plans/)。
