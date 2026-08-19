# 22 — Order-Dependent Compound Request Ships Its Destructive Half, Plus Apply/UI False-Success Mismatch (CONFIRMED SAFE — no data loss occurred)

**Severity: P0 for Bugs 1 & 2. Bug 3 downgraded from P0 to P1 — confirmed the Payment Status column was NOT actually deleted despite the UI showing "Applied."** This means the 400 from `/audit/apply` correctly blocked the underlying Office.js write — the system is safe, but the UI is lying about it, which is its own real problem (same "false success" pattern as Bug 1 in `10_critical_bugfixes.md`, now confirmed in a second, more severe context: a *destructive* action falsely reported as applied).

**Files touched:** `agentic-loop.service.ts` (partial-progress delivery safety check), `planner.agent.ts` / `planner.prompt.ts` (missing subtask decomposition), `conversation.controller.ts` / `audit.controller.ts` (apply endpoint failure handling), frontend apply-status rendering

---

## Repro

Request: `delete the column payment status and in remarks add priority to unpaid invoices`

Across 3 verifier cycles (92 seconds total), the Verifier consistently flagged:
> `"The deletion of the 'Payment Status' column is present but the required step to add 'priority' to Remarks for unpaid invoices is missing. Also, deleting the Payment Status column before annotating Remarks would lose the information needed to identify unpaid invoices."`

Final state: `"Agentic loop complete: 1 actions, 4 iterations, verified: false, partial: true"` — the **only** action delivered is `DELETE_COLUMN`. The Remarks/priority annotation never happened. User-facing message: *"I completed 1 step(s)... could not finish the full request... Want me to retry just that step?"* — with the destructive step already shown as **Applied**.

Then, separately:
```
POST /audit/apply/20174e16-7367-4e15-b44c-9e624ab880b1 → 400
```

---

## Bug 1 — Planner appears to have never created a real subtask for the Remarks/priority half of the request

Three consecutive verifier cycles report the exact same missing piece — not "wrong," but **absent**. This isn't a retry-loop failing to fix a mistake; it looks like the Remarks-annotation requirement was dropped at the planning stage and never became a real subtask/action at all. `"Selective retry: re-executing [s2] — locked passes: [s1]"` implies something (`s1`) already passed — but if that were the Remarks step, the Verifier wouldn't keep saying it's missing. This needs to be traced.

### Investigation prompt (read-only)
```
Do not write fixes yet. Trace the Planner's actual subtask decomposition for
"delete the column payment status and in remarks add priority to unpaid
invoices." Show me: how many subtasks did the Planner produce, what was each
one's description, and specifically — was there ever a subtask whose
description matches "add priority to Remarks for unpaid invoices"? If yes,
trace why its action never appeared in the final actions list despite s1
being marked as a "locked pass." If no such subtask was ever created, this
confirms a Planner decomposition bug, not an Executor execution bug.
```

### Fix, pending investigation
If the Planner dropped this subtask: the Planner needs a completeness check — for a multi-clause request ("X and Y"), verify both clauses are represented as subtasks before finalizing the plan, not just trust the model's decomposition blindly. This is a gap the mandatory Verifier is currently catching *after the fact*, repeatedly, without ever actually causing the missing piece to be created — three cycles of "you're missing this" with no mechanism that makes the Planner/Executor actually add it.

---

## Bug 2 — Partial-progress delivery shipped the destructive action while dropping its safety-critical prerequisite

This is the most serious architectural gap. Spec `12`'s Fix 4 (partial progress survives a failed chain) is confirmed working in principle — but it was never designed with an ordering/safety check, and this request is exactly the case that exposes the gap: **the surviving action (`DELETE_COLUMN`) is only safe to ship *after* the failed/missing action (Remarks annotation) — never on its own.**

### Fix
Partial-progress delivery must not surface a destructive/irreversible action as "ready to preview/apply" if:
1. The overall verifier explicitly flagged that this action depends on, or must be ordered after, another subtask that did not succeed, **and**
2. That action is structurally destructive (`DELETE_COLUMN`, `DELETE_ROW`, `CLEAR_*`, or any action already gated as "destructive" per existing Verifier logic — note the trace itself logs `"Destructive action DELETE_COLUMN — verification required"`, so the system already has a concept of "destructive" it can reuse here).

```typescript
// agentic-loop.service.ts — extend partial-progress delivery
function buildPartialDeliveryResult(subtaskResults: SubtaskResult[], verifierIssues: VerifierIssue[]): PartialDeliveryResult {
  const destructiveActionsWithUnmetDependencies = subtaskResults.filter(r =>
    r.actions.some(a => isDestructiveActionType(a.type)) &&
    verifierIssues.some(issue => issue.description.includes('before') || issue.description.includes('would lose'))
    // More robust: track explicit dependsOn relationships from the Planner's
    // subtask graph, and withhold any destructive action whose dependency
    // subtask did not pass, rather than pattern-matching verifier text.
  );

  if (destructiveActionsWithUnmetDependencies.length > 0) {
    // Withhold these specific actions from the partial-delivery preview.
    // Surface a clear message: "I can't safely apply the column deletion
    // without first completing the Remarks update — here's what's blocking
    // that" rather than delivering the destructive half alone.
  }
}
```

The more durable version of this fix: use the Planner's actual `dependsOn` graph (already part of the subtask schema per `01`/spec design) to determine safe partial-delivery order, rather than pattern-matching the Verifier's prose. If subtask B depends on subtask A and A failed, B's action (especially if destructive) must never be delivered alone.

---

## Bug 3 — CONFIRMED SAFE (write did not occur), but UI falsely shows "Applied" for a destructive action

**Confirmed:** the Payment Status column was NOT actually deleted. The `400` from `/audit/apply` correctly blocked the underlying Office.js write. No data was lost. This downgrades Bug 3 from "possible silent data loss" to "false success indicator" — still a real bug, but not an active emergency.

This is the same failure shape as Bug 1 in `10_critical_bugfixes.md` (SORT reporting "Applied" with no actual sheet change), now confirmed in a more severe context: a **destructive, irreversible-feeling action** (deleting a column) falsely reported as successfully applied. A user trusting this UI would believe Payment Status is gone and may proceed to build downstream work assuming it's missing, when it's actually still there — a different, but still real, kind of confusion and wasted effort.

### Fix
- The frontend's "Applied" state must be derived from the actual response of the apply call — a `400`/error response must render a clear failure state ("This change could not be applied — [reason]. Try again?"), never "Applied."
- Investigate why `/audit/apply` returned 400 in the first place (separate from the UI-state bug) — likely candidates: the ChangeSet had 0 previewed cells (per the log: `"Change set ... previewed: 0 cell(s)"`, which is suspicious for a column-level `DELETE_COLUMN` action — worth confirming whether column-structural actions are correctly represented in the cell-diff-based ChangeSet model at all, or whether this is a gap in how `DELETE_COLUMN`-type actions get previewed/counted, separate from `07_citation_provenance_layer.md`'s cell-diff model which may not have been designed with column/row-structural actions in mind).
- Regardless of the 400's root cause, the same general principle from Bug 1 (`10`) applies here: **no action's success state should ever be inferred from anything other than the actual result of the operation that was supposed to perform it.**

### Fix requirement
- [ ] Reproduce the `400` on `/audit/apply` for a `DELETE_COLUMN`-type ChangeSet and identify its root cause (likely the "0 cells previewed" issue — column-structural actions may not be well-represented in a cell-diff-based ChangeSet model).
- [ ] UI never shows "Applied" for a failed apply call — covered by a test simulating a 400 response.
- [ ] Confirm whether other structural action types (`ADD_SHEET`, `INSERT_COLUMN`, row insert/delete) have the same "0 cells previewed" gap in the ChangeSet model, since this could be a systemic issue for any non-cell-level action, not just `DELETE_COLUMN`.

---

## Acceptance criteria

- [x] Confirmed: the Payment Status column was NOT actually deleted despite the "Applied" UI state — no active data-loss risk from this specific incident. (Still fix Bug 3 below — false success is a real bug even without data loss.)
- [ ] Planner decomposition for multi-clause requests is confirmed to produce a real subtask for every clause — covered by a test using this exact repro, asserting a Remarks-annotation action exists in the final plan.
- [ ] Partial-progress delivery never surfaces a destructive action alone when the Verifier/dependency graph indicates it depends on an unmet prerequisite — covered by a test using this exact repro, asserting `DELETE_COLUMN` is withheld until the Remarks annotation succeeds.
- [ ] UI "Applied" status is only ever shown when the apply call actually succeeded — covered by a test simulating a 400 response and asserting the UI reflects failure, not success.
- [ ] Root cause of the `400` on `/audit/apply` identified and fixed — likely the ChangeSet's "0 cells previewed" gap for column-structural actions.
- [ ] Re-run the exact repro end-to-end after fixes: the system should either (a) complete both steps in the correct order in one turn, or (b) clearly tell the user it can only safely do the Remarks annotation first and ask before proceeding to the column deletion — never deliver the deletion alone, and never show "Applied" unless it actually was.
