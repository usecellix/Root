# CODEBASE_ANALYSIS.md — Cellix

> Read-only analysis. No code was modified to produce this document.
> Cross-references `PRD.md` (drafted earlier this session) and `VISION.md`. Where this analysis found the codebase to diverge from what those documents assume, the divergence is called out explicitly rather than silently reconciled.
>
> *Compiled: August 17, 2026, via direct inspection of `cellix_backend`, `frontend`, `Dashboard`, `shared`, and `specs/` plus three parallel deep-dive passes over the backend, frontend, and Dashboard trees.*

---

## 1. Current Architecture

### 1.1 Physical repo topology — not a plain monorepo

The four sub-projects named in `CLAUDE.md` are **not uniformly tracked**. This matters enough to state before anything else, because it changes how "the codebase" should be reasoned about:

| Path | How it's actually tracked | Consequence |
|---|---|---|
| `cellix_backend/` | Git **gitlink** (mode `160000`) pointing at commit `c37c77a` — but **no `.gitmodules` file exists**. `git submodule status` fails: `fatal: no submodule mapping found`. | The outer repo cannot resolve or clone this directory's contents through normal submodule tooling. It has its own local commit history and substantial uncommitted changes (~20 modified files, all in `src/agents/`). |
| `frontend/` | Same pattern — gitlink at `21051a0c`, no `.gitmodules`. | Same consequence. ~15 modified files, all in `src/engine/`, `src/context/`, `src/components/ConversationPanel/`. |
| `Dashboard/` | **Not a gitlink at all.** The outer repo tracks its files as ordinary blobs (mode `100644`). But `Dashboard/.git` exists independently, with its own commit history (`b1c6e38` → `f6a2a8a`) and its own GitHub remote (`usecellix/Analytic-Dashboard.git`). | Two fully disconnected histories track the same working-tree files. A commit run from the repo root and a commit run from inside `Dashboard/` go to two different places, silently. See §3.1 — this is the single highest-severity finding in this report. |
| `shared/` | Normal tracked files in the outer repo. | No issue. |

Verified directly (`git ls-files -s`, `.gitmodules` absent, `Dashboard/.git` inspected — commands and output reproduced in §3.1).

### 1.2 Backend — `cellix_backend/`

NestJS 11 + Fastify, TypeScript, Jest. Key dependencies: `@nestjs/mongoose` + `mongoose` (MongoDB), `better-auth` (auth), `@openrouter/sdk` (LLM abstraction — matches `CLAUDE.md`'s `OPENROUTER_*` env vars), `@toon-format-cjs/toon` (the TOON context-compression format), `nestjs-pino` (structured logging), `@nestjs/throttler`, `@nestjs/terminus` (health checks).

`src/` — 14 modules:
- `excel-ai/` — the core conversation pipeline: `conversation.service.ts` (dispatch), `services/llm-router.service.ts`, `tier0-direct.service.ts`, `tier1-single-action.service.ts`, `tier2-generate-verify.service.ts`, plus data-query, find-export, intent-classifier, sheet-analyzer, context-cache, and the OpenRouter client wrapper.
- `agents/` — Tier 3: `orchestrator.service.ts`, `planner.agent.ts`, `executor.agent.ts`, `verifier.agent.ts`, `agenticLoop.service.ts`, plus `checkers/` (four verification checkers, §2), `prompts/`, `utils/`.
- `audit/` — `change-set.service.ts`, `diff.engine.ts`, provenance/`sourceRefs` plumbing, schemas.
- `virtual/` — shadow-workbook dry-run simulator (`shadowWorkbook.ts`, `virtualApply.ts`).
- `formula/` — `FormulaValidatorService`: syntax checks, reference bounds-checking, hardcode lint.
- `domain-tools/` — GST/ITC/TDS/bank-recon/Ind-AS stub functions + a real tool-call contract (`DomainTool<TIn,TOut>`, `registry.ts`, `invoke-domain-tool.ts`).
- `sheets/`, `auth/`, `database/`, `config/`, `common/` (includes the new `logging/workflow-trace.service.ts`, §1.5), `health/`, `actions/` (a smaller, apparently-legacy type fragment — see §3.12).

Test suite: 77 `*.spec.ts` files under `test/`, plus tests colocated under `src/domain-tools/`. CI (`.github/workflows/backend-tests.yml`) runs a curated Phase-01–08 subset then the full suite, gated on `ENABLE_COMPLEXITY_TIERING=full`. **This workflow's ability to actually run is in question — see §3.2.**

### 1.3 Frontend — `frontend/`

React 18 + Vite 5, Office.js task pane, Tailwind 4, Vitest. `better-auth/react` for auth.

`src/` — `taskpane/` (App.tsx, the top-level component), `hooks/` (`useConversation.ts` — 1,919 lines, the SSE/turn state machine), `engine/` (`actionEngine.ts` — `RichActionEngine`, `overwriteGuard.ts`, `actionNormalizer.ts`, `legacyConverter.ts`, `handlers/`), `context/` (`workbookReader.ts`, `contextCompressor.ts`, `contextAdapter.ts`, `sheetAnalyzer.ts` — the TOON pipeline), `components/` (`ConversationPanel/` is the largest surface), `auth/`, `services/` (`previewManager.ts`, `auditService.ts`, `toolRequestHandler.ts`), `utils/`, `types/`.

31 Vitest spec files, 151 tests — confirmed passing by direct run. Coverage is concentrated in engine/logic correctness (`overwriteGuard.spec.ts`, handler specs, normalizer/legacy-converter specs); only 2 files test React components, and `App.tsx` / `ConversationPanel.tsx` / `TurnRenderer.tsx` have **no** test coverage at all (relevant to §3.6).

### 1.4 Dashboard — `Dashboard/`

Next.js 16.2.10 + React 19.2.4 (per its own `AGENTS.md`: "this is NOT the Next.js you know — read `node_modules/next/dist/docs/` before writing code"). MongoDB driver used directly, no ORM. `@xyflow/react` (React Flow) is a new dependency backing the Workflow feature (§1.5).

App Router, single sidebar layout with 5 sections: Overview, Workflow, Requests, Planner, Frontend. Each of the three original log types (`request_logs`, `planner_logs`, `frontend_logs`) has a paginated table view, a detail slide-over, and a matching `/api/{type}/[id]` route. `params`/`searchParams` are consistently handled as `Promise<...>` throughout — correct for this Next.js version, no legacy Pages Router patterns found. No test suite exists for this sub-project at all.

### 1.5 A subsystem `CLAUDE.md` doesn't mention: Workflow tracing

Both the backend and Dashboard deep-dives independently surfaced a fully-built feature that isn't documented anywhere in `CLAUDE.md`: a `WorkflowTraceService` (`cellix_backend/src/common/logging/workflow-trace.service.ts`) writes a per-request DAG — `frontend_in → router/tier → planner → executor → verifier → changeset → sse_out → accept/reject`, plus `tool` nodes — into a new `workflow_traces` Mongo collection (3-day TTL, matching the existing log collections' pattern). It's injected via `@Optional()` into `planner.agent.ts`, `executor.agent.ts`, `verifier.agent.ts`, and `change-set.service.ts`, appending nodes fire-and-forget as a request executes.

The Dashboard's new `/workflow` section (`WorkflowFlowViewer.tsx` using `@xyflow/react`, `WorkflowTable.tsx`, `workflow-layout.ts`) renders this as an interactive, color-coded, click-to-inspect flow graph — confirmed **functional, not a shell**: the backend's `WorkflowNode`/`WorkflowEdge`/`WorkflowTraceStatus` types are structurally identical to the Dashboard's local copy, no placeholder data, no TODOs in either the 5 new Dashboard files or the backend service. Both sides landed together inside a single backend commit titled `"Agentic loop retry fix"` (`c37c77a`) — a fairly large, unrelated feature bundled into a commit whose message doesn't mention it (worth being aware of if bisecting history later).

This is a genuinely useful engineering-observability tool. It is not reflected in `PRD.md` at all, which is correct — it's internal tooling, not a user-facing product capability — but it means anyone onboarding from `CLAUDE.md` alone would miss a real, non-trivial part of the current system.

---

## 2. Implemented vs. Stubbed/Missing, Mapped Against `PRD.md`

`PRD.md` §3 assigned each must-have feature a state (`Exists` / `Partial` / `New`) based on `CLAUDE.md`'s description. This section checks those flags against actual code, tightens several, and adds detail `PRD.md` couldn't have had.

| PRD item | PRD's flag | This analysis | Evidence |
|---|---|---|---|
| **M1** Workbook Understanding | `Exists` | **Confirmed, matches.** | TOON compression (`contextCompressor.ts`) is real and load-bearing — verified 54.2% token reduction in its own test, not a placeholder. Iteratively shrinks row sampling under a 6,000-token budget with active/secondary-sheet tiering. |
| **M2** Request Routing & Tiering | `Exists` | **Confirmed, the most solidly-built system in the codebase.** | `Tier0DirectService`/`Tier1SingleActionService`/`Tier2GenerateVerifyService` all exist and are genuinely dispatched from `conversation.service.ts`, with real fallthrough logic (e.g. Tier 1 escalates to the orchestrator on a specific error code). `ENABLE_COMPLEXITY_TIERING` is read via a real util with `off/shadow/tier01/full` modes; each tier has its own spec file. |
| **M3** Execution Action Set | `Exists` | **Confirmed on the frontend (51/51 canonical types dispatched), but the type contract itself is fragmented — see §3.3.** | Frontend `actionEngine.ts` handles all types from `shared/action.types.ts`; none fall through to the "unknown action" warning. But the backend's live action union has ~65 members (not ~50), and the frontend maintains its own drifted local copy of the "canonical" shared file. |
| **M4** Verification Before Reporting Success | `Partial` | **Downgrade confidence relative to PRD's implicit framing.** Real infrastructure exists, but has a documented history of exactly the failure this metric (`A1 = 0%`) forbids, and a live simulation blind spot. | Four checkers (`CompletenessChecker`, `FormattingChecker`, `SemanticFormulaChecker`, `OverwriteOccupancyChecker`) are real NestJS providers, wired into `runDeterministicChecks()`. `FormulaValidatorService` runs both pre- and post-apply. **But** the shadow workbook (`virtualApply.ts`) silently no-ops or falls through a bare `default: break` for ~7 action types including `FILL_DOWN`/`FILL_RIGHT` — which genuinely mutate cell values in real Excel but are never simulated, so the Verifier's dry-run check has a blind spot there by construction, not by bug. See §3.6 for the false-success pattern across specs 10/22/24. |
| **M5.1** Full-fidelity revert (per PRD's D5) | `New` | **Confirmed 0% built**, exactly as PRD's Appendix A stated. | `diff.engine.ts`'s `beforeStateToInverseActions` still only emits `SET_CELL`/`SET_FORMULA` inverses. No formatting, chart, or structural inverse exists anywhere in `audit/`. |
| **M5.2** Snapshot-backed checkpoints (per PRD's D5) | `New` | **Confirmed 0% built.** | `CheckpointAction` is still `{ message }` only. |
| **M6** Ask/Plan/Action Modes | `Exists` | **Server-side enforcement confirmed real; client-side has no backstop — new finding, not in PRD.** | `useConversation.ts` gates *auto-preview* on `isActionMode`, but `pendingActions` is set and the Accept-able `ActionBlock` is attached to the turn **unconditionally**, regardless of mode. If the backend ever leaks a write action during `ask`/`plan` (which it's supposed to strip server-side, per `CLAUDE.md`), the frontend will still render a working Accept button. This exact code path (`App.tsx`, `ConversationPanel.tsx`, `TurnRenderer.tsx`) has zero test coverage. |
| **M7** Rule-Based Conditional Formatting | `New` | **Confirmed absent, independently re-verified.** | `CONDITIONAL_FORMAT` exists only as a classifier-hint label (`complexity-classifier.util.ts`) used for routing text; it gets normalized down to a one-shot `FORMAT_MATCHING_ROWS` action before execution — there is no live, re-evaluating rule object anywhere. This matches the PRD research done earlier this session exactly. |
| **M8** Large Multi-Step Prompts | `Partial` | **Real decomposition/retry infrastructure confirmed; a specific dependency-ordering failure (spec 22) has unconfirmed fix status.** | Selective retry (`collectFailingIdsForRetry`) and retry-with-feedback are both confirmed implemented and wired. But spec 22 documents the Planner silently dropping one clause of a compound request, and partial-delivery shipping the destructive half without its safety prerequisite — no agent in this pass found direct evidence this specific ordering-safety check has been added. |
| **M9** Intelligent Clarification | `Exists` | **Downgrade — PRD's `Exists` flag is optimistic.** | The specs' own master queue (Phase 1, item 1.2) explicitly lists "clarification gating" as **not yet confirmed working**, as of the same body of specs this analysis is drawing on. No agent in this pass found code that closes that open item. Treat as `Partial` pending direct verification. |
| **M10** Change Reporting | `Partial` | **Real hardening in progress; historical evidence of the opposite problem it's meant to solve.** | An in-progress uncommitted diff adds `droppedActions` surfacing and honest `failedReason` preservation (so a generic "hit max iterations" message can't silently overwrite a real, specific block reason). But specs 19 and 24 document two confirmed historical instances of hallucinated/contradictory explanations and raw internal-error leakage reaching the user-facing text — current fix status for those two specific traces wasn't independently re-verified. |
| **M11** Conversational Continuity | `Exists` | **Plausible, partial evidence.** | `overwrite-confirmation.util.ts` implements exactly the two-signal design spec 21 proposed (prior-turn range overlap + explicit overwrite language) for recognizing legitimate follow-up refinements — this is turn-history-aware behavior, consistent with M11's requirement. Not independently tested against spec 21's specific repro in this pass. |
| Domain tools (nice-to-have) | — | **Confirmed exactly as `PRD.md` Appendix A stated.** | All 7 domain-tool functions (`gst-match.tool.ts` etc.) literally throw `'Not implemented — requires CA-reviewed spec before production use.'` A real tool-call contract and audit-logging wrapper exists around them, and there's even an architecture test (`no-llm.guard.spec.ts`) scanning for forbidden LLM imports in that call graph — but `executor.agent.ts` has zero references to the domain-tools registry. The layer is built and guarded; it is not connected to anything. |
| Citation/provenance (`sourceRefs`) | Mentioned in CLAUDE.md | **Real, and built ahead of its own producer.** | `provenance.util.ts` and `change-set.service.ts` genuinely thread `sourceRefs` through the change-set model, and there's an enforced rule that "domain-tool-backed writes must include non-empty `sourceRefs`." Since domain tools are never invoked (above), this enforcement path is currently unreachable in practice — implemented correctly, ahead of the thing that would exercise it. |
| Workflow tracing (§1.5) | Not in PRD | **Real and functional**, but un-scoped by any product document. | See §1.5. Not a gap to close — a scope note for whoever maintains `PRD.md` next. |

### 2.1 The overwrite guard specifically — needs its own entry, not a single verdict

This is the most safety-critical mechanism in the product, and the picture is more nuanced than either "solved" or "broken." Both are true simultaneously, in different layers:

**The frontend guard is confirmed robust and is the mechanism that actually matters.** `engine/overwriteGuard.ts` runs unconditionally at the top of every `RichActionEngine.dispatch()` call, for 11 write-shaped action types, immediately before the real Office.js write — and this is true for **every** path that reaches a write, including Accept. This directly answers the open P0 question in `specs/19` ("does clicking Accept bypass the guard?"): **no** — Accept routes through `previewManager.accept()` → `ActionEngine.applyActions()` → the same guarded `dispatch()` as everything else. There's a separate client-side dry-run preflight for UX purposes, but the authoritative check is the one immediately before the Office.js call.

**The backend's mirror (`OverwriteOccupancyChecker`) is narrower and Tier-3-only.** It only triggers when a subtask is column-insert-shaped (`suggestedActionType === 'INSERT_COLUMN'` or a regex match on "add/insert...column"), and it only runs inside `AgenticLoopService` — grepping Tier 0/1/2 turns up zero occupancy-checking, only the permissive `explicitOverwriteConfirmed` heuristic. Separately, `audit/change-set.service.ts` — the backend's own Accept/apply code path — has **zero** references to any overwrite guard at all.

**Net assessment:** because Office.js is currently the *only* path that writes to a real workbook, and that path is universally guarded on the frontend, the product is very likely safe from the original spec-14 data-loss class today. But this safety currently rests entirely on one fact — "the frontend is the sole write boundary" — that is nowhere written down as an explicit architectural invariant. `PRD.md`'s D1 (task-pane-only for v1) happens to keep this true for now, but nobody has recorded that D1 is doing double duty as a safety precondition. If a second write path is ever added (a server-side file generator, the kind of thing `VISION.md` names as future scope), this gap becomes live. See §3.4–3.5 and §4.3.

---

## 3. Technical Debt & Risky Patterns

Ordered by severity, not discovery order.

### 3.1 Dashboard has a fully independent, disconnected commit history — highest severity

Reproduced directly:
```
$ cd Dashboard && git log --oneline -5
f6a2a8a n8n like workflow
b1c6e38 first commit
$ git remote -v
origin  https://github.com/usecellix/Analytic-Dashboard.git (fetch/push)
```
while the outer repo (`e:\cellix\Cellix-2026`, presumably `usecellix/Cellix-2026` or similar) tracks `Dashboard/src/components/Sidebar.tsx` etc. as ordinary `100644` blobs with no knowledge of that second repo at all. This is worse than a missing `.gitmodules` entry (§3.2) — there, at least the outer repo *knows* it's pointing at an external commit. Here, `git status`/`git log`/`git commit` behave completely differently depending on whether you run them from the repo root or from inside `Dashboard/`, against the exact same files, with no warning either way. A commit made "in the Dashboard" believing it's part of the main project's history goes to a GitHub repo the main project's own git config has never heard of.

**This should be resolved before any more Dashboard work happens** — not because the current state is unsafe by itself, but because it's a single misdirected `git add -A .` / wrong-`cwd` commit away from confusing which history is authoritative. See open question §4.1.

### 3.2 `cellix_backend` / `frontend` are gitlinks with no `.gitmodules` — CI is very likely broken

`git ls-files -s` confirms both as mode `160000` gitlinks; `.gitmodules` doesn't exist anywhere in the repo. `git submodule status` fails outright: `fatal: no submodule mapping found in .gitmodules for path 'cellix_backend'`.

Consequence: `.github/workflows/backend-tests.yml` uses `actions/checkout@v4` with no `submodules: true` option, then sets `working-directory: cellix_backend` and runs `npm ci`. On a genuinely fresh checkout (as CI always is), a gitlink with no submodule registration checks out as an **empty directory** — there's no `.gitmodules` entry for Actions' checkout to even attempt resolving. If that reasoning holds, `npm ci` inside an empty `cellix_backend/` should fail immediately for lack of a `package.json`.

**This is inference, not confirmed via run logs** — `gh` isn't available in this environment, so I couldn't pull actual workflow-run history to check. It's a concrete, falsifiable claim: check the Actions tab for `backend-tests.yml`'s recent runs. If it has been passing, something about the setup (a self-hosted runner with the directory pre-populated, e.g.) is compensating for this in a way that isn't visible from the repo alone, and that mechanism itself would be worth documenting since it isn't in the workflow file.

### 3.3 Action-type definitions are fragmented across (at least) five files

| File | Role | State |
|---|---|---|
| `shared/action.types.ts` | Stated by `CLAUDE.md` as "the canonical source of truth shared between frontend and backend." | ~50 types. |
| `frontend/src/shared/action.types.ts` + re-export `src/action.types.ts` | Frontend's own local copy. | **Confirmed drifted**: collapses `HideRowAction`/`UnhideRowAction` into one interface with a nonexistent `'SHOW_ROW'` variant (the real, dispatched type is `'UNHIDE_ROW'`), is missing dedicated interfaces for `UnhideColumnAction`/`UnprotectSheetAction`/`ShowSheetAction`, and differs in field optionality from root. Currently harmless only because the dispatch table bypasses strict typing via a loose cast. |
| `cellix_backend/src/excel-ai/types/sheet-actions.types.ts` | The backend's actual live dispatch union. | ~65 members — **more** than the "canonical" shared file, not fewer. |
| `cellix_backend/src/actions/action.types.ts` | A smaller, separate type file. | Looks like a legacy/unused fragment (§3.12). |
| `cellix_backend/src/excel-ai/types/action-catalog.ts` (untracked, new) | A `Record<SheetActionType, CatalogEntry>` exhaustiveness map — the compiler enforces every backend action type has a catalog entry. | Well-designed, and its own code comment cites `FREEZE_PANES` as a past real incident of exactly this "type declared, no handler" class of bug. |

The `action-catalog.ts` pattern is a genuinely good idea — it's just currently scoped to keeping the backend internally consistent with itself, not to keeping frontend/backend/shared in sync with each other. `CLAUDE.md`'s claim that `shared/action.types.ts` is *the* canonical source doesn't hold in practice; it's better described as "the file everyone forked from."

### 3.4 Overwrite protection is asymmetric across tiers

Covered in detail in §2.1. Restated as a debt item: the backend's `OverwriteOccupancyChecker` only fires for column-insert-shaped Tier 3 subtasks. Given the specs' own estimate that ~85% of write traffic is Tier 0–2 by catalog share, the large majority of write requests never pass through any backend-side occupancy check — protection for those requests is entirely the frontend guard's job, with nothing documented confirming that's an intentional layering decision rather than an oversight.

### 3.5 Backend's own apply/change-set path has no overwrite re-check at all

`audit/change-set.service.ts` — the code that actually handles Accept/apply on the backend — never references the guard or `explicitOverwriteConfirmed`. This is currently masked by §2.1's "Office.js is the only real write boundary" fact, but it means the backend's own apply endpoint has no independent safety net if it were ever called by anything other than the current frontend.

### 3.6 Shadow-workbook verification has silent, uncommented blind spots

`virtualApply.ts`'s action-type switch either explicitly no-ops with a documented reason for a handful of types (`FORMAT_RANGE`, `CREATE_CHART`, `UPDATE_CHART`, `HIGHLIGHT_CELL` — "shadow workbook has no fill state to update," a reasonable call) or silently falls through a **bare, uncommented** `default: break` for others: `SET_MATCHING_ROWS`, `DELETE_SHEET`, `HIDE_SHEET`, `MERGE_CELLS`, `CLEAR_CONTENT`, `AUTO_FILTER`, `FREEZE_PANES`. Most concerning: `FILL_DOWN`/`FILL_RIGHT` genuinely mutate real cell values in Excel but aren't simulated at all — meaning the Verifier's dry-run check has a structural blind spot there, not by considered design (unlike the documented no-ops) but by apparent omission.

### 3.7 False-success / contradictory-UI-state is a recurring bug *class*, not isolated incidents

Three independently-discovered traces, over what appears to be separate debugging sessions, hit the same underlying shape:
- **Spec 10, Bug 1** — SORT reports "Applied" with no actual sheet reorder.
- **Spec 22, Bug 3** — `DELETE_COLUMN` shown as "Applied" despite the backend's own `/audit/apply` returning `400` (confirmed *not* destructive in that specific trace — the write genuinely didn't happen — but the UI lied about it regardless).
- **Spec 24** — a single response simultaneously claims success ("I've applied..."), shows "Pending review," and displays a raw validation-error string, three contradictory states at once.

This pattern — no single boolean derived from "did the actual write operation return success" gating what the UI displays — is worth fixing once, at the state-derivation layer, rather than patching three call sites independently. It's also the exact failure class `PRD.md`'s A1 gate (`false_success_rate = 0%`, zero tolerance, no exceptions) exists to prevent — this is empirical evidence the gate is not vacuous.

### 3.8 `ask`-route capability gap versus the competitor named in `PRD.md`'s own competitive-landscape section

Spec 23 is a direct, traced side-by-side: for "Tell me about this sheet," Shortcut computes real aggregates (totals, GST breakdown, paid/pending split with amounts, largest supplier) while Cellix's `ask` route returns structural metadata only (row/column count, detected types) — no sums, no group-bys, no ranking — wrapped in a single dense paragraph that leaks internal vocabulary (`"Intent: EXPLAIN"`, raw `detectedType` strings). `PRD.md` §9 (written earlier this session, without knowledge of this internal trace) independently flagged Shortcut as the closest competitor and recommended reliability/safety as the differentiator — this finding says the `ask` route specifically is currently behind on a capability comparison, worth reconciling the two documents on.

### 3.9 Spec-file hygiene — no single authoritative version

Four variants of the master priority queue exist side by side, genuinely different lengths (165 / 200 / 216 / 201 lines) — not save-as duplicates, actual content drift — with no marker indicating which is current. Spec 18 similarly has three variants (88 / 129 / 88 lines). Anyone picking up this backlog cold has to diff four files before knowing what to work from.

### 3.10 Stray 111KB raw log dump committed at repo root

`last_log.txt` (84 very long lines, ~112KB) is a raw Pino structured-log capture of a Tier 3 agentic run — appears to be a debugging artifact from a session building a 12-monthly-sheet workbook (notably, almost exactly `VISION.md`'s own hospitality-workbook example). It sits at the repo root, untracked, outside `cellix_backend/logs/` (which is the documented, presumably `.gitignore`d, log location per `CLAUDE.md`). One line's raw executor response shows a `subtaskId` mismatch (request tagged `s1`, response parsed as `s22`) — not independently investigated further in this pass, flagged only in case it's a symptom worth someone's attention.

### 3.11 `CLAUDE.md` is stale relative to current code

Doesn't mention the Workflow-tracing subsystem (§1.5) at all — a real, cross-cutting, functional feature. Doesn't mention `action-catalog.ts`'s exhaustiveness-check pattern. States `shared/action.types.ts` is canonical in a way §3.3 shows isn't quite true in practice. None of these are large individually, but together they mean `CLAUDE.md` alone would leave someone onboarding with a noticeably dated model of the system.

### 3.12 No `ARCHITECTURE.md` — `VISION.md` names one that doesn't exist

`VISION.md`'s own header states: "architecture in `ARCHITECTURE.md`." No such file exists. This isn't a paperwork gap — §2.1's overwrite-guard layering is exactly the kind of load-bearing, non-obvious design decision ("safety currently depends on Office.js being the only write path") that belongs in a document like that, and currently lives nowhere except this analysis.

### 3.13 Minor: likely dead code

`cellix_backend/src/actions/action.types.ts` — small, separate from the live `excel-ai/types/sheet-actions.types.ts`, described by the backend deep-dive as "looks like a legacy/unused fragment." Worth a direct check and probable removal rather than leaving a second thing named `action.types.ts` in the backend tree.

---

## 4. Open Questions for You

Grouped by what kind of decision each one is — genuine calls only you can make, not "should this bug get fixed" (which is usually self-evident from the spec files above).

### 4.1 Repo integrity — needs resolving before more work compounds it

1. **Dashboard's disconnected git history (§3.1):** was `Dashboard/` always meant to be its own separately-versioned repo that happens to live in this folder (in which case the outer repo tracking its files as plain blobs is itself the mistake, and should probably stop), or is the standalone `.git`/remote an accident from how it was originally set up? Whichever it is, the current state — both at once, silently — should not persist.
2. Should `cellix_backend`/`frontend` be **properly registered** as git submodules (add `.gitmodules`), or **absorbed** into the main repo's history as regular directories, or left as-is with the understanding that CI may need fixing separately (§3.2)?
3. Should the CI checkout issue (§3.2) be verified against actual Actions run history — do you want me to look at this differently, e.g. via a local `gh auth login` if you have the CLI configured elsewhere, or would you rather check the Actions tab directly?

### 4.2 Backlog triage — which specs are actually still open

This pass confirmed roughly half the master queue's Phase-0 items as implemented (retry-with-feedback, selective retry, token-budget handling, normalize field-preservation, honest block-reason preservation) or plausibly implemented (spec 21's refinement-recognition heuristics). It could **not** confirm current status for: spec 10's SORT false-success, spec 20's export-route literal-query bug, spec 22's destructive-partial-delivery ordering check, spec 23's `ask`-route aggregation gap, and spec 24's header-row misrouting + error-leak. Do you want a dedicated follow-up pass to verify these five specifically before treating the Phase-0 backlog as closed, or is that acceptable to leave open for now?

### 4.3 Design decisions worth writing down explicitly

4. Given §2.1/§3.4: is the frontend-only overwrite guard an **accepted** design (Office.js is the sole write boundary, so backend-side checking on Tier 0–2 is genuinely unnecessary) — and if so, should that reasoning go into a new `ARCHITECTURE.md` so it's not just implicit? This matters more given `PRD.md`'s D1 (task-pane-only v1) — as long as that holds, the current layering is probably fine, but the two decisions (D1, and "frontend guard is sufficient") aren't currently linked anywhere in writing.
5. Which action-types file should be the actual single source of truth going forward (§3.3), and is a build-time or CI check enforcing cross-repo sync (extending the `action-catalog.ts` idea beyond the backend's own internal consistency) worth the investment?

### 4.4 Housekeeping — low-effort, your call on priority

6. Consolidate or delete the duplicate spec files (§3.9) and remove/relocate `last_log.txt` (§3.10)?
7. Update `CLAUDE.md` to document Workflow tracing and `action-catalog.ts` (§3.11)?
8. Confirm and remove `cellix_backend/src/actions/action.types.ts` if it's genuinely dead (§3.13)?

---

## Appendix — Sourcing Note

Sections 1.2–1.4 and the file-level evidence in §2–3 draw on three parallel read-only deep-dive passes (backend, frontend, Dashboard), each independently exploring its tree and, where relevant, running existing tests (frontend: `npx vitest run`, 151/151 passing) or inspecting `git diff` on uncommitted work. Section 3's spec-derived findings (14, 19–24) were read directly and in full, not summarized secondhand. Nothing in this document reflects code changes — no file outside this new one was modified to produce it.
