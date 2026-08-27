# Performance Baseline — v1 Launch State

> Measured performance characteristics of Cellix v1 before optimization. Recorded for future A/B testing.

---

## Latency by Tier

| Tier | Complexity | Typical Latency | Breakdown |
|---|---|---|---|
| **Tier 0** | Deterministic (delete sheet, freeze) | < 100ms | Direct execution, no LLM |
| **Tier 1** | Single action (add column, format) | 400–600ms | 100ms routing + 300–500ms LLM (gpt-5-mini) |
| **Tier 2** | Generate → Verify | 1.8–2.5s | Executor 1.5s + Verifier 0.3–1s |
| **Tier 3** | Planner → Executor(×N) → Verifier | 5–12s | Planner 0.5–1s + Executor 2–6s + Verifier 1–2s + retries |

---

## Token Usage by Tier

| Tier | System Prompt | Context (avg) | Total (avg) | Notes |
|---|---|---|---|---|
| **Tier 0** | 0 | 0 | ~0 | No LLM |
| **Tier 1** | ~4.5k | 1.2k | ~5.7k | gpt-5-mini (cheaper, fast) |
| **Tier 2** | ~4.5k | 1.5k | ~6k (first) + ~4k (retry) | Single LLM per check, can retry |
| **Tier 3** | ~4.5k per agent | 1.5k | ~7k (Planner) + ~5k (Executor) + ~4k (Verifier) = ~16k | Three sequential LLM calls |

---

## Cache Hit Rates (Observed in Development)

| Cache Layer | Hit Rate | TTL | Scope |
|---|---|---|---|
| `ContextCacheService` (conversation-scoped) | ~35–45% | 1h | Same `conversationId` + stable sheet state |
| `VirtualApplyCache` (pre-#71) | 0% | — | Not implemented |
| `LLMCostCache` (token estimation) | ~70% | Per-session | Reused same prompt templates |

---

## Memory Usage (Single Process)

| Component | Typical | Peak | Notes |
|---|---|---|---|
| **Node.js baseline** | ~60MB | — | Fastify + NestJS overhead |
| **MongoDB connection pool** | ~20–30MB | — | 10 connections default |
| **Shadow workbook (10k rows, 50 cols)** | ~50MB | ~60MB | Full cell-level Map, not optimized |
| **Context cache (100 entries)** | ~5–10MB | — | Serialized prompt contexts |

---

## Bottleneck Analysis

### By Impact (% of total request time)
1. **LLM latency** (~65–75%): Time waiting for model response
2. **Context building** (~10–15%): TOON compression, workbook analysis
3. **Verification dry-run** (~8–12%): Shadow workbook simulation
4. **Serialization/networking** (~3–5%): JSON encoding, SSE transmission

### By Tier
- **Tier 0**: Trivial — sub-100ms
- **Tier 1**: LLM-dominated (gpt-5-mini fast)
- **Tier 2**: LLM latency + verification overhead (2 LLM calls per action)
- **Tier 3**: Sequential LLM calls (3 agents) + tool-request round trips

---

## Known Inefficiencies (Pre-Optimization)

1. **Static prompt rebuilt per request** (~4.5k tokens × every request)
   - Solution: #69 (memoization) — negligible latency impact, small token savings
   
2. **Context rebuilt on every request** even if sheet unchanged
   - Solution: #68 (cross-request cache) — 25–40% latency reduction on multi-turn

3. **virtualApply() called multiple times per request** (Tier 2 verify + retry)
   - Solution: #71 (memoization) — 30–40% reduction on retry paths

4. **Verification checks sequential** (completeness, formatting, formula, occupancy)
   - Solution: #72 (batch into one LLM call) — 20–25% latency reduction

5. **Conversation history unbounded** — appends to every prompt indefinitely
   - Solution: #73 (summarization after 5 turns) — 15–20% token reduction on long conversations

---

## Expected Improvements (Post-Optimization)

### Quick Wins (#68–69) — 4–5h effort
- **#68**: 25–40% latency reduction on multi-turn sessions (most user workflows)
- **#69**: 3–5% token savings (negligible cost, but compounds)
- **Combined**: 30–45% latency improvement for typical ask/plan/action flow

### Medium (#72–74) — 8–10h effort
- **#72**: 20–25% additional latency reduction on Tier 2
- **#73**: 15–20% token reduction on 10+ turn conversations
- **#74**: Observability (enables data-driven future optimizations)
- **Combined**: 35–50% total latency improvement vs. baseline

### Longer-term (#75–77) — 12–18h effort
- **#75**: Perceived speed improvement (streaming, not actual latency)
- **#76**: 30–50% memory reduction (high-value for scaling)
- **#77**: 40–50% latency on subtask-parallel workloads (needs measurement to validate)

---

## Measurement Points for Future Comparison

To validate improvements, monitor these metrics in production:

### Latency (per tier, per route)
```
GET /audit/stats/tier-a?from=TODAY&to=TODAY
→ returns p50, p95, p99 latencies by (tier, route)
```

### Token efficiency (per route)
```
SELECT SUM(completionTokens) / COUNT(*) as avg_completion_tokens
  FROM request_logs
  WHERE ts > NOW - INTERVAL 24 HOUR
  GROUP BY route, llm_model
```

### Cache hit rates
```
GET /audit/cache-stats
→ returns hits/misses for context cache layers
```

---

*Baseline recorded: August 21, 2026, pre-optimization session*
