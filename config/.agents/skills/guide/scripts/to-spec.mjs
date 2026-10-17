// to-spec の起動。晴れた map から Orca のタブに対話セッションとして起動する。終わりは map を指す仕様の issue ができたかで判定する（decide.mjs）。
import { MAP_SPEC_PREFIX, tabTitle } from "./decide.mjs";
import { launchAgent } from "./orca-agent.mjs";

const prompt = (map) =>
  [
    `/to-spec #${map}`,
    "",
    `map #${map} は晴れた（霧が無く、子 ticket がすべて閉じている）。map の本文と、閉じた子 ticket の resolution を素材にして仕様 issue を 1 つ作る。`,
    `仕様 issue には spec ラベルを付け、本文に「${MAP_SPEC_PREFIX}${map}」だけの行を書く。`,
  ].join("\n");

export function launchToSpec({ cwd, map }, run) {
  return launchAgent({ cwd, prompt: prompt(map), title: tabTitle("to-spec", map) }, run);
}
