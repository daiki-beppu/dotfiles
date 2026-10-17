// 案内役の CLI 引数の解析。不正なら null（呼び出し側が usage を出して終了コード 2 にする）。
export function parseArgs(argv) {
  let repo;
  let interval = 60;
  let dryRun = false;
  let fromSpec;
  let stallMinutes = 60;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--interval") interval = Number(argv[++i]);
    else if (a === "--from") fromSpec = Number(argv[++i]);
    else if (a === "--stall-minutes") stallMinutes = Number(argv[++i]);
    else if (!a.startsWith("--") && !repo) repo = a;
    else return null;
  }
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !(interval > 0) || !(stallMinutes > 0) || (fromSpec !== undefined && !(Number.isInteger(fromSpec) && fromSpec > 0))) return null;
  return { repo, interval, dryRun, fromSpec, stallMinutes };
}
