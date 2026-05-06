"""モジュール横断のインテグレーションテスト。

3 つ以上のファイルを跨ぐ参照を検証する:
  - workflow YAML の `instruction:` 値 → instruction ファイルの実体存在
  - nix の link_force ソースパス → リポジトリ内ファイルの実体存在
  - workflow と nix が同じファイルセットを共有していること
"""

from __future__ import annotations

import re
import unittest

from tests._helpers import (
    INSTRUCTION_DIR,
    NIX_PACKAGES,
    REPO_ROOT,
    WORKFLOW_FILE,
    load_workflow_yaml,
    read_text,
)


class WorkflowInstructionReferencesResolveTest(unittest.TestCase):
    """workflow YAML の `instruction:` で参照される名前が、
    facets/instructions/<name>.md として実在すること。

    Why: dotfiles 側に置いていない instruction を参照すると workflow 起動時に解決エラーになる。
    """

    BUILTIN_INSTRUCTION_NAMES = {
        # builtin に存在する instruction は dotfiles 側に置かなくてよい
        # (worktree 内で実体確認しなくても解決される)
        # 実体: ~/.bun/install/cache/takt@*/builtins/ja/facets/instructions/
        "plan",
        "review-requirements",
        "write-tests-first",
        "review-test",
        "implement-after-tests",
        "ai-review",
        "ai-fix",
        "review-arch",
        "supervise",
        "fix",
    }

    def setUp(self) -> None:
        self.workflow = load_workflow_yaml()

    def test_custom_instruction_files_exist(self) -> None:
        # builtin 以外の instruction は dotfiles の facets/instructions/ に実体が必要
        missing: list[tuple[str, str]] = []
        for step in self.workflow.get("steps", []):
            instruction_name = step.get("instruction")
            if not instruction_name:
                continue
            if instruction_name in self.BUILTIN_INSTRUCTION_NAMES:
                continue
            instruction_file = INSTRUCTION_DIR / f"{instruction_name}.md"
            if not instruction_file.exists():
                missing.append((step.get("name"), instruction_name))
        self.assertEqual(
            missing,
            [],
            "workflow references custom instructions that have no dotfiles backing file: "
            f"{missing}",
        )


class NixLinkForceSourcesExistInRepoTest(unittest.TestCase):
    """nix の link_force ソース（${dotfilesDir}/.takt/...）が
    リポジトリの config/.takt/... として実在すること。
    """

    LINK_FORCE_PATTERN = re.compile(
        r'link_force\s+"\$\{dotfilesDir\}(?P<src>/\.takt/[^"]+)"\s+"\$HOME(?P<dst>/[^"]+)"'
    )

    def setUp(self) -> None:
        self.text = read_text(NIX_PACKAGES)

    def test_each_takt_link_source_exists_in_repo(self) -> None:
        missing: list[str] = []
        for match in self.LINK_FORCE_PATTERN.finditer(self.text):
            src = match.group("src")  # e.g. "/.takt/workflows/default-extended.yaml"
            repo_path = REPO_ROOT / "config" / src.lstrip("/")
            if not repo_path.exists():
                missing.append(str(repo_path))
        self.assertEqual(
            missing,
            [],
            f"nix link_force references files that don't exist in repo: {missing}",
        )


class NixCoversAllNewWorkflowAndInstructionsTest(unittest.TestCase):
    """新規 4 ファイル (workflow 1 + instructions 3) すべてが nix の link_force に登場すること。"""

    REQUIRED_LINK_TARGETS = (
        "/.takt/workflows/default-extended.yaml",
        "/.takt/facets/instructions/report-scope-spillover.md",
        "/.takt/facets/instructions/test-design.md",
        "/.takt/facets/instructions/test-design-review.md",
    )

    def setUp(self) -> None:
        self.text = read_text(NIX_PACKAGES)

    def test_each_required_link_target_appears_in_nix(self) -> None:
        missing = [t for t in self.REQUIRED_LINK_TARGETS if t not in self.text]
        self.assertEqual(
            missing,
            [],
            f"nix is missing link_force entries for: {missing}",
        )


class WorkflowFileIsRoutedFromNixTest(unittest.TestCase):
    """workflow YAML の実体パスと nix link_force のソースパスが指す位置が一致すること。"""

    def test_workflow_file_path_matches_nix_link_source(self) -> None:
        nix_text = read_text(NIX_PACKAGES)
        # nix では ${dotfilesDir} が config/ 配下を指す
        self.assertIn("/.takt/workflows/default-extended.yaml", nix_text)
        self.assertTrue(
            WORKFLOW_FILE.exists(),
            f"workflow YAML must exist at {WORKFLOW_FILE} to satisfy the nix link",
        )


if __name__ == "__main__":
    unittest.main()
