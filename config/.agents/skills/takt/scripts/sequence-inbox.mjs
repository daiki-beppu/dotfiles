// takt-sequence の受け口（inbox）。repo に 1 本だけ動いている takt-sequence へ、後から issue を足すためのディレクトリ。
// 動いている takt-sequence が owner.json（pid と、自分のペインの handle）を置いて開き、毎周ここに届いた issue を自分の並びの後ろに足す。
// 起動の入口（guide の startTaktSequence）は、開いた受け口があり owner の pid が生きていれば、新しいペインを開かずにここへ足す。
// 足すのは「一時ファイルを書いてから受け口の中へ rename」の 1 手で、終わる側は「受け口ごと rename してから残りを読む」。
// どちらの rename も原子的なので、足した issue は、終わる前の takt-sequence が拾うか、足す側が失敗（ENOENT）を受けて新しく起動するかのどちらかになる。
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const OWNER = "owner.json";
let appended = 0;

// cwd の repo の受け口。worktree からでも同じ場所になるよう、git の共通ディレクトリの下に置く。git が読めなければ null。
export function inboxDirOf(cwd) {
  try {
    const common = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return join(resolve(cwd, common), "takt-sequence-inbox");
  } catch {
    return null;
  }
}

export const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

const readOwner = (dir) => {
  try {
    return JSON.parse(readFileSync(join(dir, OWNER), "utf8"));
  } catch {
    return null;
  }
};

// 受け口を開く。生きている owner の受け口が既にあれば開かずに false（その takt-sequence に任せる）。
// owner が死んでいる（kill -9 などで片付けずに終わった）受け口は消して開き直す。
export function openInbox(dir, { pid, handle }, alive = isAlive) {
  const owner = readOwner(dir);
  if (owner !== null && owner.pid !== pid && alive(owner.pid)) return false;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, OWNER), JSON.stringify({ pid, handle }));
  return true;
}

// 生きている takt-sequence の受け口へ issues を足し、その handle を返す。受け口が無い・owner が死んでいる・handle が無い・
// 足す直前に閉じられたときは null（呼び出し側が新しく起動する）。
export function appendToInbox(dir, issues, alive = isAlive) {
  const owner = readOwner(dir);
  if (owner === null || !owner.handle || !alive(owner.pid)) return null;
  // 同じ 1 ms に足しても届いた順に並ぶよう、時刻の次にプロセス内の通し番号を置く。
  const name = `${Date.now()}-${String(appended++).padStart(9, "0")}-${process.pid}-${Math.random().toString(36).slice(2)}.json`;
  const tmp = join(dirname(dir), `.${name}`);
  writeFileSync(tmp, JSON.stringify(issues.map(String)));
  try {
    renameSync(tmp, join(dir, name));
  } catch (e) {
    rmSync(tmp, { force: true });
    if (e.code === "ENOENT") return null;
    throw e;
  }
  return { handle: owner.handle };
}

// 届いた issue を、届いた順に読んで消す。受け口が無ければ空。
export function takeFromInbox(dir) {
  let names;
  try {
    names = readdirSync(dir).filter((n) => n !== OWNER && n.endsWith(".json")).sort();
  } catch {
    return [];
  }
  return names.flatMap((n) => {
    const path = join(dir, n);
    const issues = JSON.parse(readFileSync(path, "utf8"));
    rmSync(path);
    return issues;
  });
}

// 受け口を閉じ、閉じる前に届いていた issue を返す。返した issue があれば、呼び出し側は openInbox で開き直して続ける。
export function closeInbox(dir) {
  const closed = `${dir}.closed-${process.pid}`;
  try {
    renameSync(dir, closed);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const left = takeFromInbox(closed);
  rmSync(closed, { recursive: true, force: true });
  return left;
}
