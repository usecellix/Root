# 05 — Mode Selector: Ask / Plan / Act

**Phase:** 2 (depends on Phase 1's tier field being available)
**Files touched:**
- `frontend/src/components/ConversationPanel.tsx` (add mode selector UI)
- `frontend/src/hooks/useConversation.ts` (pass mode through)
- `cellix_backend/src/excel-ai/services/conversation.service.ts` (branch on mode)
- `cellix_backend/src/excel-ai/dto/` (add `mode` field to request DTO)

---

## Goal

Add an explicit three-way mode selector to the task pane, matching Shortcut's `Plan Mode` / `Ask Mode` / `Action Mode` split (source doc §2.2, §3 Layer 1). Currently Cellix has an implicit `ask` vs `action` mode distinction inside `LlmRouterService`'s route classification; this phase makes the distinction **user-visible and user-controlled**, not just inferred from phrasing.

## Why this matters for the CA buyer specifically

Per source doc §2.1/§3: a CA doing compliance work will almost always want to see a plan before anything touches the sheet, especially for Tier 3 (multi-step, cross-sheet) work. Today, a Tier 3 request executes as far as the preview stage automatically; there is no way for the CA to say "just show me the plan, don't run anything yet" up front.

## New modes

| Mode | Behavior | Maps to |
|---|---|---|
| `ask` | Read-only. No `SheetAction`s ever produced. Existing `route=ask` behavior, now explicit rather than only reachable by phrasing ("what does this formula do"). |
| `plan` | Runs classification + (for Tier 2/3) the Generate/Planner step, returns the plan/preview, but **stops before Executor writes anything or ChangeSet is created**. New. |
| `act` | Current default behavior — full pipeline through to preview + Accept/Reject. This is today's only mode. |

## DTO change

```typescript
// cellix_backend/src/excel-ai/dto/send-message.dto.ts
export class SendMessageDto {
  // ...existing fields...
  mode?: 'ask' | 'plan' | 'act'; // defaults to 'act' if omitted, for backward compatibility
}
```

## Backend branching

```typescript
// conversation.service.ts
async handleMessage(dto: SendMessageDto) {
  const route = await this.llmRouter.routeMessage(dto.message, workbookContext);

  if (dto.mode === 'ask' || route.route === 'ask') {
    return this.streamAskOnly(dto.message, workbookContext); // existing ask path
  }

  if (dto.mode === 'plan') {
    return this.streamPlanOnly(dto, route); // NEW — see below
  }

  // mode === 'act' (default) — existing tiered dispatch from 04_tier3_routing_integration.md
  return this.handleWriteRoute(dto, route);
}
```

## `streamPlanOnly` — new method

```typescript
async streamPlanOnly(dto: SendMessageDto, route: RouteResult) {
  switch (route.complexity) {
    case 0:
    case 1:
      // Tier 0/1 have no real "plan" step distinct from execution — for these,
      // Plan Mode should just describe the single action in prose without
      // calling Tier0DirectService/Tier1SingleActionService's write path.
      return this.describeIntendedAction(dto.message, route);
    case 2:
      // Run Tier 2's "generate" half only (ExecutorAgent, single subtask) but
      // do NOT call VerifierAgent and do NOT create a ChangeSet or apply anything.
      // Return the generated formula/action as a proposal.
      return this.tier2Service.generateOnly(dto.message, route.actionHint, workbookContext);
    case 3:
      // Run PlannerAgent.plan() only. Return subtasks[] with dependsOn ordering
      // for display. Do NOT invoke AgenticLoop/ExecutorAgent at all.
      return this.plannerAgent.plan(dto.message, workbookContext);
  }
}
```

**Important:** `Tier2GenerateVerifyService` needs a new `generateOnly()` method alongside its existing `execute()` — do not overload `execute()` with a flag, since that risks accidentally skipping verification in `act` mode via a wrong default. Keep the methods separate and each unmistakably named.

## Frontend: mode selector component

```tsx
// ConversationPanel.tsx — add above the message input
type ConversationMode = 'ask' | 'plan' | 'act';

// Persist selection in the existing chatSessionStorage (workbook-keyed localStorage),
// not just component state — a CA switching sheets/reloading should keep their
// last-used mode, consistent with existing multi-session chat behavior.
```

Plan Mode responses render as a **read-only step list** (reuse `ChangeHistoryPanel`'s list-rendering style, not `PreviewSummaryBar`, since there's nothing to Accept/Reject yet — only a "Run this plan" button that re-submits the same message in `act` mode).

## SSE event addition

```typescript
// New event type, only emitted in plan mode:
{ type: 'plan_only', steps: PlannerSubtask[] | { description: string } | { proposedAction: SheetAction } }
```

Do not reuse the existing `actions` SSE event for plan-only output — `actions` currently implies "these are queued for preview/apply," and overloading it risks the frontend's existing `onPreviewActions` handler firing incorrectly.

## Acceptance criteria

- [ ] `mode` defaults to `'act'` when omitted — zero behavior change for any existing client/integration that doesn't send it.
- [ ] Plan Mode never creates a `ChangeSet` and never calls `RichActionEngine`/Office.js.
- [ ] Tier 3 Plan Mode calls `PlannerAgent.plan()` exactly once and stops — verified via mock call-count test on `AgenticLoop`/`ExecutorAgent` (must be zero).
- [ ] "Run this plan" re-submission in Act mode produces the same plan (or explicitly notes if workbook state changed since the plan was shown).
- [ ] Mode selection persists per workbook session in existing `chatSessionStorage`.
