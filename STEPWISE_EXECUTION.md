# STEPWISE_EXECUTION.md — Cellix

> Design for TASKS.md **#153** — step-wise Tier 3 execution with per-step Accept.
> Companion to `ARCHITECTURE.md` (system design) and `CODEBASE_ANALYSIS.md`.
>
> *Drafted: September 7, 2026. Status: In progress.*

---

## 1. The problem, precisely

Today a Tier 3 request runs the **entire** Planner → Executor → Verifier chain inside one
SSE connection and only then surfaces Accept cards. A live run showed the cost: 12 planned
steps, 37 changes, one intermediate deterministic-check failure that the loop retried past,
and a user who waited minutes to be handed 37 changes at once with the message *"completed
12 step(s) … but could not finish the full request."*

Three things are wrong with that, and they are distinct:

1. **Sequencing** — nothing is reviewable until everything is generated.
2. **Wasted cost** — work downstream of a bad step is generated before anyone can reject it.
3. **Connection pressure** — one HTTP connection holds a multi-minute build, which is why
   `AgenticLoopService.TIMEOUT_MS` had to be raised to 480s as an explicit mitigation
   (TASKS.md #170c). A build that needs 500s still dies with nothing to show.

`onWaveComplete` (TASKS.md #174) already fixed *part* of (1): finished waves become Accept
cards early. It does **not** fix (2) or (3) — the loop runs to completion regardless of
whether the user has accepted anything, and it all still lives on one connection.

---

## 2. Key decision: client-driven continuation

### SD-1 — Each wave is its own request/response, not a blocked promise

**Decision:** A Tier 3 run becomes N HTTP requests. `POST /excel-ai/conversation` plans and
executes **wave 0 only**, emits its Accept card, and **ends the stream**. The client accepts
(or rejects/skips), then calls `POST /excel-ai/conversation/continue` with `{ runId, decision,
readback }` to produce wave 1. Repeat until the run reports `done`.

**Why not the obvious alternative** — holding the SSE stream open and awaiting a promise
resolved by an accept callback, mirroring `ToolBridgeService.waitForRangeData`: that is a
much smaller change and was seriously considered. It is rejected because it *keeps* problem
(3) and makes it worse — the connection would now be held not just for the build's compute
time but for **human think time**, unbounded. `ToolBridgeService` gets away with the pattern
because a range fetch resolves in milliseconds and has a 30s timeout; a human deciding
whether to accept 13 new sheets does not.

**Consequences:**
- Run state must persist between requests → new `agent_runs` collection (§4).
- Resumability comes free: closing the task pane mid-build and reopening can resume, because
  the run lives in Mongo rather than in a closure on one connection.
- The 480s `TIMEOUT_MS` stops being a whole-build ceiling and becomes a per-wave ceiling,
  which is what it was always sized for.
- The Executor's context for wave N+1 can include the **observed** post-apply state
  (`readback`), not just the shadow workbook's prediction. This is the actual Shortcut-parity
  capability TASKS.md #153 is named for, and it is not reachable at all under the blocked-
  promise design.

**Status:** Decided (2026-09-07), per TASKS.md #153's own prescription.

### SD-2 — Wave boundaries are dependency waves, not new semantic phases

**Decision:** Sub-task boundaries are exactly `computeExecutionWaves(subtasks)` — the
existing dependency-level grouping in `agents/utils/task-graph.util.ts`. No new
"structural → populate → format → visualize" phase layer.

**Why:** The waves already produce the grouping the UX wants. A 12-month-sheet plan puts all
12 independent sheet-creates in wave 0, which reads to a user as *"create the 12 month
sheets"* — the exact chunk the requirement asked for, with zero new logic. A semantic phase
layer would additionally risk a phase spanning two dependency levels, which would silently
break the gating guarantee SD-3 depends on.

**Consequence:** Wave labels do the descriptive work instead. `describeProgressiveWave`
already exists for this and is reused.

**Status:** Decided (2026-09-07).

### SD-3 — No look-ahead: wave N+1 is not generated until wave N is decided

**Decision:** The Executor is not invoked for wave N+1 until the client has posted a decision
for wave N. There is no speculative generation.

**Why:** This is the cost half of the requirement. Generating wave 3 while wave 2 sits
pending spends LLM budget on work a rejection may invalidate.

**Consequence:** Wall-clock for a fully-accepted large build is *no better* than today, and
is slightly worse (per-wave HTTP overhead + human latency between waves). That is an accepted
trade: the win is that a *bad* build is abandoned after one wave instead of twelve, and the
user sees something actionable in seconds rather than minutes.

**Status:** Decided (2026-09-07).

### SD-4 — Failure/rejection is skip-and-continue, with dependency cascade

**Decision:** When a wave fails deterministic checks or the user rejects it, the run does not
abort. The client's `decision` on `/continue` is one of `accepted` | `rejected` | `skipped`,
and the run proceeds to the next wave — **except** that every subtask transitively depending
on a rejected/skipped/failed subtask is cascade-skipped, never executed.

**Why:** Aborting the whole plan throws away work the user already accepted and paid for. The
cascade is what keeps skip-and-continue safe: running "populate Main's formulas" after
"create Main" was skipped would target a sheet that does not exist.

**Consequence:** The final summary must report skipped subtasks honestly — an incomplete
build reported as complete is exactly the false-completeness failure `CODEBASE_ANALYSIS.md`
§3.7 keeps re-teaching. Cascade logic mirrors the frontend's existing
`collectCascadeRejectIds`, and the backend already has `collectDownstreamSubtasks` in
`agenticLoop.service.ts` doing the same graph walk.

**Status:** Decided (2026-09-07).

---

## 3. Protocol

```
POST /excel-ai/conversation           { message, sheetData, ... }
  → event: status      "Planning your request..."
  → event: plan         { subtasks[], waveCount }      ← whole plan, up front (SD-2)
  → event: actions      { ..., runId, waveIndex: 0, waveTotal: N, stepwise: true }
  → event: wave_ready   { runId, waveIndex: 0, waveTotal: N, hasMore: true }
  → stream ends                                         ← connection released

POST /excel-ai/conversation/continue  { runId, decision: 'accepted', readback? }
  → event: actions      { ..., runId, waveIndex: 1, waveTotal: N }
  → event: wave_ready   { runId, waveIndex: 1, waveTotal: N, hasMore: true }
  → stream ends

  ... repeat ...

POST /excel-ai/conversation/continue  { runId, decision: 'accepted' }
  → event: conversation_end { summary, skippedSubtasks[] }
  → event: wave_ready   { runId, waveIndex: N-1, waveTotal: N, hasMore: false }
```

`wave_ready` is a **new SSE event type**. It is what tells the client "this stream is over but
the run is not" — distinguishing a paused run from a finished one, which `conversation_end`
alone cannot express.

`readback` is optional on `/continue`. When present it carries the post-apply observed state
of the sheets the accepted wave touched, and is merged into the next wave's Executor context.
Absent readback degrades to today's shadow-workbook prediction — never an error.

---

## 4. Run state — `agent_runs`

```typescript
interface AgentRun {
  runId: string;                    // indexed, unique
  conversationId: string;
  userId?: string;                  // ownership check on /continue — never from the body
  traceId: string;
  prompt: string;
  status: 'awaiting_decision' | 'running' | 'completed' | 'failed' | 'abandoned';
  waveIndex: number;                // wave most recently emitted
  waveTotal: number;
  subtasks: SubTask[];              // the whole plan, frozen at plan time
  waves: string[][];                // subtask ids per wave, frozen at plan time
  /** Per-subtask outcome so far — actions already emitted, and why one was skipped. */
  subtaskStates: Array<{
    subtaskId: string;
    actions: Action[];
    completed: boolean;
    verified?: boolean;
    failedReason?: string;
    decision?: 'accepted' | 'rejected' | 'skipped';
  }>;
  context: WorkbookContext;         // base context, refreshed by readback per wave
  changeSetIds: string[];           // one per emitted wave, for the dependency chain
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;                  // TTL — a run nobody continues must not live forever
}
```

**TTL, not permanence.** A run is working state, not an audit record — the `change_sets` it
produces are the durable artifact and already have their own retention. 24h, matching the
"scratch buffer for resuming today's thread" role.

---

## 5. What must NOT change

- **Shadow Workbook dry-run and deterministic checks run exactly as they do today**, per
  wave. This is a sequencing change, not a verification change (the requirement says so
  explicitly, and it is the single easiest thing to break here).
- **Nothing writes to the workbook before Accept** (TASKS.md #148).
- **Already-accepted waves stay independently revertible** — each wave has its own
  `change_set`, which is already true today via `createActionWaveChangeSets`.
- **Tier 0/1/2 are untouched.** This is a Tier 3-only change.
- `computeExecutionWaves` **schedules on `dependsOn` edges and ignores array position** —
  pinned by `test/task-graph.util.spec.ts`, and load-bearing for the Planner's emission-order
  token-budget rule (TASKS.md #83). Nothing here may change that.

---

## 6. Open questions

1. **Does a resumed run re-verify already-accepted waves?** Current answer: no — accepted
   waves are locked, mirroring `lockedPassIds` in today's loop. Worth revisiting if a
   readback ever shows an accepted wave landed differently than predicted.
2. **What happens if the client never calls `/continue`?** The run TTLs out after 24h. There
   is no server-side nudge; the workbook is in a valid partial state either way because every
   accepted wave was applied and every unaccepted one never touched the sheet.
3. **Credit accounting** — `CREDIT_SYSTEM.md` CD-3 debits once per completed turn. A stepwise
   run is now N turns' worth of LLM work under one user intent. Not resolved here; flagged
   because the two features landed in the same week and the interaction is real.
