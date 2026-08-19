# 17 — Verifier Truncation Cascades to Full-Chain Re-execution, Discarding Correct Work

**Severity: P1** (not data-destroying, but it took a dashboard request that was 10/12 subtasks genuinely correct, twice, and delivered the user nothing after 346 seconds). This directly validates and extends the partial-progress gap flagged in `12_native_range_operations.md` Fix 4 — that fix alone is not sufficient; selective retry is also required.

**Good news first:** this trace confirms `AGGREGATE_TABLE` and `CREATE_CHART` (from `13_benchmark_required_action_types.md`) are implemented and working correctly for grouped sums, top-N-style tables, and column/pie chart creation. The failures below are downstream of that success, not a regression in it.

**Files touched:** `verifier.agent.ts` (truncation handling), `agentic-loop.service.ts` (selective retry logic, executor-block handling), `executor.agent.ts` (remove silent fallback-to-wrong-action), `sheet-actions.types.ts` / `rich-action-engine.service.ts` (`AGGREGATE_TABLE` derived-grouping support)

---

## Bug A — Verifier response truncation cascades into marking all-correct work as failed

### Repro
Second verifier call in the trace: raw response correctly lists `s1` through `s8` as `passed: true` with real feedback, then the JSON string is **cut off mid-value** (`"feedback"` with no closing content, malformed JSON). The parser's fallback response for this malformed output is:

```json
{"passed": false, "feedback": "", "subtaskResults": [
  {"subtaskId":"s1","passed":false,"feedback":"","issues":[]},
  {"subtaskId":"s2","passed":false,"feedback":"","issues":[]},
  ... all 12 subtasks marked passed:false ...
]}
```

Every subtask that had just been confirmed correct (twice, in the first verifier call) is now marked failed, purely because the response got truncated on `s9`/`s10`'s section — the two genuinely broken ones.

### Root cause
Same class of failure as `16_planner_token_exhaustion.md` — the Verifier is a reasoning model (`gpt-5-mini`) producing a long, per-subtask JSON response for a 12-subtask chain, and it ran out of completion tokens partway through. Unlike the Planner bug, this one has a worse blast radius: a partial/truncated verifier response is being parsed by a fallback that defaults every entry to `failed` rather than either (a) preserving the entries that *did* parse successfully before the cutoff, or (b) treating a truncated response as "inconclusive, retry the verification call" rather than "everything failed."

### Fix
1. **Same token-budget fix as spec `16`** applies here: the Verifier needs a token ceiling with headroom scaled to the number of subtasks being verified (a 12-subtask verification response needs meaningfully more budget than a 1-subtask one).
2. **Parse partial JSON correctly, don't blanket-fail on truncation.** If the raw response contains N complete, parseable `subtaskResults` entries followed by a truncated one, use the N complete entries as real results and only mark the truncated tail as inconclusive/needing re-verification — not the earlier, successfully-parsed entries.
3. **If genuinely unparseable, retry the verification call alone** (not the whole subtask chain) with a higher token budget before falling back to "everything failed."

---

## Bug B — Retry re-executes the entire subtask chain, not just the subtasks the verifier flagged

### Repro
After the (correct, first-pass) verifier flagged only `s9` and `s10` as failed, the very next agentic-loop action is: `"Agentic loop: starting subtask 'Set label 'Total Purchases' in A1 on Dashboard'"` — **subtask s1, from the beginning.** All 12 subtasks get re-executed, including the 10 that had already passed verification correctly.

### Root cause
The agentic loop has no concept of "retry only the failed subtasks." A verifier failure on any subset restarts the entire chain from subtask 1. Combined with Bug A (which, on the second pass, falsely failed all 12), this produces a full second execution of an already-correct 10-subtask dashboard — burning ~150+ seconds and a full second round of LLM calls for work that was already done right.

### Fix
```typescript
// agentic-loop.service.ts
// Required: on verifier failure, retry ONLY the subtask IDs present in
// verifierResult.issues (or subtaskResults where passed === false).
// Subtasks that passed must not be re-executed, re-verified, or have
// their already-applied actions touched.

async retryFailedSubtasksOnly(
  verifierResult: VerifierResult,
  allSubtaskResults: Map<string, SubtaskResult>,
): Promise<void> {
  const failedIds = verifierResult.subtaskResults
    .filter(r => !r.passed)
    .map(r => r.subtaskId);
  // Only these get re-queued into the agentic loop. Everything else's
  // actions remain as already applied/verified.
}
```

This is a distinct requirement from `12_native_range_operations.md` Fix 4 (partial progress survives a *total chain failure/timeout*) — this is partial progress surviving a *partial verification failure mid-chain*, which is actually the more common case and matters even when the chain doesn't time out at all.

---

## Bug C — Executor silently substitutes an unrelated action when genuinely blocked, instead of surfacing the block

### Repro
For subtask s9's retry, the Executor's own `nextStep` field correctly and honestly explains the block:

> `"Blocked: AGGREGATE_TABLE cannot group by MONTH(Date) without a helper column, and on-demand fetch is disabled... Add a 'Month' column... or enable data fetch."`

But the very next log line is: `"Executor sort fallback for column \"=SUM('Purchase Register'!J2:J51)\""`, and the actual action produced is a `SORT_RANGE` on `Dashboard!A1:B54` — **completely unrelated to the request**, sorting the KPI summary cells by a formula string as if it were a column name. This gets marked `isDone: true` despite the model's own stated block.

### Root cause
Somewhere in the Executor's retry/fallback path, when a subtask can't produce its intended action, there's a generic "produce *something*" fallback (apparently defaulting to a sort-style action) that overrides the model's own honest "I'm blocked" signal. This is the same pattern as earlier bugs in this project — a legitimate stuck-state getting silently papered over with a plausible-looking-but-wrong action rather than surfaced.

### Fix
When the Executor's own output indicates `isDone: false` with a `nextStep` explaining a genuine block (missing capability, missing data, disabled feature), that must propagate as a real, surfaced blocker — never silently replaced by an unrelated fallback action. If a "produce something rather than nothing" fallback exists for other legitimate reasons, it must not apply when the model has explicitly stated it's blocked.

---

## Bug D — `AGGREGATE_TABLE` doesn't support grouping by a derived/computed key (e.g., month from a date)

### Repro
The one genuinely unsupported request in this chain: grouping by `MONTH(Date)` rather than by `Date`'s literal value. This is a legitimate feature gap in `AGGREGATE_TABLE` as specified in `13_benchmark_required_action_types.md` — it only groups by an existing column's raw values.

### Fix — extend `AGGREGATE_TABLE`'s contract
```typescript
export interface AggregateTableAction {
  // ...existing fields...
  groupByColumn: string;
  groupByTransform?: 'none' | 'month' | 'year' | 'monthYear' | 'weekday' | 'quarter';
  // When set, the destination sheet groups by the transformed value
  // (e.g., extract month-of-year from a date column) computed in code
  // during execution — NOT by asking the LLM to compute or emit a helper
  // column formula itself. Same "Office.js computes, LLM only specifies
  // parameters" principle as the rest of this action type.
}
```

This closes the gap without requiring a helper column or on-demand data fetch — the transform happens during the same Office.js-side aggregation pass that already reads the source range directly.

---

## Acceptance criteria

- [ ] Verifier token budget increased with headroom scaled to subtask count (same principle as spec `16` Fix 1).
- [ ] A truncated/partially-malformed verifier response preserves successfully-parsed `subtaskResults` entries rather than defaulting all entries to failed — covered by a test using this exact truncated-response fixture.
- [ ] Retry after verifier failure re-executes only the specific failed subtask IDs — covered by a test asserting `s1`-`s8`, `s11`, `s12`'s actions are never re-emitted or re-verified when only `s9`/`s10` failed.
- [ ] Executor's own `isDone: false` + `nextStep` block signal is never silently overridden by a fallback action — covered by a test using this exact "blocked, produces SORT_RANGE anyway" fixture, asserting the block is surfaced instead.
- [ ] `AGGREGATE_TABLE` supports `groupByTransform: 'month'` (at minimum; other transforms can follow), computed via Office.js during aggregation, not via LLM-generated helper-column formulas.
- [ ] Re-run the exact repro request ("In dashboard create a chart, and analysis for purchase register a summary for purchase register") end-to-end: total latency should drop from 346s to roughly one pass's worth of time (the 10 correct subtasks should never re-execute), and the month-grouped chart should actually be producible instead of blocked.
