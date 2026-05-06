"""nix/packages.nix の `# takt` セクション拡張テスト。

シンボリックリンク 4 本と `mkdir -p` 2 本が追加されていること。
既存の config.yaml リンクは維持されていること。
"""

from __future__ import annotations

import unittest

from tests._helpers import NIX_PACKAGES, read_text


class NixTaktSectionTest(unittest.TestCase):
    """`# takt` セクション内に新規 4 シンボリックリンクと 2 mkdir が含まれること。"""

    def setUp(self) -> None:
        self.text = read_text(NIX_PACKAGES)

    def test_existing_config_yaml_link_is_preserved(self) -> None:
        # 既存の link_force ".takt/config.yaml" を壊していないこと
        self.assertIn(
            'link_force "${dotfilesDir}/.takt/config.yaml" "$HOME/.takt/config.yaml"',
            self.text,
            "existing takt config.yaml link must be preserved",
        )

    def test_mkdir_for_workflows_subdir(self) -> None:
        self.assertIn(
            'mkdir -p "$HOME/.takt/workflows"',
            self.text,
            "must mkdir -p ~/.takt/workflows so link_force can place files there",
        )

    def test_mkdir_for_facets_instructions_subdir(self) -> None:
        self.assertIn(
            'mkdir -p "$HOME/.takt/facets/instructions"',
            self.text,
            "must mkdir -p ~/.takt/facets/instructions",
        )

    def test_link_force_default_extended_yaml(self) -> None:
        self.assertIn(
            'link_force "${dotfilesDir}/.takt/workflows/default-extended.yaml" '
            '"$HOME/.takt/workflows/default-extended.yaml"',
            self.text,
        )

    def test_link_force_report_scope_spillover_md(self) -> None:
        self.assertIn(
            'link_force "${dotfilesDir}/.takt/facets/instructions/report-scope-spillover.md" '
            '"$HOME/.takt/facets/instructions/report-scope-spillover.md"',
            self.text,
        )

    def test_link_force_test_design_md(self) -> None:
        self.assertIn(
            'link_force "${dotfilesDir}/.takt/facets/instructions/test-design.md" '
            '"$HOME/.takt/facets/instructions/test-design.md"',
            self.text,
        )

    def test_link_force_test_design_review_md(self) -> None:
        self.assertIn(
            'link_force "${dotfilesDir}/.takt/facets/instructions/test-design-review.md" '
            '"$HOME/.takt/facets/instructions/test-design-review.md"',
            self.text,
        )


if __name__ == "__main__":
    unittest.main()
