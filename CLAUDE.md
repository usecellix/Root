# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Cellix is an **Excel task-pane add-in** (Office.js) with an AI assistant that reads, plans, and modifies spreadsheets. The user's prompt flows through: `Complexity tier → Execution plan (actions[]) → Validation → Preview → Accept/Reject → Excel`.

Three sub-projects:
- `frontend/` — React + Vite Excel add-in (Office.js), port 3000
- `cellix_backend/` — NestJS + Fastify API, port 4001
- `Dashboard/` — Next.js ops log viewer, port 3100
- `shared/` — Shared TypeScript action types (`action.types.ts`)

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

- Action types are defined in `shared/action.types.ts` — the canonical source of truth shared between frontend and backend.
- **Overwrite guard (spec 14)**: `guardAgainstOverwrite` runs on every value-writing action before Office.js write. Occupied cells without `explicitOverwriteConfirmed` throw `OverwriteGuardError`.
- **INSERT_COLUMN semantic shape**: "Add a column" must use `INSERT_COLUMN` with `columnName` + `afterLastColumn` / `{ afterColumn }` — never `SET_FORMULA` into a guessed column index.
- `normalizeExecutorOutput` converts A1 `range` strings on FORMAT-class actions into 0-based row/col indices before `sanitizeAction`.

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

### Backend Key Entry Points
- `cellix_backend/src/excel-ai/conversation.controller.ts` — `POST /excel-ai/conversation`
- `cellix_backend/src/excel-ai/services/conversation.service.ts` — top-level orchestration
- `cellix_backend/src/excel-ai/services/llm-router.service.ts` — route classification
- `cellix_backend/src/agents/orchestrator.service.ts` — Tier 3 planner/executor/verifier

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
