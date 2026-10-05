{
  lib,
  buildNpmPackage,
  fetchurl,
  jq,
  nodejs_22,
}:

# cf: Cloudflare の CLI。wrangler の後継で、Cloudflare API 全体を扱える。
# nixpkgs・Homebrew 未収録。npm の公開 tarball（ビルド済み dist 入り）から組む。
# 上流は pnpm モノレポで、tarball の devDependencies は vendor の相対 tgz を指していて
# 解決できない。ランタイム依存だけで作った package-lock.json を同梱して使う。
#
# 更新手順: version と hash を上げ、tarball 展開先で
#   jq 'del(.devDependencies, .scripts)' package.json > p && mv p package.json
#   npm install --package-lock-only --ignore-scripts
# を実行して package-lock.json を差し替え、npmDepsHash を lib.fakeHash にしてビルドし直す。
buildNpmPackage rec {
  pname = "cf";
  version = "1.0.0-beta.12";

  src = fetchurl {
    url = "https://registry.npmjs.org/cf/-/cf-${version}.tgz";
    hash = "sha256-LGaN+SuptzxQq1uElbwA71HzBk3en/cLPZwCyOTLMHY=";
  };
  sourceRoot = "package";

  nodejs = nodejs_22;

  postPatch = ''
    ${lib.getExe jq} 'del(.devDependencies, .scripts)' package.json > package.json.tmp
    mv package.json.tmp package.json
    cp ${./package-lock.json} package-lock.json
  '';

  npmDepsHash = "sha256-/QexaG3E6VvI8UOsbRqgljwP4dusRFaNNvLsvf/3umA=";
  dontNpmBuild = true;

  meta = {
    description = "The Cloudflare CLI";
    homepage = "https://github.com/cloudflare/cf";
    license = with lib.licenses; [
      mit
      asl20
    ];
    mainProgram = "cf";
  };
}
