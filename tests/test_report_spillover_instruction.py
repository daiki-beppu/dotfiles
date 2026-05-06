"""report-scope-spillover.md の内容テスト。

INSTRUCTION_STYLE_GUIDE 準拠で、必須出力 (`##` 見出し)・gh issue 起票手順・
スコープ判定基準・`{report:filename}` プレースホルダ利用を要求する。
"""

from __future__ import annotations

import re
import unittest

from tests._helpers import REPORT_SPILLOVER_INSTRUCTION, read_text


class ReportSpilloverInstructionExistsTest(unittest.TestCase):
    def test_file_exists(self) -> None:
        self.assertTrue(
            REPORT_SPILLOVER_INSTRUCTION.exists(),
            f"instruction must exist at {REPORT_SPILLOVER_INSTRUCTION}",
        )


class ReportSpilloverRequiredHeadingsTest(unittest.TestCase):
    """必須出力の見出しが含まれていること。"""

    REQUIRED_HEADINGS = (
        "## 検出したスコープ外項目",
        "## 起票した issue",
        "## 起票しなかった項目",
    )

    def setUp(self) -> None:
        self.text = read_text(REPORT_SPILLOVER_INSTRUCTION)

    def test_each_required_heading_appears(self) -> None:
        for heading in self.REQUIRED_HEADINGS:
            self.assertIn(
                heading,
                self.text,
                f"required heading missing: {heading}",
            )


class ReportSpilloverContentRulesTest(unittest.TestCase):
    """判断基準・起票手順・テンプレ参照のキーワードが含まれること。"""

    def setUp(self) -> None:
        self.text = read_text(REPORT_SPILLOVER_INSTRUCTION)

    def test_mentions_pr_title_criterion(self) -> None:
        # スコープ判定の絶対基準: 「PR タイトルが変わるか?」
        self.assertIn("PR タイトル", self.text)

    def test_mentions_gh_issue_create(self) -> None:
        self.assertIn("gh issue create", self.text)

    def test_uses_report_placeholder_pattern(self) -> None:
        # ハードコード禁止。{report:filename} プレースホルダ形式で参照させる
        pattern = re.compile(r"\{report:[^}]+\}")
        self.assertRegex(
            self.text,
            pattern,
            "instruction must reference reports via {report:...} placeholder",
        )

    def test_does_not_hardcode_takt_runs_path(self) -> None:
        # `.takt/runs/...` のような実パスを直接書かないこと（プレースホルダ経由のみ）
        self.assertNotIn(
            ".takt/runs/",
            self.text,
            "must not hardcode .takt/runs/ path; use {report:...} placeholder instead",
        )

    def test_warns_against_modifying_current_worktree(self) -> None:
        # 「現 worktree 内では新規ファイルを作成・変更しない」
        # 文言は揺れてよいので、worktree もしくは "現" + 修正禁止系の語を期待
        forbidden_keywords = ["作成・変更しない", "編集しない", "修正しない", "触らない"]
        self.assertTrue(
            any(k in self.text for k in forbidden_keywords),
            "instruction must explicitly forbid modifying current worktree",
        )


if __name__ == "__main__":
    unittest.main()
