// to-tickets の起動。Orca のタブに対話セッションとして起動する。終わりは親 issue ができたかで判定する（decide.mjs）。
import { PARENT_SPEC_PREFIX } from "./decide.mjs";
import { launchAgent } from "./orca-agent.mjs";

const prompt = (spec) =>
  [
    `/to-tickets #${spec}`,
    "",
    `仕様 #${spec} は spec-approved ラベルで承認済みなので、分割案の確認は省いて起票まで進める。`,
    `親 issue は仕様とは別に作り、本文に「${PARENT_SPEC_PREFIX}${spec}」だけの行を書く。子の起票は gh-subissues で行い、すべて親の sub-issue として紐付ける。`,
  ].join("\n");

export function launchToTickets({ cwd, spec }, run) {
  return launchAgent({ cwd, prompt: prompt(spec), title: `to-tickets #${spec}` }, run);
}
