# 02 — Tier 0 & Tier 1 Handlers

**Phase:** 1 (Tiering)
**Files touched:**
- `cellix_backend/src/excel-ai/services/tier0-direct.service.ts` (new)
- `cellix_backend/src/excel-ai/services/tier1-single-action.service.ts` (new)
- `cellix_backend/src/excel-ai/services/conversation.service.ts` (dispatch wiring)
- `frontend/src/utils/localSheetActions.ts` (Tier 0 may resolve entirely client-side — see note)

---

## Tier 0 — zero LLM calls

**When:** `complexity === 0` from the classifier (target fully explicit — "bold A1:C1", "freeze row 1", "hide column F").

**Design note:** Tier 0 is architecturally identical to the existing local frontend shortcut lane (`tryLocalSheetActions`) already documented for delete/rename/clear. This phase **generalizes that lane** to cover the full Tier 0 catalog (cell formatting, row/column structure, visibility, named ranges) rather than adding a second, separate mechanism.

```typescript
// tier0-direct.service.ts
export interface Tier0Result {
  actions: SheetAction[];   // existing SheetAction type, no new fields needed
  skippedLLM: true;
}

export class Tier0DirectService {
  // Maps actionHint + extracted target (regex capture groups from the classifier
  // pattern, e.g. "A1:C1", "row 1", "column F") directly to a SheetAction.
  // NO LLM call. NO Planner. NO Executor. Straight to RichActionEngine.
  resolve(actionHint: string, captures: RegExpMatchArray, workbookContext: WorkbookContext): Tier0Result | null {
    switch (actionHint) {
      case 'CELL_FORMAT': return this.resolveCellFormat(captures);
      case 'FREEZE_PANES': return this.resolveFreezePanes(captures);
      case 'VISIBILITY_TOGGLE': return this.resolveVisibilityToggle(captures);
      case 'ROW_COL_STRUCTURE': return this.resolveRowColStructure(captures);
      default: return null; // fall back to Tier 1 if target extraction fails
    }
  }
}
```

**Fallback rule:** if `resolve()` returns `null` (e.g. target was implicit — "bold the header row," which row is that?), do **not** error — downgrade to Tier 1 for a single small LLM call to resolve the target, per the source doc's explicit guidance. Log this downgrade with `reason: 'implicit_target'`.

**Preview/apply:** Tier 0 actions still go through the existing `previewManager` / Accept-Reject flow — skipping the LLM does not mean skipping user review for structural changes that the current UI already previews (e.g. `ADD_SHEET`-class actions). Cosmetic/reversible actions (bold, freeze, hide) may apply immediately without a preview gate, consistent with current shortcut-lane behavior — confirm this against `previewPolicy.ts` rather than assuming.

---

## Tier 1 — one LLM call, no verification

**When:** `complexity === 1` (sort, filter, find & replace on non-numeric columns, conditional formatting, copy/fill).

```typescript
// tier1-single-action.service.ts
export class Tier1SingleActionService {
  constructor(private openRouterService: OpenRouterService) {}

  async execute(
    message: string,
    actionHint: string,
    workbookContext: WorkbookContext, // column-sliced, same slicer as SmartDataQuery where applicable
  ): Promise<{ actions: SheetAction[]; answer: string }> {
    // Single call, LOW-tier model (same tier as LlmRouter's own classification calls).
    // Prompt is action-hint-specific (small, focused prompt per actionHint — NOT the
    // general cellix-system-prompt), producing exactly one SheetAction.
    // NO ExecutorAgent, NO VerifierAgent, NO Planner call.
  }
}
```

**Why no verifier here:** per source doc §5 — these operations are visually self-evident and trivially reversible in one undo. Do not add verification; that reintroduces the latency this phase exists to remove.

**Escalation exception (must implement):** if `actionHint === 'FIND_REPLACE'` and the classifier already tagged it numeric/financial (see `01_complexity_classifier.md`), this request arrives as Tier 2, not Tier 1 — `Tier1SingleActionService` should never see it. Add a defensive assertion/log if it does (classifier bug indicator).

---

## Dispatch wiring in `ConversationService`

```typescript
// conversation.service.ts — extend existing route=write branch
if (route === 'write') {
  switch (complexity) {
    case 0: {
      const result = tier0DirectService.resolve(actionHint, captures, workbookContext);
      if (result) return this.streamTier0Result(result);
      // fall through to case 1 (implicit target downgrade)
    }
    case 1:
      return this.streamTier1Result(await tier1Service.execute(message, actionHint, workbookContext));
    case 2:
      return this.streamTier2Result(await tier2Service.execute(message, actionHint, workbookContext)); // see 03
    case 3:
    default:
      return this.streamWithOrchestrator(message, workbookContext); // existing, unchanged
  }
}
```

## SSE contract — no changes required

Tier 0/1 still emit the same SSE event shape (`answer`, `actions`, optionally `changeSetId`) so the frontend's `useConversation` hook and `PreviewSummaryBar` require **no changes** for this phase. The only new field is `tier` on the final event, purely for telemetry/debugging — add it as an optional field, do not make the frontend depend on it yet (Phase 2 will surface it in the UI).

## Acceptance criteria

- [ ] Tier 0 handles all "explicit target" catalog items from §2 Tier 0 table with zero LLM calls, verified via request logging (LLM call count = 0).
- [ ] Tier 0 downgrades to Tier 1 on implicit-target failure, never errors to the user.
- [ ] Tier 1 makes exactly one LLM call per request (assert in tests via call-count mock).
- [ ] Numeric/financial find-replace never reaches `Tier1SingleActionService` (covered by a unit test asserting classifier output, not just runtime behavior).
- [ ] No regression in `PreviewSummaryBar` / Accept-Reject behavior for existing shortcut-lane actions.
