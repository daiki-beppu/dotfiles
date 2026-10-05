---
name: kanary-digest
description: Kanary の録音を Claude の Artifact にまとめ、Codex の画像生成で 1 枚のまとめ画像にする。
disable-model-invocation: true
---

# Kanary ダイジェスト

録音 1 件から、読むための **Artifact**（詳しい要約）と、見るための **1 枚画像**（要点だけ）を作る。対象は引数で受け取る。`latest`（既定）・録音 ID・タイトルの一部のどれでもよい。

## 1. 文字起こしを取り出す

```bash
python3 <このスキルの絶対パス>/scripts/fetch_transcript.py [latest|<id>|<タイトルの一部>]
```

受領 JSON の `out_dir` が、この回の作業場所になる（`~/Documents/kanary-digest/<日時>-<タイトル>/`）。`limited` が `"plan"` のとき、または `transcript_path` が null のときは、kanary スキルの規則どおり利用者に伝えて判断を仰ぐ。部分的な文字起こしを黙って要約しない。

## 2. 内容を整理したノートを Artifact にする

`transcript_path` を最後まで読む。音声認識の誤変換は文脈から正しい語に直し、フィラーは落とす。

作るのは要約ではなく、自分用に**整理したノート**。話された順や話者ごとではなく、テーマごとの節に組み直す。同じテーマが複数の話者や時間帯に散らばっていれば 1 つの節に統合し、具体例・数値・固有名詞・依頼文の型は削らずに残す。

[ノートのテンプレート](references/note-template.html) の CSS と構成をそのまま使い、`out_dir/summary.html` を書く。

- hero: 録音全体の主張を 1 文にした見出し、lede、登壇者と主題
- テーマ別の節: サブタイトルと小見出しで整理し、流れや構成があれば mermaid の図を 1 枚添える。部品の使い分けはテンプレート内のコメントに従う
- 質疑応答があれば `dl.qa`、最後に `ol.todo` で「自分で試すこと」を優先度順に

artifact-design スキルを読み込んでから公開する。

文字起こしに出てくる話題を、どれもノートのどこかの節に位置づけてから完了とする。

## 3. 画像ブリーフを書く

`out_dir/image-brief.md` に、画像に載せる文字だけを書く。画像生成は文字が増えるほど崩れるため、ここは**削る**工程として扱う。

- タイトル（15 字以内）
- 要点 3〜5 個（各 20 字以内）と、それぞれを表す絵のモチーフ
- 結論 1 行

## 4. 画像を生成する

```bash
python3 <このスキルの絶対パス>/scripts/render_image.py <out_dir>/image-brief.md
```

数分かかる。出力された `digest.png` を開き、ブリーフの文字が正しく描かれているか照合する。タイトルや要点の文字が崩れていたら、その語を短くするか言い換えて、もう一度だけ生成する。

## 5. 報告する

Artifact の URL と `digest.png` を SendUserFile で渡し、2 回目の生成でも文字が崩れた箇所があればそれも伝える。
