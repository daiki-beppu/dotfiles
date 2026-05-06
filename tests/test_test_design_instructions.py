"""test-design.md / test-design-review.md の汎用化テスト。

specv 固有の policy 名・ヘルパー名・パスを含まないこと、
出力構造の見出し（Happy/Edge/Error 表 + 責務マトリクス）が維持されていること。
"""

from __future__ import annotations

import unittest

from tests._helpers import (
    TEST_DESIGN_INSTRUCTION,
    TEST_DESIGN_REVIEW_INSTRUCTION,
    read_text,
)


# specv リポジトリでのみ意味を持ち、dotfiles に持ち込んではならない語
SPECV_FORBIDDEN_TOKENS = (
    "specv-testing",
    "specv-conventions",
    "tests/test-utils.ts",
    "withTmpDir",
)


class TestDesignInstructionExistsTest(unittest.TestCase):
    def test_test_design_file_exists(self) -> None:
        self.assertTrue(
            TEST_DESIGN_INSTRUCTION.exists(),
            f"test-design instruction must exist at {TEST_DESIGN_INSTRUCTION}",
        )

    def test_test_design_review_file_exists(self) -> None:
        self.assertTrue(
            TEST_DESIGN_REVIEW_INSTRUCTION.exists(),
            f"test-design-review instruction must exist at {TEST_DESIGN_REVIEW_INSTRUCTION}",
        )


class TestDesignDoesNotMentionSpecvSpecificsTest(unittest.TestCase):
    """specv 固有の語が漏れていないこと（汎用化済みかの検証）。"""

    def setUp(self) -> None:
        self.text = read_text(TEST_DESIGN_INSTRUCTION)

    def test_no_specv_specific_tokens(self) -> None:
        offenders = [t for t in SPECV_FORBIDDEN_TOKENS if t in self.text]
        self.assertEqual(
            offenders,
            [],
            f"test-design.md must be generalized; remove tokens: {offenders}",
        )


class TestDesignReviewDoesNotMentionSpecvSpecificsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.text = read_text(TEST_DESIGN_REVIEW_INSTRUCTION)

    def test_no_specv_specific_tokens(self) -> None:
        offenders = [t for t in SPECV_FORBIDDEN_TOKENS if t in self.text]
        self.assertEqual(
            offenders,
            [],
            f"test-design-review.md must be generalized; remove tokens: {offenders}",
        )


class TestDesignOutputStructurePreservedTest(unittest.TestCase):
    """出力構造（Happy/Edge/Error の区分）が文書中に残っていること。

    具体的な見出し記号は揺れてよいので、語の出現を緩く確認する。
    """

    def setUp(self) -> None:
        self.text = read_text(TEST_DESIGN_INSTRUCTION)

    def test_mentions_happy_path_classification(self) -> None:
        self.assertIn("Happy", self.text)

    def test_mentions_edge_case_classification(self) -> None:
        self.assertIn("Edge", self.text)

    def test_mentions_error_classification(self) -> None:
        self.assertIn("Error", self.text)


class TestDesignDoesNotForceAaaOrGwtTest(unittest.TestCase):
    """汎用版は AAA / GWT のいずれも強制しない（ワークフロー側 testing policy に委ねる）。

    Why: builtin testing policy は GWT 採用。汎用 instruction が AAA を強制すると衝突する。
    """

    def setUp(self) -> None:
        self.text = read_text(TEST_DESIGN_INSTRUCTION)

    def test_does_not_force_aaa_pattern(self) -> None:
        # 「AAA」と「強制 / 必須 / 必ず」が同じ近接で出ていないことを緩く確認。
        # 完全禁止だと言及自体ができなくなるため、強制系語との同時出現を NG とする。
        for keyword in ("AAA を必須", "AAA 必須", "AAA を強制"):
            self.assertNotIn(
                keyword,
                self.text,
                f"汎用版 test-design.md は {keyword} と書いてはならない",
            )


if __name__ == "__main__":
    unittest.main()
