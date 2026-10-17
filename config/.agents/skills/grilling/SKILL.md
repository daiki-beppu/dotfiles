---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Grilling runs in one of two modes.

- **判断の振り分け** (triage): the agent sorts each question and asks the human only the irreversible ones. Use it when wayfinder calls you to resolve a `grilling` or `task` ticket.
- **対話型** (interactive): rounds of questions answered by the human, described under "Interactive mode" below. Use it when the human invoked grilling directly, and when wayfinder calls you from Chart the map.

## 判断の振り分け

Build the same design tree and frontier as in interactive mode. Then take each frontier question one at a time and sort it through the four steps below in order, stopping at the first step that settles it:

- ⓪ **Reversible by design.** If the design can be changed so the decision becomes reversible, change it and settle the question as a reversible decision (a 仮決め).
- ① **Fact.** If the code, `GLOSSARY.md`, `docs/adr/`, or research gives the answer, the agent decides it (dispatch a sub-agent to look it up).
- ② **Precedent.** If an earlier ADR leads to the answer, decide as that ADR did, and record the ADR you cited in the resolution body as a link.
- ③ **Irreversible or not.** If the decision is irreversible, ask the human (see below). Otherwise make a 仮決め: choose one answer, and move on at once without waiting.

A decision is **irreversible** when it falls in one of these five:

1. A contract already published outside (public API, URL, file format, CLI arguments).
2. A change that loses data (data loss).
3. Outbound communication (a release, a published article, a PR to someone else's repo).
4. Money and permissions.
5. Names that go outside (externally visible names).

### Asking an irreversible decision

Before you ask, write a comment on the ticket (the one wayfinder called you for) whose first line is `## 判断の問い`, followed by the question, its options (選択肢), and your recommendation (推奨). The guide reads the last such comment and puts it in the Discord request, because it cannot read the question from the Orca terminal. Write it before calling the AskUserQuestion tool, never after.

Ask each irreversible decision with the AskUserQuestion tool, 1 件ずつ. Write the question with its options (選択肢) and your recommendation (推奨), so the human can answer with 1 回答 and you can proceed. The guide watches for AskUserQuestion to notice that the session is waiting for a human, so every irreversible decision goes through it.

### Recording a 仮決め

Record each 仮決め in the ticket's resolution comment, in the form wayfinder defines for the resolution (answer, triage step, reason, evidence).

### Done

Triage is done when the frontier is empty. Go straight on to recording the resolution; the human's confirmation is not awaited.

## Interactive mode

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
