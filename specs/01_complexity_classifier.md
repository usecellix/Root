# 01 — Complexity Classifier

**Phase:** 1 (Tiering)
**Files touched:**
- `cellix_backend/src/excel-ai/services/llm-router.service.ts` (extend)
- `cellix_backend/src/excel-ai/utils/complexity-classifier.util.ts` (new)
- `cellix_backend/src/excel-ai/prompts/router-system-prompt.ts` (extend with `complexity` field)

---

## Goal

Insert a third routing lane, of the same shape as the existing `INSTANT_SHORTCUT_PATTERNS` regex lane and `quickDataCheck` keyword lane, that classifies every `route=write` message into Tier 0/1/2/3 **before** it reaches the Planner. Only genuinely ambiguous or compound requests should fall through to the LLM router's semantic classification.

## New type

```typescript
// cellix_backend/src/excel-ai/utils/complexity-classifier.util.ts

export type ComplexityTier = 0 | 1 | 2 | 3;

export interface ComplexityMatch {
  tier: ComplexityTier;
  actionHint: string;       // e.g. 'FORMULA_GEN', 'PIVOT_TABLE', 'SORT_OR_FILTER'
  matchedBy: 'regex' | 'llm-fallback';
  confidence?: number;      // only set when matchedBy === 'llm-fallback'
}

export interface ComplexityClassifierResult {
  match: ComplexityMatch | null; // null => fall through to LLM router semantic classification
}
```

## Pattern table (seed from the catalog — extend, don't replace)

```typescript
const SINGLE_ACTION_PATTERNS: Array<{ pattern: RegExp; tier: ComplexityTier; actionHint: string }> = [
  // Tier 0 — explicit target, pure structural/cosmetic, zero interpretation
  { pattern: /\b(bold|italic|underline)\b.*\b[a-z]+\d+(:[a-z]+\d+)?\b/i, tier: 0, actionHint: 'CELL_FORMAT' },
  { pattern: /\bfreeze\s+(top\s+)?row\b/i, tier: 0, actionHint: 'FREEZE_PANES' },
  { pattern: /\b(hide|unhide|show)\s+(column|row|sheet)\b/i, tier: 0, actionHint: 'VISIBILITY_TOGGLE' },
  { pattern: /\b(insert|delete)\s+(a\s+)?(row|column)\b/i, tier: 0, actionHint: 'ROW_COL_STRUCTURE' },

  // Tier 1 — single LLM call, no verification, low stakes
  { pattern: /\b(sort|filter)\b.*\bby\b/i, tier: 1, actionHint: 'SORT_OR_FILTER' },
  { pattern: /\bfind\s*(and)?\s*replace\b/i, tier: 1, actionHint: 'FIND_REPLACE' },
  { pattern: /\b(highlight|conditional format)\b/i, tier: 1, actionHint: 'CONDITIONAL_FORMAT' },
  { pattern: /\bfill\s+down\b|\bcopy\s+format(ting)?\b/i, tier: 1, actionHint: 'COPY_FILL' },

  // Tier 2 — formula/computation/structured object, verification mandatory
  { pattern: /\bcalculate\b.*%|=|\bformula\b|\bif\s.*then\b/i, tier: 2, actionHint: 'FORMULA_GEN' },
  { pattern: /\bpivot\s*table\b/i, tier: 2, actionHint: 'PIVOT_TABLE' },
  { pattern: /\bchart\b|\bgraph\b/i, tier: 2, actionHint: 'CHART' },
  { pattern: /\bduplicate\b/i, tier: 2, actionHint: 'DUPLICATE_CHECK' },
  { pattern: /\bvalidation\b|\bdropdown\b/i, tier: 2, actionHint: 'DATA_VALIDATION' },
  { pattern: /#(REF|N\/A|VALUE|DIV\/0)!?/i, tier: 2, actionHint: 'ERROR_FIX' },
];

// If ANY of these match alongside a single-action pattern, escalate to Tier 3
// regardless of what else matched. This must be checked FIRST.
const COMPOUND_SIGNALS = /\band then\b|\bafter that\b|,\s*(then|and)\s|\bfor each sheet\b|\bacross (all|every) sheets?\b/i;

// Safety override: numeric/financial find-replace is NOT low-stakes (per source doc §5).
// Escalate Tier 1 FIND_REPLACE -> Tier 2 when target looks numeric/financial.
const NUMERIC_FINANCIAL_HINT = /\b(gst|gstin|amount|total|balance|invoice|tax|₹|rs\.?)\b/i;
```

## Classification function contract

```typescript
export function classifyComplexity(
  message: string,
  activeSheetContext?: { hasHeaders?: boolean }, // optional, for future refinement
): ComplexityClassifierResult {
  // 1. Check COMPOUND_SIGNALS first — if matched, return { tier: 3 } immediately,
  //    UNLESS message also fails to match any SINGLE_ACTION_PATTERN, in which case
  //    return null (let LLM router decide — a compound signal with no recognizable
  //    action is exactly the ambiguous case that needs semantic routing).
  // 2. Walk SINGLE_ACTION_PATTERNS in order, return first match.
  // 3. If matched pattern.tier === 1 && actionHint === 'FIND_REPLACE' &&
  //    NUMERIC_FINANCIAL_HINT.test(message) -> upgrade to tier 2, actionHint stays 'FIND_REPLACE'.
  // 4. No match -> return { match: null } (fall through to LlmRouterService's
  //    existing LLM call, which should now also emit a `complexity` field —
  //    see router-system-prompt change below).
}
```

## Router prompt extension

Add to `router-system-prompt.ts` output schema (only used when the regex layer returns `null`):

```json
{
  "route": "write",
  "complexity": 0 | 1 | 2 | 3,
  "reasoning": "short justification, logged not shown to user"
}
```

The LLM's `complexity` field is the **semantic fallback**, not the primary path. Log every case where the regex layer misses (returns `null` and the LLM fills in complexity) — this is required for Phase migration step 3 in `08_migration_plan_and_tests.md`.

## Integration point in `LlmRouterService`

```typescript
// Existing flow (unchanged): INSTANT_SHORTCUT_PATTERNS -> quickDataCheck -> LLM classify(route)
// New: insert complexity classification between quickDataCheck and the LLM route classify call,
// but ONLY when route candidate is 'write' (shortcut/data/export/ask routes are unaffected).

async routeMessage(message: string, context: WorkbookContext): Promise<RouteResult> {
  // ...existing shortcut/data/export checks unchanged...

  const complexityResult = classifyComplexity(message);
  if (complexityResult.match) {
    return {
      route: 'write',
      complexity: complexityResult.match.tier,
      actionHint: complexityResult.match.actionHint,
      matchedBy: 'regex',
    };
  }

  // Fall through to existing LLM router call, now also parsing `complexity` from its response.
}
```

## Acceptance criteria

- [ ] `classifyComplexity()` is a pure function, unit-testable with no I/O.
- [ ] All ~180 catalog phrasings from the user's `cellix-basic-usecases.html` catalog are run through it as test fixtures (see `08_migration_plan_and_tests.md`).
- [ ] Compound signal detection takes priority over single-action pattern matching.
- [ ] Numeric/financial find-replace is provably escalated to Tier 2 in a unit test.
- [ ] `LlmRouterService.routeMessage()` returns a `complexity` field on every `route=write` result — this field must exist for Tier 3 (existing) requests too, so downstream consumers don't need to special-case "no tier."
- [ ] No changes to `route=shortcut | data | export | ask` behavior.
