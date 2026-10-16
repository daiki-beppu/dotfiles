// プロセス起動アダプタ。claude -p で to-tickets を起動し、終わるまで待って終了コードを返す。出力は一時ファイルのログに書く。
import { PARENT_SPEC_PREFIX } from "./decide.mjs";
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const prompt = (spec) =>
  [
    `/to-tickets #${spec}`,
    "",
    `仕様 #${spec} は spec-approved ラベルで承認済みなので、分割案の確認は省いて起票まで進める。`,
    `親 issue は仕様とは別に作り、本文に「${PARENT_SPEC_PREFIX}${spec}」だけの行を書く。子の起票は gh-subissues で行い、すべて親の sub-issue として紐付ける。`,
  ].join("\n");

export function runToTickets({ cwd, spec }) {
  const logFile = join(tmpdir(), `guide-to-tickets-${spec}.log`);
  const fd = openSync(logFile, "a");
  return new Promise((resolve, reject) => {
    const child = spawn(
      "claude",
      ["-p", prompt(spec), "--allowedTools", "Bash(gh:*)", "Bash(gh-subissues:*)", "Read", "Grep", "Glob"],
      { cwd, stdio: ["ignore", fd, fd] },
    );
    closeSync(fd);
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code: code ?? 1, logFile }));
  });
}
