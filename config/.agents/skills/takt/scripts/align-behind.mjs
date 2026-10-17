// 自動マージを予約した BEHIND の PR を、作者を問わず、予約の古い順に 1 件ずつ main に揃える常駐スクリプト。
// 揃えた 1 件がマージされるか落ちるまで、次は揃えない。DIRTY の PR には head ごとに 1 回だけコメントで知らせる（判定は align-decide.mjs）。
// 利用者の gh で update-branch するので、揃えた後の CI は普通に走る（Actions の GITHUB_TOKEN だと承認待ちになる。live-mindmap の ADR 0022）。
// 手元の Mac が起きている間だけ動く。状態はファイルに持たず、毎周 GitHub から読み直す（止めて流し直してもよい）。
// 出力は出来事が起きたときだけ「日時（JST） 出来事: PR」の 1 行。Orca のタブで流して人が追える形にする。
// 使い方（repo root で）: node <skill>/scripts/align-behind.mjs [--check check] [--base main] [--interval 60] [--dry-run]
//   --dry-run: 1 周だけ読み、スナップショットと判定を出して終わる（揃えず、知らせない）
import { execFileSync } from "node:child_process";
import { openSync, closeSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { decide } from "./align-decide.mjs";

const opts = { check: "check", base: "main", interval: "60" };
const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--dry-run") continue;
  if (a.startsWith("--") && a.slice(2) in opts) opts[a.slice(2)] = argv[++i];
  else { console.error(`不明な引数: ${a}`); process.exit(2); }
}

const cwd = process.cwd();
const sh = (cmd, args) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
const gh = (args) => JSON.parse(sh("gh", args));
const log = (s) => console.log(new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }), s);
// 同じ待ちや飛ばしを毎周出さないよう、最後に出した行を覚える
let lastStatus = "";
const status = (s) => { if (s !== lastStatus) log(s); lastStatus = s; };

const repo = gh(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
const [owner, name] = repo.split("/");
// DIRTY の知らせは利用者の gh で書く。第三者のコメントで判定が動かないよう、その login が書いた印だけを見る
const viewer = gh(["api", "user"]).login;
const MARKER = (sha) => `<!-- align-behind:dirty ${sha} -->`;

// 同じ repo に 2 本走ると 1 件ずつの約束が崩れるので、PID のロックで 1 本に絞る
const lockFile = join(tmpdir(), `align-behind-${owner}-${name}.pid`);
try { closeSync(openSync(lockFile, "wx")); writeFileSync(lockFile, String(process.pid)); }
catch {
  const pid = Number(readFileSync(lockFile, "utf8"));
  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch {}
  if (alive) { console.error(`もう動いている（PID ${pid}、${lockFile}）`); process.exit(2); }
  writeFileSync(lockFile, String(process.pid));
}
const unlock = () => { try { if (readFileSync(lockFile, "utf8") === String(process.pid)) unlinkSync(lockFile); } catch {} };
process.on("exit", unlock);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => process.exit(0));

const QUERY = `query($owner: String!, $name: String!, $base: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, baseRefName: $base, first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number url headRefOid mergeStateStatus
        autoMergeRequest { enabledAt }
        commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
          __typename
          ... on CheckRun { name status conclusion }
          ... on StatusContext { context state }
        } } } } } }
        comments(last: 100) { nodes { author { login } body } }
      }
    }
  }
}`;

const FAILED = ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE", "ERROR"];
// head の必須チェックの状態。同じ名前が複数あれば（流し直し）、1 つでも走っていれば pending、そうでなければ最後のもの
function checkState(nodes) {
  const runs = nodes.filter((c) => (c.__typename === "CheckRun" ? c.name : c.context) === opts.check);
  if (runs.length === 0) return "none";
  if (runs.some((c) => (c.__typename === "CheckRun" ? c.status !== "COMPLETED" : c.state === "PENDING" || c.state === "EXPECTED"))) return "pending";
  const r = runs.at(-1);
  const result = r.__typename === "CheckRun" ? r.conclusion : r.state;
  return FAILED.includes(result) ? "failure" : "success";
}

function reservedPrs() {
  const prs = [];
  let cursor = null;
  for (;;) {
    const args = ["api", "graphql", "-f", `query=${QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `base=${opts.base}`];
    if (cursor) args.push("-F", `cursor=${cursor}`);
    const page = gh(args).data.repository.pullRequests;
    prs.push(...page.nodes.filter((p) => p.autoMergeRequest));
    if (!page.pageInfo.hasNextPage) return prs;
    cursor = page.pageInfo.endCursor;
  }
}

// 今の head で update-branch が失敗した PR（PR 番号 → head）。head が変われば試し直す
const alignFailed = new Map();
const upToDateCache = new Map();

function snapshot() {
  const mainOid = sh("git", ["ls-remote", "origin", `refs/heads/${opts.base}`]).split(/\s/)[0];
  const raw = reservedPrs();
  const prs = raw.map((p) => {
    const key = `${p.headRefOid}..${mainOid}`;
    // head が最新の main を含むか。BEHIND なら含まない。それ以外は compare で確かめる（head と main が同じ間は結果を覚える）
    let upToDate = false;
    if (p.mergeStateStatus !== "BEHIND") {
      if (!upToDateCache.has(key)) upToDateCache.set(key, gh(["api", `repos/${repo}/compare/${mainOid}...${p.headRefOid}`]).behind_by === 0);
      upToDate = upToDateCache.get(key);
    }
    return {
      number: p.number,
      enabledAt: p.autoMergeRequest.enabledAt,
      mergeState: p.mergeStateStatus,
      upToDate,
      check: checkState(p.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? []),
      dirtyNotified: p.comments.nodes.some((c) => c.author?.login === viewer && c.body.includes(MARKER(p.headRefOid))),
      alignFailed: alignFailed.get(p.number) === p.headRefOid,
    };
  });
  return { prs, raw };
}

function round() {
  const { prs, raw } = snapshot();
  const byNumber = new Map(raw.map((p) => [p.number, p]));
  const r = decide(prs);
  for (const n of r.notify) {
    const p = byNumber.get(n);
    const body = [
      MARKER(p.headRefOid),
      `自動マージを予約済みですが、\`${opts.base}\` と衝突していて揃えられません（head ${p.headRefOid.slice(0, 7)}）。`,
      `\`${opts.base}\` を取り込んで衝突を解き、push し直してください。push し直した後にまた衝突したら、改めて知らせます。`,
    ].join("\n\n");
    sh("gh", ["pr", "comment", String(n), "--body", body]);
    log(`衝突を知らせた: ${p.url}`);
  }
  for (const s of r.skipped) status(`飛ばした: #${s.number}（${s.reason}）`);
  if (r.align === null) { status(`待つ: ${r.wait}（予約済み ${prs.length} 件）`); return; }
  const p = byNumber.get(r.align);
  // 読んだ後に push されていたら 422 で落ちる。そのときは次の周に任せる
  try {
    sh("gh", ["api", "-X", "PUT", `repos/${repo}/pulls/${p.number}/update-branch`, "-f", `expected_head_sha=${p.headRefOid}`]);
    log(`${opts.base} に揃えた: ${p.url}`);
  } catch (e) {
    alignFailed.set(p.number, p.headRefOid);
    log(`揃えられなかった: ${p.url}（${String(e.stderr || e.message).trim().split("\n")[0]}）`);
  }
}

if (dryRun) {
  const { prs } = snapshot();
  console.log(JSON.stringify({ prs, decision: decide(prs) }, null, 2));
  process.exit(0);
}
log(`開始: ${repo} の ${opts.base} 向けの予約済み PR を ${opts.interval} 秒ごとに見る（必須チェック: ${opts.check}）`);
let errors = 0;
for (;;) {
  try { round(); errors = 0; }
  catch (e) {
    // GitHub の一時的なエラーで止めない。続けて落ちるときだけ出す
    if (++errors >= 3) log(`エラーが続いている: ${String(e.stderr || e.message).trim().split("\n")[0]}`);
  }
  await sleep(Number(opts.interval) * 1000);
}
