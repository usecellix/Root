# 23 — Ask/Explain Route: Missing Aggregation + Internal-Vocabulary Leak (extends 15 to the `ask` route)

**Phase:** 2 (UX + capability gap, can run alongside `15_user_facing_response_structure.md`'s work — this is the `ask`-route counterpart to that spec's `write`-route fixes)
**Files touched:** `cellix_backend/src/excel-ai/services/ask-handler.service.ts` (or wherever `route=ask`/"explain" requests are handled), its system prompt, frontend response rendering for `ask`-route answers

---

## The gap, concretely

For `Tell me about this sheet`, compare what shipped against what a CA actually needs:

| | Shortcut | Cellix |
|---|---|---|
| Row/column count | ✅ | ✅ |
| Date range | ✅ | ❌ (not mentioned) |
| Total quantity | ✅ (275 units) | ❌ |
| Pre-tax / GST / grand total | ✅ (78,600 / 14,148 / 92,748) | ❌ |
| Paid vs Pending breakdown, with amounts | ✅ (33 @ 60,406.56 / 17 @ 32,341.44) | ❌ |
| Largest supplier, with total | ✅ (Global Distributors, 25,783) | ❌ |
| Data quality notes (e.g. Date stored as text) | — | ✅ (this part is genuinely good) |
| Format | Structured headers + bullets | One dense paragraph |
| Internal vocabulary visible | None | `"Intent: EXPLAIN"`, `"detectedType: number but currently empty"`, raw column type dump |

**The formatting problem is the smaller issue.** The bigger one: Cellix's `ask` route is not doing real aggregation over the data at all — it's only reporting structural metadata (headers, types, row count). This is a capability gap, not just a presentation gap: `AGGREGATE_TABLE`-style computation (sums, counts, group-bys, max/rank) already exists for the `write` route (per `13_benchmark_required_action_types.md`) but the `ask` route apparently never invokes anything equivalent for a broad, open-ended request like "tell me about this sheet."

---

## Fix 1 — `ask` route must run real aggregation for broad/summary requests, not just structural analysis

For open-ended requests ("tell me about this sheet," "summarize this data," "give me an overview"), the `ask` handler should compute, at minimum:
- Row/column count, date range (if a date column is detected)
- Sum/count for the most obviously relevant numeric columns (heuristically: columns with "amount," "total," "price," "qty," "tax" in the header — same detection logic already needed for `01_complexity_classifier.md`'s numeric/financial escalation)
- Group-by breakdown for the most obviously relevant categorical column (heuristically: a column with a small number of distinct values relative to row count — e.g. `Payment Status`'s 2 values across 50 rows is a strong "this is worth breaking down" signal)
- Top-N ranking for high-cardinality categorical columns tied to a numeric column (e.g. Supplier × Total Amount)

This should reuse the same deterministic, Office.js-side aggregation logic as `AGGREGATE_TABLE` (spec 13) — computed in code against the real range, not estimated by the LLM from a sampled context. The LLM's job is to decide *which* aggregations are worth surfacing for a given sheet shape and narrate the result, not to compute the numbers itself.

```typescript
// ask-handler.service.ts — new step for broad/summary-style ask requests
async function buildSheetOverview(sheetContext: WorkbookContext): Promise<SheetOverview> {
  const numericColumns = detectNumericColumns(sheetContext); // header + dtype heuristic
  const categoricalColumns = detectLowCardinalityColumns(sheetContext); // e.g. Payment Status

  return {
    rowCount: sheetContext.rowCount,
    dateRange: detectDateRange(sheetContext), // if a date-typed column exists
    numericSummaries: numericColumns.map(col => ({ column: col.name, sum: computeSum(col), count: sheetContext.rowCount })),
    categoricalBreakdowns: categoricalColumns.map(col => ({
      column: col.name,
      breakdown: computeGroupByCount(col, /* optionally paired numeric column */),
    })),
    topRanking: computeTopN(sheetContext, /* highest-cardinality categorical × best-matching numeric */, 1),
    dataQualityNotes: detectDataQualityIssues(sheetContext), // date-stored-as-text, unexpected type mismatches, etc. — Cellix already does this part well, keep it
  };
}
```

---

## Fix 2 — Structured response format, no internal vocabulary (same principle as spec 15, applied to `ask`)

```markdown
**Purchase Register overview**
- 50 records, [date range]
- Columns: Date, Invoice No, Supplier, GSTIN, Item, Qty, Unit Price, Tax %, Tax Amount, Total Amount, Payment Status, Remarks
- Total quantity: [X] units · Pre-tax: [X] · GST: [X] · Total: [X]

**Payment status**
- Paid: [N] invoices, [amount]
- Pending: [N] invoices, [amount]

**Largest supplier:** [name], [amount]

**Data quality notes**
- [Date is stored as text — may break sorting/filtering]
- [Remarks column detected type doesn't match its empty content — worth verifying]
```

**Never render, in the default view:** `"Intent: EXPLAIN"`, raw `detectedType` field names, or a flat `A: ... B: ... C: ...` column-letter dump — same rule as `15_user_facing_response_structure.md`'s default/expandable-detail split. Column names alone (no letters, no raw type strings) are what a CA needs; letters and detected-type internals belong in an expandable "Show details" section if shown at all.

**Data-quality observations should stay** (Cellix's "Date stored as text," "Remarks type mismatch" notes are genuinely more useful than anything Shortcut surfaced) — just rewrite them in plain language without the raw field name (`detectedType: number but currently empty` → `"Remarks column appears to expect numbers but is currently empty — worth double-checking this is intentional"`).

**Drop or soften the mode-switch pitch.** `"switch to Action mode and tell me which one"` reads as a product nudge stapled onto an answer, not part of the answer itself. If suggesting a follow-up action is valuable, phrase it as a natural offer — *"Want me to add a totals row or a Payment Status breakdown to the sheet?"* — not a mode-switching instruction.

---

## Acceptance criteria

- [ ] "Tell me about this sheet" (and equivalent broad/summary phrasings) produces real computed aggregates — row/date range, numeric sums for relevant columns, categorical breakdown for low-cardinality columns, top-N ranking for high-cardinality categorical × numeric pairs — not just structural metadata.
- [ ] Aggregation is computed via Office.js-side code against the real range, not estimated/hallucinated by the LLM from a sampled context — covered by a test comparing computed totals against the actual sheet's true sums.
- [ ] Default response view contains zero occurrences of `Intent:`, `detectedType`, or raw column-letter-plus-type dumps — covered by a snapshot test, same pattern as `15`'s acceptance criteria.
- [ ] Response renders as structured markdown (headers + bullets), not a single dense paragraph.
- [ ] Data-quality observations (date-as-text, type mismatches) are preserved and rewritten in plain language, not dropped — this is a genuine strength to keep, not remove.
- [ ] No mode-switching product pitch embedded in the answer text — any follow-up suggestion reads as a natural offer, not an instruction to change UI modes.
