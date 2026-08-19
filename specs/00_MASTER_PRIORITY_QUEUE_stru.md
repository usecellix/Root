# 00_MASTER_PRIORITY_QUEUE — Execution Order for All 20 Specs

**Purpose:** one document to work through instead of juggling 20 files. Each item names the file, what to tell Cursor, its dependencies, and the exact repro to re-test against afterward. Work top to bottom. Don't skip ahead within a phase unless a dependency note says it's safe to parallelize.

---

## How to use this

1. Give Cursor one numbered item at a time using its listed prompt.
2. If an item says "investigate first," get the read-only report back before authorizing the fix.
3. After each fix, re-run the exact repro listed — not a new made-up test — before moving to the next item.
4. Don't start a new bug-hunting session until Phase 0 is fully shipped and re-tested.

---

## PHASE 0 — Safety & Correctness (do not skip, do not reorder within this phase)

### 0.1 — Confirm the overwrite guard can't be bypassed by Accept
**File:** `19_overwrite_guard_confirmation_and_gaps.md` (Bug 3)
**Why first:** this is the one open question about whether your most important safety fix (`14`) can silently be defeated by clicking Accept. Everything else can wait five minutes for this answer.
**Prompt:**
```
Read-only investigation only, no code changes. Trace whether clicking Accept
on a guard-blocked action re-checks guardAgainstOverwrite at actual write
time, or bypasses it. Report file paths and line numbers for both the
generation-time check and the apply-time write path.
```
**Then:** fix per whatever the investigation finds (spec 19 has both fix paths written).
**Retest:** the "Net of Tax" column request from spec 14/19 — confirm Payment Status in column K is never touched, and a blocked action never reaches an Accept-able preview state.

---

### 0.2 — Root pattern: retry loops don't consume their own feedback
**Files:** `18_tier2_retry_and_context_resolution.md` (Bugs 1 & 4), `19_overwrite_guard_confirmation_and_gaps.md` (Bug 1)
**Why grouped:** same root cause in two subsystems (Tier 2 verifier retry, overwrite-guard retry). Fix the pattern once if possible.
**Prompt:**
```
Implement the retry-with-feedback fix from 18_tier2_retry_and_context_resolution.md
(Bug 1: one bounded retry using the Verifier's specific feedback; Bug 4: a
toolRequest during retry must not consume the retry without a follow-up
action attempt). Then apply the same principle to the overwrite-guard retry
path per 19's Bug 1 — confirm INSERT_COLUMN is actually implemented and
callable, and that a guard block's message + suggestion is fed into the
next attempt.
```
**Retest:** the green bar-chart repro from `18`, and the "Net of Tax" repro from `19` — both should now self-correct in one user-facing turn instead of dead-ending.

---

### 0.3 — Root pattern: normalize silently drops fields the model got right
**Files:** `10_critical_bugfixes.md` (Bug 4 — FORMAT_RANGE), `18` (Bug 3 — colorScheme)
**Prompt:**
```
Fix normalize-executor-output.util.ts per 10_critical_bugfixes.md Bug 4
(FORMAT_RANGE range-string to row/col conversion) and confirm 18's Bug 3
(UPDATE_CHART colorScheme) is also fixed. Then build the general regression
guard: enumerate every action type in sheet-actions.types.ts, construct a
raw example with every optional field populated, run through normalize,
assert zero fields are lost unless intentionally stripped.
```
**Retest:** "header should be in bg red" (spec 10) and "also create a bar chart use greeen color" (spec 18) — both should succeed cleanly without needing retries.

---

### 0.4 — Bug 1: false "applied" success on SORT
**File:** `10_critical_bugfixes.md` (Bug 1)
**Dependency:** none, can run in parallel with 0.3.
**Prompt:**
```
Investigate and fix Bug 1 in 10_critical_bugfixes.md — confirm whether
"Applied" in the UI is gated on an actual Office.js context.sync() result,
whether the SORT action's range reference was stale, or whether this is a
preview/apply-state copy mismatch. Fix at whichever layer the diagnosis
points to.
```
**Retest:** "sort the sheet based on Total Amount descending" — confirm the sheet actually reorders, not just that the backend reports success.

---

### 0.5 — Root pattern: write-intent guard doesn't cover every non-write route
**Files:** `10_critical_bugfixes.md` (Bug 3), `11_action_first_guarantee.md`, `20_export_route_misclassification.md` (Bug 1)
**Prompt:**
```
Implement hasWriteIntent() from 11_action_first_guarantee.md, then extend
its override logic per 20_export_route_misclassification.md Bug 1 to also
cover misclassification into 'export', not just 'data'/'ask'. Also fix the
COMPOUND_SIGNALS detection ordering issue from 10's Bug 3 (must run before
route keyword-matching, not after).
```
**Retest:** all three: "sort the data based on tax amount" (compound signal case), "find all suppliers with pending payments above 3000, then highlight..." (spec 10 Bug 3), and "create a new sheet named Paid payments and copy the paid data..." (spec 20).

---

### 0.6 — Bug 2: find/export handler treats raw message as literal search query
**File:** `20_export_route_misclassification.md` (Bug 2)
**Dependency:** do after 0.5 — once routing is fixed, confirm this handler is even still reachable for cases like this; fix it regardless since other genuine export requests could hit the same issue.
**Retest:** the same repro as 0.5's third case, confirming it now produces a real `COPY_FILTERED_RANGE` action with headers/formatting preserved.

---

### 0.7 — Root pattern: reasoning models exhaust token budget before producing output
**Files:** `16_planner_token_exhaustion.md`, `17_verifier_truncation_and_selective_retry.md` (Bug A)
**Prompt:**
```
Fix the Planner's token ceiling per 16_planner_token_exhaustion.md (raise
max_tokens with headroom, replace the fake fallback plan with an honest
error or high-budget retry). Apply the same fix to the Verifier per 17's
Bug A — token ceiling scaled to subtask count, and partial-JSON parsing
that preserves successfully-parsed results instead of blanket-failing
everything on truncation.
```
**Retest:** "In dashboard create a chart, and analysis for purchase register a summary for purchase register" — should complete without hitting the fallback-plan path, and the 12-subtask dashboard verification should never falsely fail all-passing subtasks.

---

### 0.8 — Bug B: selective retry (don't re-run subtasks that already passed)
**File:** `17_verifier_truncation_and_selective_retry.md` (Bug B)
**Dependency:** do after 0.7 — less urgent once truncation stops causing false failures, but still needed for genuine partial failures.
**Retest:** same dashboard repro — confirm only the actually-failed subtask(s) re-execute, not all 12.

---

### 0.9 — Bug C: Executor silently substitutes wrong action instead of surfacing a real block
**File:** `17_verifier_truncation_and_selective_retry.md` (Bug C)
**Retest:** the month-grouping subtask from spec 17 — confirm a genuine block surfaces honestly instead of producing an unrelated SORT_RANGE action.

---

### 0.10 — Bug 2: user-facing narration must match the real, factual block reason
**File:** `19_overwrite_guard_confirmation_and_gaps.md` (Bug 2)
**Dependency:** do after 0.1/0.2 (same request path).
**Retest:** "Net of Tax" column repro — confirm the summary shown matches the guard's actual message, no hallucinated explanation.

---

### 0.11 — Overwrite guard blocks legitimate follow-up refinements to its own recent edit
**File:** `21_overwrite_guard_refinement_recognition.md`
**Dependency:** do after 0.1/0.2/0.10 — same subsystem, same request path, do last in this group so the guard's core behavior is stable before adding refinement recognition on top of it.
**Why this matters:** without this, the guard blocks nearly every second-pass "tweak that" request a CA makes in normal iterative use — the guard is technically correct but practically unusable for follow-up edits.
**Prompt:**
```
Implement 21_overwrite_guard_refinement_recognition.md — add the two
confirmation signals (prior-turn range overlap, explicit change/update
language) that should set explicitOverwriteConfirmed=true, without
loosening the guard for genuinely fresh, unconfirmed writes.
```
**Retest:** BOTH cases — (a) "add remarks to paid invoices" then "change to paid invoices" in the same conversation now succeeds, AND (b) the original "Net of Tax" column repro from spec 14/19 is still correctly blocked. Both must pass; (b) regressing would be worse than not shipping this fix at all.

---

### 0.12 — Partial-progress delivery must not ship a destructive action alone, plus false "Applied" on a failed apply call
**File:** `22_order_dependent_partial_delivery_and_apply_mismatch.md`
**Confirmed:** no actual data loss occurred in this trace (the 400 correctly blocked the write) — but this is still P0-adjacent because the underlying gap (partial delivery has no safety check for order-dependent destructive actions) is a live risk for the *next* similar request, and the false "Applied" state is the same false-success pattern as Bug 1 in spec 10, now confirmed on a destructive action.
**Dependency:** builds on 0.8's selective-retry/partial-progress work (spec 17) — do after that's stable, since this extends the same partial-delivery mechanism with a safety check.
**Prompt:**
```
Implement 22_order_dependent_partial_delivery_and_apply_mismatch.md.
Priority order: Bug 2 first (partial-progress delivery must withhold a
destructive action when the Verifier/dependency graph shows it depends on
an unmet prerequisite — use the Planner's dependsOn graph if available,
not verifier-text pattern matching). Then Bug 1 (investigate whether the
Planner actually created a subtask for the Remarks-annotation clause at
all). Then Bug 3 (fix the false "Applied" UI state on a 400 apply response,
and find the root cause of the 400 itself — likely a ChangeSet gap for
column-structural actions showing "0 cells previewed").
```
**Retest:** "delete the column payment status and in remarks add priority to unpaid invoices" — should either complete both steps in correct order, or clearly ask before doing the destructive half alone. Never show "Applied" unless the apply call actually succeeded.

---

## PHASE 1 — Feature Completion (after Phase 0 is stable and re-tested)

### 1.1 — Native range operations
**File:** `12_native_range_operations.md`
**Note:** confirm this isn't already done — several later traces show `COPY_FILTERED_RANGE`/`AGGREGATE_TABLE` already working, so check before re-building.
**Retest:** "create a new sheet called pending payments and then move the pending data to there create a copy."

### 1.2 — Remaining action types + semantic verification + clarification gating
**File:** `13_benchmark_required_action_types.md`
**Note:** confirm `AGGREGATE_TABLE`/`CREATE_CHART`/`UPDATE_CHART` status first — trace evidence suggests these are mostly built; focus remaining effort on Fix 5 (semantic correctness check) and Fix 4 (clarification gating), which haven't been confirmed working yet.
**Retest:** benchmark prompts #7, #8 (semantic check) and #20 (clarification gating) from `cellix-benchmark-test-prompts.md`.

### 1.3 — `AGGREGATE_TABLE` derived-grouping support
**File:** `17_verifier_truncation_and_selective_retry.md` (Bug D)
**Retest:** month-grouped aggregate table request.

---

## PHASE 2 — Independent / Parallelizable

These don't depend on Phase 0/1 and can be assigned to a separate Cursor session at any point once Phase 0 is done:

- `01-09` — tiering system, mode selector, citation/provenance layer, context pipeline optimization
- `15_user_facing_response_structure.md` — response UX cleanup (do this once Phase 0's error/narration fixes are in, since 15 governs how those get displayed)
- `23_ask_route_response_and_aggregation.md` — ask-route structured response + real aggregation (pairs naturally with `15` since both are response-quality fixes; do together if convenient — `23` reuses `13`'s aggregation logic, so confirm `13` is done first)

---

## After Phase 0 ships: re-run the full benchmark

Once everything in Phase 0 is fixed and re-tested individually, run the entire `cellix-benchmark-test-prompts.md` set fresh (all 20 prompts, both tools) rather than continuing ad hoc bug hunting. That will surface what's actually left far more efficiently than one-off traces at this point.
