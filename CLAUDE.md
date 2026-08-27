# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Cellix is an **Excel task-pane add-in** (Office.js) with an AI assistant that reads, plans, and modifies spreadsheets. The user's prompt flows through: `Complexity tier → Execution plan (actions[]) → Validation → Preview → Accept/Reject → Excel`.

Three sub-projects:
- `frontend/` — React + Vite Excel add-in (Office.js), port 3000
- `cellix_backend/` — NestJS + Fastify API, port 4001
- `Dashboard/` — Next.js ops log viewer, port 3100
- `shared/` — Shared TypeScript action types (`action.types.ts`)

## Working With This Repo Across Sessions

Claude Code has no memory between sessions — `VISION.md`, `PRD.md`, `ARCHITECTURE.md`, and `TASKS.md` in `Root/` are the memory. Three habits keep that memory trustworthy:

1. **Start every session by reading `Root/VISION.md`, `Root/PRD.md`, `Root/ARCHITECTURE.md`, and `Root/TASKS.md` before doing anything else.** They're the source of truth for why, what, how, and what's left.
2. **Don't fold "also fix X while you're in there" into an in-progress task.** That's how scope creep sneaks in. Add X as a new numbered item in `Root/TASKS.md` instead, and pick it up as its own task.
3. **After finishing a task, update `Root/CODEBASE_ANALYSIS.md` and `Root/TASKS.md` to reflect it.** Stale docs are worse than no docs — a `Partial`/`New` flag or an open task that's actually done misleads the next session more than an honest gap would.

---

## Commands

### Backend (`cellix_backend/`)
```bash
npm run start:dev        # dev with hot-reload (ts-node + nodemon)
npm run build            # rimraf dist && tsc
npm run start            # node dist/main.js (production)
npm test                 # all Jest tests (--runInBand)
npm run test:watch       # Jest in watch mode
# Single test file:
npx jest --runInBand test/tier2-generate-verify.service.spec.ts
# Phase regression suite:
npm run test:phase-regression
```

### Frontend (`frontend/`)
```bash
npm run dev              # Vite dev server (https://localhost:3000)
npm run build            # tsc && vite build
npm start                # launch Excel desktop with sideloaded add-in
npm run stop             # remove add-in from Excel
npm test                 # vitest run
npm run test:watch       # vitest (watch)
# One-time cert setup (Windows, run once per machine):
npx office-addin-dev-certs install
```

### Dashboard (`Dashboard/`)
```bash
npm run dev              # Next.js dev (http://localhost:3100)
npm run build
npm run import-logs      # seed MongoDB from logs/*.log files
```

---

## Environment Variables

### Backend (`.env` in `cellix_backend/`)
| Variable | Default | Notes |
|---|---|---|
| `PORT` | `4001` | Backend listen port |
| `MONGODB_URL` | `mongodb://127.0.0.1:27017/cellix` | |
| `MONGODB_DB_NAME` | `cellix` | |
| `OPENROUTER_API_KEY` | — | Required for LLM; preferred over OpenAI |
| `OPENROUTER_MODEL_LOW` | `openai/gpt-5-mini` | Router, fast lane |
| `OPENROUTER_MODEL_MEDIUM` | `openai/gpt-5-mini` | Data query, Tier 1 |
| `OPENROUTER_MODEL_HIGH` | `openai/gpt-5` | Tier 2/3 agents |
| `ENABLE_COMPLEXITY_TIERING` | — | Gates Tier 0–3 routing |
| `CLIENT_ORIGIN` | `https://localhost:3000` | CORS |

### Frontend (`.env` in `frontend/`)
| Variable | Default |
|---|---|
| `VITE_API_BASE_URL` | `http://localhost:4001` |

### Dashboard (`.env.local` in `Dashboard/`)
Same `MONGODB_URL` / `MONGODB_DB_NAME` as backend.

---

## Architecture

### Request Routing (`LlmRouterService`)
Every user message is classified before dispatch — in priority order:
1. **Regex fast lane** (0ms) — unambiguous layout commands (freeze, protect, zoom)
2. **Find/export** — `FindExportService` (matching rows → new sheet)
3. **Complexity / write-intent guard** — escalates mutations to write path
4. **Data query fast lane** — `SmartDataQueryService` (read-only, MEDIUM LLM)
5. **Ask/Plan mode short-circuit**
6. **LLM Router** (~100ms, LOW tier) — everything else

Routes: `shortcut` | `data` | `export` | `write` | `ask`

### Complexity Tiering (write route, gated by `ENABLE_COMPLEXITY_TIERING`)
- **Tier 0** — deterministic, no LLM (e.g., delete sheet, clear)
- **Tier 1** — single LLM call (`Tier1SingleActionService`)
- **Tier 2** — Generate → Verify loop (`Tier2GenerateVerifyService`)
- **Tier 3** — Planner → Executor → Verifier agents (`OrchestratorService`)

### Multi-Agent Pipeline (Tier 3)
`OrchestratorService` → `PlannerAgent` → `AgenticLoopService` → (`ExecutorAgent` + `VerifierAgent`)

Verifier checkers: `CompletenessChecker`, `FormattingChecker`, `SemanticFormulaChecker`, `OverwriteOccupancyChecker`. Scoped retry re-runs only failed subtasks (max 2 attempts).

### Action System
All actions flow through `RichActionEngine` in the frontend before Office.js apply.

- Action types are defined in `shared/action.types.ts` — the intended canonical source of truth shared between frontend and backend. In practice this drifts across five files; see `ARCHITECTURE.md` AD-7 for the current state and the proposed fix.
- **Overwrite guard (spec 14)**: `guardAgainstOverwrite` runs on every value-writing action before Office.js write. Occupied cells without `explicitOverwriteConfirmed` throw `OverwriteGuardError`.
- **INSERT_COLUMN semantic shape**: "Add a column" must use `INSERT_COLUMN` with `columnName` + `afterLastColumn` / `{ afterColumn }` — never `SET_FORMULA` into a guessed column index.
- `normalizeExecutorOutput` converts A1 `range` strings on FORMAT-class actions into 0-based row/col indices before `sanitizeAction`.
- **Action-type exhaustiveness checks (TASKS.md #5)**: `cellix_backend/src/excel-ai/types/action-catalog.ts` is a `Record<SheetActionType, CatalogEntry>` the compiler forces to stay exhaustive against the backend's own live action union — added after the `FREEZE_PANES` incident (a type declared with no handler wired up). The frontend mirrors the same pattern with two catalogs: `frontend/src/types/sheetActionCatalog.ts` (wire-type parity) and `frontend/src/engine/actionDispatchCatalog.ts` (dispatch completeness). `frontend/src/types/actionCatalogParity.spec.ts` imports the backend's catalog directly across the repo boundary and fails if the two unions disagree — a real drift detector, not a hand-copied mirror.

### Workflow Tracing
`WorkflowTraceService` (`cellix_backend/src/common/logging/workflow-trace.service.ts`) records a per-request DAG — `frontend_in → router/tier → planner → executor → verifier → changeset → sse_out → accept/reject`, plus `tool` nodes — into a `workflow_traces` Mongo collection (3-day TTL, same pattern as the other log collections). It's injected via `@Optional()` into `planner.agent.ts`, `executor.agent.ts`, `verifier.agent.ts`, and `change-set.service.ts`, appending nodes fire-and-forget as a request executes. The Dashboard's `/workflow` section (`WorkflowFlowViewer.tsx`, built on `@xyflow/react`) renders it as an interactive, color-coded, click-to-inspect flow graph. This is internal observability tooling, not a product-facing feature — it isn't in `PRD.md`, deliberately.

### SSE Protocol
Backend streams SSE events from `POST /excel-ai/conversation`:
- `chunk` — `{ text: string }` (append to assistant text)
- `actions` — `{ actions: SheetAction[], explanation: string }`
- `status` — `{ message: string }` (progress)
- `plan_only` — emitted in Plan mode (no ChangeSet)
- `tool_request` / `tool_result` — Tier 3 agent tool bridge
- `error` — `{ message: string }`

### Assistant Modes
Three modes: `ask` | `plan` | `action` (aka `act`). Persisted per workbook in `localStorage`. `ask` and `plan` are read-only — write actions are stripped server-side via `modeIsReadOnly` / `stripWriteActions`.

### Frontend Key Entry Points
- `frontend/src/taskpane/` — App entry, mode persistence, preview Accept/Reject
- `frontend/src/hooks/useConversation` — SSE handling, `plan_only`, `select_cell` → `navigateToCell`
- `frontend/src/engine/` — `RichActionEngine`, `overwriteGuard`, action handlers
- `frontend/src/context/` — `workbookReader`, TOON compression (reduces token payload for large sheets)
- `frontend/src/services/formatGuard.ts` — number-format preservation around writes. **`preserveNumberFormatsAroundWrite` contains a load-bearing `context.sync()` between the value write and the format restore.** Office.js queues property assignments; without that sync both flush in one batch, Excel's smart-entry re-parses the written cells (a date becomes a locale default) and the same-batch `numberFormat` never takes. Removing it silently reintroduces the `12-09-26` → `120926` bug (TASKS.md #85).

**Three Accept paths, one gating rule.** Accepting a staged action wave is reachable from `ActionResponseCard` (in-conversation), `PreviewSummaryBar` (bottom bar), and `acceptActions` (the hook). All three must honor `isWaveDependencySatisfied` from `frontend/src/utils/actionWaveGating.ts` — enforcing it in only some of them is what caused TASKS.md #80. `acceptActions` returns `Promise<boolean>`: **`false` means refused, and callers must not treat that as applied** (doing so cleared the preview on a refusal, so Accept silently did nothing).

### Backend Key Entry Points
- `cellix_backend/src/excel-ai/conversation.controller.ts` — `POST /excel-ai/conversation`
- `cellix_backend/src/excel-ai/services/conversation.service.ts` — top-level orchestration
- `cellix_backend/src/excel-ai/services/llm-router.service.ts` — route classification
- `cellix_backend/src/agents/orchestrator.service.ts` — Tier 3 planner/executor/verifier

**LLM truncation is not self-announcing.** `OpenRouterService.complete()` returns a bare `string`; pass the optional `outcome` out-param to receive `finishReason` and a `truncated` flag. Any caller parsing structured output **must** check it — a model that hits its token cap mid-JSON usually emits the closing brackets anyway, so the result parses cleanly and is silently short. `PlannerAgent` treats truncation exactly like a parse failure (retry, then a larger last-resort budget) for this reason; `normalizePlannerOutput` also logs any malformed subtask it drops rather than quietly shortening the plan. See TASKS.md #82.

**Planner emission order is a token-budget rule, not an execution-order rule.** The "YEARLY MONTHLY LEDGER" prompt block tells the planner to emit Main-sheet subtasks *first* and the 12 repetitive month-sheet subtasks *last*, so a truncation loses regenerable boilerplate rather than the dashboard. This is safe only because `computeExecutionWaves` (`agents/utils/task-graph.util.ts`) schedules purely on `dependsOn` edges and ignores array position — pinned by tests in `test/task-graph.util.spec.ts`. See TASKS.md #83.

### Logging
- NDJSON files: `cellix_backend/logs/requests.log`, `planner.log`, `frontend.log` (24h prune)
- MongoDB collections: `request_logs`, `planner_logs`, `frontend_logs` (3-day TTL on `ts`)
- Dashboard at port 3100 browses these logs; `npm run import-logs` seeds Mongo from files

### Domain Tools (`cellix_backend/src/domain-tools/`)
GST/ITC/TDS/bank-recon/Ind-AS stubs as deterministic functions — scaffolding only, unwired until CA sign-off.

### Virtual / Shadow Workbook (`cellix_backend/src/virtual/`)
`shadowWorkbook.ts` + `virtualApply.ts` — used for dry-run verification before Office.js apply.

### Formula Validation (`cellix_backend/src/formula/`)
`FormulaValidatorService` — hardcode lint blocks numeric literals where formulas are expected (runs before Verifier/apply in Tier 2).

### Audit & Change Sets (`cellix_backend/src/audit/`)
`ChangeSetService` captures before/after cell diffs for audit and revert. `CellChange.sourceRefs` + `exceptionFlags` for citation/provenance.

---

## Dashboard Notes

The Dashboard is a **Next.js 16** app. The `Dashboard/AGENTS.md` contains a note: this version of Next.js has breaking changes — read `node_modules/next/dist/docs/` before writing any code.

MongoDB collections for logs use a **3-day TTL** on `ts`. File mirrors use a **24h prune**.
