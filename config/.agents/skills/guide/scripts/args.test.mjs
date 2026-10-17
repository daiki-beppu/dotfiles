import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "./args.mjs";

test("parseArgs: --stall-minutes の既定は 60、指定した正の数がそのまま返る", () => {
  assert.equal(parseArgs(["o/r"]).stallMinutes, 60);
  assert.equal(parseArgs(["o/r", "--stall-minutes", "30"]).stallMinutes, 30);
  assert.deepEqual(parseArgs(["o/r", "--interval", "10", "--from", "5", "--dry-run", "--stall-minutes", "1.5"]), {
    repo: "o/r", interval: 10, dryRun: true, fromSpec: 5, stallMinutes: 1.5,
  });
});

test("parseArgs: --stall-minutes が正の数でなければ（0・負・数でない・値なし）拒否する", () => {
  for (const bad of [["--stall-minutes", "0"], ["--stall-minutes", "-5"], ["--stall-minutes", "abc"], ["--stall-minutes"]]) {
    assert.equal(parseArgs(["o/r", ...bad]), null, bad.join(" "));
  }
});

test("parseArgs: 既存の引数の検証は変わらない", () => {
  assert.equal(parseArgs([]), null);
  assert.equal(parseArgs(["bad"]), null);
  assert.equal(parseArgs(["o/r", "--interval", "0"]), null);
  assert.equal(parseArgs(["o/r", "--from", "1.5"]), null);
  assert.equal(parseArgs(["o/r", "--unknown"]), null);
});
