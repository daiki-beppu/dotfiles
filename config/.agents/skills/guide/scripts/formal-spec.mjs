// formal-spec の起動。Orca のタブに対話セッションとして起動する。結果は仕様の issue の Formal Spec コメントで判定する（decide.mjs）。
import { tabTitle } from "./decide.mjs";
import { launchAgent } from "./orca-agent.mjs";

const prompt = (spec) =>
  [
    `/formal-spec #${spec}`,
    "",
    "確認待ちにせず、手順 1 の判定から結果のコメントまで進める。",
    "要件どうしの矛盾で人の判断が要るときは、手順 3 の failed のコメントを書いて終える。",
  ].join("\n");

export function launchFormalSpec({ cwd, spec }, run) {
  return launchAgent({ cwd, prompt: prompt(spec), title: tabTitle("formal-spec", spec) }, run);
}
