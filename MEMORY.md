This index tracks cross-session memories for Cellix development.

## Foundation & Context
- [VISION.md](VISION.md) — Product north star and use cases
- [PRD.md](PRD.md) — Requirements, personas, success metrics, competitive landscape
- [ARCHITECTURE.md](ARCHITECTURE.md) — System design, key decisions, tradeoffs
- [CLAUDE.md](CLAUDE.md) — Codebase structure and command reference
- [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) — MongoDB collections and field contracts
- [CODEBASE_ANALYSIS.md](CODEBASE_ANALYSIS.md) — Module-by-module audit and known gaps

## Implementation
- [TASKS.md](TASKS.md) — Numbered backlog with sequential dependencies (includes new Optimization section)

## Performance & Optimization (Post-Launch)
- [OPTIMIZATION.md](OPTIMIZATION.md) — Full bottleneck analysis and 10 scoped optimization tasks
- [PERF_BASELINE.md](PERF_BASELINE.md) — v1 launch-state performance metrics and measurement points
- [GETTING_STARTED_OPTIMIZATION.md](GETTING_STARTED_OPTIMIZATION.md) — How-to guide for the next engineering phase

## Session Summaries
- [SESSION_SUMMARY_AUG21.md](SESSION_SUMMARY_AUG21.md) — What was done Aug 20–21, status of all work

## Key insights from latest session (Aug 20–21, 2026)
- **M0–M4 fully closed**, M6–M7 design spikes done — product is **feature-complete and launch-ready**
- **M5 backend done**, only Dashboard UI deferred (no correctness blocking)
- **Real bottlenecks identified**: context recomputation (40–60% of multi-turn latency), virtualApply() caching, prompt memoization
- **Quick wins implemented**: #68 (cross-request cache) + #69 (prompt memoization) — code complete, tests running
- **Optimization roadmap created**: 10 tasks prioritized (quick wins → medium → longer-term), 25–50% latency improvement projected
