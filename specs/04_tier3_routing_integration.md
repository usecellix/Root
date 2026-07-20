# 04 — Tier 3 (Unchanged) & Full Routing Integration

**Phase:** 1 (Tiering)
**Files touched:**
- `cellix_backend/src/excel-ai/services/conversation.service.ts`
- `cellix_backend/src/agents/orchestrator.ts` (no internal changes — confirm entry point only)
- `cellix_backend/src/excel-ai/utils/structured-logger.ts` (extend with tier field)

---

## Tier 3 — no changes to Planner/Executor/Verifier internals

**When:** compound signal detected (`COMPOUND_SIGNALS` regex, see `01_complexity_classifier.md`), or the LLM router's semantic fallback returns `complexity: 3`, or the request doesn't match any Tier 0-2 pattern at all and looks genuinely multi-step from context.

Tier 3 is the **existing** `streamWithOrchestrator` path — `PlannerAgent → AgenticLoop → ExecutorAgent (per subtask) → VerifierAgent (with existing shouldSkipVerifier policy intact)`. Do not touch this path's internals in this phase. The only change is that it is now reached deliberately (via explicit tier routing) rather than by default.

## Full dispatch table (final state after Phase 1)

```
route='write' (from LlmRouterService, now carrying a `complexity` field)
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│ ConversationService.handleWriteRoute()                        │
│                                                                 │
│  complexity === 0 → Tier0DirectService.resolve()               │
│                     (implicit-target failure → retry as tier 1)│
│  complexity === 1 → Tier1SingleActionService.execute()         │
│  complexity === 2 → Tier2GenerateVerifyService.execute()       │
│  complexity === 3 → streamWithOrchestrator() [EXISTING, UNCHANGED]│
└───────────────────────────────────────────────────────────────┘
```

## Logging requirement (needed for Phase migration step 3, see `08`)

Every write request must log, regardless of tier:

```typescript
interface TierDecisionLog {
  traceId: string;
  message: string;          // redacted per existing structured-logger redaction rules
  tier: 0 | 1 | 2 | 3;
  matchedBy: 'regex' | 'llm-fallback';
  actionHint: string;
  llmCallCount: number;     // 0 for tier 0, 1 for tier 1, 2 for tier 2, 3+ for tier 3
  durationMs: number;
}
```

This extends `StructuredLogger`'s existing agent-call tracing (already logs Planner/Executor/Verifier calls with correlation IDs) — add `TierDecisionLog` as a new log event type alongside the existing `agent_call` / `agent_slow_call` / `agent_parse_failure` events, not as a replacement.

## Backward compatibility

- Legacy `/excel-ai/process` route: no change, remains unused/removed as already documented.
- `GET /excel-ai/conversation/:id` rehydration: unaffected — tier is a request-time routing decision, not persisted conversation state, so no schema migration needed for existing conversations.
- Existing `refinementChangeSetId` quick-edit flow: quick-edits should be **re-classified independently** each time (a follow-up edit to a Tier 3 result is not automatically Tier 3) — do not inherit the parent turn's tier.

## Acceptance criteria

- [ ] `streamWithOrchestrator()` function signature and internals are byte-for-byte unchanged from pre-Phase-1 behavior.
- [ ] Every `route=write` request produces exactly one `TierDecisionLog` entry.
- [ ] Quick-edit / refinement turns are independently classified, not inherited — covered by a test where a Tier 3 parent turn's follow-up edit resolves to Tier 1.
- [ ] `test/orchestrator.e2e.spec.ts` (existing) still passes unmodified — this is the regression guard for Tier 3.
