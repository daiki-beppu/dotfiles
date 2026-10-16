// キーチェーンの読み出し。Discord の秘密情報を macOS のキーチェーンから取る。値はログにもエラーにも出さない。
import { execFileSync } from "node:child_process";

export const KEYCHAIN_NAMES = {
  botToken: "guide.discord.bot-token",
  guildId: "guide.discord.guild-id",
  userId: "guide.discord.user-id",
};

const defaultRun = (file, args) => execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });

export function readDiscordSecrets({ account, run = defaultRun }) {
  const secrets = {};
  const missing = [];
  for (const [key, name] of Object.entries(KEYCHAIN_NAMES)) {
    let value = "";
    try {
      value = String(run("security", ["find-generic-password", "-a", account, "-s", name, "-w"])).trim();
    } catch {
      value = "";
    }
    if (value === "") missing.push(name);
    else secrets[key] = value;
  }
  if (missing.length > 0) throw new Error(`キーチェーンに値が無い: ${missing.join(", ")}（security add-generic-password -a "${account}" -s <名前> -w で登録する）`);
  return secrets;
}
