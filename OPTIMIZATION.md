# OPTIMIZATION.md — Speed & Token Efficiency

> Cellix v1 is feature-complete and launch-ready (M0–M4 closed). This document identifies specific, measurable performance and token-efficiency improvements — the difference between "works" and "works fast for every user every time."
>
> *Strategy: Measure → Identify → Optimize → Repeat. Ordered by impact-to-effort ratio.*

---

## 1. Current State & Bottlenecks

### Known Token Consumption
| Tier | Model | Budget | Typical Usage |
|---|---|---|---|
| **Tier 0** | — | ~0 tokens | Deterministic operations (delete sheet, freeze, etc.) |
| **Tier 1** | `MEDIUM` (gpt-5-mini) | ~1,500 tokens | Single-action requests (format, add column) |
| **Tier 2** | `HIGH` (gpt-5) | ~2,500 tokens | Generate → Verify loop (complex single-sheet) |
| **Tier 3** | `HIGH` (gpt-5) | Variable (see below) | Planner (1.5k) → Executor (2–8k) → Verifier (1.5k) — total ~5–11k per request |

### Context Optimization Today
- **Frontend**: TOON compression on `SheetContext` — reduces rows to ~40–60% of JSON size (captured in console on dev)
- **Backend**: `ContextCacheService` — reuses `promptContext` if TOON hash matches within 1h TTL (in-memory, not persisted)
- **Backend**: `buildCellixSystemPrompt()` is ~4–5k tokens static, regenerated per request (not cached across requests)

### Speed Bottlenecks
1. **Tier 3 latency**: 5–12s typical (Planner 0.5–1s + Executor 2–6s + Verifier 1–2s + network/parsing)
2. **Large workbook context**: TOON helps but a 10k-row sheet still ~10–15k tokens after compression
3. **Prompt rebuilding**: `formatWorkbookContextForPrompt()` called on *every* request, even when sheet unchanged
4. **Verification dry-run**: `virtualApply()` walks every action through shadow workbook for every request (no caching)
5. **Tool-use round trips**: Tier 3's `tool_request`/`tool_result` adds latency (3–4 HTTP requests per execution loop)

---

## 2. Quick Wins (1–2 hour payoff)

### 2.1 — Extend `ContextCacheService` to cross-request caching
**Status**: Proposed  
**Effort**: ~1 hour (backend only)  
**Impact**: 40–60% latency reduction for multi-turn requests on the same sheet

**Current state**: Cache TTL is 1h, but the cache key is `conversationId` — scoped to a single session. A user with 5 consecutive requests on the same workbook recomputes the full prompt context 5 times.

**Proposal**: 
1. Add a second cache layer keyed by `(workbookId, toonHash)` — the same TOON hash that already gates the current cache.
2. Extend TTL to 24h for this "stable workbook state" layer (new LRU layer, still capped at 100 entries).
3. On miss, populate from current `conversationId`-keyed cache; on hit, reuse the promptContext without recomputing.

**What this unblocks**: A user in ask/plan/action mode across 10 turns on a stable workbook goes from 10× prompt rebuilds to 1× (if they land the same tier) or 2–3× (if tier routing varies).

**Acceptance test**:
```
Same workbook, 3 consecutive Tier 1 requests:
- Turn 1: 800ms (fresh) = prompt build (400ms) + LLM (400ms)
- Turn 2: 500ms (cache hit) = LLM only
- Turn 3: 500ms (cache hit) = LLM only
Total: 1.8s vs. 2.4s (25% faster)
```

**Implementation**: `context-cache.service.ts` gains a second `stableCache` Map, keyed by `toonHash` (without conversationId), populated on every successful cache.set().

---

### 2.2 — Memoize `buildCellixSystemPrompt()` at the tier level
**Status**: Proposed  
**Effort**: ~30 min  
**Impact**: 3–5% token savings, negligible latency

**Current state**: The static prompt section (identity, rules, action types, etc.) is ~4–5k tokens, regenerated every request. Only the `formatWorkbookContextForPrompt(ctx)` part changes per request.

**Proposal**: 
1. Extract the static parts into constants: `CELLIX_SYSTEM_PROMPT_TIER_0`, `CELLIX_SYSTEM_PROMPT_TIER_1`, etc.
2. Assemble on first use, cache in a module-level Map keyed by tier.
3. Only recompute the per-request `ctx` part.

**Acceptance test**: 
```
CELLIX_SYSTEM_PROMPT_TIER_1 builds once, reused for all Tier 1 requests in the process lifetime.
Token count: static ~4.5k, per-context ~1–2k, total saved ~4.5k over 10 Tier 1 requests.
```

---

### 2.3 — Defer formulas from initial context to executor prompt only
**Status**: Proposed  
**Effort**: ~2 hours  
**Impact**: 10–15% token reduction for large formula sheets, no latency impact

**Current state**: `compressSheetForPrompt()` includes every formula's full text in `sheet.formulaSummary`. A sheet with 200 SUMIF formulas means 200× formula text in the router/planner context before the executor even starts.

**Proposal**:
1. Add a `defer: 'formulas'` flag to `SheetContext`.
2. In `compressSheetForPrompt()`, if `defer` includes 'formulas', replace full formula text with a `[Formula in {count} cells]` placeholder for Tier 0–1 use.
3. Planner/Executor always get full formula detail (they need it).
4. Router saves tokens (formulas not relevant for routing).

**Acceptance test**:
```
200-row sheet with formulas:
- Prompt size without deferral: ~8k tokens
- Prompt size with deferral: ~6.5k tokens
- Router → Planner tier escalation: unchanged
- Executor output: unchanged (gets full formulas)
```

---

### 2.4 — Cache `virtualApply()` results by (actions hash, shadowHash)
**Status**: Proposed  
**Effort**: ~1.5 hours  
**Impact**: 30–40% latency reduction on Tier 2 retries + verification

**Current state**: Tier 2's Verifier and Tier 3's retry logic both call `virtualApply()` → `generateDiff()` on the same action batch, computing identical results twice per request.

**Proposal**:
1. New `VirtualApplyCache` service (in-memory, same LRU pattern as `ContextCacheService`).
2. Key: `sha256(JSON.stringify(actions) + shadowBefore.hash)`.
3. After first `virtualApply()`, store `(shadowAfter, diff, verifierResult)`.
4. On cache hit, return the pre-computed tuple immediately.

**Acceptance test**:
```
Tier 2 request with retry (first attempt fails):
- Without cache: virtualApply() 2× (Verify + Retry) = 400ms total
- With cache: virtualApply() 1× + 1× cache hit = 200ms total
- Latency: 50% faster
```

---

## 3. Medium-Effort Wins (2–4 hours)

### 3.1 — Implement prompt caching via Claude Prompt Caching (if on Claude API)
**Status**: Proposed  
**Effort**: ~3 hours (backend + config)  
**Impact**: 40–50% cost reduction on large workbooks (if on Claude), negligible on OpenRouter

**Current state**: Using OpenRouter (model-agnostic), so built-in prompt caching isn't available. The conversation history is appended to every request, ballooning over time.

**Proposal** (conditional on adopting Claude API directly):
1. Separate the prompt into cached and uncached sections.
2. Mark the static system prompt + workbook context as a cache block.
3. Only the current user turn is sent fresh each time.
4. OpenRouter overhead: no change (caching not exposed at their API level).
5. Claude API direct: 40–50% cost savings on the cached portion after first request.

**Acceptance test**:
```
If migrating to Claude API directly:
- Request 1: 8k tokens (all fresh)
- Requests 2–5 on same workbook: ~2k tokens (cached block reused)
- Cost: 8k + 2k×4 = 16k vs. 8k×5 = 40k (60% savings)
```

**Blocker**: Requires switching from OpenRouter to Claude API directly (a product/cost decision, not pure engineering).

---

### 3.2 — Batch verification checks into a single LLM call
**Status**: Proposed  
**Effort**: ~3 hours  
**Impact**: 20–25% latency reduction on Tier 2, no token change

**Current state**: `Tier2GenerateVerifyService` calls `VerifierAgent` with four separate checkers (completeness, formatting, semantic-formula, occupancy), each potentially triggering LLM calls. Each checker's result chains into the next.

**Proposal**:
1. Build a single "batch verification prompt" that asks for all four checks in one LLM call.
2. Parse the response into structured results per check type.
3. If any check fails, emit a `retry` instruction inline.
4. Reduces from ~4 LLM calls → 1–2 (only retry if needed).

**Acceptance test**:
```
Tier 2 request with multi-check verification:
- Without batching: 4 sequential verifier calls = ~2.5s (Executor 1.5s + Verifier 1s)
- With batching: 1 verification call = ~1.2s (Executor 1.5s + Verifier 0.5s) + retry if needed
- Latency: ~50% faster when no retry, same if retry needed
```

---

### 3.3 — Compress conversation history with summarization
**Status**: Proposed  
**Effort**: ~2.5 hours  
**Impact**: 15–20% token reduction on long conversations

**Current state**: Tier 3's conversation context carries every prior turn's full text. A 10-turn conversation means ~20–30 SSE events worth of text in the Planner's context.

**Proposal**:
1. Add a `ConversationSummaryService` that, after every 5 turns, produces a compact digest: *"User has made 3 edits to regions column (widened from 5 to 8 chars), added 2 formulas, and rejected 1 format change."*
2. Replace the oldest 5 turns with the digest in the context.
3. Keep the 2–3 most recent turns in full (needed for nuance).

**Acceptance test**:
```
10-turn conversation:
- Without summarization: ~15k tokens (all turns verbatim)
- With summarization: ~10k tokens (oldest 5 turns → 1 digest, last 5 full)
- Token reduction: ~33%
```

---

## 4. Longer-Term Optimizations (4+ hours, bigger changes)

### 4.1 — Streaming partial results from Executor
**Status**: Proposed  
**Effort**: ~4–5 hours  
**Impact**: Perceived latency cut by 30–40% (total time unchanged, but user sees progress sooner)

**Current state**: Executor runs to completion, then emits a single `actions` SSE event. User sees nothing until the full response is ready (1–3 seconds of silence).

**Proposal**:
1. Executor emits partial `actions` events as each subtask completes.
2. Frontend batches these into the preview (accept/reject still works on the full final result).
3. User sees "formatting...", "formulas added...", "validation..." as progress unfolds.

**Acceptance test**:
```
5-subtask Executor run:
- Without streaming: 0s … 0s … 0s … 3s (full result)
- With streaming: 0.6s (subtask 1) … 1.2s (subtask 2) … 1.8s (subtask 3) … 3s (full)
- Perceived speed: much faster (user engaged, not waiting)
```

---

### 4.2 — Reduce shadowWorkbook granularity for large sheets
**Status**: Proposed  
**Effort**: ~3–4 hours  
**Impact**: 30–50% memory reduction, negligible latency

**Current state**: `ShadowWorkbook` holds a cell-level map for every value/formula in the workbook. A 10k-row, 50-column sheet = 500k cell objects in memory.

**Proposal**:
1. For verification, use a row-level or column-level granularity instead (only track *which* rows/columns changed, not every cell value).
2. Only use full cell-level shadow when a specific verification check needs it (formula references, overwrite occupancy).
3. Lazy-load the full shadow on demand.

**Acceptance test**:
```
Large sheet shadow memory:
- Current: 500k cells × ~100 bytes/cell = ~50MB
- Optimized: 500 column-change records × ~1kb = ~0.5MB + lazy loads on demand
- Memory: 99% reduction (if lazy loads aren't triggered)
```

---

### 4.3 — Parallelize Executor subtasks (architectural change)
**Status**: Proposed  
**Effort**: ~4–6 hours  
**Impact**: 40–50% latency reduction on independent multi-subtask executions

**Current state**: `AgenticLoopService` runs Executor subtasks sequentially (each subtask waits for the prior one to finish). If subtask 1 is formatting (fast, 0.5s) and subtask 2 is formulas (slow, 2.5s), total is 3s because they run 1 → 2.

**Proposal**:
1. Analyze `dependsOn` edges in the subtask graph.
2. Identify independent subtasks (no `dependsOn` relationship).
3. Spawn them in parallel via Promise.all().
4. Sequence only truly dependent ones (e.g., formulas after structure creation).

**Acceptance test**:
```
5-subtask batch, dependency graph:
Subtask 1 (create sheet, 0.5s)
  → Subtask 2 (add columns, 0.3s)
  → Subtask 3 (populate data, 1.2s) [independent of 2]
Subtask 4 (formulas, 2.5s) [depends on 3]
Subtask 5 (format, 0.5s) [independent]

Sequential: 1 → 2 → (3 || 5) → 4 = 0.5 + 0.3 + max(1.2, 0.5) + 2.5 = 4.8s
Parallel: max(1→2→3→4, 5) = max(4.5, 0.5) = 4.5s
Latency: ~6% faster (limited by dependency chain, not raw parallelization)

But on a batch where subtasks 2–4 are independent of 1:
Sequential: 1 + 2 + 3 + 4 = 4.5s
Parallel: 1 + max(2, 3, 4) = 1 + 2.5 = 3.5s = 23% faster
```

---

## 5. Measurement & Monitoring

### Add performance telemetry (low-effort, high-value)
```typescript
// New: AuditController endpoint
GET /audit/stats/performance?from=&to=
Response: {
  "avg_latency_by_tier": { "Tier1": 480, "Tier2": 2100, "Tier3": 5400 },
  "p50_p95_p99": { "Tier1": [400, 600, 800], "Tier2": [1800, 3200, 4500], ... },
  "token_usage": { "avg_by_tier": { "Tier1": 1200, "Tier2": 2500 }, "histogram": ... },
  "cache_hit_rates": { "context_cache": 0.62, "virtual_apply_cache": 0.45 },
  "error_rates": { "by_route": { "write": 0.008, "ask": 0.002 } }
}
```

**Acceptance test**: Dashboard `Performance` tab shows these charts for the selected date range, updating live.

---

## 6. Proposed Task List

| # | Task | Tier | Status |
|---|---|---|---|
| 68 | Cross-request context cache (workbookId + toonHash) | Quick Win | — |
| 69 | Memoize static system prompt by tier | Quick Win | — |
| 70 | Defer formulas from router context | Quick Win | — |
| 71 | virtualApply() result caching (by action hash) | Quick Win | — |
| 72 | Batch verification checks into one LLM call | Medium | — |
| 73 | Conversation history summarization after 5 turns | Medium | — |
| 74 | Performance telemetry endpoint + Dashboard view | Medium | — |
| 75 | Streaming partial results from Executor (optional, UX-only) | Longer-term | — |
| 76 | Shadow workbook lazy-load optimization | Longer-term | — |
| 77 | Parallel subtask execution (if DAG analysis is sound) | Longer-term | — |

---

## 7. Recommendation

**Start with #68–71** (4 quick wins, ~4 hours total).  
These are low-risk, high-confidence, and give:
- 25–40% latency improvement on multi-turn sessions
- 3–5% token savings (negligible cost benefit, but easy)
- Zero product behavior changes

**Then tackle #72–74** (medium tier, higher complexity, ~8 hours).  
These unlock a second wave of efficiency:
- 20–30% additional latency improvement
- Observability dashboard for ongoing monitoring

**Reserve #75–77** for after measuring real-world usage against the dashboard. Parallelization and lazy-loading are high-touch architectural changes best validated against actual bottleneck data, not speculation.

---

*Last updated: August 21, 2026 — ready for implementation prioritization.*
