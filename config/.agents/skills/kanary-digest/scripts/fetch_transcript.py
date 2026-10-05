#!/usr/bin/env python3
"""Kanary の録音 1 件を、要約しやすいテキストと meta.json に書き出す。

stdout には受領 JSON だけを出す。Kanary の Pro 通知などの stderr はそのまま流す。
"""

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_ROOT = Path.home() / "Documents" / "kanary-digest"


def kanary(*args: str) -> dict:
    # stderr は捕まえずに流す（[Kanary Pro] 通知を利用者に見せるため）
    out = subprocess.run(["kanary", *args], stdout=subprocess.PIPE, check=True, text=True)
    return json.loads(out.stdout)


def resolve_id(selector: str) -> str:
    recordings = kanary("recordings", "list")["recordings"]
    if not recordings:
        sys.exit("Kanary に録音がありません")
    if selector == "latest":
        return max(recordings, key=lambda r: r["created_at"])["id"]
    if any(r["id"] == selector for r in recordings):
        return selector
    hits = [r for r in recordings if selector.lower() in (r.get("title") or "").lower()]
    if len(hits) == 1:
        return hits[0]["id"]
    sys.exit(f"録音を一意に特定できません: {selector!r}（{len(hits)} 件一致）")


def clock(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600:d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def slugify(text: str) -> str:
    return re.sub(r"[\s/\\:]+", "-", text).strip("-")[:40] or "untitled"


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("selector", nargs="?", default="latest", help="latest | 録音 ID | タイトルの一部")
    p.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="出力先のルート")
    args = p.parse_args()

    rec_id = resolve_id(args.selector)
    rec = kanary("recordings", "show", rec_id)
    meta = rec["metadata"]
    transcript = rec.get("transcript")

    created = datetime.fromisoformat(meta["created_at"].replace("Z", "+00:00")).astimezone()
    out_dir = args.root / f"{created:%Y-%m-%d-%H%M}-{slugify(meta.get('title') or rec_id[:8])}"
    out_dir.mkdir(parents=True, exist_ok=True)

    receipt = {
        "id": rec_id,
        "title": meta.get("title"),
        "recorded_at": created.isoformat(timespec="minutes"),
        "duration": clock(meta["duration"]),
        "out_dir": str(out_dir),
        "limited": None,
        "unavailable_artifacts": rec.get("unavailable_artifacts"),
        "transcript_path": None,
        "segments": 0,
    }

    if transcript:
        segments = transcript["segments"]
        lines = [f"[{clock(s['start_seconds'])}] {s['track']}: {s['text']}" for s in segments]
        path = out_dir / "transcript.txt"
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        receipt.update(
            limited=transcript.get("limited"),
            transcript_path=str(path),
            segments=len(segments),
            covered_until=clock(segments[-1]["end_seconds"]) if segments else None,
        )

    receipt["fetched_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    (out_dir / "meta.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(receipt, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
