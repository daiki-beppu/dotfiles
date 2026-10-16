// 案内役の判定。tracker と takt の状態のスナップショットから、次にやることの一覧を返す純粋関数。
// I/O・時刻・環境変数は読まない（import も持たない）。LLM も使わず、ラベルと状態だけで決める。
//
// snapshot: { repo, viewer, issues: [{ number, state, labels, body, comments: [{ author, body }], subIssues: [{ number, state }] }],
//             taktIssues: [number], dispatched: [key] }
// 行動: { kind: "to-tickets", key, spec } | { kind: "takt-sequence", key, parent, issues }

export const MARKER_STARTED = "案内役: to-tickets を起動した";
export const MARKER_FINISHED_PREFIX = "案内役: to-tickets が終わった（exit ";
export const MARKER_HANDED_PREFIX = "案内役: takt-sequence に渡した";

const FINISHED = /^案内役: to-tickets が終わった（exit (\d+)）/;

// 親 issue の本文に書く記録の行の接頭辞。`仕様: #n` だけの行を、仕様 n の親の印として数える。
export const PARENT_SPEC_PREFIX = "仕様: #";

const isParentOf = (issue, n) =>
  (issue.subIssues ?? []).length > 0 &&
  typeof issue.body === "string" &&
  issue.body.split(/\r?\n/).some((line) => line.trim() === `${PARENT_SPEC_PREFIX}${n}`);

// viewer が書き、本文が接頭辞で始まるコメントだけをマーカーとして数える
const markers = (issue, viewer) =>
  (issue.comments ?? []).filter((c) => c.author === viewer && typeof c.body === "string").map((c) => c.body);

const hasLabel = (issue, name) => (issue.labels ?? []).includes(name);
const isSpec = (issue) => hasLabel(issue, "spec");

export function decide(snapshot) {
  const { viewer, issues } = snapshot;
  const dispatched = new Set(snapshot.dispatched ?? []);
  const takt = new Set((snapshot.taktIssues ?? []).map(Number));

  const approved = issues
    .filter((i) => i.state === "OPEN" && isSpec(i) && hasLabel(i, "spec-approved"))
    .sort((a, b) => a.number - b.number);

  const actions = [];
  const handedParents = new Set();

  for (const spec of approved) {
    const specMarkers = markers(spec, viewer);
    const started = specMarkers.some((b) => b.startsWith(MARKER_STARTED));
    const finished = specMarkers.map((b) => FINISHED.exec(b)).filter(Boolean);
    const ticketed = finished.some((m) => m[1] === "0");

    const candidates = issues
      .filter((i) => i.number !== spec.number && !isSpec(i) && isParentOf(i, spec.number))
      .sort((a, b) => a.number - b.number);

    // 遷移 1
    const key = `to-tickets:${spec.number}`;
    if (candidates.length === 0 && !started && finished.length === 0 && !dispatched.has(key)) {
      actions.push({ kind: "to-tickets", key, spec: spec.number });
    }

    // 遷移 2: 人が作った親（起動マーカー無し）か、to-tickets が exit 0 で終わった親だけ
    const gateOpen = (!started && finished.length === 0) || ticketed;
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
  }
  return actions;
}
