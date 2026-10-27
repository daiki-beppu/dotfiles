// 案内役のペインに出す状況の一覧。スナップショットから、仕様と map ごとに「今どこにいるか」を 1 行ずつ作る純粋関数。
// 判定の規則は decide.mjs の印の読み方を借りる（同じ印を別の正規表現で読み直さない）。表示だけで、行動は決めない。
import {
  CAUSE_FORMAL_SPEC, FOG_CAUSE, MARKER_FORMAL_SPEC_LAUNCHING, MARKER_HANDED_PREFIX, MARKER_KNOWLEDGE_LAUNCHING, MARKER_KNOWLEDGE_STARTED,
  closedTabMarker, decisionRequests, hasFog, hasSpecOfMap, hasStepResult, isParentOf, knowledgePrOf, lastFormalSpec, latestLaunches, markers,
  openMaps, openSpecs, pendingGrillingReplies, sentApprovalRequest, specOfMap, stallCause, ticketSessionsToObserve, ticketsStarted,
} from "./decide.mjs";

const STALL_SUFFIX = stallCause("");

// 送った判断依頼のうち、答えた印が無く、対象もまだ止まったままに見えるもの。
// 対象が自分（仕様・map）なら原因ごとの resolved、PR なら OPEN の間、親なら sub-issue が残る間、他の issue なら OPEN の間。
function pendingDecisions(subject, snapshot, resolvedSelf) {
  const pending = [];
  for (const { issue: target, cause, answered } of decisionRequests(subject, snapshot.viewer)) {
    if (answered) continue;
    const pr = (snapshot.pullRequests ?? []).find((p) => p.number === target);
    const issue = snapshot.issues.find((i) => i.number === target);
    let open = true;
    if (target === subject.number) open = !resolvedSelf(cause);
    else if (pr !== undefined) open = pr.state === "OPEN";
    else if (issue !== undefined) open = (issue.subIssues ?? []).length > 0 ? issue.subIssues.some((s) => s.state === "OPEN") : issue.state === "OPEN";
    if (open) pending.push(`#${target} ${cause}`);
  }
  return pending;
}

const parentsOf = (snapshot, spec) =>
  snapshot.issues.filter((i) => i.number !== spec.number && !(i.labels ?? []).includes("spec") && isParentOf(i, spec.number)).sort((a, b) => a.number - b.number);

// 仕様の状態の材料を 1 度だけ集める。段階の判定と詳細の文はここから読む。
function specFacts(snapshot, spec) {
  const own = markers(spec, snapshot.viewer);
  const parents = parentsOf(snapshot, spec);
  const formal = lastFormalSpec(spec, snapshot.viewer)?.status ?? null;
  const handed = parents.filter((p) => markers(p, snapshot.viewer).some((b) => b.startsWith(MARKER_HANDED_PREFIX)));
  const subs = parents.flatMap((p) => p.subIssues ?? []);
  const resolvedSelf = (cause) => {
    if (cause === CAUSE_FORMAL_SPEC) return formal !== "failed";
    if (cause.endsWith(STALL_SUFFIX)) return hasStepResult(snapshot, spec, cause.slice(0, -STALL_SUFFIX.length));
    return false;
  };
  return {
    own, parents, formal, handed, subs,
    sent: sentApprovalRequest(spec, snapshot.viewer) !== null,
    approved: (spec.labels ?? []).includes("spec-approved"),
    formalLaunched: own.some((b) => b.startsWith(MARKER_FORMAL_SPEC_LAUNCHING)) || latestLaunches(own).has("formal-spec"),
    allClosed: subs.length > 0 && subs.every((s) => s.state === "CLOSED"),
    knowledgeLaunched: own.some((b) => b.startsWith(MARKER_KNOWLEDGE_LAUNCHING) || b.startsWith(MARKER_KNOWLEDGE_STARTED)),
    knowledgePr: knowledgePrOf(snapshot.pullRequests, snapshot.viewer, spec.number),
    decisions: pendingDecisions(spec, snapshot, resolvedSelf),
  };
}

// 親ごとの閉じた数と、takt が扱っている sub-issue（実行中・待ち）。
function implementationDetail(snapshot, f) {
  const tasks = snapshot.taktTasks ?? [];
  const parts = f.parents.map((p) => `親 #${p.number} ${p.subIssues.filter((s) => s.state === "CLOSED").length}/${p.subIssues.length} 閉`);
  const openSubs = new Set(f.subs.filter((s) => s.state === "OPEN").map((s) => s.number));
  const busy = (kind) => [...new Set(tasks.filter((t) => t.kind === kind && openSubs.has(Number(t.issue))).map((t) => Number(t.issue)))].sort((a, b) => a - b);
  const running = busy("running");
  const pending = busy("pending");
  if (running.length > 0) parts.push(`takt ${running.map((n) => `#${n}`).join(" ")} 実行中`);
  if (pending.length > 0) parts.push(`${pending.map((n) => `#${n}`).join(" ")} 待ち`);
  return parts.join("・");
}

// 仕様の段階。上から流れの順に並べ、当てはまる最後の段階を採る（後ろほど進んでいる。判断待ちは何より優先）。
const SPEC_PHASES = [
  { key: "before-approval", label: "承認依頼前", when: () => true, detail: () => "承認依頼を Discord に送る" },
  { key: "awaiting-approval", label: "承認待ち", when: (f) => f.sent && !f.approved, detail: (f) => `Discord の ✅ / ❌ を待つ${f.formal === "passed" ? "（形式検証は passed）" : ""}` },
  { key: "formal-spec", label: "形式検証中", when: (f) => f.formalLaunched && f.formal === null, detail: () => "formal-spec のタブ" },
  { key: "formal-spec-failed", label: "形式検証で失敗", when: (f) => f.formal === "failed", detail: () => "仕様を直して formal-spec のタブで検証し直す" },
  {
    key: "ticketing", label: "起票中",
    when: (f) => ticketsStarted(f.own) || f.parents.length > 0 || (f.approved && ["passed", "not-applicable"].includes(f.formal)),
    detail: (f) => (f.parents.length > 0 ? `親 ${f.parents.map((p) => `#${p.number}`).join(" ")} を takt-sequence に渡す` : ticketsStarted(f.own) ? "to-tickets のタブ" : "to-tickets を起動する"),
  },
  { key: "implementing", label: "実装中", when: (f) => f.handed.length > 0, detail: (f, snapshot) => implementationDetail(snapshot, f) },
  { key: "knowledge", label: "学びをまとめ中", when: (f) => f.allClosed || f.knowledgeLaunched, detail: (f) => (f.knowledgeLaunched ? "knowledge のタブ" : "knowledge を起動する") },
  {
    key: "knowledge-pr", label: "学びの PR のマージ待ち", when: (f) => f.knowledgePr?.state === "OPEN",
    detail: (f) => `PR #${f.knowledgePr.number}${f.knowledgePr.autoMerge ? "（自動マージ予約済み）" : ""}`,
  },
  { key: "done", label: "学びの PR がマージ済み", when: (f) => f.knowledgePr?.state === "MERGED", detail: (f) => `PR #${f.knowledgePr.number}` },
  // 渡した後の停止でも takt が動いていることがあるので、実装中の詳細も続けて出す。
  {
    key: "decision", label: "判断待ち", when: (f) => f.decisions.length > 0,
    detail: (f, snapshot) => [f.decisions.join("、"), ...(f.handed.length > 0 ? [implementationDetail(snapshot, f)] : [])].join("・"),
  },
];

function mapFacts(snapshot, map) {
  const own = markers(map, snapshot.viewer);
  const children = map.subIssues ?? [];
  const allClosed = children.length > 0 && children.every((c) => c.state === "CLOSED");
  const fog = hasFog(map.body);
  const resolvedSelf = (cause) => {
    if (cause === FOG_CAUSE) return !(allClosed && fog);
    if (cause === stallCause("to-spec")) return hasSpecOfMap(snapshot, map.number);
    return false;
  };
  const grilling = pendingGrillingReplies(snapshot)
    .filter(({ ticket }) => children.some((c) => c.number === ticket))
    .map(({ ticket }) => `#${ticket} grilling の問い`);
  const toSpec = latestLaunches(own).get("to-spec");
  return {
    children, allClosed, fog,
    open: children.filter((c) => c.state === "OPEN").length,
    running: ticketSessionsToObserve(snapshot).filter((t) => t.map === map.number).length,
    toSpecRunning: toSpec !== undefined && !own.includes(closedTabMarker("to-spec", toSpec.handle)),
    spec: specOfMap(snapshot, map.number),
    decisions: [...new Set([...pendingDecisions(map, snapshot, resolvedSelf), ...grilling])],
  };
}

// map の段階。仕様と同じく、当てはまる最後の段階を採る。
const MAP_PHASES = [
  { key: "exploring", label: "探索中", when: () => true, detail: (f) => `子 open ${f.open}/${f.children.length}・セッション ${f.running}` },
  { key: "fog", label: "霧の残り", when: (f) => f.allClosed && f.fog, detail: () => "霧を晴らす ticket を起こす" },
  { key: "to-spec", label: "仕様化中", when: (f) => f.allClosed && !f.fog, detail: (f) => (f.toSpecRunning ? "to-spec のタブ" : "to-spec を起動する") },
  { key: "specced", label: "仕様ができた", when: (f) => f.spec !== undefined, detail: (f) => `仕様 #${f.spec.number}` },
  { key: "decision", label: "判断待ち", when: (f) => f.decisions.length > 0, detail: (f) => f.decisions.join("、") },
];

const rowOf = (subject, issue, phases, facts, snapshot) => {
  const phase = phases.findLast((p) => p.when(facts));
  return { subject, title: issue.title ?? "", phase: phase.label, detail: phase.detail(facts, snapshot) };
};

// 扱う仕様（fromSpec の範囲内）と open な map（保留を除く）ごとの 1 行。仕様、map の順に、それぞれ番号の昇順。
export function boardOf(snapshot) {
  return [
    ...openSpecs(snapshot).map((spec) => rowOf(`仕様 #${spec.number}`, spec, SPEC_PHASES, specFacts(snapshot, spec), snapshot)),
    ...openMaps(snapshot).map((map) => rowOf(`map #${map.number}`, map, MAP_PHASES, mapFacts(snapshot, map), snapshot)),
  ];
}

// 端末での表示幅。全角（CJK・全角記号・絵文字）は 2 桁に数える。
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1f300}-\u{1faff}✅❌]/u;
export const widthOf = (s) => [...s].reduce((w, ch) => w + (WIDE.test(ch) ? 2 : 1), 0);
const pad = (s, width) => s + " ".repeat(Math.max(0, width - widthOf(s)));

// 表示幅が width を超えたら、末尾を … にして切る。
export function truncate(s, width) {
  if (widthOf(s) <= width) return s;
  let out = "";
  for (const ch of s) {
    if (widthOf(out + ch) > width - 1) break;
    out += ch;
  }
  return `${out}…`;
}

const TITLE_WIDTH = 40;
export const clockOf = (date) => date.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
export const timeOf = (date) => date.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit" });

// 1 行目に時刻と件数、続けて 1 行に 1 件。列は表示幅でそろえる。
export function renderBoard(rows, now) {
  const specs = rows.filter((r) => r.subject.startsWith("仕様")).length;
  const decisions = rows.filter((r) => r.phase === "判断待ち").length;
  const header = `${clockOf(now)} 状況: 仕様 ${specs} 件・map ${rows.length - specs} 件${decisions > 0 ? `（判断待ち ${decisions} 件）` : ""}`;
  if (rows.length === 0) return `${header}\n  （扱う仕様も map も無い）`;
  const col = (key) => Math.max(...rows.map((r) => widthOf(r[key])));
  const [subject, phase, detail] = [col("subject"), col("phase"), col("detail")];
  const lines = rows.map((r) => `  ${pad(r.subject, subject)}  ${pad(r.phase, phase)}  ${pad(r.detail, detail)}  ${truncate(r.title, TITLE_WIDTH)}`.trimEnd());
  return [header, ...lines].join("\n");
}
