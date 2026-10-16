// 案内役の入口。仕様の承認依頼を Discord に送り、承認済みの仕様を to-tickets から takt-sequence まで流す。
// 使い方（対象 repo の root で）: node guide.mjs <owner/repo> [--interval 60] [--dry-run]
// 状態は GitHub の issue（マーカーのコメント）に持つ。止めて流し直しても続きから動く。
import { setTimeout as sleep } from "node:timers/promises";
import { createDiscord } from "./discord.mjs";
import { createExecute } from "./execute.mjs";
import { createGithub } from "./github.mjs";
import { readDiscordSecrets } from "./keychain.mjs";
import { runLoop, runRound } from "./loop.mjs";
import { createReadSnapshot } from "./snapshot.mjs";
import { startTaktSequence, taktRunDirs, taktTasks } from "./takt.mjs";
import { runKnowledge } from "./knowledge.mjs";
import { runToTickets } from "./to-tickets.mjs";

const usage = () => {
  console.error("usage: node guide.mjs <owner/repo> [--interval 60] [--dry-run]");
  process.exit(2);
};

let repo;
let interval = 60;
let dryRun = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--dry-run") dryRun = true;
  else if (a === "--interval") interval = Number(argv[++i]);
  else if (!a.startsWith("--") && !repo) repo = a;
  else usage();
}
if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !(interval > 0)) usage();

const cwd = process.cwd();
const log = (s) => console.log(new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }), s);
const github = createGithub({ repo, cwd });

const actual = github.repoName();
if (actual.toLowerCase() !== repo.toLowerCase()) {
  console.error(`cwd の repo (${actual}) が引数 (${repo}) と違う。対象 repo の root で流す`);
  process.exit(2);
}
// マーカーのコメントは gh の認証ユーザーが書く。第三者のコメントで判定が動かないよう、その login を起点で 1 回だけ解決する
const viewer = github.viewer();

let secrets;
try {
  secrets = readDiscordSecrets({ account: process.env.USER });
} catch (e) {
  console.error(String(e.message));
  process.exit(2);
}
const discord = createDiscord({ token: secrets.botToken, guildId: secrets.guildId, userId: secrets.userId, warn: log });

const readSnapshot = createReadSnapshot({
  repo,
  viewer,
  discordUserId: secrets.userId,
  github,
  discord,
  taktTasks: () => taktTasks(cwd),
});

const execute = createExecute({ github, discord, cwd, repo, viewer, runToTickets, startTaktSequence, runKnowledge, taktRunDirs });

const deps = { readSnapshot, execute, log };
try {
  if (dryRun) {
    const snapshot = await readSnapshot();
    const specs = snapshot.issues.filter((i) => i.state === "OPEN" && i.labels.includes("spec"));
    log(`dry-run: ${repo} / issue ${snapshot.issues.length} 件 / 仕様(open) ${specs.length} 件（承認済み ${specs.filter((i) => i.labels.includes("spec-approved")).length} 件）`);
    log(`dry-run: sub-issue を持つ issue ${snapshot.issues.filter((i) => i.subIssues.length > 0).length} 件 / takt にタスクのある issue ${snapshot.taktIssues.length} 件`);
    await runRound({ ...deps, readSnapshot: async () => snapshot, dryRun: true }, new Set());
  } else {
    log(`案内役を開始: ${repo}（${interval} 秒ごと）`);
    await runLoop({ ...deps, sleep }, { intervalSec: interval });
  }
} catch (e) {
  log(`停止: ${String(e.message).split("\n")[0]}`);
  process.exit(1);
}
