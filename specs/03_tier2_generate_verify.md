# 03 — Tier 2: Generate → Verify (No Planner)

**Phase:** 1 (Tiering)
**Files touched:**
- `cellix_backend/src/excel-ai/services/tier2-generate-verify.service.ts` (new)
- `cellix_backend/src/agents/executor.agent.ts` (reused directly, single-subtask mode)
- `cellix_backend/src/agents/verifier.agent.ts` (reused directly, unchanged)
- `cellix_backend/src/formula/` (formula validation hooks, reused)

---

## Goal

For formulas, pivot tables, charts, duplicate detection, data validation, and error-fix requests: skip `PlannerAgent` entirely (there is nothing to decompose — it's one action) but **keep verification mandatory**. This is the highest-value tier to get right — source doc §5 is explicit that wrong-number risk concentrates here (GST %, SUMIFS thresholds, date-range formulas), so do not weaken verification while removing the Planner hop.

## Why skip the Planner specifically (not the Verifier)

The Planner's output is a `subtasks[]` array with `dependsOn` ordering. A single formula has exactly one subtask with no dependencies — calling `PlannerAgent.plan()` for it produces pure overhead: one LLM round trip whose entire output is "there is one thing to do," and per the earlier bug investigation, an unnecessary opportunity for an over-cautious clarification prompt to fire on a simple request.

## Service contract

```typescript
// tier2-generate-verify.service.ts
export interface Tier2Result {
  actions: SheetAction[];
  answer: string;
  verifierPassed: boolean;
  verifierSkipped: false; // Tier 2 verification is NEVER skipped — distinct from
                          // the existing shouldSkipVerifier policy used in Tier 3
}

export class Tier2GenerateVerifyService {
  constructor(
    private executorAgent: ExecutorAgent,   // existing, reused directly
    private verifierAgent: VerifierAgent,   // existing, reused directly
    private formulaValidator: FormulaValidatorService, // existing
  ) {}

  async execute(
    message: string,
    actionHint: string, // 'FORMULA_GEN' | 'PIVOT_TABLE' | 'CHART' | 'DUPLICATE_CHECK' | 'DATA_VALIDATION' | 'ERROR_FIX'
    workbookContext: WorkbookContext,
  ): Promise<Tier2Result> {
    // 1. Build a single synthetic subtask (NOT via PlannerAgent.plan()):
    const subtask = {
      id: 's1',
      description: message,
      dependsOn: [],
      actionHint,
    };

    // 2. Call ExecutorAgent directly on this one subtask (existing agent, existing
    //    prompt path — no changes to ExecutorAgent itself, just a new caller).
    const executorResult = await this.executorAgent.executeSubtask(subtask, workbookContext);

    // 3. Deterministic checks FIRST, before any LLM verifier call (cheap, fast,
    //    per source doc §5 — "don't pay for an LLM pass on an error a library
    //    catches in milliseconds"):
    const hardcodeCheck = this.formulaValidator.checkNoHardcodedLiterals(executorResult.actions);
    if (!hardcodeCheck.passed) {
      // Do NOT silently retry with a patched prompt — surface as a verification
      // failure the same way the LLM verifier would, so this is auditable.
      return this.buildFailureResult(executorResult, hardcodeCheck.reason);
    }

    // 4. LLM VerifierAgent — MANDATORY for Tier 2, never skipped, unlike Tier 3's
    //    shouldSkipVerifier optimization. Reuse the existing agent unchanged.
    const verifierResult = await this.verifierAgent.verify(executorResult, workbookContext);

    return {
      actions: executorResult.actions,
      answer: executorResult.answer,
      verifierPassed: verifierResult.passed,
      verifierSkipped: false,
    };
  }
}
```

## Explicit rule: `shouldSkipVerifier` must not apply here

The existing `shouldSkipVerifier` policy (used in the Tier 3 / full pipeline path when executor output is "clean, non-destructive, and parsed on first attempt") is a **Tier 3 optimization** and must not be reused for Tier 2. Tier 2 verification is mandatory by design — add a code-level guard (not just a comment) so a future refactor can't accidentally wire `shouldSkipVerifier` into `Tier2GenerateVerifyService`.

```typescript
// Guard example — fail loudly in dev/test if misused:
if (process.env.NODE_ENV !== 'production' && tier2CallSite.usedShouldSkipVerifier) {
  throw new Error('Tier 2 must never use shouldSkipVerifier — verification is mandatory here.');
}
```

## Pivot tables & charts — same tier, different action shape

Per source doc: these "look complex" but Office.js exposes them as single structured API calls once source range, fields, and chart/pivot type are known. The complexity is in correctly specifying that one call, not sequencing multiple calls — so they belong in `Tier2GenerateVerifyService`, not Tier 3. The Verifier's job for these is to check the specified range/fields are valid against the actual sheet structure (via the existing workbook context), not to check "is this the right sequence of steps."

## Acceptance criteria

- [ ] `Tier2GenerateVerifyService` never calls `PlannerAgent.plan()`.
- [ ] `Tier2GenerateVerifyService` never sets `verifierSkipped: true` — enforce via test asserting `VerifierAgent.verify()` is always called (mock call-count === 1).
- [ ] Hardcode-literal check runs and blocks before any LLM verifier call, and is independently unit-tested against known bad outputs (e.g. `=D2*0.18` replaced with a literal number).
- [ ] Every catalog example from source doc's Q&A.5 table (GST %, SUMIFS, etc.) is a test fixture for this service.
- [ ] Latency instrumented per request (target: 800ms–2s per source doc §4 latency budget) and logged with `tier: 2`.
