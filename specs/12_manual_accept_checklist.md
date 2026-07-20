# Spec 12 — Manual Excel Accept Checklist

Use this after Fixes 1–4 are deployed (backend + add-in rebuilt).

## Setup

1. Open a workbook with a sheet such as `Purchase Register` that has a header row and a **Payment Status** (or similar) column containing `"Pending"` values among others.
2. Start the Cellix backend (`npm run start:dev`) and load the Excel add-in.

## Exact repro

Prompt:

> create a new sheet called pending payments and then move the pending data to there create a copy

## Pass criteria

| Check | Expected |
|-------|----------|
| Plan shape | ~2 subtasks: create sheet + one `COPY_FILTERED_RANGE` (not read/filter/paste) |
| Latency | Low single-digit to low tens of seconds — **not** ~330s |
| Preview | New sheet may appear structurally; filtered values stay deferred until Accept |
| After Accept | `Pending Payments` contains header + pending rows only (correct filter) |
| Source sheet | Unchanged if `mode: "copy"` |

## Partial-progress spot check (optional)

If a later subtask is forced to fail (e.g. bad dest sheet name in a mock), earlier successful steps (e.g. sheet create) must still appear for Accept with a clear message about the failed step — not “no partial changes were sent.”

## Automated coverage already in repo

- `cellix_backend/test/range-filter.util.spec.ts`
- `cellix_backend/test/virtual-copy-filtered.spec.ts`
- `cellix_backend/test/normalize-executor-output.spec.ts` / `finalize-actions.spec.ts`
- `cellix_backend/test/native-range-planner.spec.ts` + `fixtures/native-range-planner.json`
- `cellix_backend/test/agenticLoop.service.spec.ts` (partial progress + no `get_range_data`)
- `frontend/src/engine/rangeFilter.spec.ts` / `previewRevert.spec.ts`
