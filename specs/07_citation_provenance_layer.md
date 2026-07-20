# 07 — Citation & Provenance Layer

**Phase:** 4 (extends Phase 1's tier output and Phase 3's `SourceRef` shape — do last)
**Files touched:**
- `cellix_backend/src/audit/` (extend `ChangeSet` schema)
- `cellix_backend/src/types/audit.types.ts`
- `frontend/src/components/ChangeHistoryPanel.tsx` (extend)
- new `frontend/src/components/SourcePreview.tsx`

---

## Goal

Every cell written by Tier 2/3 (and any domain-tool-backed write) should carry a pointer back to its source — matching Vesence's "citations as a first-class object" and Shortcut's "Source Preview" pattern (source doc §2.1, §2.2). This is an **extension** of the existing `ChangeSet`/audit model already in Cellix, not a new parallel system.

## Why this extends `ChangeSet` rather than replacing it

Cellix already captures before/after cell diffs for audit and revert via `ChangeSetService`. Citations are additional metadata on each change entry, not a different kind of record — keeping them in the same model means the existing audit export, revert, and `ChangeHistoryPanel` rendering all keep working with one additive field.

## Schema extension

```typescript
// types/audit.types.ts — extend existing ChangeSet entry type
export interface CellChange {
  // ...existing fields (range, before, after, etc.) — unchanged...
  sourceRefs?: SourceRef[]; // NEW, optional — from domain-tools' DomainToolResult.sourceRefs
                            // (see 06_domain_tool_layer_scaffolding.md), or workbook-internal
                            // refs for Tier 2 formula generation (e.g. "derived from Sheet2!C4:C40").
}
```

For non-domain-tool writes (e.g. a Tier 2 formula referencing other cells in the same workbook), `sourceRefs` should point to the precedent range using the same `SourceRef` shape with `documentType: 'workbook'`:

```typescript
{ documentType: 'workbook', documentId: currentWorkbookId, rowOrLine: 'Sheet2!C4:C40' }
```

## Backend: where citations get attached

```typescript
// ChangeSetService.createPreview() — extend, don't replace
async createPreview(actions: SheetAction[], context: { sourceRefs?: SourceRef[] }) {
  // existing diff-building logic unchanged; attach context.sourceRefs to each
  // resulting CellChange where applicable. Tier 0/1 changes will simply have
  // sourceRefs: undefined — this is expected and fine, not an error state.
}
```

`Tier2GenerateVerifyService` and any domain-tool-backed Tier 3 execution must thread `sourceRefs` through from generation to `createPreview()` — this is the main wiring work in this phase, not new storage design.

## Frontend: `SourcePreview` component (new)

```tsx
// SourcePreview.tsx
interface SourcePreviewProps {
  sourceRefs: SourceRef[];
  onJumpToSource: (ref: SourceRef) => void; // scrolls to/highlights the cited
                                             // row in the source doc viewer, or
                                             // the referenced range in-sheet for
                                             // documentType: 'workbook'
}
```

Render as a small clickable badge/icon on each changed cell in `ChangeHistoryPanel` — clicking opens `SourcePreview`, matching Shortcut's "click to open a Source Preview that verifies the extracted value against the exact page/passage" pattern. For `documentType: 'workbook'` refs, "jump to source" means selecting the precedent range in the live Excel sheet via Office.js, not opening an external viewer.

## Confidence/exception surfacing (ties to Phase 3's domain tools)

Per source doc §3 Layer 5/6: anything below a domain tool's confidence threshold must render as a visually distinct exception marker in `ChangeHistoryPanel`, not the same styling as a clean match. Never silently auto-accept a low-confidence match into the normal "Matched" visual bucket.

```typescript
// CellChange, when sourceRefs came from a domain tool with exceptions:
interface CellChange {
  // ...
  exceptionFlags?: DomainException[]; // from 06's DomainToolResult.exceptions,
                                       // rendered distinctly, never hidden
}
```

## Audit trail requirement (ties existing feature to statutory need)

The existing append-only audit log (prompt → plan → tool calls → cell changes) already satisfies most of this. This phase's addition: ensure domain-tool calls and their `exceptions`/`confidence` are logged in the same structured-logger trace as Planner/Executor/Verifier calls, so the working-paper record is complete for CA documentation requirements — not just "what changed" but "what was flagged and at what confidence."

## Acceptance criteria

- [ ] `CellChange.sourceRefs` is optional and backward compatible — existing change sets without it render exactly as before.
- [ ] Every Tier 2 formula-generation write includes at least a `workbook`-type `sourceRef` when the formula references other cells.
- [ ] Every domain-tool-backed write (once Phase 3 tools are implemented) includes non-empty `sourceRefs` — enforced by a test that fails if a domain tool's output reaches `createPreview()` without them.
- [ ] Low-confidence/exception matches render with a distinct visual marker in `ChangeHistoryPanel`, verified via a component test/snapshot.
- [ ] Clicking a citation badge for a `workbook`-type ref selects the correct precedent range in the live sheet (Office.js `Excel.run` selection call).
- [ ] Audit export (`test/audit-export.spec.ts`, existing) still passes and now includes `sourceRefs`/`exceptionFlags` in exported records.
