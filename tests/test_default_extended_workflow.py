"""default-extended.yaml の構造的妥当性テスト。

specv 派生 workflow を「specv 固有 policy 抜き」「reviewers の next を report_spillover に差し替え」
「report_spillover step 追加」した状態を要求する。
"""

from __future__ import annotations

import unittest

from tests._helpers import WORKFLOW_FILE, load_workflow_yaml


SPECV_ONLY_POLICIES = {"specv-conventions", "specv-testing", "srp"}


class WorkflowFileExistenceTest(unittest.TestCase):
    def test_workflow_file_exists(self) -> None:
        # Given: 計画通りに workflow ファイルが配置されている前提
        # When: ファイルパスを参照する
        # Then: 実体が存在する
        self.assertTrue(
            WORKFLOW_FILE.exists(),
            f"workflow file must exist at {WORKFLOW_FILE}",
        )


class WorkflowMetadataTest(unittest.TestCase):
    """冒頭メタデータが計画値と一致することを確認する。"""

    def setUp(self) -> None:
        self.workflow = load_workflow_yaml()

    def test_name_is_default_extended(self) -> None:
        # Given: workflow YAML
        # When: name フィールドを読む
        # Then: "default-extended" になっている
        self.assertEqual(self.workflow.get("name"), "default-extended")

    def test_max_steps_is_60(self) -> None:
        # issue 指定の max_steps=60
        self.assertEqual(self.workflow.get("max_steps"), 60)

    def test_initial_step_is_plan(self) -> None:
        self.assertEqual(self.workflow.get("initial_step"), "plan")

    def test_description_is_present_and_non_empty(self) -> None:
        description = self.workflow.get("description")
        self.assertIsInstance(description, str)
        self.assertTrue(description.strip(), "description must be non-empty")


class WorkflowStepsStructureTest(unittest.TestCase):
    """steps 構造の最低限の不変条件。"""

    def setUp(self) -> None:
        self.workflow = load_workflow_yaml()
        self.steps = self.workflow.get("steps")

    def test_steps_is_a_non_empty_list(self) -> None:
        self.assertIsInstance(self.steps, list)
        self.assertGreater(len(self.steps), 0)

    def test_every_step_has_a_name(self) -> None:
        for step in self.steps:
            self.assertIn("name", step, f"step missing name: {step}")
            self.assertIsInstance(step["name"], str)
            self.assertTrue(step["name"].strip())

    def test_step_names_are_unique(self) -> None:
        names = [step["name"] for step in self.steps]
        self.assertEqual(len(names), len(set(names)), f"duplicate step names: {names}")


class SpecvPoliciesAreRemovedTest(unittest.TestCase):
    """specv 固有 policy が一切残っていないこと。dotfiles 側に対応 facet が無いため
    残っていれば facet 解決エラーになる。
    """

    def setUp(self) -> None:
        self.workflow = load_workflow_yaml()

    def test_no_step_references_specv_only_policies(self) -> None:
        offenders: list[tuple[str, list[str]]] = []
        for step in self.workflow.get("steps", []):
            policies = step.get("policy") or []
            if isinstance(policies, str):
                policies = [policies]
            bad = [p for p in policies if p in SPECV_ONLY_POLICIES]
            if bad:
                offenders.append((step.get("name", "<unnamed>"), bad))
        self.assertEqual(
            offenders,
            [],
            f"specv-only policies must be removed; offenders: {offenders}",
        )

    def test_raw_yaml_does_not_mention_specv_policy_names(self) -> None:
        # Why: list 化されない位置（コメントや別フィールド）に残るのも防ぐ。
        text = WORKFLOW_FILE.read_text(encoding="utf-8")
        for name in SPECV_ONLY_POLICIES:
            self.assertNotIn(
                name,
                text,
                f"raw YAML must not contain '{name}' anywhere (found in {WORKFLOW_FILE.name})",
            )


class ReviewersStepTransitionTest(unittest.TestCase):
    """reviewers の「全 approved」rule の next が report_spillover に切り替わっていること。
    needs_fix → fix の rule は維持されていること。
    """

    def setUp(self) -> None:
        self.workflow = load_workflow_yaml()
        self.reviewers = self._find_step("reviewers")

    def _find_step(self, name: str) -> dict:
        for step in self.workflow.get("steps", []):
            if step.get("name") == name:
                return step
        raise AssertionError(f"step '{name}' not found in workflow")

    def test_reviewers_step_exists(self) -> None:
        self.assertIsNotNone(self.reviewers)

    def test_approved_rule_targets_report_spillover(self) -> None:
        # Given: reviewers step の rules
        # When: condition が "approved" を含む rule を探す
        # Then: その next は report_spillover
        approved_rules = [
            r
            for r in self.reviewers.get("rules", [])
            if "approved" in str(r.get("condition", ""))
        ]
        self.assertTrue(
            approved_rules,
            "reviewers step must have a rule whose condition mentions 'approved'",
        )
        for rule in approved_rules:
            self.assertEqual(
                rule.get("next"),
                "report_spillover",
                f"approved rule must transition to report_spillover, got {rule.get('next')}",
            )

    def test_needs_fix_rule_still_targets_fix(self) -> None:
        needs_fix_rules = [
            r
            for r in self.reviewers.get("rules", [])
            if "needs_fix" in str(r.get("condition", ""))
        ]
        self.assertTrue(
            needs_fix_rules,
            "reviewers step must keep a rule whose condition mentions 'needs_fix'",
        )
        for rule in needs_fix_rules:
            self.assertEqual(rule.get("next"), "fix")

    def test_no_reviewers_rule_targets_complete_directly(self) -> None:
        # 旧 default の `next: COMPLETE` が残っていないこと
        for rule in self.reviewers.get("rules", []):
            self.assertNotEqual(
                rule.get("next"),
                "COMPLETE",
                f"reviewers must not transition directly to COMPLETE; rule={rule}",
            )


class ReportSpilloverStepTest(unittest.TestCase):
    """新 step `report_spillover` の最低限の構造。"""

    def setUp(self) -> None:
        self.workflow = load_workflow_yaml()
        self.step = self._find_step("report_spillover")

    def _find_step(self, name: str):
        for step in self.workflow.get("steps", []):
            if step.get("name") == name:
                return step
        return None

    def test_step_exists(self) -> None:
        self.assertIsNotNone(self.step, "report_spillover step must be defined")

    def test_edit_is_false(self) -> None:
        self.assertEqual(self.step.get("edit"), False)

    def test_persona_is_supervisor(self) -> None:
        self.assertEqual(self.step.get("persona"), "supervisor")

    def test_pass_previous_response_is_false(self) -> None:
        self.assertEqual(self.step.get("pass_previous_response"), False)

    def test_instruction_is_report_scope_spillover(self) -> None:
        self.assertEqual(self.step.get("instruction"), "report-scope-spillover")

    def test_allowed_tools_include_minimum_set(self) -> None:
        # Why: 起票には gh が要るので Bash 必須。レポート読みに Read/Glob/Grep。
        provider_options = self.step.get("provider_options") or {}
        claude = provider_options.get("claude") or {}
        allowed = set(claude.get("allowed_tools") or [])
        for tool in {"Read", "Glob", "Grep", "Bash"}:
            self.assertIn(tool, allowed, f"allowed_tools must include {tool}")

    def test_has_terminal_rule_to_complete(self) -> None:
        rules = self.step.get("rules") or []
        self.assertTrue(rules, "report_spillover must define at least one rule")
        nexts = {r.get("next") for r in rules}
        self.assertIn(
            "COMPLETE",
            nexts,
            "report_spillover must terminate with at least one rule whose next is COMPLETE",
        )


class StepGraphIntegrityTest(unittest.TestCase):
    """next で参照される step 名が実際の step 一覧 / 終端マーカーに収まること。"""

    TERMINAL_MARKERS = {"COMPLETE", "ABORT"}

    def setUp(self) -> None:
        self.workflow = load_workflow_yaml()
        self.step_names = {s.get("name") for s in self.workflow.get("steps", [])}

    def test_every_next_resolves_to_a_known_step_or_terminal(self) -> None:
        unresolved: list[tuple[str, str]] = []
        for step in self.workflow.get("steps", []):
            for rule in step.get("rules") or []:
                target = rule.get("next")
                if target is None:
                    continue
                if target in self.TERMINAL_MARKERS:
                    continue
                if target not in self.step_names:
                    unresolved.append((step.get("name"), target))
        self.assertEqual(
            unresolved,
            [],
            f"unresolved next targets (step, target): {unresolved}",
        )


class LoopMonitorsIntegrityTest(unittest.TestCase):
    """loop_monitors が参照する step 名が steps に存在すること。"""

    def setUp(self) -> None:
        self.workflow = load_workflow_yaml()
        self.step_names = {s.get("name") for s in self.workflow.get("steps", [])}

    def test_loop_monitor_step_references_resolve(self) -> None:
        monitors = self.workflow.get("loop_monitors") or []
        if not monitors:
            self.skipTest("workflow defines no loop_monitors; nothing to verify")

        unresolved: list[tuple[int, str]] = []
        for index, monitor in enumerate(monitors):
            cycle = monitor.get("cycle") or []
            for step_name in cycle:
                if step_name not in self.step_names:
                    unresolved.append((index, step_name))
        self.assertEqual(
            unresolved,
            [],
            f"loop_monitors cycle references unknown steps: {unresolved}",
        )


if __name__ == "__main__":
    unittest.main()
