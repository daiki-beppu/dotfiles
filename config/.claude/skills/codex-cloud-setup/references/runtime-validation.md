# 構成別の設定と検証

## Node.js / Vite+

`packageManager`、`engines`、バージョン指定ファイル、カタログとロックファイルを照合する。矛盾があれば CI と実際の依存制約を調べ、都合のよいバージョンへ黙って緩和しない。

Vite+ プロジェクトでは `vp` を使用する。リポジトリで指定された Vite+ とパッケージマネージャーのバージョンを採用し、現行の公式 Vite+ 文書とその版の CLI ヘルプで導入方法・凍結インストールのフラグを確認する。グローバル最新版への置換や、別パッケージマネージャーによるロックの再生成は避ける。セットアップ・メンテナンスとも対象チェックアウトの依存を同期し、既存の実行コマンドを使う。

Cloud が生成する `.nvmrc` は後続シェルの Node 選択に影響する。Cloud 上でファイルの有無・内容と生成時点を確認し、追跡ファイルかも判別する。UI のランタイム設定、要求バージョン、セットアップ後の `node --version` が一致するか確認する。インストール時だけの `nvm use` 成功では判定しない。

独立した Cloud シェルで `command -v node`、`node --version`、`command -v vp`、`vp --version` と、使用するパッケージマネージャーの実測バージョンを確認する。PATH の確認は対象ツールに絞り、環境変数全体をダンプしない。シェル初期化ファイルを使うなら、Cloud の実際の非対話シェルでも読み込まれることを検証する。

## Playwright / PDF

依存と実行スクリプトから Playwright の利用有無・版・必要なブラウザーを特定する。使用しているパッケージの CLI を用い、公式 Playwright 文書で確認した方法でブラウザー本体と Linux の OS 依存を導入する。必要な場合の `playwright install --with-deps chromium` は一例であり、呼び出すパッケージマネージャーとブラウザーはプロジェクトに合わせる。

後続シェルから同じパッケージを解決し、headless ブラウザーの launch → page 作成 → close を実行する。PDF 用なら既存の生成コマンドも実行し、一時出力の存在と PDF 形式を確認する。パッケージのインストール成功だけではブラウザーや共有ライブラリーの可用性は分からない。キャッシュ復元後も同じブラウザー保存先が解決されるか確認する。

今回の portfolio は「Vite+ の依存導入に加えて PDF 生成用ブラウザーの起動検証が必要な構成」の具体例として扱う。他のリポジトリにも PDF、Playwright、同じパスやバージョンが必要だとは推定しない。

## 長い導入ログ

Cloud スクリプトの Bash 用パターン。呼び出し側で対象リポジトリの導入コマンドを渡す。ログに秘密値を出すコマンドには使わず、末尾を共有する前にも伏せ字を確認する。

```bash
run_logged() {
  local log_file result
  log_file="$(mktemp /tmp/cloud-setup.XXXXXX)" || return 1
  if "$@" >"$log_file" 2>&1; then
    printf 'Completed; log: %s\n' "$log_file"
  else
    result=$?
    tail -n 60 "$log_file" >&2
    printf 'Failed (%s); log: %s\n' "$result" "$log_file" >&2
    return "$result"
  fi
}
```

失敗コードを呼び出し側でも伝播させる。完了マーカーの無条件出力や `|| true` で導入失敗を成功に変換しない。
