"""takt-issue SKILL.md の更新テスト。

3 箇所の更新を検証する:
  1. Overview のデフォルト workflow が default-extended に切替
  2. 対話プロンプトのカテゴリ表記が「その他/」（「クイックスタート」表記の残骸禁止）
  3. スコープ外発見セクションが report_spillover step の存在を踏まえた記述に更新
"""

from __future__ import annotations

import unittest

from tests._helpers import TAKT_ISSUE_SKILL, read_text


class TaktIssueSkillFileExistsTest(unittest.TestCase):
    def test_skill_md_exists(self) -> None:
        self.assertTrue(
            TAKT_ISSUE_SKILL.exists(),
            f"SKILL.md must exist at {TAKT_ISSUE_SKILL}",
        )


class OverviewSwitchedToDefaultExtendedTest(unittest.TestCase):
    def setUp(self) -> None:
        self.text = read_text(TAKT_ISSUE_SKILL)

    def test_mentions_default_extended_workflow(self) -> None:
        self.assertIn("default-extended", self.text)

    def test_no_longer_describes_default_as_9_step(self) -> None:
        # 旧 Overview の固有 step 数表記は外す（メンテ負債）
        for fragile in ("9 step", "9step", "9steps"):
            self.assertNotIn(
                fragile,
                self.text,
                f"step count literal '{fragile}' must be removed (use qualitative wording)",
            )


class CategoryWordingMatchesActualPlacementTest(unittest.TestCase):
    """workflowCategoryParser の実装上、未登録 workflow は「その他」へ自動分類される。
    SKILL.md の対話プロンプトもこの実装に揃える。
    """

    def setUp(self) -> None:
        self.text = read_text(TAKT_ISSUE_SKILL)

    def test_mentions_others_category(self) -> None:
        # 「その他/」もしくは「その他」配下の表記
        self.assertIn("その他", self.text)

    def test_does_not_route_user_to_quickstart_category(self) -> None:
        # 旧プロンプトの「クイックスタート」表記が残ると default-extended が見つからない
        self.assertNotIn(
            "クイックスタート",
            self.text,
            "クイックスタート 表記は default-extended の実配置（その他/）と矛盾するため削除する",
        )


class SpilloverSectionAcknowledgesAutomationTest(unittest.TestCase):
    """「7. スコープ外の発見は別 issue 化」セクションが report_spillover step を前提に書かれていること。"""

    def setUp(self) -> None:
        self.text = read_text(TAKT_ISSUE_SKILL)

    def test_section_mentions_report_spillover(self) -> None:
        # report_spillover step の存在を踏まえた表現に変わっていること
        self.assertIn("report_spillover", self.text)


if __name__ == "__main__":
    unittest.main()
