# 08 — Migration Plan & Tests

**Phase:** all (rollout order, instrumentation, and the test matrix for 01–07)
**Files touched:**
- `cellix_backend/test/` (new + extended spec files, listed below)
- `cellix_backend/src/excel-ai/utils/structured-logger.ts` (already extended in `04`)
- CI config (add new test suites to the pipeline)

---

## Rollout order (do not parallelize across phases — each depends on the previous being stable)

```
Step 1 — Ship 01 + 02 + 03 + 04 (Phase 1: Tiering) behind a feature flag
         `ENABLE_COMPLEXITY_TIERING`, default OFF in production.

Step 2 — Shadow mode: run classifyComplexity() on every real write request,
         LOG the tier decision, but still route everything through the
         existing Tier-3-only path regardless of what the classifier says.
         Collect 1-2 weeks of TierDecisionLog data.

Step 3 — Review shadow logs:
         a) Confirm regex-layer coverage (% of requests matched by regex vs.
            fell through to llm-fallback) is high (>80% target, per source
            doc's stated 85% Tier 0-2 traffic share).
         b) Spot-check a sample of each tier's classification against what a
            human would expect — this is the main place classifier bugs surface.
         c) Confirm zero compound-signal misses (a multi-step request wrongly
            classified as Tier 0/1/2 is the highest-risk failure mode here).

Step 4 — Flip ENABLE_COMPLEXITY_TIERING on for Tier 0 and Tier 1 only
         (lowest risk — cosmetic/reversible actions). Monitor error rates and
         undo-click rates (if instrumented) for a regression signal.

Step 5 — Flip on Tier 2. Monitor VerifierAgent pass/fail rates specifically —
         a rise in verifier failures vs. the old Tier-3-only baseline would
         indicate the Planner was silently correcting Executor mistakes in a
         way Tier 2's leaner path doesn't.

Step 6 — Remove the feature flag once Tier 0-2 have run in production for a
         full cycle with no regressions. Tier 3 was never behind the flag.

Step 7 — Phase 2 (mode selector): ship independently once Phase 1 is stable,
         since Plan Mode's Tier 2/3 branches depend on tier routing existing.

Step 8 — Phase 3 (domain tools): ship as scaffolding only, no user-facing
         change, can be developed in parallel with Phase 2 but should not be
         wired into ExecutorAgent's tool-calling until each tool has CA sign-off.

Step 9 — Phase 4 (citations): ship last, once Phase 3 tools produce real
         SourceRefs to display — building the UI against Phase 3 stubs risks
         designing around placeholder data shapes that change.
```

---

## Test matrix

### Unit tests (new)

| File | Covers |
|---|---|
| `test/complexity-classifier.spec.ts` | `classifyComplexity()` against the full catalog fixture set (below), compound-signal priority, numeric/financial escalation |
| `test/tier0-direct.service.spec.ts` | Explicit-target resolution, implicit-target downgrade to Tier 1 |
| `test/tier1-single-action.service.spec.ts` | Exactly-one-LLM-call assertion, numeric find-replace never reaches this service |
| `test/tier2-generate-verify.service.spec.ts` | No `PlannerAgent.plan()` call, verifier always called, hardcode-lint blocks before LLM verify, `shouldSkipVerifier` guard throws in dev/test if misused |
| `test/domain-tools/*.spec.ts` | Each tool's `.spec.ts` per `06`'s acceptance criteria — signature compliance even for stubs |
| `test/audit-sourcerefs.spec.ts` | `CellChange.sourceRefs` backward compatibility, domain-tool writes always populate `sourceRefs` |

### Integration/e2e tests (extend existing)

| File | Change |
|---|---|
| `test/orchestrator.e2e.spec.ts` | Must still pass unmodified (Tier 3 regression guard) |
| `test/conversation.e2e.spec.ts` | Add cases for each tier's full request→SSE-response round trip |
| `test/audit-export.spec.ts` | Extend to assert exported records include `sourceRefs`/`exceptionFlags` |
| new `test/mode-selector.e2e.spec.ts` | `ask`/`plan`/`act` mode branching, Plan Mode never creates a `ChangeSet` |

### Fixture set — catalog-derived

Build `test/fixtures/catalog-classification.json` from the existing use-case catalog (`cellix-basic-usecases.html` if that's the ~180-item catalog referenced in the tiering doc), shaped as:

```json
[
  { "message": "bold cells A1 to C1", "expectedTier": 0, "expectedActionHint": "CELL_FORMAT" },
  { "message": "sort column B descending", "expectedTier": 1, "expectedActionHint": "SORT_OR_FILTER" },
  { "message": "calculate GST at 18% for column D", "expectedTier": 2, "expectedActionHint": "FORMULA_GEN" },
  { "message": "reconcile the bank statement against the ledger and flag mismatches", "expectedTier": 3, "expectedActionHint": null }
]
```

Run every entry through `classifyComplexity()` and assert `tier`/`actionHint` match — this single fixture file is the regression guard for the entire tiering system and should be extended every time a misclassification is found in production logs (shadow mode or post-launch).

---

## Instrumentation dashboard (recommended, not blocking)

Track over time, per tier:
- Request volume share (validate the ~85% Tier 0-2 assumption from the source doc against real usage)
- p50/p95 latency (validate against the doc's stated latency budgets: Tier 0 <500ms, Tier 1 <2s, Tier 2 800ms–2s, Tier 3 3–8s)
- Verifier pass rate (Tier 2 and Tier 3 separately)
- Regex-match rate vs. llm-fallback rate (classifier coverage health)
- Undo/reject rate per tier (proxy for correctness, if not already tracked)

## Final acceptance criteria for the whole upgrade

- [ ] All acceptance criteria in `01` through `07` are individually satisfied.
- [ ] Shadow-mode data (Step 2-3 above) reviewed and documented before any tier is flipped on in production.
- [ ] Feature flag `ENABLE_COMPLEXITY_TIERING` removed only after Tier 0-2 have run one full production cycle with no regression in verifier pass rate or undo/reject rate versus the pre-upgrade Tier-3-only baseline.
- [ ] No change to `route=shortcut | data | export | ask` behavior anywhere across all four phases.
- [ ] Domain tools (`06`) remain unwired into any user-facing execution path until each has explicit CA/domain-expert sign-off — this gate is a process control, not a code control, so document it in the PR description for `06`'s merge.
