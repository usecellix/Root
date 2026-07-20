# Cellix Pipeline Upgrade 2026 — Overview

**Source docs this upgrade implements:**
- `PIPELINE-tiering-and-catalog-classification.md` (complexity-gated dispatcher)
- `CELLIX-Technical-Architecture-Guide.md` (six-layer architecture: mode selector, domain-tool layer, citation/provenance)

**Reads before implementing:** `CELLIX_TECHNICAL_DOCUMENTATION.md` (current system) and `cellix-architecture-diagrams.html` (current flows) — this upgrade is **additive**, not a rewrite. Do not modify `PlannerAgent`, `ExecutorAgent`, or `VerifierAgent` signatures until Phase 1 is merged and stable.

---

## What's changing, in one sentence each

1. **Tiering (Phase 1):** Every `route=write` request currently goes through Planner→Executor→Verifier regardless of complexity. A new complexity classifier gates requests into Tier 0 (no LLM) / Tier 1 (1 LLM call) / Tier 2 (Generate→Verify, 2 calls) / Tier 3 (existing full pipeline).
2. **Mode selector (Phase 2):** Frontend gets an explicit `Ask | Plan | Act` selector so the CA can request a plan preview without execution, matching Shortcut's Plan Mode.
3. **Domain-tool layer (Phase 3, scaffolding only):** GST/ITC/TDS/bank-recon/Ind-AS/trial-balance become deterministic, versioned, unit-tested functions the Executor calls as tools — not LLM-generated arithmetic. This phase ships **interfaces and stubs**, not full compliance logic (that's a separate, longer engagement).
4. **Citation/provenance layer (Phase 4):** Every cell written by Tier 2/3 carries a `sourceRef` back to the originating document/row, extending the existing `ChangeSet` model rather than replacing it.

---

## Why this order (do not reorder)

```
Phase 1 (Tiering)          → de-risks latency + false-Planner-clarification bugs, changes nothing structurally risky
Phase 2 (Mode selector)    → pure UI/routing addition, depends on Phase 1's tier output being visible to the frontend
Phase 3 (Domain scaffolding) → new isolated module, no dependency on 1/2, but should slot into Tier 3's tool-call contract
Phase 4 (Citation layer)   → extends ChangeSet/audit schema; touches Phase 1 and Phase 3 output shapes, so it goes last
```

Rationale for Phase 1 first (from the tiering doc): ~85% of write traffic is Tier 0-2 by catalog share, currently forced through 3 LLM calls (3–8s) when it could be <2s or under 500ms. Fixing this before adding new features (mode selector, domain tools) means those features are built on a pipeline that already distinguishes "one formula" from "a five-step reconciliation."

---

## File map for this upgrade

| Spec file | Phase | Touches |
|---|---|---|
| `01_complexity_classifier.md` | 1 | `cellix_backend/src/excel-ai/services/llm-router.service.ts`, new `utils/complexity-classifier.util.ts` |
| `02_tier0_tier1_handlers.md` | 1 | new `services/tier0-direct.service.ts`, `services/tier1-single-action.service.ts` |
| `03_tier2_generate_verify.md` | 1 | new `services/tier2-generate-verify.service.ts`, reuses `ExecutorAgent`, `VerifierAgent` |
| `04_tier3_routing_integration.md` | 1 | `conversation.service.ts` dispatch, `agents/orchestrator.ts` (routing only, not internals) |
| `05_mode_selector_ask_plan_act.md` | 2 | frontend `ConversationPanel`, `useConversation`, backend `conversation.controller.ts` |
| `06_domain_tool_layer_scaffolding.md` | 3 | new `cellix_backend/src/domain-tools/` module |
| `07_citation_provenance_layer.md` | 4 | `audit/` module, `types/ChangeSet`, frontend `ChangeHistoryPanel` |
| `08_migration_plan_and_tests.md` | all | rollout order, instrumentation, test files per phase |

---

## Non-negotiable constraints carried over from both source docs

- **Never emit hard-coded literals where a formula is expected.** Enforce as a system-prompt rule AND a post-generation lint rule (`isHardcoded` check) — not just prompt-level trust.
- **One writer at a time.** No concurrent agents mutating the live workbook via Office.js.
- **Verification is separated from execution** — different pass, and for Tier 2/3, ideally a different prompt path so it isn't "the same model marking its own homework."
- **Domain arithmetic is plain, versioned, unit-tested code — never LLM-computed at runtime.** This is the single most load-bearing constraint in Phase 3.
- **Deterministic checks gate before any LLM verifier call** (circular refs, hardcode lint, debit=credit, etc.) — cheap and fast, don't pay LLM latency to catch what a library catches in milliseconds.

---

## How to use these specs in Cursor

Each numbered file is self-contained: paste it into a Cursor chat/composer session referencing the actual files at the paths listed in its "Files touched" section, and ask Cursor to implement against the interfaces given. Work through them in order 01 → 08. Each file's "Acceptance criteria" section doubles as the PR checklist.
