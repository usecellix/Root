# 12 — Native Range Operations (Copy/Move/Filter Across Sheets) + Partial Progress Delivery

**Phase:** 0 (P0 — this is a missing capability, not a bug patch; it removes an entire failure class rather than fixing one symptom)
**Files touched:**
- `cellix_backend/src/excel-ai/types/sheet-actions.types.ts` (new action types)
- `cellix_backend/src/excel-ai/services/rich-action-engine.service.ts` (or wherever Office.js execution lives — new handlers)
- `cellix_backend/src/agents/planner.agent.ts` / `planner.prompt.ts` (decomposition rule)
- `cellix_backend/src/agents/executor.agent.ts` / `executor.prompt.ts` (stop treating data-movement as a text-generation task)
- `cellix_backend/src/excel-ai/services/agentic-loop.service.ts` (partial-progress delivery on subtask failure)

---

## The actual root cause (confirmed from trace)

Request: "create a new sheet called pending payments and then move the pending data to there create a copy." Result after **330 seconds**: total failure, nothing shown, not even the one subtask (sheet creation) that succeeded.

The system has **no action type that represents "copy/filter rows from sheet A to sheet B."** Its only primitives are `SET_CELL` (one cell) and `SET_FORMULA` (one formula). So when the Planner decomposed this into subtasks, the Executor was asked to do something it structurally cannot express:

- **Subtask 2** ("copy header + pending rows"): instead of moving data, it wrote a header row to **row 52 of the wrong sheet** (`Purchase Register`, the source) and dropped a `=FILTER(...)` formula next to it. It never touched the destination sheet.
- **Subtask 3** ("paste into Pending Payments"): spent ~10 iterations asking, in slightly reworded ways, for someone to hand it the actual data values as text — even after two successful `get_range_data` tool calls returned data (`201` responses logged). It could not translate "I have a filtered range" into "write that range to another sheet" without literally re-typing every value as a `SET_CELL` action, which it also couldn't do at this row count.
- Hit `max iterations (10)`, then the whole 3-subtask chain timed out at 330s, and because verification never completed, **all progress was discarded** — including the sheet-creation step that worked.

This is the same underlying problem behind Bug 2 (column slicer) and the SORT/FORMAT_RANGE bugs in `10`/`11`: **anywhere the system needs to move or transform actual spreadsheet data, it's routing that data through the LLM as generated text instead of through a direct Office.js call.** That doesn't scale past a handful of cells and will keep failing in new shapes until there's a native primitive for it.

---

## Fix 1 — New native action types (primary fix)

Add action types that Office.js executes directly — the LLM specifies *what* to copy/move/filter and *where*, never the actual cell values.

```typescript
// sheet-actions.types.ts — add to SheetActionPayload's type union

export interface CopyFilteredRangeAction {
  type: 'COPY_FILTERED_RANGE';
  sourceSheet: string;
  sourceRange: string;           // A1 notation, e.g. "A1:L51" (include header row)
  hasHeaders: boolean;
  destSheet: string;
  destStartCell: string;         // e.g. "A1"
  filter?: {
    column: string;              // header name, e.g. "Payment Status"
    operator: 'equals' | 'contains' | 'greaterThan' | 'lessThan' | 'notEquals';
    value: string | number;
  };
  mode: 'copy' | 'move';         // move = also clear matched rows from source after copy
}

export interface MoveRangeAction {
  type: 'MOVE_RANGE';
  sourceSheet: string;
  sourceRange: string;
  destSheet: string;
  destStartCell: string;
}
```

### Execution (Office.js, no LLM involvement in the data itself)

```typescript
// rich-action-engine.service.ts — new handler
async function executeCopyFilteredRange(action: CopyFilteredRangeAction, context: Excel.RequestContext) {
  const sourceSheet = context.workbook.worksheets.getItem(action.sourceSheet);
  const sourceRange = sourceSheet.getRange(action.sourceRange);
  sourceRange.load('values');
  await context.sync();

  const rows = sourceRange.values;
  const headerRow = action.hasHeaders ? rows[0] : null;
  const dataRows = action.hasHeaders ? rows.slice(1) : rows;

  let filteredRows = dataRows;
  if (action.filter) {
    const colIndex = headerRow.indexOf(action.filter.column);
    if (colIndex === -1) throw new ActionValidationError(`Column "${action.filter.column}" not found in source range`);
    filteredRows = dataRows.filter(row => applyFilterOperator(row[colIndex], action.filter));
  }

  const destSheet = getOrCreateSheet(context, action.destSheet);
  const outputRows = headerRow ? [headerRow, ...filteredRows] : filteredRows;
  const destRange = destSheet.getRangeByIndexes(/* derived from destStartCell */, outputRows.length, outputRows[0].length);
  destRange.values = outputRows;
  await context.sync();

  if (action.mode === 'move' && action.filter) {
    // Clear matched rows from source — implement as a second pass, deleting
    // rows bottom-to-top so row indices don't shift mid-deletion.
  }

  return { rowsCopied: filteredRows.length };
}
```

**This is the entire fix for the data-movement problem.** Office.js reads the real range directly (not a sampled/compressed context), filters it in code, writes it to the destination in one `context.sync()`. The LLM never sees, re-types, or reasons about individual cell values — it only specifies the operation parameters.

---

## Fix 2 — Planner must recognize this as ONE action, not a multi-subtask chain with a data handoff

The Planner currently decomposed "create sheet, then move filtered data there" into 3 subtasks where subtask 3 depends on subtask 2 *handing it data* — but subtasks can't hand each other literal data through the planning layer, only through the Executor re-deriving it from scratch each time (which is what caused the 10-iteration loop).

**Add a decomposition rule to `planner.prompt.ts`:**

> When a request involves copying, moving, or filtering rows/data from one location (sheet or range) to another — including "move X to a new sheet," "copy rows where Y to Z," "extract matching rows into a new tab" — this must be planned as a **single subtask** using the `COPY_FILTERED_RANGE` or `MOVE_RANGE` action type, never decomposed into separate "read," "filter," and "paste" subtasks. Sheet creation (if the destination doesn't exist) may be a preceding subtask, but the data movement itself is always one subtask with one resulting action.

```json
// Correct decomposition for this request:
{
  "subtasks": [
    {
      "id": "s1",
      "description": "Create sheet 'Pending Payments' if it doesn't exist",
      "targetSheet": "Pending Payments",
      "dependsOn": [],
      "estimatedActions": 1
    },
    {
      "id": "s2",
      "description": "Copy header + rows where Payment Status = Pending from 'Purchase Register' to 'Pending Payments' starting at A1",
      "targetSheet": "Pending Payments",
      "dependsOn": ["s1"],
      "estimatedActions": 1,
      "suggestedActionType": "COPY_FILTERED_RANGE"
    }
  ]
}
```

**Add `suggestedActionType` as an optional field on the subtask schema** — this lets the Planner nudge the Executor toward the correct native action type when the request pattern is recognizable, without forcing the Planner to fully specify parameters (the Executor still resolves exact ranges/columns from workbook context).

---

## Fix 3 — Executor must stop treating data-movement subtasks as a text-generation task

Add to `executor.prompt.ts`: when a subtask's `suggestedActionType` is `COPY_FILTERED_RANGE` or `MOVE_RANGE`, the Executor must emit exactly one action of that type with resolved parameters (`sourceRange`, `filter`, `destStartCell`) — it must never attempt to enumerate individual rows as `SET_CELL` actions, and it must never request the source data via `get_range_data` in order to re-emit it as literal values. The whole point of these action types is that Office.js reads and writes the data directly; the Executor's job is only to resolve *which* range and *what* filter, not to see the data itself.

This also means: if `get_range_data` tool calls are showing up in the trace for a `COPY_FILTERED_RANGE`-eligible subtask, that's a signal the Executor is falling back to the old text-transcription approach — treat that as a bug indicator, not normal tool use, for this specific action type.

---

## Fix 4 — Partial progress must survive a downstream subtask failure

Independent of Fixes 1-3 (defense in depth — this protects against the *next* new failure mode too, not just this one): when a multi-subtask Tier 3 chain has some subtasks succeed and a later one fail/timeout, the successful ones must not be discarded.

```typescript
// agentic-loop.service.ts
// Current behavior (confirmed by trace): 20 iterations across 3 subtasks,
// subtask 1 succeeds (ADD_SHEET), subtask 2 produces wrong actions, subtask 3
// times out — final result: "verified: false", entire response discarded,
// 330s elapsed, user sees nothing.

// Required behavior: track completed-and-verified subtasks independently.
interface SubtaskChainResult {
  completedSubtasks: Array<{ subtaskId: string; actions: SheetAction[]; verified: boolean }>;
  failedSubtask: { subtaskId: string; reason: string } | null;
}

// On chain failure/timeout: return completedSubtasks' actions for preview/apply
// (with a clear note on which ones), and surface the failed subtask as a
// specific, actionable error — not a generic "could not complete and verify
// the full request" that discards everything including what worked.
```

**User-facing behavior after this fix:** for this exact request, the user should see "Pending Payments" sheet created and offered for accept (subtask 1's real result), plus a clear message like *"I created the sheet but couldn't complete the data copy — [specific reason]. Want me to retry just that step?"* — not silence after 5+ minutes.

---

## Acceptance criteria

- [ ] `COPY_FILTERED_RANGE` and `MOVE_RANGE` action types implemented, executed entirely via Office.js range read/filter/write — zero LLM involvement in the actual row data.
- [ ] Re-run the exact repro request ("create a new sheet called pending payments and then move the pending data to there create a copy") end-to-end: completes in low single-digit seconds (matching Shortcut's ~5s), produces a 2-subtask plan (create sheet + copy filtered range), and the destination sheet actually contains the filtered rows after Accept.
- [ ] Planner never decomposes a copy/move/filter-across-sheets request into separate read/filter/paste subtasks — covered by a fixture test using this exact request phrasing plus 2-3 rephrasings ("extract pending rows into a new tab," "copy rows where status is pending to Pending sheet").
- [ ] Executor never calls `get_range_data` to re-transcribe source data for a `COPY_FILTERED_RANGE`-eligible subtask — covered by a mock call-count test.
- [ ] A chain where subtask 1 succeeds and subtask 2 fails delivers subtask 1's result to the user with a specific, actionable message about subtask 2 — never a full silent discard.
- [ ] `max iterations` and chain-timeout paths both route through the partial-progress delivery logic, not the current "could not complete... no partial changes sent" dead end.
- [ ] Latency budget: this class of request (create sheet + copy/filter data) should land in Tier 3's normal range (a few seconds to low tens of seconds for larger sheets), not the 330s observed — the majority of that time was wasted on the doomed text-transcription retry loop this spec eliminates.
