# Task: Break large Planner/Executor runs into incremental, user-gated sub-tasks

## Problem

Right now, when a user gives a large multi-part request — e.g. "create 12 monthly sheets, a Main dashboard sheet with a summary and a chart, and a Lists sheet, with formatting on all of them" — the Tier 3 Planner/Executor/Verifier pipeline runs the **entire plan end-to-end in one continuous pass**, and only surfaces accept/preview dialogs to the user **after everything is done**.

Observed failure mode from a real run:
- Planner produced a 12-step plan.
- Executor ran all 12 steps, generating 37 total changes (new sheets, cell updates, ~20 range-format calls, row-height sets, freeze panes, autofit, a chart).
- One step's deterministic check **failed partway through** (`Deterministic checks failed` on one of the intermediate steps), but the run kept going / retried internally instead of stopping there.
- The user only saw all 37 accept dialogs **at the very end**, after a long wait, with no way to review or approve earlier chunks incrementally.
- The overall response was: "completed 12 step(s) and prepared 37 change(s) for preview, but could not finish the full request... Could not complete after 2 attempts."

This is a bad UX and a bad reliability posture: the user has no visibility into progress, can't catch a bad step early, and a failure deep in the chain wastes all the work (and cost) that came before it.

## Desired behavior

Model this on how "Shortcut" (our competitor, referenced in our own `CODEBASE_ANALYSIS.md`) handles multi-step agentic edits: **break the plan into logical sub-tasks, and gate execution on user acceptance between each one.**

Concretely:

1. **Planner still produces the full plan up front** (all N steps), so the user can see the overall shape of what's about to happen — but the plan is chunked into discrete, independently-previewable **sub-tasks** (not necessarily 1:1 with today's internal `structuralOps`/action granularity — group related actions, e.g. "create the 12 empty month sheets" is one sub-task, "populate Main dashboard layout" is another, "apply formatting to Main" is another, "add the chart" is another).
2. **Only the first sub-task is executed and verified initially.** Its changes are run through the existing Shadow Workbook dry-run + deterministic checks, and a preview/accept dialog is surfaced to the user **immediately** — not batched with anything downstream.
3. **Execution pauses and waits for explicit user acceptance of that sub-task** before the Executor is invoked for the next one. If the user rejects or the step fails deterministic checks, do not proceed automatically — surface the failure for that sub-task specifically, with a retry option scoped to just that sub-task (matching the existing "Want me to retry just that step?" affordance, but actually blocking on it instead of continuing to accumulate downstream work).
4. **Repeat per sub-task**: accept sub-task 1 → only then does the Planner/Executor move to generate + verify sub-task 2 → present that dialog → wait for accept → etc.
5. **No look-ahead work happens while waiting on a pending accept.** Don't pre-generate sub-task 3's changes while sub-task 2 is still awaiting user acceptance — this avoids wasted LLM cost on work that may become invalid if an earlier step is rejected/modified, and matches the "only start working on next task once accepted" requirement.
6. **Progress should stream incrementally**, not batch at the end — the user should see "Sub-task 1 of 4: creating month sheets" complete and become actionable well before the full 12-step/37-change plan has finished generating.

## Requirements / things to figure out in the codebase

- Identify where today's Tier 3 flow currently accumulates all steps' changes into a single `ChangeSetService` preview batch, and change this to emit **one `change_set` per sub-task**, gated on `previewManager.accept()` (or equivalent) before the next sub-task's Executor call is triggered.
- Confirm how sub-task boundaries should be derived from the Planner's output — likely a new grouping/segmentation layer on top of the existing subtask list, not a rewrite of the Planner itself. Look at whether the Planner's existing subtask units are already a reasonable boundary, or whether they need grouping into coarser "phases" (e.g. structural creation → data population → formatting → visualization) for this to feel right to the user.
- Confirm how the SSE stream (`POST /excel-ai/conversation`) should represent this — likely need a new event/state indicating "sub-task N of M ready for review" vs. today's single terminal "done" event.
- Decide what happens on reject/failure of a mid-sequence sub-task: does the user get to (a) retry just that sub-task, (b) skip it and continue, or (c) abort the remaining plan entirely? At minimum, replicate today's "retry just that step" affordance, but scope it so it doesn't require re-running or re-previewing already-accepted sub-tasks.
- Make sure already-accepted sub-tasks' `change_sets` remain independently revertible (per existing M5.1/M5.2 checkpoint/revert design) — accepting sub-task 2 shouldn't require sub-task 1 to still be "pending" in any way.
- This should not regress the existing Shadow Workbook dry-run verification or deterministic-checks logic — it's a sequencing/UX change (when previews are surfaced and when execution proceeds), not a change to what gets verified.

## Non-goals

- Not asking for a change to how the Planner reasons about the overall task — it can and should still plan the full N-step sequence up front for coherence. This is purely about **execution and preview sequencing**: don't run everything before the user sees anything.
- Not asking to change what counts as "verified" (deterministic checks, Shadow Workbook simulation stay as-is).

## Acceptance criteria

- Given a large multi-part request (e.g. "12 month sheets + Main dashboard + Lists + formatting + chart"), the user sees and can accept/reject the **first** logical sub-task's changes well before the rest of the plan has even been generated.
- No Executor work happens for sub-task N+1 until sub-task N has been explicitly accepted by the user.
- A deterministic-check failure on one sub-task does not silently continue into generating further sub-tasks — it stops and surfaces that specific failure with a scoped retry option.
- The final "all done" state is reached only after every sub-task has been individually accepted, not as one big batch of 37 dialogs at the end.
