// main の状態（赤／緑／未定）の判定。import も gh の呼び出しも持たない純粋なモジュール。
// ruleset と check-runs の取得は呼び出し側が行い、応答をここへ渡す。案内役（guide スキル）と takt-sequence が同じ判定を import して使う（依存の向きは案内役 → takt）。

const FAILED = new Set(["failure", "cancelled", "timed_out"]);

// `GET repos/{repo}/rules/branches/main` の応答（ルールの配列）から、必須チェックの名前を重複なく返す。repo ごとに名前を書き込まないため、ruleset から読む。
export function requiredChecks(rules) {
  const names = rules
    .filter((r) => r.type === "required_status_checks")
    .flatMap((r) => r.parameters?.required_status_checks ?? [])
    .map((c) => c.context);
  return [...new Set(names)];
}

// required: 必須チェックの名前 / checks: commit の check-runs [{ id, name, status, conclusion, runId }]
// 戻り値: { state: "red" | "green" | "undetermined", failed: [{ name, runId }] }
// 必須のどれかが未登録・実行中なら undetermined（次の周で読み直す）。再実行で同名の check-run が増えるので、名前ごとに最新（id 最大）を採る。
export function mainState({ required, checks }) {
  const latest = new Map();
  for (const c of checks) {
    if (!latest.has(c.name) || c.id > latest.get(c.name).id) latest.set(c.name, c);
  }
  const runs = required.map((name) => latest.get(name));
  if (runs.length === 0 || runs.some((c) => c === undefined || c.status !== "completed")) return { state: "undetermined", failed: [] };
  const failed = runs.filter((c) => FAILED.has(c.conclusion)).map((c) => ({ name: c.name, runId: c.runId }));
  return failed.length > 0 ? { state: "red", failed } : { state: "green", failed: [] };
}
