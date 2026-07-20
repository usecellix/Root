# Complexity tiering rollout (Spec 08)

## Feature flag

`ENABLE_COMPLEXITY_TIERING` controls write-route tier dispatch:

| Value | Behavior |
|---|---|
| `off` | Always execute via Tier 3 orchestrator. **Production default** when unset. |
| `shadow` | Classify + emit `TierDecisionLog` (`classifiedTier`, `shadowed: true`), still always Tier 3. |
| `tier01` | Enable Tier 0 + Tier 1 handlers only; Tier 2+ stay on orchestrator. |
| `full` / `on` | Enable Tier 0–2 handlers (current local/test default when unset). |

Local / CI should set `ENABLE_COMPLEXITY_TIERING=full` (Jest `NODE_ENV=test` already defaults to `full`).

## Shadow-mode review checklist (Steps 2–3)

Before flipping any tier on in production, export ~1–2 weeks of `tier_decision` logs and confirm:

1. **Regex coverage** — share of `matchedBy=regex` vs `llm-fallback` is high (target >80%).
2. **Spot-check sample** — for each tier 0/1/2/3, manually review ~20 classifications against human expectation.
3. **Compound misses** — zero multi-step requests wrongly classified as Tier 0/1/2 (highest-risk failure mode).
4. Document findings in the release PR before changing the flag from `shadow` → `tier01`.

## Gradual flip

1. Production: `off` → ship code
2. `shadow` for 1–2 weeks → review logs
3. `tier01` → monitor errors / reject rates for cosmetic actions
4. `full` → monitor Tier 2 verifier pass rate vs Tier-3-only baseline
5. Remove the flag only after one full production cycle with no regression

## Domain tools gate (process control)

Domain tools (`src/domain-tools/`) remain **unwired** into ExecutorAgent tool-calling until each tool has explicit CA/domain-expert sign-off. Scaffolding (Spec 06) must not be user-facing as compliance-correct output.

## Non-write routes

`route=shortcut | data | export | ask` behavior is unchanged by this flag — tiering only gates `handleWriteRoute`.
