// to-spec の起動。晴れた map から Orca のタブに対話セッションとして起動する。終わりは map を指す仕様の issue ができたかで判定する（decide.mjs）。
import { MAP_SPEC_PREFIX, tabTitle } from "./decide.mjs";
import { launchAgent } from "./orca-agent.mjs";

const prompt = (map) =>
  [
    `/to-spec #${map}`,
    "",
    `map #${map} は晴れた（霧が無く、子 ticket がすべて閉じている）。map の本文と、閉じた子 ticket の resolution を素材にして仕様 issue を作る。`,
    "map の Decisions so far と閉じた子 ticket の resolution に、仕様の切り方（数・範囲・順・前提の仕様）の決定があればそれに従う。無ければ 1 つ作る。",
    `どの仕様にも spec ラベルを付け、本文に「${MAP_SPEC_PREFIX}${map}」だけの行を書く。`,
    "複数作るときは、前提の仕様を本文の Further Notes に「前提の仕様: #n」と書く。",
  ].join("\n");

export function launchToSpec({ cwd, map }, run) {
  return launchAgent({ cwd, prompt: prompt(map), title: tabTitle("to-spec", map) }, run);
}
