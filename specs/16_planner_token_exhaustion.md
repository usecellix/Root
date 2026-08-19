# 16 — Planner Reasoning-Token Exhaustion → Empty Response → Non-Functional Fallback Plan

**Severity: P1** (not data-destroying like Bug 6, but silently degrades into a fake plan after wasting ~130 seconds, on exactly the compound/dashboard-style requests you most want to work well).
**Files touched:** wherever Planner calls are made to OpenRouter (`planner.agent.ts` / the OpenRouter client config for Planner calls specifically), the Planner's fallback-plan logic, and — separately — model selection for chart/dashboard-generation tasks (see note at bottom).

---

## Repro

Request: `In dashboard create a chart ,and analysis for purchase register a summary for purchase register`

Router correctly classified this: `Complexity regex match: tier=3 actionHint=DASHBOARD`, `route=write confidence=1`. Routing worked fine — the failure is entirely inside the Planner's model call.

```
OpenRouter empty content on first attempt
  (model=openai/gpt-5, finishReason=length, completionTokens=960, reasoningTokens=960)
OpenRouter empty content on retry with reasoning.effort=low
  (model=openai/gpt-5, finishReason=length, completionTokens=1024, reasoningTokens=1024)
```

`completionTokens === reasoningTokens` on **both** attempts. The model spent its entire token budget on internal reasoning and hit the length cap before emitting a single character of actual output — `finishReason=length` confirms this wasn't a content-policy refusal or an error, it just ran out of room.

After both attempts return empty:

```json
{
  "subtasks": [{
    "description": "In dashboard create a chart ,and analysis for purchase register a summary for purchase register",
    "targetSheet": "Dashboard",
    "dependsOn": [],
    "estimatedActions": 3
  }],
  "confidence": "low",
  "reasoning": "Fallback single-step plan — planner JSON was not parseable"
}
```

This "fallback plan" is not a real plan — its `description` is your raw input message copy-pasted verbatim. It has zero chance of producing a working dashboard. Total elapsed time: **129.5 seconds**, entirely wasted.

---

## Root cause

1. **Token budget too tight for a reasoning model on a compound request.** 960-1024 completion tokens is not enough headroom when the model both reasons *and* needs to emit a real JSON plan for a 3-part compound request (chart + analysis + summary). The existing mitigation (retry with `reasoning.effort=low`) helped somewhat (1024 vs 960) but was nowhere near enough — the model still spent 100% of the increased budget on reasoning alone.
2. **The fallback has no floor for usefulness.** When both attempts fail, the system produces a plan-shaped object rather than either retrying with a substantially larger budget or surfacing a clear failure to the user. A fallback whose `description` is the raw user message isn't a degraded plan, it's a null result wearing a plan's schema — and it gets executed as if it were real, silently.

---

## Fix

### 1. Raise the completion token ceiling for Planner calls, with headroom for both reasoning and output
Increase the Planner's `max_tokens` substantially (e.g. 3000-4000+, tune based on real observed reasoning-token usage for compound requests) so a reasoning model has room to think *and* still produce the JSON. Don't apply this uniformly to every route — a single Tier 1 formula request doesn't need this ceiling, but Tier 3/compound requests do (this can key off the `complexity`/tier field from `01_complexity_classifier.md` if useful — higher tiers get a higher token ceiling by default).

### 2. Cap reasoning specifically, not just completion tokens, for structured-output tasks
The Planner's job is decomposition into a small JSON object — it doesn't need deep reasoning, it needs reliable structure. If the model/provider exposes a way to bound reasoning tokens independently of completion tokens (separate from the `reasoning.effort` string which clearly wasn't sufficient here), use it. Otherwise, consider whether a non-reasoning or lighter-reasoning model is simply a better fit for the Planner's specific job — see model-selection note below.

### 3. Give the fallback plan a real floor, or fail loudly instead
```typescript
// planner.agent.ts — after both attempts return empty/unparseable
if (attempt1Failed && attempt2Failed) {
  // Option A: one more retry with a much larger token ceiling as a last resort
  // Option B: surface a clear, honest failure to the user instead of a stub plan
  throw new PlannerExhaustedError({
    message: "I had trouble planning this request — it may be too complex for one step. Try breaking it into smaller requests (e.g. first 'create a Dashboard sheet', then 'add a chart of...').",
    originalMessage: message,
  });
}
// Never construct a "fallback plan" whose description is just the raw user
// message — that object has a schema that looks like a real plan but isn't
// one, and downstream code has no way to distinguish it from a real
// low-confidence-but-genuine plan.
```

### 4. Separate consideration — model choice for chart/dashboard/structured-output tasks
Independent of the token-budget fix (which is necessary regardless of model): reasoning models like GPT-5 are more prone to this specific failure mode (reasoning tokens crowding out output) precisely on requests that invite more internal deliberation — compound/dashboard requests being a prime example. Worth evaluating whether Planner/chart-spec-generation calls are better served by a model with strong structured-output adherence but without an open-ended reasoning mode competing for the same budget (e.g., a non-reasoning GPT-4.1/GPT-4o-class model, or a reasoning model with a hard, separate reasoning-token cap confirmed to actually apply). This is a model-selection experiment to run alongside the token-budget fix, not a replacement for it — the token ceiling should be fixed regardless of which model is used.

---

## Acceptance criteria

- [ ] Re-run the exact repro request and confirm the Planner call succeeds with actual JSON output within the increased token budget, without needing the fallback path at all.
- [ ] If both attempts still somehow fail even with the raised ceiling, confirm the system surfaces `PlannerExhaustedError`'s honest message to the user instead of constructing a fake single-subtask plan.
- [ ] Add a unit test asserting the fallback plan path is never reachable in normal operation with the new token ceiling for a range of realistic compound requests (use the benchmark prompts from `cellix-benchmark-test-prompts.md` Tier 3-4 as fixtures).
- [ ] Log and monitor `completionTokens === reasoningTokens` as a specific alertable pattern going forward — this exact signature (full budget spent on reasoning, zero output) should be easy to spot in production logs before it becomes a support ticket.
- [ ] Total latency for this request class should drop from ~130s (two wasted 40-60s calls) to whatever one successful call takes — should be well under 30s even for a compound dashboard request.
