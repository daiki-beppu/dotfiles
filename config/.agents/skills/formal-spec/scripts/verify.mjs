// takt の対話モードの /verify と同じ検証器を、会話なしで Markdown に対して動かす（takt 0.68.0 で確認）。
// 結果の JSON を stdout に出し、終了コードは passed=0 / failed=1 / error=2。
// 検証器は cwd/.takt/ に作業ディレクトリと Alloy の jar を置くので、cwd は ~/.cache/formal-spec に固定する。
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const [file] = process.argv.slice(2);
if (!file) { console.error("usage: verify.sh <spec.md>"); process.exit(2); }
const text = readFileSync(resolve(file), "utf8");

const { runFormalSpecVerification } = await import(
  `${process.env.TAKT_ROOT}/dist/features/interactive/formalSpecVerifier.js`
);
if (typeof runFormalSpecVerification !== "function") {
  console.error("takt の内部 API が変わった: runFormalSpecVerification が無い");
  process.exit(2);
}

const cwd = join(homedir(), ".cache", "formal-spec");
mkdirSync(cwd, { recursive: true });
const result = await runFormalSpecVerification(text, cwd, { modelCheckTimeoutSeconds: 300 });
console.log(JSON.stringify(result, null, 2));
process.exit({ passed: 0, failed: 1 }[result.verdict] ?? 2);
