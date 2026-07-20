# 13 — Action Types & Verification Needed for Full Benchmark Coverage

**Phase:** 0/1 (build before running the Tier 3-4 benchmark prompts — several will fail or silently degrade without this)
**Source:** gap analysis against `cellix-benchmark-test-prompts.md`'s 20 prompts.
**Files touched:** `sheet-actions.types.ts`, `rich-action-engine.service.ts`, `planner.prompt.ts`, `executor.prompt.ts`, `verifier.agent.ts` / `verifier.prompt.ts`, `conversation.service.ts` (clarification gating)

---

## Gap map — what each benchmark tier actually requires

| Prompts | Requires | Currently have? |
|---|---|---|
| Tier 1 (#1-4) | `SORT_RANGE`, `FORMAT_RANGE`, `SET_FORMULA` | Yes (with `10`/`11` fixes applied) |
| Tier 2 (#5-9) | Aggregation formulas (SUMIF/COUNTIF/AVERAGEIF), conditional flagging | Mostly yes via `SET_FORMULA`, but **no semantic correctness check** (see Fix 3) |
| Tier 3 (#10-14) | `COPY_FILTERED_RANGE`/`MOVE_RANGE` (spec `12`), multi-sheet writes | **No** — blocked on `12` shipping |
| Tier 4 #15-17 | Same as Tier 2/3 plus more complex conditional logic — no new action types, just harder formulas | Yes, pending `12` and Fix 3 below |
| Tier 4 #18-19 (dashboard) | `CREATE_CHART` for real (multiple types, multi-series), a way to lay out a "dashboard sheet," chart *editing* on follow-up | **Partial/unconfirmed** — see Fix 1 |
| Tier 4 #20 (ambiguous) | Clarification gating that actually blocks execution | **No** — confidence/clarificationsNeeded exist as fields but don't gate anything (flagged in earlier Planner-response conversation) |

---

## Fix 1 — Chart & dashboard action types

### Current state (needs confirmation before building)
Earlier investigation found `CREATE_CHART` already exists in `sanitizeAction`'s pass-through group, validating `sheetName`, `sourceRange`, `sourceSheetName`, `chartType`. **Before building anything new, confirm via a minimal test** (e.g. "add a bar chart of Total Amount by Supplier") whether this path actually produces a working chart end-to-end, or whether it has the same "documented but never exercised" gap as `FORMAT_RANGE` did.

### New/extended action types needed

```typescript
export interface CreateChartAction {
  type: 'CREATE_CHART';
  sheetName: string;
  sourceRange: string;        // e.g. "A1:B6" for a 2-column chart source
  sourceSheetName: string;
  chartType: 'bar' | 'column' | 'pie' | 'line' | 'barHorizontal';
  title?: string;
  destCell?: string;          // where to anchor the chart, default below/right of source
  colorScheme?: 'default' | 'blue' | 'grey' | 'blueGrey'; // needed for #19's follow-up
}

export interface UpdateChartAction {
  type: 'UPDATE_CHART';
  sheetName: string;
  chartId: string;            // must be tracked/returned when a chart is created — see below
  chartType?: CreateChartAction['chartType'];
  colorScheme?: CreateChartAction['colorScheme'];
}

export interface AggregateTableAction {
  type: 'AGGREGATE_TABLE';
  sourceSheet: string;
  sourceRange: string;
  groupByColumn: string;       // e.g. "Supplier"
  aggregations: Array<{
    column: string;            // e.g. "Total Amount"
    fn: 'sum' | 'count' | 'average' | 'max' | 'min';
    outputLabel: string;       // e.g. "Total Spend"
  }>;
  sortBy?: { column: string; direction: 'asc' | 'desc' };
  topN?: number;                // e.g. 5, for "top 5 suppliers"
  destSheet: string;
  destStartCell: string;
}
```

**`AGGREGATE_TABLE` matters as much as the chart types** — "top 5 suppliers by spend" (prompt #10, #18) is a group-by-aggregate-sort-limit operation. Doing this via chained `SET_FORMULA` (SUMIF + manual ranking) is fragile and exactly the kind of multi-step chain that timed out in the Pending Payments trace. Execute it the same way as `COPY_FILTERED_RANGE` in spec `12` — Office.js reads the real range, aggregates in code, writes the result table directly.

### Chart identity tracking (needed for #19's follow-up edit)
When a chart is created, its Office.js-assigned chart name/ID must be captured and stored (likely in the `ChangeSet`/audit record for that action, per `07_citation_provenance_layer.md`'s model) so a follow-up like *"make it horizontal instead"* can resolve `chartId` from conversation context rather than the model having to re-identify "which chart" from a description. Without this, follow-up chart edits will be as unreliable as the original FORMAT_RANGE bug — an ambiguous reference the Executor can't resolve deterministically.

### "Dashboard sheet" is not a new primitive — it's an orchestration pattern
A "build me a dashboard" request (#18) should decompose (per the Planner) into: create a new sheet → one or more `AGGREGATE_TABLE` actions → one or more `CREATE_CHART` actions referencing those aggregate tables, all targeting the new sheet with a sensible layout (e.g. summary numbers top-left, charts arranged below/right). Add a Planner prompt rule for this decomposition pattern explicitly, using the same "recognize the pattern as a bounded set of native actions, not an open-ended chain" principle as spec `12`.

---

## Fix 2 — Layout rule for multi-element dashboard sheets

Without an explicit rule, charts and tables will get placed at overlapping or default coordinates. Add a simple deterministic layout policy to whichever service assembles multi-action dashboard responses:

```
Row 1-2:   Summary KPI cells (total purchases, total tax, etc.) — plain SET_CELL/SET_FORMULA
Row 4+:    Aggregate tables (e.g. top-5-suppliers table), one per section, stacked vertically
           with 2 blank rows between each
Charts:    Anchored to the right of their source aggregate table, not overlapping
```

This doesn't need to be sophisticated — it needs to be *consistent*, so repeated dashboard requests don't produce visually broken output. Treat this as a fixed constant/config, not something the LLM decides per-request.

---

## Fix 3 — Verifier semantic correctness check (closes the Tier 2 #7/#8 gap)

**Current gap:** `VerifierAgent` (per earlier architecture) checks that generated formulas are syntactically valid and non-hardcoded, but there's no confirmation it checks whether the *computed result* is actually correct against expected domain logic (e.g., "is Tax Amount actually 18% of Qty×Unit Price").

### Add a deterministic semantic check, run before the LLM verifier (same "cheap check first" pattern as the hardcode-literal check in `03_tier2_generate_verify.md`):

```typescript
// verifier — new deterministic pass for formula-generation subtasks
interface SemanticCheckResult {
  passed: boolean;
  discrepancies: Array<{ row: number; expected: number; actual: number; tolerance: number }>;
}

function checkFormulaAgainstExpectedValues(
  action: SetFormulaAction,
  sourceData: SheetRow[],
  expectedComputation: (row: SheetRow) => number, // derived from the request's stated logic
): SemanticCheckResult {
  // For requests with an explicit, checkable rule ("Tax Amount = 18% of Qty×Unit Price",
  // "flag if unit price >25% off average"), compute the expected value directly in
  // code and compare against what the formula would produce — don't just check that
  // the formula parses.
}
```

This is specifically what prompts #7 and #8 are testing — a formula that's syntactically perfect but checks the wrong column, or uses the wrong tax rate, will pass a syntax-only verifier and fail this check. **This is the single highest-trust-impact fix in this spec for a CA-facing product** — a wrong GST calculation that "looks verified" is worse than an obvious failure.

Where an explicit expected-value check isn't derivable from the request (open-ended asks like "rank suppliers"), fall back to existing LLM verification — this deterministic layer is additive, not a replacement.

---

## Fix 4 — Clarification gating that actually blocks execution (closes the Tier 4 #20 gap)

Per the earlier Planner-response conversation: `confidence` and `clarificationsNeeded` currently exist as fields on the Planner's output but nothing confirmed they *gate* anything — a low-confidence or clarification-flagged plan can still proceed straight to execution.

### Required behavior

```typescript
// conversation.service.ts — after Planner output, before Executor dispatch
if (plannerResult.clarificationsNeeded?.length > 0 || plannerResult.confidence === 'low') {
  // MUST stop here. Emit a `question` SSE event surfacing the actual
  // clarification(s), not a generic fallback string. Do NOT proceed to
  // ExecutorAgent for any subtask.
  return this.emitClarificationRequest(plannerResult.clarificationsNeeded, conversationId);
}
```

For an intentionally vague request like #20 ("clean up this data"), the correct behavior is the Planner setting `clarificationsNeeded: ["What does 'clean up' mean here — remove duplicates, fix formatting inconsistencies, standardize date formats, something else?"]` and the system **stopping there**, not guessing an interpretation and executing it. This directly reuses the `ask` vs `plan` vs `act` mode distinction from `05_mode_selector_ask_plan_act.md` — a low-confidence write-intent request should behave like it's in `plan`/`ask` mode by default until the user resolves the ambiguity, regardless of which mode they nominally selected.

---

## Acceptance criteria

- [ ] Confirmed (via direct test) whether existing `CREATE_CHART` works end-to-end before building `UPDATE_CHART`/`AGGREGATE_TABLE` on top of it — don't build on an unverified foundation.
- [ ] `AGGREGATE_TABLE` executes via Office.js range read + code-side aggregation, same pattern as `COPY_FILTERED_RANGE` in spec `12` — no per-row `SET_CELL` chains, no LLM re-transcription of data.
- [ ] Chart identity (`chartId`) is captured on creation and resolvable in follow-up turns for edits (prompt #19's "make it horizontal" test).
- [ ] Dashboard-pattern requests (#18) decompose into a bounded, deterministic set of subtasks (create sheet → aggregate → chart), never an open-ended chain.
- [ ] Semantic correctness check catches at least the two concrete cases in prompts #7 and #8 (wrong tax %, mismatched formula logic) — covered by fixture tests using deliberately-wrong formulas as input.
- [ ] A `clarificationsNeeded`-flagged or low-confidence Planner result never reaches `ExecutorAgent` — covered by a test asserting zero Executor calls when clarification is required.
- [ ] Re-run benchmark prompts #7, #8, #18, #19, #20 after these fixes and confirm each behaves as intended before running the full comparison against Shortcut.
