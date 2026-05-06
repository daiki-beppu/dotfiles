"""共通ヘルパー: テスト対象ファイルのパス定数とローダ。

テストファイルから import して使う。 Why: tests 内で同じパス計算を
繰り返さないため。フォールバック値は持たない（Fail Fast）。
"""

from __future__ import annotations

import pathlib

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent

# 新規作成される workflow / instruction
WORKFLOW_FILE = REPO_ROOT / "config" / ".takt" / "workflows" / "default-extended.yaml"
INSTRUCTION_DIR = REPO_ROOT / "config" / ".takt" / "facets" / "instructions"
REPORT_SPILLOVER_INSTRUCTION = INSTRUCTION_DIR / "report-scope-spillover.md"
TEST_DESIGN_INSTRUCTION = INSTRUCTION_DIR / "test-design.md"
TEST_DESIGN_REVIEW_INSTRUCTION = INSTRUCTION_DIR / "test-design-review.md"

# 変更対象ファイル
NIX_PACKAGES = REPO_ROOT / "nix" / "packages.nix"
TAKT_ISSUE_SKILL = REPO_ROOT / "config" / ".claude" / "skills" / "takt-issue" / "SKILL.md"


def read_text(path: pathlib.Path) -> str:
    """指定パスのテキストを返す。Why: 欠落時は Path.read_text が FileNotFoundError を自然に raise する。"""
    return path.read_text(encoding="utf-8")


def load_workflow_yaml() -> dict:
    """default-extended.yaml をロードして辞書として返す。"""
    import yaml  # 遅延 import: 未インストール環境でも他テストは動かす

    text = read_text(WORKFLOW_FILE)
    data = yaml.safe_load(text)
    if not isinstance(data, dict):
        raise AssertionError(
            f"workflow YAML root must be a mapping, got {type(data).__name__}"
        )
    return data
