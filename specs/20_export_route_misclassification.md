# 20 — "Create Sheet + Copy Filtered Data" Misrouted to `export`, Which Then Searches for the Literal Request Text

**Severity: P1.** Two stacked bugs: a routing gap in `11_action_first_guarantee.md`'s write-intent guard (doesn't cover `export` misclassification, only `data`/`ask`), and a second, independent bug in the `export`/find handler itself (uses the raw user message as a literal search string instead of extracting the actual filter condition).

**Files touched:** `cellix_backend/src/excel-ai/utils/write-intent-guard.util.ts` (extend), `cellix_backend/src/excel-ai/services/llm-router.service.ts`, `cellix_backend/src/excel-ai/services/conversation.service.ts` (the "Find export" / find-query handler)

---

## Repro

Request: `create a new sheet named Paid payments and copy the paid data from purchase register to that new sheet only paid`

```
Router decision: route=export confidence=0.95 complexity=none
  reason="User requests creating a new sheet named 'Paid payments' and
  copying rows from 'Purchase Register' where Payment Status = 'paid',
  which is a find-and-copy operation (export)."
...
Tool request: get_range_data(Purchase Register, A1:L51)
Find query fetched 51 rows from Purchase Register!A1:L51
Find export (router) trace=- mode=action
```

**Result shown to user:** `No rows matching "create a new sheet named Paid payments" were found in the workbook.`

---

## Bug 1 — Router correctly parsed intent, then filed it under the wrong route entirely

The router's own `reason` field shows it understood the request perfectly: create a sheet, copy rows where `Payment Status = 'paid'`. But it classified this as `route=export` rather than `route=write`. "Create a new sheet" is an unambiguous structural mutation — this is exactly the kind of request `01_complexity_classifier.md`'s `WRITE_INTENT_VERBS` (`create`, `add`, `build`, etc.) and `11_action_first_guarantee.md`'s `hasWriteIntent()` guard exist to catch. But `hasWriteIntent()` as speced only overrides a misclassification into `data` or `ask` — it does not check for or override a misclassification into `export`. This request slipped through that gap.

### Fix
Extend `hasWriteIntent()`'s override logic to also catch `export`-route misclassifications:

```typescript
// llm-router.service.ts
if ((existingRoute.route === 'data' || existingRoute.route === 'ask' || existingRoute.route === 'export')
    && hasWriteIntent(message)) {
  this.logger.warn('write-intent-guard: overriding route', { original: existingRoute.route, message });
  return { ...existingRoute, route: 'write', complexity: existingRoute.complexity ?? 3, overridden: true };
}
```

Also worth auditing: what is `route=export` actually *for*? If it's meant for "generate a downloadable export/report" type requests rather than "create a sheet and copy data within the workbook," the router's system prompt may need a clearer distinction between "export data out of the workbook" vs. "copy/move data within the workbook" — the latter should never be `export`, it's `write` (specifically the `COPY_FILTERED_RANGE` action type from `12_native_range_operations.md`).

---

## Bug 2 — Independent of Bug 1: the `export`/find handler uses the raw message as a literal search query

Even setting aside the misrouting, look at what the `export` path actually did: it fetched the full range, then searched for rows matching the string **"create a new sheet named Paid payments"** — your entire instruction, verbatim — rather than extracting "Payment Status = paid" as the actual filter. This is a second, independent bug: whatever "Find query" component handles `route=export`/find-style requests is not doing intent extraction (pulling out the actual filter condition from the message) — it's using the raw message text as a literal search string. That would produce zero matches for almost any real request phrased as an instruction rather than a bare keyword search.

### Fix
The find/export handler needs the same intent-extraction step the `write` route already has via the Planner/Executor — either route genuine find/export requests through a lightweight version of that extraction, or (more likely, given Bug 1) this handler should rarely be reached at all once the write-intent guard correctly redirects requests like this one to `write`. Regardless, a find-style handler using the entire raw user message as a search string is a bug on its own and should be fixed independent of the routing fix, since some genuine `export`-route requests might hit the same issue.

---

## What this request should actually do once both bugs are fixed

Per `12_native_range_operations.md`, this is a textbook `COPY_FILTERED_RANGE` case:
```json
{
  "type": "COPY_FILTERED_RANGE",
  "sourceSheet": "Purchase Register",
  "sourceRange": "A1:L51",
  "hasHeaders": true,
  "destSheet": "Paid Payments",
  "destStartCell": "A1",
  "filter": { "column": "Payment Status", "operator": "equals", "value": "Paid" },
  "mode": "copy"
}
```
The user also asked for "same headers and styles" — confirm `COPY_FILTERED_RANGE`'s implementation copies cell formatting along with values (per spec 12's `copyFrom`-style approach), not just raw values, since that was part of the original request and easy to silently drop if the implementation only handles values.

---

## Acceptance criteria

- [ ] `hasWriteIntent()` override covers `export` misclassification, not just `data`/`ask` — covered by a unit test using this exact repro message.
- [ ] The find/export handler's query logic never uses the full raw user message as a literal search string — covered by a test asserting it either extracts a real filter condition or is unreachable for requests like this one post-routing-fix.
- [ ] Re-run the exact repro end-to-end: routes to `write`, produces a `COPY_FILTERED_RANGE` action, creates the "Paid Payments" sheet, and copies only `Payment Status = Paid` rows with headers and formatting intact.
- [ ] Add this exact request phrasing to the routing regression fixture set (`08_migration_plan_and_tests.md`'s catalog) as `expectedRoute: 'write'` — this is now the second real production example (after spec `10`'s Bug 3) of a compound write request being misrouted to a read-only-style path, and both should be permanent regression fixtures.
