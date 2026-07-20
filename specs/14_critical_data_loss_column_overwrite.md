# 14 — CRITICAL: Silent Data Loss via Wrong-Column Write (P0 — highest severity, fix before anything else in this queue)

**Severity: CRITICAL.** Every prior bug in this project (`10`, `11`) produced either a visible failure or a no-op. This bug **destroys real user data and reports success.** For a CA-facing product, this is the one failure class that ends trust outright. Nothing else in the backlog should ship ahead of this fix.

**Phase:** 0 — blocks everything, supersedes prior P0 ordering.
**Files touched:** `cellix_backend/src/excel-ai/services/executor.agent.ts` / `executor.prompt.ts` (root cause), `cellix_backend/src/excel-ai/services/rich-action-engine.service.ts` (structural guard — primary fix location), `cellix_backend/src/excel-ai/types/sheet-actions.types.ts` (new `INSERT_COLUMN` action type)

---

## Repro

**Request:** `Add a column called "Net of Tax" that subtracts Tax Amount from Total Amount`

**Sheet's actual layout (12 columns):**
`A:Date, B:Invoice No, C:Supplier, D:GSTIN, E:Item, F:Qty, G:Unit Price, H:Tax %, I:Tax Amount, J:Total Amount, K:Payment Status, L:Remarks`

**Response:** "Multi-agent pipeline: planned, executed, and verified. 52 Direct Changes Applied."

**Change log (actual):**
```
Purchase Register!K2: Paid → =J2-I2
Purchase Register!K3: Pending → =J3-I3
Purchase Register!K4: Paid → =J4-I4
... (48 more, all K2:K52)
```

**What actually happened:** the system did not add a new column. It **overwrote column K — the existing `Payment Status` column — for all 51 data rows**, replacing every "Paid"/"Pending" value with a subtraction formula (`=J{row}-I{row}`, i.e. Total Amount − Tax Amount, which is the correct *Net of Tax* formula — the math itself is right, the **location** is catastrophically wrong). `Payment Status` data for the entire sheet is gone. The system reported this as a clean, fully verified success.

---

## Root cause (needs confirmation, but high-confidence hypothesis)

The Executor almost certainly derived the target column by counting from the sheet's known column count incorrectly — likely treating the table as 10 columns wide (A-J, ending at `Total Amount`) rather than 12 (through `L: Remarks`), and picking "the next column after the last one it accounted for" — landing on K instead of the actual first-empty column, M.

This is the same *class* of bug as the `FORMAT_RANGE` A1-string/row-col mismatch in `10_critical_bugfixes.md` — a mismatch between what the model assumes about sheet structure and the sheet's real structure — but where that bug produced a harmless no-op, this one produces silent overwrite because **nothing in the write path checks whether the target range already contains data before writing to it.**

### Investigation prompt for Cursor (read-only, confirm before fixing)

```
Do NOT write code yet — read-only investigation.

Trace how the Executor determines the target column for a "add a new column
called X" request. Specifically:
1. Find where column count/last-used-column is derived from workbook context
   for this kind of request — is it reading the ACTUAL used range (12 columns,
   through L), or a cached/stale/partial column count?
2. Show me the exact Executor output (or reconstruct it) for the request
   "Add a column called 'Net of Tax' that subtracts Tax Amount from Total
   Amount" against a 12-column sheet (A:Date ... L:Remarks) — what column
   index did it target and why?
3. Confirm: does ANY layer in the write pipeline (Executor, normalize,
   sanitize, or the Office.js execution layer) check whether the target
   range already contains non-empty values before writing? If yes, why did
   it not block this write. If no, confirm that's the gap.

Report file paths and line numbers. Wait for confirmation before fixing.
```

---

## Required fixes (three layers — do not ship with only one)

### Fix 1 — Structural guard: never silently overwrite non-empty cells (primary fix, most important)

This is the fix that actually prevents data loss, independent of whatever caused the wrong column index in the first place. Add a pre-write check in the Office.js execution layer (`rich-action-engine.service.ts`) for any action that writes to a range:

```typescript
async function guardAgainstOverwrite(
  action: SheetAction,
  context: Excel.RequestContext,
): Promise<void> {
  const targetRange = resolveTargetRange(action); // sheet + row/col + span
  const range = getExcelRange(context, targetRange);
  range.load('values');
  await context.sync();

  const hasExistingData = range.values.some(row => row.some(cell => cell !== '' && cell != null));

  if (hasExistingData && !action.explicitOverwriteConfirmed) {
    throw new OverwriteGuardError({
      message: `Write blocked: target range ${targetRange} already contains data. This action would overwrite existing values.`,
      targetRange,
      sampleExistingValues: range.values.slice(0, 3),
    });
  }
}
```

**This check must run for every write action, unconditionally**, not just "add column" requests — the same gap could just as easily corrupt data via a misplaced `FORMAT_RANGE`, `WRITE_TABLE`, or any future action type. `explicitOverwriteConfirmed` should only ever be set `true` when the user's request is unambiguously about replacing existing content (e.g. "replace column K with X," "clear and refill this range") — never inferred by the Executor on its own.

**On block:** surface a clear, specific error to the user — *"I was about to write to column K, but it already contains your Payment Status data. Did you mean to add a new column instead? I'll place it in column M."* — not a silent fallback and not a generic failure message. This is a case where stopping and asking is strictly better than any guess.

### Fix 2 — New `INSERT_COLUMN` action type (removes the guesswork entirely for this request pattern)

The deeper fix: "add a new column" should never be expressed as "figure out an index and write there." Add a dedicated action type that inserts a genuinely new column using Office.js's actual insert semantics, which shifts nothing and cannot land on existing data by construction:

```typescript
export interface InsertColumnAction {
  type: 'INSERT_COLUMN';
  sheetName: string;
  columnName: string;        // header text, e.g. "Net of Tax"
  position: 'afterLastColumn' | { afterColumn: string }; // explicit, not computed by the model
  formula?: string;           // e.g. "={col}2-{col}2" pattern applied per row, resolved against real headers
}
```

Execution derives `afterLastColumn` from the **actual used range** read fresh via Office.js at execution time (`worksheet.getUsedRange()`), never from a cached/sampled context — this is the same "read the real thing, don't trust the sampled snapshot" principle from `12_native_range_operations.md`.

### Fix 3 — Executor prompt update

Add an explicit rule to `executor.prompt.ts`: for any "add a new column" request, the Executor must emit `INSERT_COLUMN`, never a `SET_CELL`/`SET_FORMULA` chain against a guessed column index. Combined with Fix 2, this makes the failure mode structurally much harder to reach — Fix 1 remains the last line of defense for every other action type that doesn't have a dedicated safe-insert primitive yet.

---

## Immediate action item — data recovery for this test run

Before anything else: **the Payment Status data for this specific test sheet is gone** unless recovered via Excel's own undo history or a backup/version. Recommend checking:
- Excel's built-in Undo (Ctrl+Z) if the session is still open and hasn't been closed.
- Any autosave/version history (OneDrive/SharePoint version history if the file is stored there).
- Whether Cellix's own `ChangeSet`/audit "before" state for this change was captured (per `07_citation_provenance_layer.md`'s model) — if the audit system correctly recorded before/after values, the original K2:K52 values may be recoverable from your own audit log even if Excel's undo is gone. Worth checking as a first step, and worth confirming your audit system actually captures **before-state**, not just after-state, since that's exactly what would be needed for a recovery like this.

---

## Acceptance criteria

- [ ] Root cause confirmed via the read-only investigation above before any fix is written.
- [ ] `guardAgainstOverwrite` (or equivalent) blocks any write to a non-empty range unless explicitly confirmed by the request's own semantics — covered by a test reproducing this exact scenario (12-column sheet, "add a new column" request) and asserting column K is untouched.
- [ ] `INSERT_COLUMN` action type implemented, using Office.js's real used-range at execution time, never a cached/sampled column count.
- [ ] Re-run the exact repro request end-to-end: confirm the new column lands at M (or wherever the true next-empty column is), `Payment Status` in K is untouched, and the formula correctly computes Total Amount − Tax Amount.
- [ ] Add a broader regression test: run this same overwrite-guard check against every existing action type in the system (`FORMAT_RANGE`, `SET_FORMULA`, `WRITE_TABLE`, `COPY_FILTERED_RANGE` from spec `12`, `AGGREGATE_TABLE` from spec `13`) to confirm none of them can silently overwrite existing data either.
- [ ] Confirm whether the audit/ChangeSet system captured genuine before-state for this incident, and if not, treat that as an additional P0 gap — a data-loss bug without a recoverable audit trail is strictly worse than one with it.
