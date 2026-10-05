#!/usr/bin/env python3
"""画像ブリーフ（Markdown）から、Codex の画像生成で 1 枚のまとめ画像を作る。

Codex は生成画像を ~/.codex/generated_images/<thread_id>/ に保存する。
`codex exec --json` の thread.started から thread_id を取り、そこから画像を回収する。
"""

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

GENERATED = Path.home() / ".codex" / "generated_images"


def build_image_prompt(brief: str) -> str:
    # スタイルは指定せず、構図や絵柄は画像生成側に任せる
    return "この内容をまとめた画像を作って\n\n" + brief


def run_codex(prompt: str, cwd: Path) -> str:
    proc = subprocess.run(
        ["codex", "exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "-"],
        input=prompt, stdout=subprocess.PIPE, text=True, cwd=cwd, check=True,
    )
    for line in proc.stdout.splitlines():
        event = json.loads(line)
        if event.get("type") == "thread.started":
            return event["thread_id"]
    sys.exit("codex の出力に thread.started がありません")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("brief", type=Path, help="画像ブリーフの Markdown")
    p.add_argument("--out", type=Path, help="出力 PNG（既定: ブリーフと同じ場所の digest.png）")
    args = p.parse_args()

    out = args.out or args.brief.with_name("digest.png")
    thread_id = run_codex(build_image_prompt(args.brief.read_text(encoding="utf-8")), args.brief.parent)

    images = sorted((GENERATED / thread_id).glob("*.png"), key=lambda f: f.stat().st_mtime)
    if not images:
        sys.exit(f"画像が生成されませんでした（thread {thread_id}）")
    shutil.copyfile(images[-1], out)
    print(json.dumps({"image": str(out), "thread_id": thread_id}, ensure_ascii=False))


if __name__ == "__main__":
    main()
