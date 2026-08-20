# 18 — Tier 2 Retry, Context Resolution, Field Preservation, and Tool-Informed Follow-Up

**Severity: P1.** Not a data-safety issue like Bug 6 — the verifier did its job and blocked a bad chart. The gap is that a **correctable** mistake (wrong source range) becomes a full dead end for the user instead of a one-shot self-correction, which is exactly the kind of friction that makes an AI tool feel unreliable even when it's technically "working as designed."

**Status:** Bugs 1–3 confirmed fixed in live traces. **Bug 4** implemented (unit-covered); live add-in re-run of the green-bar repro still to confirm.

**Files touched:** `cellix_backend/src/excel-ai/services/tier2-generate-verify.service.ts`, `cellix_backend/src/excel-ai/services/conversation.service.ts`, `cellix_backend/src/agents/utils/normalize-executor-output.util.ts`, `cellix_backend/src/excel-ai/utils/turn-action-history.util.ts`

---

## Repro (original — Bugs 1 & 2)

Turn 1: user creates a chart successfully.
Turn 2: `Also create a bar chart along with the current`

```
Executor produces: CREATE_CHART, sourceRange: "A4:B54", chartType: BarClustered
Verifier: passed=false — "sourceRange 'A4:B54' begins at row 4..."
→ Without Bug 1: dead end. With Bug 1: one retry with verifier feedback.
```

---

## Bug 1 — Tier 2 has no retry-with-feedback loop on verification failure ✅ FIXED

Add exactly one retry attempt to `Tier2GenerateVerifyService`, feeding the Verifier's `issues`/`suggestion` back into a second Executor call before giving up. Cap at one logical retry (see Bug 4 for the tool-informed follow-up within that correction process).

---

## Bug 2 — Follow-up requests referencing "the current" data have no reliable range-context resolution ✅ FIXED

When a `CREATE_CHART` / `AGGREGATE_TABLE` / `UPDATE_CHART` succeeds, store structured `TurnActionRecord`s on the assistant message and inject `priorTurnActionsSummary` into the next Executor context.

---

## Bug 3 — `UPDATE_CHART`'s `colorScheme` field is silently dropped during normalize/parse ✅ FIXED

`normalizeChartColorScheme` preserves `green` (and related schemes); general field-preservation regression covers every action type in `sheet-actions.types.ts`.

---

## Bug 4 (confirmed live) — the single retry gets consumed by a `toolRequest`, leaving no attempt to actually apply the fix

**This trace is good news overall** — it confirms Bug 1 (retry-with-feedback), Bug 3 (colorScheme field-drop), the `11_action_first_guarantee.md` write-route error guarantee, and `12`'s `get_range_data` tool bridge are all now working correctly and chained together. The remaining gap is narrow.

### Repro
Request: `Create a bar graph too using color green`

1. First attempt: `CREATE_CHART` with `sourceRange: "A4:B54"` (wrong) + `UPDATE_CHART` with `colorScheme: "green"` (correct, field preserved).
2. Verifier fails on the range, provides a concrete suggestion.
3. Retry fires (Bug 1) — but the Executor's retry response is `{ actions: [], isDone: false, toolRequest: { name: "get_range_data", range: "A1:B60" } }`. It correctly asked for real data via the tool bridge.
4. The tool call may succeed — but **there was no subsequent Executor attempt that uses that data to emit the corrected `CREATE_CHART`.** The single retry was consumed by the tool-call round-trip, not by producing a fix.
5. Verifier fails again ("no actions"), and `WriteRouteNoActionError` fires per `11` — honest failure, but still a dead end for a correctable mistake.

### Fix
When `Tier2GenerateVerifyService`'s single retry returns a `toolRequest` instead of a direct action:

1. Resolve the tool call (`get_range_data` via `ToolBridgeService`).
2. Merge the fetched values into workbook context.
3. Make **ONE** additional Executor call with that data before considering the retry exhausted.

This must **not** become an open-ended loop. Cap total **correction-related** Executor calls at **2** (retry + one tool-informed follow-up), consistent with Tier 2's speed budget from spec `03`. A `toolRequest` is a data-gathering step *within* the correction process, not a second verifier-feedback retry.

```typescript
// After verifier-feedback retryStep(...):
if (executorResult.toolRequest && actions empty && conversationId + toolEmit available) {
  const fetched = await toolBridge.waitForRangeData(...);
  context = mergeFetchedRange(context, toolRequest, fetched.values);
  executorResult = await executorAgent.execute(subtask, context, [], correlationId);
  // then deterministic gates + verify — no further tool loops
}
```

### Acceptance criteria (Bug 4)
- [x] When a Tier 2 retry's Executor response is a `toolRequest` rather than a direct action, the system makes one further Executor call using the resolved tool data before exhausting the retry — covered by this exact repro (green bar chart, wrong range needing `get_range_data`) in `test/tier2-generate-verify.service.spec.ts`.
- [x] Total Tier 2 correction process remains tightly bounded — **2** correction-related Executor calls max (retry + one tool-informed follow-up); second toolRequest after follow-up does not loop.
- [ ] Re-run `Create a bar graph too using color green` end-to-end in the add-in: correct range via `get_range_data`, green color applied, single user-facing turn, no `WriteRouteNoActionError`.

---

## Acceptance criteria (Bugs 1–3 — confirmed)

- [x] `Tier2GenerateVerifyService` retries exactly once on verifier failure with verifier feedback.
- [x] After the single retry, if still failing, the user-facing failure message includes the Verifier's actual suggestion.
- [x] Successful `CREATE_CHART`/`AGGREGATE_TABLE` actions are recorded in structured turn history.
- [x] Follow-up "along with the current" can resolve range from structured records.
- [x] No change to Tier 2's fundamental design (Planner-skipping, mandatory verification) beyond bounded correction.
- [x] `UPDATE_CHART`'s `colorScheme` survives normalize; general per-action-type field-preservation test covers all action types.
