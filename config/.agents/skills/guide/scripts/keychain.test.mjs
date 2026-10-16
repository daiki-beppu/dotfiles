// keychain.mjs のテスト。security コマンドは偽の実行関数に差し替え、本物のキーチェーンは読まない。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readDiscordSecrets } from "./keychain.mjs";

const NAMES = { token: "guide.discord.bot-token", guild: "guide.discord.guild-id", user: "guide.discord.user-id" };
const VALUES = { [NAMES.token]: "TOKEN-VALUE-abc", [NAMES.guild]: "111", [NAMES.user]: "222" };

// run(file, args) は stdout の文字列を返す。-s の次の引数をキーチェーンの名前として引く。
const fakeRun = (values, calls = []) => (file, args) => {
  calls.push({ file, args });
  const name = args[args.indexOf("-s") + 1];
  const v = values[name];
  if (v === undefined) throw new Error(`security: The specified item could not be found in the keychain (${name})`);
  return `${v}\n`;
};

test("3 つの値を security find-generic-password で読み、改行を除いて { botToken, guildId, userId } で返す", () => {
  const calls = [];
  const secrets = readDiscordSecrets({ account: "mba", run: fakeRun(VALUES, calls) });
  assert.deepEqual(secrets, { botToken: "TOKEN-VALUE-abc", guildId: "111", userId: "222" });
  assert.equal(calls.length, 3);
  for (const c of calls) assert.equal(c.file, "security");
  assert.deepEqual(
    calls.map((c) => c.args).sort((a, b) => a.join().localeCompare(b.join())),
    Object.values(NAMES).map((n) => ["find-generic-password", "-a", "mba", "-s", n, "-w"]).sort((a, b) => a.join().localeCompare(b.join())),
  );
});

test("値が無い名前だけを message に示して止まり、他の名前と値は含めない", () => {
  const { [NAMES.guild]: _omit, ...rest } = VALUES;
  assert.throws(() => readDiscordSecrets({ account: "mba", run: fakeRun(rest) }), (e) => {
    assert.ok(e.message.includes(NAMES.guild));
    assert.ok(!e.message.includes(NAMES.token));
    assert.ok(!e.message.includes(NAMES.user));
    assert.ok(!e.message.includes("TOKEN-VALUE-abc"));
    return true;
  });
});

test("値が空（空白・改行だけ）の名前は無いものとして示す", () => {
  assert.throws(() => readDiscordSecrets({ account: "mba", run: fakeRun({ ...VALUES, [NAMES.user]: "  \n" }) }), (e) => {
    assert.ok(e.message.includes(NAMES.user));
    assert.ok(!e.message.includes(NAMES.guild));
    return true;
  });
});

test("複数の値が無ければ、無い名前をすべて示す", () => {
  assert.throws(() => readDiscordSecrets({ account: "mba", run: fakeRun({ [NAMES.user]: "222" }) }), (e) => {
    assert.ok(e.message.includes(NAMES.token));
    assert.ok(e.message.includes(NAMES.guild));
    assert.ok(!e.message.includes(NAMES.user));
    return true;
  });
});

test("依存なし: import は node:* と同じディレクトリのモジュールだけ", () => {
  const src = readFileSync(new URL("./keychain.mjs", import.meta.url), "utf8");
  const specs = [...src.matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)].map((m) => m[1]);
  for (const s of specs) assert.ok(s.startsWith("node:") || s.startsWith("./"), `外部パッケージの import: ${s}`);
});
