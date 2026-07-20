# 10 — Critical Bugfixes (P0, fix before continuing Phase 1 rollout)

**Phase:** 0 — blocks everything else. Do this before shipping any of `01`-`09`.
**Source:** four production traces (see repro steps per bug below), not hypothetical — each bug is reproduced from an actual SSE/log capture.
**Files touched:** confirmed for Bug 4 via read-only investigation — `normalize-executor-output.util.ts`, `executor.prompt.ts`. Others per per-bug diagnosis sections below: `conversation.service.ts` / `rich-action-engine` (SORT handler, Bug 1), `smart-data-query.service.ts` (column slicer, Bug 2), router ordering (Bug 3).

---

## Bug 4 — CONFIRMED ROOT CAUSE: `sanitizeAction` drops FORMAT_RANGE actions emitted as an A1 `range` string, because it only accepts `row`/`col` indices

**Severity: P0 — fix this first.** This is the most dangerous bug in the system: a correctly planned, executed, and verifier-passed action gets silently discarded post-verification and the user is shown a generic "I couldn't produce valid actions" message instead of the actual result. A user cannot distinguish "the AI is confused" from "the AI succeeded but a downstream bug ate the result."

**Investigation history (for context, not action items):** the original hypotheses in this spec's first draft — a stale failure flag, a first-vs-last-attempt bug, or a "Missing subtaskId" retry loop — were investigated read-only via Cursor and **ruled out**. "Missing subtaskId" does not appear anywhere in this codebase (confirmed via grep across backend/frontend/logs) and was not part of this bug. The real cause, confirmed by tracing the actual code, is below.

### Repro (trace, request: "header should be in bg red")

```
event: status   → "Prepared FORMAT_RANGE action"
event: thinking → "Running deterministic checks..."
event: status   → "Actions verified"
event: status   → "1 actions ready for preview"
event: question → "I understood your request but could not produce valid actions. Can you clarify what to change?"   ← BUG
```

### Confirmed root cause

**A split contract between what the Executor's prompt teaches the model and what `sanitizeAction` requires:**

- The canonical backend contract for `FORMAT_RANGE` (per `system-prompt-builder.ts` and `cellix-system-prompt.ts`) is `{ type, row, col, rowCount?, colCount?, format }` — 0-indexed anchor + span.
- `executor.prompt.ts` lists `FORMAT_RANGE` in its type list but **never actually documents its schema** — it only fully documents `SORT_RANGE`'s A1-string (`range: "A1:L1"`) shape.
- Planner language itself describes the target in A1 notation ("Apply red background fill to the header row A1:L1"), further nudging the Executor's model toward emitting a `range` string.
- `normalizeSingleAction` (`normalize-executor-output.util.ts`, ~lines 68–158) copies `range` through as-is if present, and does **not** convert it to `row/col/rowCount/colCount`. It does not drop the action here — this is a "no-op fix" step, not the failure point.
- `sanitizeAction` (`conversation-engine.service.ts`, ~lines 555–564, using `normalizeIndex` ~613–618) requires integer `row`/`col` for `FORMAT_RANGE` (and `MERGE_CELLS`, `CLEAR_CONTENT`, `CLEAR_FORMAT`, `CLEAR_ALL`, `ADD_COMMENT`, `DELETE_COMMENT` — same case). A `range`-only action has no valid `row`/`col`, so `normalizeIndex` returns null, `sanitizeAction` returns `null`, and `sanitizeActions` filters it out — silently producing an empty `actions` array.
- `streamWithOrchestrator` (`conversation.service.ts`, ~lines 1505–1521) then sees `actions.length === 0` and emits the `question` fallback — even though `orchestratorResult.verifierPassed === true` and `rawActions.length > 0` going in. This happens because virtual-apply treats `FORMAT_RANGE` as a no-op during verification (`virtualApply.ts` ~80–90), so verification can pass without `row`/`col` ever being checked — the gap only surfaces at the later `finalizeActions → sanitizeAction` stage.
- By contrast, `SORT_RANGE` and `CREATE_CHART` are in `sanitizeAction`'s "pass-through" group and validate against `range`/`sourceRange` strings directly — `FORMAT_RANGE` is the inconsistent one relative to those, even though it's internally consistent with `MERGE_CELLS`/`CLEAR_*`'s row/col requirement.
- The frontend already accepts **both** shapes (`actionNormalizer.ts` converts A1 ⟷ row/col in both directions) — the backend's `sanitizeAction` is the one link in the chain that only accepts the index form.

### Fix — two changes, in order

**1. `normalize-executor-output.util.ts` — make normalize actually normalize (primary fix):**
For the index-requiring action types (`FORMAT_RANGE`, `MERGE_CELLS`, `UNMERGE_CELLS`, `CLEAR_CONTENT`, `CLEAR_FORMAT`, `CLEAR_ALL`, `ADD_COMMENT`, `DELETE_COMMENT`), add a step in `normalizeSingleAction`:
- If `row`/`col` are already valid integers, leave as-is — no behavior change to the working path.
- Else if a `range` string is present and sheet context is available, parse it into `row`/`col`/`rowCount`/`colCount` (0-indexed anchor + span). Reuse the cell-ref parsing already used in `tier0-direct.service.ts` (~lines 142–148) rather than writing a second parser.
- Else (no `range`, no valid `row`/`col`) leave the action as-is — `sanitizeAction`'s rejection of a genuinely malformed action is correct and must not be suppressed.

**2. `executor.prompt.ts` — close the prompt gap that caused the drift in the first place:**
Add an explicit `FORMAT_RANGE` schema example alongside the existing `SORT_RANGE` one, showing the canonical `row`/`col`/`rowCount`/`colCount` + `format` shape already defined in `system-prompt-builder.ts` (~line 18) and `cellix-system-prompt.ts` (~lines 119–120). Don't invent a new shape — surface the one that already exists elsewhere in the prompt layer, so the model is nudged toward emitting indices directly instead of an A1 range string.

**Do not modify `sanitizeAction`'s validation logic itself** — its `row`/`col` requirement is the existing, documented contract that Tier 0 and the docs already agree on. The fix is making `normalize` reliably produce that shape regardless of which form the model emits, not loosening the check that catches genuinely malformed actions.

### Fix requirement

- [ ] `normalizeSingleAction` converts a `range`-only `FORMAT_RANGE`-class action into valid `row`/`col`/`rowCount`/`colCount` when a valid A1 range and sheet context are available; leaves already-valid actions untouched; leaves genuinely malformed actions (no range, no indices) untouched for `sanitizeAction` to correctly reject.
- [ ] Unit test: `{ type: "FORMAT_RANGE", sheetName: "X", range: "A1:L1", format: {...} }` goes into normalize and comes out with `row: 0, col: 0, rowCount: 1, colCount: 12`, format preserved.
- [ ] `executor.prompt.ts` documents the `FORMAT_RANGE` index schema explicitly, not just `SORT_RANGE`.
- [ ] Follow-up check (can be a fast grep, not a full audit): confirm no other action type has the same "prompt teaches A1-string but sanitize wants indices" mismatch. `SORT_RANGE`/`CREATE_CHART` are already fine (sanitize accepts their range strings); this is a sanity check, not an expected new bug.
- [ ] Re-run "bold the header row" and "header should be in bg red" end-to-end after the fix: final SSE event must be `actions`/preview-ready, not `question`; latency should drop to single-digit seconds (no more multi-step retry loop in the trace).

---

## Bug 1 — Sort reports "1 change applied" but the sheet is unchanged

**Severity: P0 — false success is worse than visible failure.**

### Repro

Request: "sort the data based on tax amount." Backend pipeline: planned → executed → verified → UI shows "Multi-agent pipeline: planned, executed, and verified. 1 Direct Change Applied." Actual Excel sheet: unsorted, no change.

### Diagnosis — check each of these, in order

1. **Is "applied" gated on an actual Office.js result?** Find where the frontend renders "Applied" and confirm it's driven by a resolved `context.sync()` call succeeding against the live workbook — not just by the backend SSE stream completing without an error event. If the UI marks something "Applied" purely because the backend said `success: true`, that's the bug: the backend can be right about generating a valid action and still have that action never actually execute client-side.
2. **Is the SORT action's range reference stale?** The trace's `selectedRange` was `'Purchase Register'!K13` (not A1), and `usedRange` was `A1:L51`. Confirm the generated `SheetAction` for SORT targets the correct absolute range (`A1:L51` or equivalent) and not something derived from the stale selection.
3. **Is there a preview/apply split being skipped?** If Tier 3 changes normally require an explicit "Accept" click to apply, but this response's copy ("Here are 1 change(s) I will apply to your sheet") reads like a *preview* label while the summary card says "Applied" — check for a mismatch between preview-state and applied-state copy. This alone could explain "says applied, sheet unchanged" without any Office.js bug at all — the change may still be sitting in preview, un-accepted.

### Fix requirement

- [ ] Confirm (via the diagnosis steps above) which failure mode this is, then fix at that specific layer — don't guess-fix all three simultaneously.
- [ ] Add an integration test: submit a SORT request, then read back the actual `Range.values` order via Office.js in the test and assert it matches the expected post-sort order — not just that the backend returned `success: true`. This is the class of test currently missing (backend-only assertions can't catch this bug).
- [ ] If it turns out to be the preview/apply-copy mismatch (point 3), fix the UI copy to never say "Applied" for anything still awaiting Accept.

---

## Bug 2 — SmartDataQuery column-slicer excludes the relevant amount column

**Severity: P1 — degrades a common query pattern but fails safely (says "can't find," doesn't silently produce wrong numbers).**

### Repro

Query: "find all suppliers with pending payments above 3000..." Log: `SmartDataQuery: sheet=Purchase Register cols=Date,Invoice No,Supplier,Payment Status rows=50` — `Total Amount` and `Tax Amount` columns excluded despite "payments above 3000" clearly requiring a monetary column.

### Diagnosis

The column-relevance heuristic is likely doing literal keyword matching against header names (e.g. looking for the word "payment" and matching `Payment Status` while missing that "payments above 3000" semantically requires a numeric amount column). It's probably not using `columnMeta[].detectedType` (already computed and available per the trace's own payload — every column has a `detectedType: number|text`) as a signal at all.

### Fix requirement

- [ ] When a query contains a numeric comparison (`above`, `over`, `below`, `at least`, `>`, `<`, a bare number near a currency symbol, etc.), the slicer must include all columns with `detectedType: number` as candidates, not just headers that lexically match query words.
- [ ] Add a specific rule: monetary-sounding query terms ("payment," "amount," "total," "cost," "price," "tax," "₹," "Rs.") should bias toward columns whose header also contains a monetary-sounding term AND `detectedType: number` — prefer `Total Amount`/`Tax Amount` over `Payment Status` when both partially match.
- [ ] Add the exact fixture from this trace as a regression test: query "pending payments above 3000" against this sheet's schema must select `Total Amount` (or `Tax Amount`) in the sliced columns.

---

## Bug 3 — Compound write request misrouted to read-only `data` route

**Severity: P1 — same request as Bug 2, but a routing-layer problem, not a retrieval problem. Confirmed by `01_complexity_classifier.md`'s compound-signal design — this trace is a real-world validation of that spec.**

### Repro

Same request as Bug 2. Log: `Router: route=data confidence=0.85 "Matched data query keywords — SmartDataQuery (MEDIUM tier)"`. The request contains three sequential actions ("find X, **then** highlight... **and** add a total") — a write-route compound request — but matched on the word "find" and got routed read-only.

### Fix requirement

- [ ] This is fixed by implementing `01_complexity_classifier.md`'s `COMPOUND_SIGNALS` check (`\band then\b|\bafter that\b|,\s*(then|and)\s|...`) **ahead of** the existing keyword-based data-route matching, not just ahead of the write-tier matching. Currently the router seems to check data-route keywords before ever considering compound structure — reorder so compound-signal detection runs first regardless of which route the keywords would otherwise suggest.
- [ ] Add this exact request as a fixture in `test/fixtures/catalog-classification.json` (per `08_migration_plan_and_tests.md`) with `expectedRoute: 'write'`, `expectedTier: 3` — it's a real production example of the highest-risk misclassification case (compound request wrongly downgraded).
- [ ] Do not fix this by special-casing this one phrase — fix it by ensuring `COMPOUND_SIGNALS` runs before route keyword-matching in general, per the existing spec design.

---

## Fix sequencing

```
1. Bug 4 (FORMAT_RANGE dropped by sanitizeAction) — fix first; root cause is
   confirmed (see above), so this is now a well-scoped two-file change, not
   an investigation. Fix normalize-executor-output.util.ts and
   executor.prompt.ts as specified, then re-test "bold the header row" and
   "header should be in bg red" end-to-end.
2. Bug 1 (false "applied" on SORT) — audit per the three diagnosis branches
   below, fix at the identified layer, add the Office.js-verified
   integration test.
3. Bug 2 (column slicer) — independent of 1/3/4, can be fixed in parallel.
4. Bug 3 (compound misrouting) — becomes the first real-world test case for
   01_complexity_classifier.md; implement compound-signal detection now rather
   than waiting for the full tiering rollout, since it's a correctness bug today,
   not just an optimization.
```

## Acceptance criteria for this phase

- [ ] All four bugs have a passing regression test using the exact repro inputs captured in this spec (not just synthetic new cases).
- [ ] Re-run all three original failing requests ("sort by tax amount," "find suppliers with pending payments above 3000...," "header should be in bg red") end-to-end after fixes and confirm: sort actually reorders the sheet, the compound request actually finds+highlights+totals, and the bg-red request succeeds in under ~10s with no retry-loop.
- [ ] No regression in the two requests that already worked correctly in these traces ("bold the header row" reaching a clean subtask plan, "sort" reaching a clean single-subtask plan) — the fixes should not change behavior for the parts that were already right.
- [ ] Bug 4's fix is verified against the confirmed root cause (split A1-string vs row/col contract), not against the original, now-disproven hypotheses (stale failure flag / first-vs-last-attempt / missing subtaskId) — those were investigated and ruled out, and should not be re-litigated in the fix PR.
