// takt の対話モードの /verify と同じ検証器を、会話なしで Markdown に対して動かす（takt 0.71.0 で確認）。
// 結果の JSON を stdout に出し、終了コードは passed=0 / failed=1 / error=2。
// --expect-violation <name> は mutant 用で、<name> が破れたときだけ 0、それ以外は 1 を返す。
// 検証器は cwd/.takt/ に作業ディレクトリと Alloy の jar を置くので、cwd は ~/.cache/formal-spec に固定する。
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
let expected;
if (args[0] === "--expect-violation") { expected = args[1]; args.splice(0, 2); }
const [file] = args;
if (!file || (expected !== undefined && !expected)) {
  console.error("usage: verify.sh [--expect-violation <inv*|prop*>] <spec.md>");
  process.exit(2);
}
const text = readFileSync(resolve(file), "utf8");
const timeoutSeconds = Number(process.env.FORMAL_SPEC_TIMEOUT_SECONDS ?? 180);

const verifierPath = `${process.env.TAKT_ROOT}/dist/features/interactive/formalSpecVerifier.js`;
const { runFormalSpecVerification, extractFormalSpecBlocks } = await import(verifierPath);
if (typeof runFormalSpecVerification !== "function" || typeof extractFormalSpecBlocks !== "function") {
  console.error("takt の内部 API が変わった: runFormalSpecVerification か extractFormalSpecBlocks が無い");
  process.exit(2);
}

function finish(result) {
  console.log(JSON.stringify(result, null, 2));
  if (expected !== undefined) {
    const hit = result.verdict === "failed" && (result.violated ?? []).includes(expected);
    if (!hit) console.error(`mutant で ${expected} が破れなかった（verdict=${result.verdict}, violated=${JSON.stringify(result.violated ?? [])}）`);
    process.exit(hit ? 0 : 1);
  }
  process.exit({ passed: 0, failed: 1 }[result.verdict] ?? 2);
}

// 検証器に渡す前に、空振りや時間切れを生む書き方を弾く。
function lintQuint(source) {
  // 行番号を保ったまま、コメントと文字列を空白にする
  const code = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"/g, (m) => m.replace(/[^\n]/g, " "));
  const lineOf = (index) => code.slice(0, index).split("\n").length;
  const issues = [];
  // `x' = a and b` は `(x' = a) and b` と読まれ、検査が遷移の前提条件にすり替わって性質が空振りする。
  // 続きが別の代入（`x' = a and y' = b`）なら正しい書き方なので通す。
  for (const m of code.matchAll(/\b(\w+)'\s*=(?![=>])/g)) {
    let depth = 0;
    for (let i = m.index + m[0].length; i < code.length; i++) {
      const c = code[i];
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) { if (depth-- === 0) break; }
      else if (depth === 0 && c === ",") break;
      else if (depth === 0 && !/\w/.test(code[i - 1])) {
        if (/^(action|val|def|var|const|temporal|pure|run|nondet|import|export|type|assume)\b/.test(code.slice(i, i + 16))) break;
        const op = /^(and|or|implies|iff)\b\s*/.exec(code.slice(i, i + 16));
        if (!op) continue;
        if (/^\w+'\s*=(?![=>])/.test(code.slice(i + op[0].length))) break;
        issues.push(`${lineOf(m.index)} 行目: \`${m[1]}' = …\` の右辺が括弧なしで \`${op[1]}\` に続いている。\`${m[1]}' = (…)\` と囲むか、前提条件は \`all { 条件, ${m[1]}' = … }\` の要素に分ける`);
        break;
      }
    }
  }
  // prop* が無いと検証器は Apalache を使い、20 手の記号探索が時間切れになりやすい。prop* があれば TLC で全状態を調べる。
  if (!/\btemporal\s+prop\w*\s*=/.test(code)) {
    issues.push("`temporal prop*` が無い。`temporal propSafety = always(invA and invB)` のように不変条件をまとめた prop を 1 つ置き、TLC で検証させる");
  }
  return issues;
}

const quintIssues = extractFormalSpecBlocks(text).quint.flatMap(lintQuint);
if (quintIssues.length > 0) {
  finish({ verdict: "error", message: `lint:\n- ${quintIssues.join("\n- ")}`, lint: quintIssues });
}

// TLC の反例は `Invariant q_inv is violated` としか言わないので、性質を 1 つずつ検査し直して破れた名前を特定する。
function findViolated(result) {
  const parse = JSON.parse(readFileSync(result.artifacts.parseJson, "utf8"));
  const main = parse.modules.find((m) => ["init", "step"].every((n) =>
    m.declarations.some((d) => d.name === n && d.qualifier === "action")))?.name;
  const cli = createRequire(verifierPath).resolve("@informalsystems/quint/dist/src/cli.js");
  const targets = [
    ...result.quint.invariants.map((name) => ["--invariant", name]),
    ...result.quint.temporal.map((name) => ["--temporal", name]),
  ].filter(([, name]) => expected === undefined || name === expected);
  const violated = [];
  const undetermined = [];
  for (const [flag, name] of targets) {
    const run = spawnSync(process.execPath, [cli, "verify", result.artifacts.specifications.quint,
      "--main", main, "--backend", "tlc", "--max-steps", "20", flag, name], {
      cwd: result.artifacts.runDirectory, encoding: "utf8", timeout: timeoutSeconds * 1000, maxBuffer: 16 * 1024 * 1024,
    });
    if (run.status === 0) continue;
    if (/\[violation\]/.test(run.stdout ?? "")) violated.push(name);
    else undetermined.push(name);
  }
  return { violated, ...(undetermined.length > 0 ? { undetermined } : {}) };
}

const cwd = join(homedir(), ".cache", "formal-spec");
mkdirSync(cwd, { recursive: true });
const result = await runFormalSpecVerification(text, cwd, { modelCheckTimeoutSeconds: timeoutSeconds });
// 反例はシミュレーション（run）と TLC（verify）のどちらで見つかるかが乱数で変わるので、両方で特定する
if (result.verdict === "failed" && [result.quint?.run?.status, result.quint?.verify?.status].includes("failed")) {
  Object.assign(result, findViolated(result));
}
if (result.verdict === "error" && /timed out/.test(result.message ?? "")) {
  result.message = `${timeoutSeconds} 秒で時間切れ。実体の数と値の範囲を減らす（実体は 2 個から始める）。上限は FORMAL_SPEC_TIMEOUT_SECONDS で変えられる\n${result.message}`;
}
finish(result);
