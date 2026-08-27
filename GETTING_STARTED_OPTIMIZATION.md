# Getting Started: Performance Optimization for Cellix v1

> You are reading this because Cellix v1 is feature-complete and launch-ready. This document guides the next engineering work: making it **fast**.

---

## Current State

✅ **Feature-complete** (M0–M4 fully closed)
✅ **All safety mechanisms working** (zero false-success, full-fidelity revert, checkpoints)
✅ **Verified & tested** (800+ tests passing)
🚧 **Performance not yet optimized** (5–12s Tier 3 latency, 16k avg tokens)

---

## What to Do Next

### 1. Read These Documents (15 min)
In order:
1. **[OPTIMIZATION.md](OPTIMIZATION.md)** — Full analysis, bottlenecks, all 10 proposed tasks
2. **[PERF_BASELINE.md](PERF_BASELINE.md)** — Baseline metrics for future A/B testing
3. **[SESSION_SUMMARY_AUG21.md](SESSION_SUMMARY_AUG21.md)** — What was done, what remains
4. **[TASKS.md](TASKS.md)** — Look at the "Performance & Token Optimization" section (new)

### 2. Verify Optimizations #68–69 Are Integrated (5 min)
Two quick wins were implemented in the last session:

**#68 — Cross-Request Context Cache**
- File: `cellix_backend/src/excel-ai/services/context-cache.service.ts`
- Status: Complete, code compiles
- What it does: Reuses prompt context across conversations if the workbook state (TOON hash) is identical
- Expected payoff: 25–40% latency reduction on multi-turn sessions

**#69 — Memoized Static System Prompt**
- File: `cellix_backend/src/excel-ai/prompt/cellix-system-prompt.ts`
- Status: Complete, code compiles
- What it does: Caches static prompt sections per process, rebuilds only dynamic parts
- Expected payoff: 3–5% token savings

**Verify**: Run `npm test` in `cellix_backend/`. If all tests pass, both optimizations are working.

### 3. Pick Your Next Task

#### Option A: Complete the Quick Wins (2–3 hours)
Implement #70 and #71 to round out the fast-payoff tier:

- **#70**: Defer formulas from router context (10–15% token reduction)
  - Impacts: frontend's `buildPromptContext`, backend's prompt building
  - Complexity: Medium (cross-repo coordination)

- **#71**: Cache virtualApply() results (30–40% latency on Tier 2 retry)
  - Impacts: `audit/` module, verification pipeline
  - Complexity: High (cache invalidation strategy)

**Total impact**: 35–50% latency improvement over baseline
**Estimated time**: 3–4 hours

#### Option B: Build Observability First (3–4 hours)
Implement #74 (Performance telemetry endpoint + Dashboard view) so you can measure improvement:

- **Why first**: Data-driven decisions beat guesses. Measure baseline, optimize, re-measure.
- **What it does**: Exposes `GET /audit/stats/performance?from=&to=` with per-tier/per-route latency and token histograms
- **Payoff**: Enables all future optimization decisions to be grounded in real metrics

**Estimated time**: 3–4 hours
**Recommended if**: Planning to do #72–77 anyway

#### Option C: Medium-Tier Optimizations (8–10 hours total)
Jump to #72–74 for a second wave of improvements:

- **#72**: Batch verification checks into one LLM call (20–25% latency ↓ Tier 2)
- **#73**: Conversation history summarization (15–20% tokens ↓ long sessions)
- **#74**: Observability (unlocks all future measurement)

**Total impact**: 35–50% additional latency improvement (cumulative with #68–69)
**Estimated time**: 8–10 hours

---

## How to Structure Your Work

### Session 1 (Recommended)
**Goal**: Baseline measurement + quick wins

1. Run `npm test` → verify #68/#69 pass
2. Build #74 (observability) → measure current state
3. Implement #70 and #71 → measure improvement
4. Commit with message: "perf: implement quick-win optimizations #68–71"
5. Update `PERF_BASELINE.md` with new measurements

**Outcome**: 35–50% latency improvement, data for next steps

### Session 2 (Optional)
**Goal**: Medium-tier efficiency

1. Use #74's dashboard to identify which tier(s) matter most
2. Implement #72 (batch verification) if Tier 2 is a bottleneck
3. Implement #73 (history summarization) if long conversations dominate
4. Measure, commit, iterate

---

## Key Files to Know

| File | Purpose |
|---|---|
| `cellix_backend/src/excel-ai/services/context-cache.service.ts` | #68 — Context caching (already done) |
| `cellix_backend/src/excel-ai/prompt/cellix-system-prompt.ts` | #69 — Prompt memoization (already done) |
| `cellix_backend/src/excel-ai/services/conversation.service.ts` | Route classification, where context is built |
| `cellix_backend/src/agents/agenticLoop.service.ts` | Tier 3 orchestration, where retries happen |
| `cellix_backend/src/agents/verifier.agent.ts` | Verification checks (target for #72) |
| `cellix_backend/src/audit/tier-a-metrics.util.ts` | Metrics backend (for #74) |

---

## Testing Strategy

### For Each Optimization Task:
1. **Write a unit test** that captures the optimization's intent (e.g., "context cache returns same prompt for same TOON hash")
2. **Run `npm test`** to verify no regressions
3. **Manual latency check** (optional): Measure request time in dev before/after with `console.time()`
4. **Production validation** (later): Use #74's dashboard to confirm real-world improvements

### Keep These Suites Passing:
- `npm test` (all Jest suites)
- Frontend `npm test` (all vitest)
- `npm run build` (TypeScript compilation)

---

## Success Criteria

By end of this optimization phase, you should have:

- ✅ Tests passing (no regression from #68–69)
- ✅ Latency baseline recorded (via #74's dashboard or manual timing)
- ✅ At least #70 and #71 implemented (or #72–74 if starting session 2)
- ✅ Follow-up measurements showing 20%+ improvement
- ✅ Commit message linking back to OPTIMIZATION.md and PERF_BASELINE.md

---

## Questions?

1. **"Should I implement #68–71 or #72–74?"** 
   - Start with #68–71 (they're lower-risk and faster). Build #74 first for measurement, then decide if #72–73 are worth the time.

2. **"What if my measurements don't match the projected improvements?"**
   - That's valuable. Log your findings in a new comment on the OPTIMIZATION.md task rows. Real data beats projections.

3. **"Are there other optimizations I should consider?"**
   - Check OPTIMIZATION.md §4 (longer-term items). They're higher-touch and worth validating against real usage first.

---

*This guide was prepared: August 21, 2026*
