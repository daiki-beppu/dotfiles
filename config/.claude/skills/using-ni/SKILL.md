---
name: using-ni
description: Use when working with Node.js projects that need package management (installing, running scripts, updating dependencies). Provides ni command reference for package-manager-agnostic workflows.
---

# ni パッケージマネージャーラッパー

## 概要
`ni` は npm、yarn、pnpm を自動検出し、適切なコマンドに変換するラッパー。ロックファイルからパッケージマネージャーを判定。

## クイックリファレンス

| コマンド | 用途 | npm 相当 |
|---------|------|----------|
| `ni` | 依存関係インストール | `npm install` |
| `ni axios` | パッケージ追加 | `npm install axios` |
| `ni -D typescript` | dev 依存追加 | `npm install -D typescript` |
| `nr dev` | スクリプト実行 | `npm run dev` |
| `nlx create-vite` | パッケージ実行 | `npx create-vite` |
| `nu` | 依存関係更新 | `npm update` |
| `nun axios` | パッケージ削除 | `npm uninstall axios` |
| `nci` | クリーンインストール | `rm -rf node_modules && npm install` |
| `na` | 使用中の PM 表示 | - |

## パッケージマネージャー対応

`ni` は以下を自動変換：

**インストール (`ni`)**
- npm: `npm install`
- yarn: `yarn install`
- pnpm: `pnpm install`

**スクリプト実行 (`nr`)**
- npm: `npm run`
- yarn: `yarn run`
- pnpm: `pnpm run`

**パッケージ実行 (`nlx`)**
- npm: `npx`
- yarn: `yarn dlx`
- pnpm: `pnpm dlx`

## 実装例

```bash
# プロジェクトのセットアップ
ni                    # 依存関係インストール
nr dev                # 開発サーバー起動

# 新しいパッケージの追加
ni axios react-query  # 複数パッケージ同時追加
ni -D vitest          # dev 依存として追加

# パッケージの実行（インストール不要）
nlx create-vite my-app
nlx tsc --init

# メンテナンス
nu                    # すべて更新
nun lodash            # 不要なパッケージ削除
nci                   # クリーンインストール
```

## よくある間違い

| 間違い | 正しい方法 | 理由 |
|--------|-----------|------|
| `npm install` を直接実行 | `ni` を使用 | プロジェクトの PM と不一致の可能性 |
| `yarn add` を直接実行 | `ni` を使用 | 同上 |
| PM を手動で確認してからコマンド実行 | `ni` で自動判定 | 時間の無駄、エラーの元 |

## 自動検出の仕組み

`ni` は以下の順でロックファイルをチェック：
1. `pnpm-lock.yaml` → pnpm
2. `yarn.lock` → yarn
3. `package-lock.json` → npm
4. 上記がない場合 → npm（デフォルト）

## 参考
GitHub: https://github.com/antfu/ni
