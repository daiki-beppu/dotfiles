// 案内役の判定。tracker と takt の状態のスナップショットから、次にやることの一覧を返す純粋関数。
// I/O・時刻・環境変数は読まない（import も持たない）。LLM も使わず、ラベルと状態だけで決める。
//
// snapshot: { repo, viewer, discordUserId, fromSpec?, issues: [{ number, title, state, labels, body, comments: [{ author, body }], subIssues: [{ number, state }],
//             reactions: [{ emoji, userId }] }], taktIssues: [number], dispatched: [key],
//             taktTasks: [{ issue, kind, createdAt, step, error, worktreePath }] }
//   fromSpec: 指定があれば、番号がそれ以上の仕様だけを扱う（既存の仕様が多い repo に向けるとき、新しい仕様だけを流すため）
// 行動: { kind: "request-approval", key, spec, title } | { kind: "approve-spec", key, spec } | { kind: "reject-spec", key, spec }
//     | { kind: "to-tickets", key, spec } | { kind: "takt-sequence", key, parent, issues }
//     | { kind: "knowledge", key, spec, parents, subIssues }   （snapshot.pullRequests: [{ number, state, author, body, autoMerge }]）
//     | { kind: "merge-auto", key, spec, pr }   （学びの PR が OPEN で自動マージが未予約）
//     | { kind: "request-decision", key, spec, issue, cause, title, threadId, reason, reports }
//       （sub-issue の takt の run が ABORT、または仕様の formal-spec の検証が失敗。仕様の Discord スレッドへ判断依頼を送る）
//     | { kind: "request-decision", key, spec, issue, cause, title, threadId, reason, step, tab, tail }
//       （Orca で起動した工程のセッションが、結果を GitHub に出さないまま止まった。reports は無く、タブの名前と画面の最後の行を持つ）
// セッションの観測（snapshot.now: ISO 8601 / snapshot.stallMinutes: 既定 60 / snapshot.sessions）:
//   sessions: { [handle]: { found, waiting, idle, startedAt, tail } }（sessionsToObserve が返す工程だけ）
//   waiting は入力待ち（確認・許可）、found は handle のセッションが Orca にあるか。起動時刻は観測ではなく起動の印のコメントから読む。

// to-tickets の印は 2 段: 起動前（二重起動の防止）と、起動後（ターミナルの handle と起動時刻）。
// 終わりは印ではなく、仕様を指す親 issue ができたかで判定する。
// 古い版の印（handle なしの「起動した」と「終わった（exit n）」）は読み取りだけ残す。
export const MARKER_TO_TICKETS_LAUNCHING = "案内役: to-tickets を起動する";
export const MARKER_STARTED = "案内役: to-tickets を起動した";
const LAUNCHED_PREFIX = `${MARKER_STARTED}（ターミナル `;
// Orca のタブで起動した工程の印。工程名・ターミナルの handle・起動時刻を持つ。to-tickets の既存の印と同じ形。
export const launchedMarker = (step, handle, launchedAt) => `案内役: ${step} を起動した（ターミナル ${handle} / ${launchedAt}）`;
const LAUNCHED = /^案内役: (\S+) を起動した（ターミナル (\S+) \/ ([^）]+)）/;
// Orca のタブの題名。起動時にタブへ付け、セッションが見つからないときの判断依頼でも同じ値を使う。
export const tabTitle = (step, spec) => `${step} #${spec}`;
export const MARKER_HANDED_PREFIX = "案内役: takt-sequence に渡した";

// 承認依頼: 送る前（二重送信の防止）と送った後（スレッドとメッセージの ID を GitHub に残す）の 2 つ。差し戻しは 1 つ。
export const MARKER_APPROVAL_SENDING = "案内役: Discord に承認依頼を送る";
export const MARKER_APPROVAL_SENT_PREFIX = "案内役: Discord に承認依頼を送った";
export const MARKER_REJECTED = "案内役: Discord で差し戻された";

// 判断依頼: 送る前に仕様の issue へ書く。閉じ括弧まで含めて照合する（#2 が #21 に前方一致しないように）。
export const MARKER_DECISION_PREFIX = "案内役: Discord に判断依頼を送る";
export const CAUSE_ABORT = "takt の ABORT";
export const CAUSE_FORMAL_SPEC = "formal-spec の検証失敗";
const stallCause = (step) => `${step} のセッションの停止`;
export const decisionMarker = (issue, cause) => `${MARKER_DECISION_PREFIX}（#${issue} ${cause}）`;

// formal-spec が仕様の issue に書くコメントの 1 行目。末尾が「で failed）」なら検証失敗。
const FORMAL_SPEC_HEADING = "## Formal Spec（";
const FORMAL_SPEC_FAILED_SUFFIX = "で failed）";
const FORMAL_SPEC_RUN_DIR = /^検証器の作業ディレクトリ: (.+)$/m;

const APPROVAL_SENT = /^案内役: Discord に承認依頼を送った（スレッド (\d+) \/ メッセージ (\d+)）/;
const APPROVE_EMOJI = "✅";
const REJECT_EMOJI = "❌";

const FINISHED = /^案内役: to-tickets が終わった（exit (\d+)）/;

// 学び（knowledge）: 起動前に仕様の issue へ書くマーカーと、学びの PR 本文に書く記録の行の接頭辞。
export const MARKER_KNOWLEDGE_STARTED = "案内役: knowledge を起動した";
export const KNOWLEDGE_SPEC_PREFIX = "学びの元の仕様: #";

// 親 issue の本文に書く記録の行の接頭辞。`仕様: #n` だけの行を、仕様 n の親の印として数える。
export const PARENT_SPEC_PREFIX = "仕様: #";

const isParentOf = (issue, n) =>
  (issue.subIssues ?? []).length > 0 &&
  typeof issue.body === "string" &&
  issue.body.split(/\r?\n/).some((line) => line.trim() === `${PARENT_SPEC_PREFIX}${n}`);

// viewer が作り、本文に `学びの元の仕様: #spec` だけの行がある PR（状態は問わない）。無ければ null。
export function knowledgePrOf(pullRequests, viewer, spec) {
  return (
    (pullRequests ?? []).find(
      (pr) =>
        pr.author === viewer &&
        typeof pr.body === "string" &&
        pr.body.split(/\r?\n/).some((line) => line.trim() === `${KNOWLEDGE_SPEC_PREFIX}${spec}`),
    ) ?? null
  );
}

// viewer が書き、本文が接頭辞で始まるコメントだけをマーカーとして数える
const markers = (issue, viewer) =>
  (issue.comments ?? []).filter((c) => c.author === viewer && typeof c.body === "string").map((c) => c.body);

const hasLabel = (issue, name) => (issue.labels ?? []).includes(name);
const isSpec = (issue) => hasLabel(issue, "spec");

// 扱う仕様: OPEN で spec、fromSpec の指定があれば番号がそれ以上。番号の昇順。
// 範囲の外の仕様は、承認依頼・to-tickets・takt-sequence・学び・判断依頼のどれにも出さない。
const openSpecs = (snapshot) =>
  snapshot.issues
    .filter((i) => i.state === "OPEN" && isSpec(i) && (snapshot.fromSpec === undefined || i.number >= snapshot.fromSpec))
    .sort((a, b) => a.number - b.number);

// 送り済みの承認依頼（viewer の「送った」マーカー）のスレッドとメッセージの ID。無ければ null。
export function sentApprovalRequest(issue, viewer) {
  for (const body of markers(issue, viewer)) {
    const m = APPROVAL_SENT.exec(body);
    if (m) return { threadId: m[1], messageId: m[2] };
  }
  return null;
}

// リアクションを読むべき仕様か。OPEN で spec、承認依頼が送り済み。承認済みでも差し戻し（❌）を読むため、承認ラベルは問わない。
export const awaitsReaction = (issue, viewer) =>
  issue.state === "OPEN" && isSpec(issue) && sentApprovalRequest(issue, viewer) !== null;

// OPEN な仕様ごとの、承認依頼の送信・承認・差し戻し。送信は承認ラベルを問わない。承認は未承認の仕様だけ、差し戻しは承認済みの仕様も対象にする。
function decideApproval(snapshot, dispatched) {
  const { viewer, discordUserId } = snapshot;
  const actions = [];
  for (const spec of openSpecs(snapshot)) {
    const approved = hasLabel(spec, "spec-approved");
    const own = markers(spec, viewer);
    if (!own.some((b) => b.startsWith(MARKER_APPROVAL_SENDING))) {
      const key = `request-approval:${spec.number}`;
      if (!dispatched.has(key)) actions.push({ kind: "request-approval", key, spec: spec.number, title: spec.title });
      continue;
    }
    if (sentApprovalRequest(spec, viewer) === null) continue;
    const mine = (spec.reactions ?? []).filter((r) => r.userId === discordUserId).map((r) => r.emoji);
    const approve = mine.includes(APPROVE_EMOJI);
    const reject = mine.includes(REJECT_EMOJI);
    if (approve === reject) continue;
    if (approve) {
      if (approved) continue;
      const key = `approve-spec:${spec.number}`;
      if (!dispatched.has(key)) actions.push({ kind: "approve-spec", key, spec: spec.number });
    } else if (!own.some((b) => b.startsWith(MARKER_REJECTED))) {
      const key = `reject-spec:${spec.number}`;
      if (!dispatched.has(key)) actions.push({ kind: "reject-spec", key, spec: spec.number });
    }
  }
  return actions;
}

// viewer の最後の Formal Spec コメントが failed なら、その検証器の作業ディレクトリ（記録が無ければ説明文）。failed でなければ null。
function formalSpecFailure(spec, viewer) {
  const last = markers(spec, viewer)
    .filter((b) => b.split(/\r?\n/)[0].startsWith(FORMAL_SPEC_HEADING))
    .at(-1);
  if (last === undefined || !last.split(/\r?\n/)[0].trimEnd().endsWith(FORMAL_SPEC_FAILED_SUFFIX)) return null;
  return FORMAL_SPEC_RUN_DIR.exec(last)?.[1].trim() ?? "（検証器の作業ディレクトリの記録なし）";
}

// issue の最新の takt タスク（createdAt が最も新しいもの）が failed（= workflow が ABORT で終わった）なら、そのタスク。
function abortedTask(tasks, issue) {
  const latest = tasks
    .filter((t) => Number(t.issue) === issue)
    .reduce((a, b) => (a === null || String(b.createdAt) > String(a.createdAt) ? b : a), null);
  return latest !== null && latest.kind === "failed" ? latest : null;
}

const abortReason = (t) =>
  `takt の run が ABORT で終わった${t.step ? `（step: ${t.step}）` : ""}${t.error ? `: ${t.error}` : ""}`;

// 止まった流れ（sub-issue の ABORT、仕様の検証失敗）ごとの判断依頼。送り先は承認依頼のスレッド。送り済みマーカーがあれば出さない。
function decideDecisionRequests(snapshot, dispatched) {
  const { viewer, issues } = snapshot;
  const tasks = snapshot.taktTasks ?? [];
  const actions = [];
  for (const spec of openSpecs(snapshot)) {
    const sent = sentApprovalRequest(spec, viewer);
    if (sent === null) continue;
    const own = markers(spec, viewer);
    const titleOf = (n) => issues.find((i) => i.number === n)?.title;
    const push = (issue, cause, reason, reports) => {
      const key = `request-decision:${spec.number}:${issue}:${cause}`;
      if (dispatched.has(key) || own.includes(decisionMarker(issue, cause))) return;
      actions.push({ kind: "request-decision", key, spec: spec.number, issue, cause, title: titleOf(issue), threadId: sent.threadId, reason, reports });
    };

    const runDir = formalSpecFailure(spec, viewer);
    if (runDir !== null) {
      push(spec.number, CAUSE_FORMAL_SPEC, "formal-spec の検証が failed で終わった", runDir);
    }

    if (!hasLabel(spec, "spec-approved")) continue;
    const subs = new Set(
      issues
        .filter((i) => i.number !== spec.number && !isSpec(i) && isParentOf(i, spec.number))
        .flatMap((p) => p.subIssues.filter((s) => s.state === "OPEN").map((s) => s.number)),
    );
    for (const n of [...subs].sort((a, b) => a - b)) {
      const t = abortedTask(tasks, n);
      if (t !== null) push(n, CAUSE_ABORT, abortReason(t), t.worktreePath ? `${t.worktreePath}/.takt/runs` : "（worktree の記録なし）");
    }
  }
  return actions;
}

// 工程ごとの結果（GitHub に出るもの）。表に無い工程は結果を判定できないので観測しない。
const RESULT_OF = {
  "to-tickets": (snapshot, spec) =>
    snapshot.issues.some((i) => i.number !== spec.number && !isSpec(i) && isParentOf(i, spec.number)),
  knowledge: (snapshot, spec) => knowledgePrOf(snapshot.pullRequests, snapshot.viewer, spec.number) !== null,
  "formal-spec": (snapshot, spec) =>
    markers(spec, snapshot.viewer).some((b) => b.split(/\r?\n/)[0].startsWith(FORMAL_SPEC_HEADING)),
};

const DEFAULT_STALL_MINUTES = 60;

// 起動の印に handle があり、結果がまだ無く、判断依頼を送っていない工程。承認依頼を送り済みで fromSpec の範囲内の仕様だけ。
// 同じ工程の印が複数あれば最後の印を使う（印を消して流し直した後の、新しい handle を見るため）。
export function sessionsToObserve(snapshot) {
  const targets = [];
  for (const spec of openSpecs(snapshot)) {
    if (sentApprovalRequest(spec, snapshot.viewer) === null) continue;
    const own = markers(spec, snapshot.viewer);
    const latest = new Map();
    for (const body of own) {
      const m = LAUNCHED.exec(body);
      if (m) latest.set(m[1], { handle: m[2], startedAt: m[3] });
    }
    for (const [step, { handle, startedAt }] of latest) {
      const hasResult = RESULT_OF[step];
      if (hasResult === undefined || hasResult(snapshot, spec)) continue;
      if (own.includes(decisionMarker(spec.number, stallCause(step)))) continue;
      targets.push({ spec: spec.number, step, handle, startedAt });
    }
  }
  return targets;
}

// 止まった理由を 1 つだけ選ぶ（見つからない → 入力待ち → 時間切れ）。止まっていなければ null。
function stallReason(observation, startedAt, snapshot) {
  if (!observation.found) return "起動したセッションが Orca に見つからない";
  if (observation.waiting) return "セッションが入力待ち（確認・許可）で止まっている";
  const minutes = snapshot.stallMinutes ?? DEFAULT_STALL_MINUTES;
  if (Date.parse(snapshot.now) - Date.parse(startedAt) >= minutes * 60_000) {
    return `起動から ${minutes} 分経っても結果が GitHub に出ていない`;
  }
  return null;
}

// 起動したセッションが結果を出さないまま止まったときの判断依頼。送り先は承認依頼のスレッド。
function decideSessionStalls(snapshot, dispatched) {
  const actions = [];
  for (const { spec, step, handle, startedAt } of sessionsToObserve(snapshot)) {
    const observation = snapshot.sessions?.[handle];
    if (observation === undefined) continue;
    const reason = stallReason(observation, startedAt, snapshot);
    if (reason === null) continue;
    const cause = stallCause(step);
    const key = `request-decision:${spec}:${spec}:${cause}`;
    if (dispatched.has(key)) continue;
    const issue = snapshot.issues.find((i) => i.number === spec);
    actions.push({
      kind: "request-decision", key, spec, issue: spec, cause, title: issue.title,
      threadId: sentApprovalRequest(issue, snapshot.viewer).threadId, reason, step, tab: tabTitle(step, spec), tail: observation.tail ?? [],
    });
  }
  return actions;
}

export function decide(snapshot) {
  const { viewer, issues } = snapshot;
  const dispatched = new Set(snapshot.dispatched ?? []);
  const takt = new Set((snapshot.taktIssues ?? []).map(Number));

  const approved = openSpecs(snapshot).filter((i) => hasLabel(i, "spec-approved"));

  const actions = decideApproval(snapshot, dispatched);
  const handedParents = new Set();

  for (const spec of approved) {
    const specMarkers = markers(spec, viewer);
    const launching = specMarkers.some((b) => b.startsWith(MARKER_TO_TICKETS_LAUNCHING));
    const launched = specMarkers.some((b) => b.startsWith(LAUNCHED_PREFIX));
    const legacyStarted = specMarkers.some((b) => b.startsWith(MARKER_STARTED) && !b.startsWith(LAUNCHED_PREFIX));
    const finished = specMarkers.map((b) => FINISHED.exec(b)).filter(Boolean);
    const ticketed = finished.some((m) => m[1] === "0");

    const candidates = issues
      .filter((i) => i.number !== spec.number && !isSpec(i) && isParentOf(i, spec.number))
      .sort((a, b) => a.number - b.number);

    // 遷移 1
    const key = `to-tickets:${spec.number}`;
    if (candidates.length === 0 && !launching && !launched && !legacyStarted && finished.length === 0 && !dispatched.has(key)) {
      actions.push({ kind: "to-tickets", key, spec: spec.number });
    }

    // 遷移 2: 親ができたら渡す。古い版の印（handle なしの起動・終了）がある仕様だけは、従来どおり exit 0 で終わった親に限る
    const legacy = legacyStarted || finished.length > 0;
    const gateOpen = legacy ? ticketed : true;
    if (!gateOpen) continue;
    for (const parent of candidates) {
      const subs = parent.subIssues ?? [];
      if (handedParents.has(parent.number)) continue;
      const pkey = `takt-sequence:${parent.number}`;
      const open = subs.filter((s) => s.state === "OPEN").map((s) => s.number);
      const handed = markers(parent, viewer).some((b) => b.startsWith(MARKER_HANDED_PREFIX));
      if (handed || open.length === 0 || open.some((n) => takt.has(n)) || dispatched.has(pkey)) continue;
      handedParents.add(parent.number);
      actions.push({ kind: "takt-sequence", key: pkey, parent: parent.number, issues: open });
    }

    // 遷移 3: 仕様を指す親の sub-issue がすべて閉じている。学びの PR も起動マーカーも無ければ knowledge、
    // 学びの PR が OPEN で自動マージが未予約なら（マーカーの有無によらず）予約だけを出す
    const kkey = `knowledge:${spec.number}`;
    const allClosed = candidates.length > 0 && candidates.every((p) => (p.subIssues ?? []).every((s) => s.state === "CLOSED"));
    if (!allClosed) continue;
    const knowledgePr = knowledgePrOf(snapshot.pullRequests, viewer, spec.number);
    if (knowledgePr !== null) {
      const mkey = `merge-auto:${knowledgePr.number}`;
      if (knowledgePr.state === "OPEN" && !knowledgePr.autoMerge && !dispatched.has(mkey)) {
        actions.push({ kind: "merge-auto", key: mkey, spec: spec.number, pr: knowledgePr.number });
      }
    } else if (!specMarkers.some((b) => b.startsWith(MARKER_KNOWLEDGE_STARTED)) && !dispatched.has(kkey)) {
      actions.push({
        kind: "knowledge",
        key: kkey,
        spec: spec.number,
        parents: candidates.map((p) => p.number),
        subIssues: candidates.flatMap((p) => p.subIssues.map((s) => s.number)),
      });
    }
  }
  return [...actions, ...decideDecisionRequests(snapshot, dispatched), ...decideSessionStalls(snapshot, dispatched)];
}
