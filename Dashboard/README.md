# Cellix Agent Logs Dashboard

Next.js + Tailwind UI over the same MongoDB as `cellix_backend`.

## Setup

```bash
cd Dashboard
npm install
cp .env.local.example .env.local   # or edit .env.local
npm run import-logs                # optional: seed from logs/*.log
npm run dev                        # http://localhost:3100
```

Env (same as backend):

```
MONGODB_URL=mongodb://127.0.0.1:27017/Cellix
MONGODB_DB_NAME=cellix
```

## Pages

- `/` — overview stats (requests, planner, frontend)
- `/requests?page=1&id=…` — HTTP conversation traffic
- `/planner?page=1&id=…` — planner agent I/O
- `/frontend?page=1&id=…&level=error&category=accept` — Excel add-in events

### Frontend logs

Emitted by the Excel add-in via `POST /telemetry/frontend`:

| Category | Examples |
|----------|----------|
| `console` | `console.error`, `window.error`, `unhandledrejection` |
| `preview` | `preview.start`, `preview.ready`, `preview.fail` |
| `accept` | `accept.click`, `accept.success`, `accept.fail` |
| `reject` | `reject.click` |

Detail sheet shows message, action summary (types / first action), error stack, conversation/changeSet IDs, and client context.

Mongo collections `request_logs`, `planner_logs`, and `frontend_logs` use a **3-day TTL** on `ts`. File mirrors: `cellix_backend/logs/{requests,planner,frontend}.log` (24h prune).
