# dotfiles

この Mac の環境と、Claude Code・Codex が共有するエージェント用スキルを管理するリポジトリ。ここでは、仕様を issue から実装の PR まで流す仕組みで使う語を定める。

## Language

### 仕様の流れ

**仕様**:
`spec` ラベルの付いた issue で、ユーザーストーリーと実装の決定をまとめたもの。承認されると `spec-approved` が付く。
_Avoid_: spec issue、PRD

**親 issue**:
仕様とは別の issue で、本文に `仕様: #n` だけの行を持ち、仕様を実装する issue を sub-issue として束ねるもの。
_Avoid_: epic、まとめ issue

**学びの PR**:
仕様の sub-issue がすべて閉じた後に、その学びを用語集・ADR・知識文書にまとめる PR。本文に `学びの元の仕様: #n` だけの行を持つ。
_Avoid_: ナレッジ PR

**Formal Spec コメント**:
formal-spec が仕様に残す、検証の結果のコメント。結果は passed・failed・対象外のどれか。
_Avoid_: 検証結果コメント

### wayfinder の map

**map**:
`wayfinder:map` ラベルの issue で、大きな目的地までの道を、sub-issue の ticket と本文の霧で表したもの。晴れる（霧が無く、子 ticket がすべて閉じる）と、案内役が `to-spec` を起動して仕様につなぐ。
_Avoid_: 地図、ロードマップ

**frontier**:
map の子 ticket のうち、open で、ブロックしている issue がすべて閉じていて、claim されていないもの。案内役がセッションを起動するのはここだけ。
_Avoid_: 着手可能、ready

**claim**:
wayfinder のセッションが、作業の前に ticket の assignee を自分にすること。assignee があれば claim 済みで、frontier から外れる。
_Avoid_: ロック、担当

**霧**:
map 本文の `## Not yet specified` 節に書かれた、まだ ticket にできない範囲。節が無いか、HTML コメントと空行しか無ければ霧は無い。
_Avoid_: 未定義、TBD

**判断の振り分け**:
grilling・task の ticket の問いを、⓪ 設計で戻せる判断に変える → ① 事実で決める → ② ADR の前例で決める → ③ 不可逆なら人に聞き、それ以外は仮決めする、の順に振り分ける進め方。正本は `grilling` スキル。
_Avoid_: triage（英語の説明でだけ使う）、自動判断

**不可逆な判断**:
外部に公開した契約（公開 API・URL・ファイル形式・CLI の引数）、データを失う変更、外への発信、お金と権限、外部に出る名前のどれかに当たる判断。判断の振り分けで人に聞くのはこれだけ。
_Avoid_: 重要な判断

**仮決め**:
判断の振り分けで、エージェントが人に聞かずに決めて先へ進んだ判断。resolution コメントの `## 仮決め` 節に、答え・振り分け（⓪ か ③）・理由・根拠を書く。案内役が map のスレッドに流し、人は ❌ で差し戻せる。
_Avoid_: 暫定決定、デフォルト

**判断の問い**:
grilling が不可逆な判断を AskUserQuestion で聞く前に ticket に書く、1 行目が `## 判断の問い` のコメント。案内役はこれを判断依頼に載せる。
_Avoid_: 質問コメント

**人が見る ticket**:
frontier にある `wayfinder:prototype` の ticket。案内役はセッションを起動せず、map のスレッドに知らせるだけにする。
_Avoid_: HITL ticket（wayfinder の分類の語と紛れる）

**仮決めの差し戻し**:
map のスレッドに流れた仮決めに本人が ❌ を付けること。案内役は GitHub に書き戻し、ticket を開き直して新しい回のセッションに解き直させる。仕様の承認を ❌ で断る「差し戻し」とは別で、印の文言も前方一致しないように分けてある。
_Avoid_: ロールバック、却下

### 案内役

**案内役**:
仕様を、承認依頼から学びの PR まで流す常駐スクリプト。状態は GitHub に持つ。
_Avoid_: オーケストレーター、guide（スキル名としては使う）

**工程**:
案内役が起動する、エージェントの作業の 1 単位。仕様ごとの formal-spec・to-tickets・knowledge と、PR ごとの review-fix（修正のセッション）がある。
_Avoid_: ステップ（takt のワークフローの段を指す語と紛れる）、ジョブ

**印**:
案内役が、済んだ行動を表すために仕様や親 issue に書く、本文が `案内役: ` で始まるコメント。
_Avoid_: マーカー、state

**承認依頼**:
案内役が仕様ごとに Discord のスレッドへ送る、仕様を承認するか差し戻すかを人に尋ねるメッセージ。
_Avoid_: レビュー依頼

**判断依頼**:
流れが止まったときに、案内役が承認依頼のスレッドへ送る、人の判断を求めるメッセージ。原因ごとに 1 度だけ送る。
_Avoid_: アラート、エスカレーション

**回**:
案内役が開き直した wayfinder の ticket を数える区切り。ticket に書いた仮決めの差し戻しの印の数が回の番号になり、最後の差し戻しより後の起動の印だけが今の回のものになる。
_Avoid_: サイクル、試行

**修正のセッション**:
takt のレビューが失敗した PR について、案内役がその head ブランチの worktree に起動する review-fix のセッション。コードの指摘なら直して push し、証跡が無いだけなら証跡を PR に載せてやり直しの印を付け、直せなければ理由を書いて止まる。1 つの PR に 2 回まで起動する。
_Avoid_: 修正ジョブ、fix セッション

**やり直しの印**:
修正のセッションが証跡を載せた後に PR に書く、`案内役: レビューのやり直しを頼む for head <sha>` のコメント。takt-sequence は、これより前の同じ head の失敗を数えずにレビューし直す。head ごとに最初の 1 つだけが効く。
_Avoid_: retry マーカー、再レビュー依頼

**レビューそのものが落ちた**:
`takt merge` が現在の head で 2 回 failed になり、レビュー失敗のコメントが付かないまま終わった状態。コードを直しても解決しないので、修正のセッションを起動せずに判断依頼にする。
_Avoid_: クラッシュ、レビュー失敗（失敗のコメントが付いた場合を指す）

**セッションの停止**:
案内役が起動した工程のセッション、または takt-sequence のタブが、結果を GitHub に出さないまま進まなくなった状態。takt-sequence の結果は、渡した sub-issue がすべて閉じること。判断依頼の原因の 1 つ。
_Avoid_: ハング、タイムアウト

**main の修復**:
main の push の CI が落ちてから、緑に戻るまでの流れ。落ちた job の再実行 → main-fix → 判断依頼、の順に進む。マージの前に止めず、マージの後に直すための仕組み（ADR 0004）。
_Avoid_: main の復旧、hotfix

**main-fix**:
main の修復で、案内役が main から切った worktree に起動するセッション。修正の PR を main 向けに新しく出して、自動マージを予約する。PR の head ブランチを直す修正のセッション（review-fix）とは別物。
_Avoid_: main 用の review-fix

**最後に緑だった commit**:
main の first-parent の履歴をさかのぼって、必須チェックがすべて success だった最も新しい commit。そこから落ちた commit までが、原因の候補の範囲になる。
_Avoid_: last good commit、base
