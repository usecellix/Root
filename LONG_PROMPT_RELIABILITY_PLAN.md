# Long-Prompt Reliability Plan

Status: Phases 1–8 ALL IMPLEMENTED and unit-tested (Sept 23, 2026). Every defect found by live runs so far is fixed (#298→#300, #299→#301, #302→#303, #311–#318); run 4 passed every check but died at wave 7 of 8 on out-of-credits, so it does not count. All 8 smoke prompts are wired (#305) but only the ledger has ever run. Still **not** meeting §6's Definition of Done — zero clean end-to-end runs. Next: `CELLIX_SMOKE_CASE=ledger`, then `=all`. See §0 for the honest scoreboard.
Owner context: written Sept 21, 2026 after TASKS.md #259–#275. Update the **Status** column and the **Implementation log** at the bottom after each phase.

---

## 0. What this plan got wrong (read this first)

Written Sept 23, 2026, after implementing all five phases and watching live runs fail anyway.

**The original diagnosis was partly wrong.** §1 blamed concurrency and fan-out. That was real but secondary. The measured bottleneck turned out to be per-subtask workload: a single month subtask, running completely ALONE with no contention, still hit `max iterations (10)`. Phase 2 was built for the wrong problem and, as its own Risks note records, delivers no benefit when its template fails. Phase 1.5 — which was not in the original plan at all — did the real work.

**Every phase so far has fixed one failure and created the next.** This is the single most important pattern in this document:

| Fix | What it solved | What it then broke |
|---|---|---|
| #270 "template must compute" | derived columns were blank | pushed the planner into 95 elided subtasks (#271) |
| #265 width floor | unreadable columns | flattened all 13 columns to an identical 40pt (#273) |
| Phase 1.5 (#280) | subtask too heavy to finish | header row narrower than the rest step expected (#283) |
| #283 parser | that mismatch | handled ONE phrasing; next run used another (#284) |
| #284 range validation | phrasing variance | rejected a self-correcting description (#289) |
| Phase 1.5's header step | drift and timeouts | left row 2 unwritable, blocking every formula (#289) |

Each fix was correct. The pattern is the problem: **changes to one stage keep creating preconditions the next stage cannot satisfy**, and nothing checks for that except the next live run. Phases 6–8 exist to break that loop.

**Live-run scoreboard (the only evidence that counts):**

| Date | Outcome |
|---|---|
| Sept 22 | months built, headers wrong (#283) |
| Sept 22 | same error, different phrasing (#284) |
| Sept 22 | whole months phase silently dropped (#285) |
| Sept 23 (smoke) | 12 months + headers perfect; all 12 formula steps blocked, Main never built (#289) |
| Sept 23 (smoke) | harness itself died at 5 min — Node's fetch body timeout, fixed (#290) |
| Sept 23 (smoke) | **all 7 waves ran, all 12 months + formulas built, zero dangling refs** — but Main written to and never created (#294) |
| Sept 23 (smoke) | all 12 months built with **correct headers** (first run ever to check), but the Main subtask's own formulas were rejected as referencing an unknown sheet — run ended at wave 4 of 6, Main never built (#296) |
| Sept 23 (smoke) | **all 8 waves ran, 12 months + Main all built, headers verified correct for the first time, 11 of 12 derived columns carry formulas, zero dangling refs** — April silently skipped its own formulas (#298) and Main is written to before it is created (#299) |
| Sept 23 (smoke) | all 12 months + headers again, but all 12 formula steps failed to converge — each retry refused as an overwrite of its OWN previous attempt (#302, pre-existing) — so Main was gated off and never built |
| Sept 23 (smoke) | **every check passed for the first time** — 12 months + Main, headers correct, ALL 12 derived columns carrying formulas (#302 fixed), zero dangling refs, zero writes-before-create — but the run died at wave 7 of 8 on an out-of-credits error, so this is NOT a clean run (and the harness wrongly called it PASS; fixed in #304) |
| Sept 25 (LIVE, Excel) | first live run after #304–#310, model `z-ai/glm-5.3`. Steps 1–7 of 8 applied cleanly (12 months, headers, formulas, totals, KPIs, chart), but Main!A19's live consolidated view showed `#SPILL!` — the header step wrote formulas inside its spill area (#311) — and step 8 re-emitted that formula onto its own `#SPILL!`, which the overwrite guard refused on every Accept, stranding the run (#312). Both fixed. The panel showed the user model-facing error text (#313, open) |
| Sept 25 (LIVE, Excel) | re-run, but the backend had NOT been restarted, so still pre-#311 code. All 12 months built; 5 of Main's 7 subtasks failed (#315, open) — and the run closed **"All steps applied."**, a §6 item 3 silent failure (#314, fixed: the summary now counts subtasks that failed inside an accepted wave) |
| Sept 25 (LIVE, Excel) | third run, still pre-#311 code. Plan came out coarser (3 waves). The formulas step failed wholesale: Main's single subtask failed, and because of #315 that dropped all 12 FINISHED month subtasks from the record while a fallback branch still shipped them (#318); the shipped card carried eleven identical Lists writes, the second refused on every Accept (#317). Root cause of #315 — earlier-wave dependencies read as unmet — also explains run 2's lost Monthly Totals. All fixed |
| Sept 25 (LIVE, Excel) | fourth run, old backend AND old client. Steps 1–5 clean (12 months, formulas, Main totals); A19 `#SPILL!` from #311; step 6 re-emitted A19 (#312) and was blocked AFTER its title, KPIs and chart had already landed, then refused at A1 on every retry by its own title (#319). Rejected; formatting step cascade-skipped; closing summary then wrongly said the KPIs/chart were not applied and quoted planner text (#320) |
| Sept 25 (LIVE, Excel) | fifth run, same old backend, new client: **first run to complete all 7 steps with every subtask delivered, no Accept blocked.** The step-7 re-emission of A19 went through because the cell already held that exact formula (#319 idempotency), and #321's red card named the spill blockers. NOT clean: Main!A19 `#SPILL!` from #311 (backend fix not loaded) until G19/I19/M19 are cleared. Next run must be on a restarted backend |
| Sept 25 (LIVE, Excel) | `run_1790327330470_tkx11y6`: **all 7 of 7 steps accepted, every subtask completed, "All steps applied." — the first run today to reach the end.** Client fixes #319/#321 live-confirmed: the step-7 Accept that re-wrote A19 went through (idempotent write) instead of blocking, and the red card named the spill blockers ("the list at Main!A19 can't fill in: G19, I19 and M19…") with a one-click clear. Still NOT clean: the backend was never restarted, so #311's server-side strip never ran and A19 needed that manual clear |
| Sept 25 (LIVE, Excel) | `run_1790331172604_c0njd8s`: **9 of 9 steps, every subtask completed, zero client errors, zero read-back mismatches, "All steps applied."** — the first run with nothing at all to report. Still NOT counted toward §6: the user's 15:41 restart started a second backend that could not bind :4001 because the 11:52 process (PID 3676, `npx ts-node`) was never stopped, so this was still pre-#311 server code (old Main layout; #322–#325 untested live) |

Zero clean end-to-end runs so far. The deterministic parts (Phase 1.5's sheet/header/table) have been solid for several runs; every remaining failure has been in the LLM-driven step that follows, or in the seam between them.

**What "works perfectly" has to mean here.** An LLM pipeline cannot be made to never fail. The achievable bar, and the one this plan should be judged against, is in §6.

---

## 1. Problem statement

Long / compound prompts ("multiple sheets for every month + a main dashboard + payment columns ...") fail intermittently and unpredictably. Evidence (Mongo `agent_runs`, `requests.log`, two consecutive live runs of the same prompt):

- The plan is correct (all 12 months + Lists + Main planned).
- The 12 independent month-create subtasks are grouped into ONE parallel wave (`computeExecutionWaves`).
- In both runs ALL 12 failed to complete, a DIFFERENT random subset each time: `OpenRouter could not verify available credits for this request in time`, or `hit max iterations (10)`.
- Downstream symptoms: missing/blank month sheets, generic `Column1..N` headers, `#REF!`/`#VALUE!` on Main (KPI cells `=SUM(B5:B16)` inherit errors from month rows that point at sheets that were never created), headers that don't match the prompt.

### Root causes

1. **Cost and failure risk scale linearly with the number of repeated entities.** One LLM generation per month/branch/employee, each expected to independently produce the same structure.
2. **Unbounded fan-out** hit the provider's concurrency ceiling (partly mitigated by TASKS.md #275: cap of 3).
3. **Provider errors are treated as subtask failures** and burn the 10-iteration budget, instead of being retried as transient.
4. **Content is re-generated, not copied.** Headers/sheet names the user spelled out in the prompt are re-typed by the Executor and drift.
5. **No post-build reconciliation.** A partial failure is reported and the user must retry manually; nothing checks the workbook against the plan.

### Design principle

Use the LLM to decide WHAT to build once. Build the repeated parts deterministically. Verify the workbook against the spec before showing the user.

### Already done (do not redo)

- #261 wave success gating (dependents don't run on failed prerequisites)
- #266/#262 missing-sheet-create nets
- #271 elided-description guard
- #274 incomplete subtasks ship nothing and are reported (no partial garbage)
- #275 `MAX_WAVE_CONCURRENCY = 3` (stopgap; Phase 3 replaces it)

---

## 2. Phases

| # | Phase | Fixes | Status |
|---|-------|-------|--------|
| 1 | Structured spec extraction; headers/names copied from spec | Headers don't match prompt; Column1..N | ✅ Done (Sept 21, 2026) — see log; not yet live-verified |
| 1.5 | Split each pinned subtask into a deterministic header/table step + a lighter "rest" step | The template itself hitting max iterations/timeout SOLO — the real bottleneck, not concurrency | ✅ Done (Sept 22, 2026) — see log; not yet live-verified |
| 2 | Template + replicate for N similar subtasks | Random missing/blank months; concurrency load; drift between sheets | ⚠️ Live-tested Sept 22, 2026 — code correct, but delivers no benefit (and a real time cost) when the template fails; see Risks |
| 3 | Adaptive throttling + transient-error retry | OpenRouter credit error; iteration budget wasted on provider errors | ✅ Done (Sept 23, 2026) — TASKS.md #286 |
| 4 | Post-build reconciliation (auto-fill gaps) | Anything Phases 1–3 still miss; #REF! on Main; manual retry burden | ✅ Done (Sept 23, 2026) — TASKS.md #287 |
| 5 | Up-front plan summary / ETA for big builds | User surprise; ambiguity questions stay for real ambiguity | ✅ Done (Sept 23, 2026) — TASKS.md #288 |
| 6 | **Plan-integrity gate** (pre-execution) | A plan that is already wrong before any LLM call is spent on it | ✅ Done (Sept 23, 2026) — TASKS.md #291 |
| 7 | **Stage-seam contract tests** | The "each fix breaks the next stage" pattern in §0 | ✅ Done (Sept 23, 2026) — TASKS.md #292; caught a real bug on its first run |
| 8 | **Resumability** | A dropped connection orphaning a long run with no way back | ✅ Done (Sept 23, 2026) — TASKS.md #293 (server) + #307 (client: the panel now offers to continue) |

Build order: 1 → 2 → 3 → 4 → 5. Phases 1–2 remove most load and drift at the source; 3–4 are the safety net; 5 is UX.

---

### Phase 1 — Structured spec extraction

**Goal:** the explicit facts in the prompt (sheet names, column lists, the "for each X" entity list, dropdown values, derived columns) are extracted ONCE into a typed spec and copied verbatim into actions, not re-typed by the Executor.

**Approach**
- Add a `BuildSpec` type: `{ sheets: [{ name, role: 'entry'|'dashboard'|'lookup', columns: string[], derived: [{header, formulaHint}], lists: {...} }], repeatedEntities: { key: 'month', values: string[], templateSheet } }`.
- Extract in the planner output (extend the planner schema) or a single cheap extraction call. Prefer extending the planner so there is no extra round trip.
- Deterministic header writer: a subtask whose sheet is in the spec gets its header row from `spec.sheets[i].columns`, emitted as a BATCH_SET by code. The Executor only handles what is not in the spec (formatting choices, dropdown validation wiring).
- Deterministic check (new checker): header row written for a spec'd sheet must equal `spec.columns` (order + text). Mismatch = subtask fails.

**Files likely touched:** `planner.agent.ts`, `prompts/planner.prompt.ts`, `types/agent.types.ts` (PlannerOutput), new `utils/build-spec.util.ts`, new `checkers/spec-conformance.checker.ts`, `agenticLoop.service.ts` (inject spec into executor context / deterministic header action).

**Acceptance**
- For each of the 7 analogous prompts, every created sheet's header row equals the prompt's column list, character for character.
- No `Column1..N` headers in the smoke harness output.
- Unit tests: spec extraction on the 8 known prompts; checker rejects a wrong/missing/reordered header.

**Risks:** extraction misreads prose column lists. Mitigation: when the spec has low confidence for a sheet, fall back to current behavior and surface it (do not silently guess).

---

### Phase 1.5 — Split the deterministic part off each pinned subtask (added Sept 22, 2026, out of build order)

**Why this exists, and why it jumped the queue:** two consecutive LIVE 12-month runs both had the template subtask (running completely SOLO, before Phase 2's cloning or any concurrency ever entered the picture) hit `"hit max iterations (10)"` or time out. Both waves overran the loop's 480s budget by about the same margin (497s, 498s) — not a fluke, a reproducible ceiling. This is direct proof the bottleneck was never the concurrency Phase 2/3 target: a SINGLE subtask asked to create a sheet, write a 13-column header row, build a table, write 3 row-2 formulas, add 3 dropdowns, set 13 column widths and apply a font — all in one Executor generation — is simply too much work to reliably finish, with or without other subtasks competing for API calls.

**Goal:** shrink what one subtask has to do, by removing the one part of it that is already 100% code-certain — the create+header+table piece — the moment Phase 1's `expectedHeaders` exists for it. There is no judgement call left in "create this sheet, write these exact columns in row 1, wrap a table around them" once the columns are known; generating it with an LLM only adds cost and failure risk with nothing to show for it.

**Approach**
- `utils/header-table-split.util.ts`: `splitSpecPinnedSubtasks` turns every Phase-1-pinned subtask (one with `expectedHeaders`) into two — a new deterministic step (`isDeterministicHeaderStep: true`) built entirely from `expectedHeaders`/`targetSheet` by `buildHeaderTableActions` (ADD_SHEET + header BATCH_SET + CREATE_TABLE, zero LLM calls), and the ORIGINAL subtask — same id, so every existing `dependsOn` reference to it keeps resolving — now depending on the new step and told not to redo what it already built.
- `agenticLoop.service.ts`'s wave worker (`runOne`) short-circuits on the flag before ever touching the Executor: the header step cannot time out, drift, or hit the iteration cap, because it never makes a model call at all.
- `ComputedColumnChecker` exempts the new step (it deliberately writes a computed-sounding header with no formula of its own — that is now the "rest" step's job, a wave later).
- `template-replicate.util.ts`'s clone-detection (`normalizedSignature`) was extended to normalize sheet-name tokens inside `dependsOn` entries too, not just the description — without it, the "rest" steps (still the ones costing an LLM call) silently stopped being clone-groupable, since each one's `dependsOn` now includes a different month's header-step id. The header step's own id is deliberately built from the sheet name (`hdr_January`) rather than the arbitrary original subtask id, specifically so that normalization can find it.
- Along the way, found and fixed a second, unrelated live bug (TASKS.md #279): the client's ADD_SHEET handler reads only `action.name`, but the normalizer's generic `sheetName`-copying plus the Executor prompt's generic "set sheetName" guidance let the model emit ADD_SHEET with no `name` at all — a confirmed cause of the "RichApi.Error: argument is invalid" failures seen in frontend.log.

**Acceptance**
- The month-create wave splits into two plan-waves: an all-deterministic header/table wave (near-instant, zero LLM calls) and a lighter formulas/dropdowns/widths/font wave.
- A subtask given the full monolithic workload that fails to converge (reproduced from the live shape) succeeds once split, because the "rest" step alone is what actually has to finish.
- Existing dependents (Main's consolidation subtasks) need no changes — their `dependsOn` references the original subtask id, unchanged by the split.

**Risks (updated Sept 22, 2026 — both of these HAVE now happened):** this phase reads the planner's own prose to decide what the deterministic step should build, and prose varies. TASKS.md #283 built the header row from the narrower `expectedHeaders` while the "rest" step still described a wider layout, so INSERT_COLUMN collided with an occupied column; TASKS.md #284 then showed the parser fix itself was phrasing-specific and broke on the very next run's wording. Both are now covered — the parser handles all four observed phrasings and validates against a range hint, and the already-built instructions are STRIPPED from the rest step rather than merely warned against — but the underlying exposure is structural: a fifth phrasing would fall back to `expectedHeaders` again. The fallback is safe (it degrades to the pre-#283 behavior, never a wrong header row), and stripping removes the contradiction that turned that fallback into a visible failure, so a future mismatch should now be inert rather than corrupting. Worth revisiting if a live run ever shows a sheet built narrower than its own description again.

---

### Phase 2 — Template + replicate

**Goal:** N structurally identical sibling subtasks run as ONE LLM-built template plus N-1 deterministic clones.

**Approach**
- Detect "same shape": subtasks with identical description modulo one substitution key (month name, branch, etc.) — driven by `spec.repeatedEntities`, not string heuristics alone.
- Run the template subtask through the normal Executor/Verifier path once (first entity).
- On success, generate the other N-1 sheets' actions by cloning the template's accepted actions and substituting the sheet name (and any sheet-name references in formulas/table names, e.g. `tblJanuary` → `tblFebruary`).
- Clones skip the Executor entirely: zero LLM calls, no concurrency, identical structure.
- Dependents (Main consolidation) depend on all clones as before.

**Files likely touched:** `utils/plan-coverage.util.ts` (repeat handling exists: `ensureRepeatForCoverage`), new `utils/template-replicate.util.ts`, `agenticLoop.service.ts` (wave execution: run template first, then expand), `conversation.service.ts` (stepwise waves).

**Acceptance**
- 12-month prompt: exactly 1 Executor generation for the month sheets; 12 identical-structure sheets; no random missing months across 5 consecutive runs.
- Table names / range refs are correctly rewritten per sheet (tests assert no `tblJanuary` inside the February clone).
- Prompts with genuinely different sheets are unaffected (no false-positive cloning): test with prompt 6/7 shapes.

**Risks:** false-positive "same shape" merges different sheets. Mitigation: only clone when the spec marks them as one repeated entity; otherwise run normally.

**Live run finding (Sept 22, 2026):** a real 12-month run had the template (January) time out. The fallback correctly avoided shipping its garbage, but building 11 siblings individually costs as much as pre-Phase-2 PLUS the time spent attempting and timing out the template first — that wave's request measured 498s against the loop's 480s budget, and several months never got a turn at all. Phase 2 has no benefit, and a real cost, when the template itself fails. Not yet mitigated — a candidate fix (shortening the template's iteration budget before falling back, or running one sibling in parallel with the template as a hedge) is unscoped follow-up work, not yet a phase.

**Also found in this same run, unrelated to Phase 2 itself but exposed by it:** TASKS.md #278 — `onWaveComplete` (the progressive per-wave "Applied" Accept card, separate from the final result `buildLoopResult` already guards per #274) flattened every subtask's actions with no completion check, so May and July's partial in-progress header cells (3 and 4 columns, from subtasks that never reached `completed: true`) were shown as "Applied" mid-build. Fixed: filtered to `state.completed === true`, same principle as #274.

---

### Phase 3 — Adaptive throttling + transient retry

**Goal:** provider errors never consume subtask iteration budget and never fail a subtask on the first hit; concurrency adapts to what the provider tolerates.

**Approach**
- Classify errors in the LLM client layer: transient (`could not verify available credits`, 429, 5xx, timeouts) vs. permanent (auth, invalid request).
- Transient: retry the SAME call with exponential backoff + jitter (e.g. 1s, 2s, 4s, max 3), invisible to the iteration counter.
- Replace fixed `MAX_WAVE_CONCURRENCY = 3` with an AIMD controller: start at 3, halve on transient error, +1 after N consecutive successes, floor 1, ceiling 4–6.
- Log every backoff to `planner.log` so live runs are diagnosable.

**Files likely touched:** LLM client / provider wrapper (find where the OpenRouter call lives), `agenticLoop.service.ts` (`runWithConcurrencyLimit` → adaptive), new `utils/adaptive-concurrency.util.ts`.

**Acceptance**
- Simulated provider that rejects the Nth concurrent call: run completes with zero failed subtasks.
- Iteration counter is unchanged by transient retries (test).
- `hit max iterations` only appears for genuine non-convergence.

**Risks:** retries stretch wall-clock time. Mitigation: bound total retries per call; keep the 480s loop budget in mind.

---

### Phase 4 — Post-build reconciliation

**Goal:** before presenting "done", diff the built workbook against the spec and auto-fix gaps.

**Approach**
- New reconcile step at the end of the run (`finishStepwiseRun` / one-shot path): for each spec sheet check exists, header row equals spec, derived columns have formulas, no formula-error cells, Main references only existing sheets.
- If gaps exist: generate ONLY the missing pieces (deterministic from spec where possible, LLM only if needed), bounded to 2 rounds.
- Make subtasks idempotent (skip if sheet already has the expected header) so re-runs never duplicate or overwrite.
- Final message: either "complete", or a short specific list of what is still missing and why.

**Files likely touched:** `conversation.service.ts`, new `utils/reconcile.util.ts`, reuse `SemanticFormulaChecker` / shadow workbook.

**Acceptance**
- Inject a failure (drop 3 month sheets from a wave): reconcile restores them without user action.
- Zero `#REF!` on Main in the smoke harness for all 7 prompts.
- Reconcile is a no-op (0 actions) on a fully correct build.

**Risks:** infinite fix loops. Mitigation: hard cap of 2 rounds; anything left is reported honestly (false-completeness principle).

---

### Phase 5 — Up-front plan summary

**Goal:** big builds show a short plan summary + ETA before running; clarifying questions remain only for real ambiguity.

**Approach**
- When plan has >= N subtasks or a repeated-entity expansion, emit a one-line summary ("13 sheets + dashboard, ~X min") and proceed (or ask to confirm, product decision).
- Do not add comprehension questions for load failures; those don't help.

**Acceptance:** summary appears for the 8 known prompts; not for short prompts.

---

### Phase 6 — Plan-integrity gate (pre-execution)

**Goal:** never spend a single Executor call on a plan that is already provably wrong.

**Why:** #285 lost all twelve month sheets because a coarse phase expanded to zero subtasks and nothing noticed until the workbook came back empty. That was detectable the instant planning finished, for free, with no model call. The recovery shipped in #285 is real but it is a rescue, not a gate.

**Approach**
- After planning, before execution, assert: every repeated entity named in the request has at least one subtask; no phase contributed zero subtasks; every `dependsOn` id resolves; every `targetSheet` is either created by some subtask or already in the workbook.
- A violation is fixed deterministically where possible (the #285 synthesizer already does this) and otherwise fails loudly BEFORE the build starts, when the user has lost nothing.
- Log the assertion result either way, so a plan that passes is on the record as having passed.

**Acceptance**
- The #285 run shape (p2 empty) is caught at plan time, not from the workbook.
- A plan referencing an unplanned sheet fails the gate.
- A correct 12-month plan passes with zero added latency and no model call.

---

### Phase 7 — Stage-seam contract tests

**Goal:** stop the §0 pattern — a change to one stage silently breaking the stage after it.

**Why:** this is the single largest source of live failures in this document. Phase 1.5 built a header row the rest step could not work with (#283), then a table whose row 2 did not exist (#289). #279 was the same shape across the server/client seam: the server emitted `ADD_SHEET` with `sheetName` while the client handler read only `name`, and nothing tested that the actions we emit are actually applicable by the code that applies them.

**Approach**
- One fixture set of realistic subtasks, driven through EVERY seam in order: planner output → spec/split → executor context → normalizer → client handler contract.
- Assert the postconditions each stage owes the next, explicitly: after the deterministic step, the sheet reports the expected row AND column count; a formula targeting row 2 is writable; every emitted action type carries the fields its client handler actually reads.
- Run it in CI on every change to any stage, so the seam is checked without needing a live run to find it.

**Acceptance**
- The #289 shape (table spans A1:J2, row 2 unaddressable) fails this suite.
- The #279 shape (ADD_SHEET without `name`) fails this suite.
- Adding a new action type without wiring its client handler fails this suite.

---

### Phase 8 — Resumability

**Goal:** a long build survives a dropped connection.

**Why:** observed live — the task pane lost its connection, the run sat in `awaiting_decision` forever, and nothing on either side could resume it. Long builds are hit hardest because they are long.

**Approach**
- On reopening a conversation, detect an unfinished run and offer to continue it.
- Server side, treat `awaiting_decision` past a threshold as resumable rather than abandoned.

**Acceptance:** killing the client mid-build and reopening offers to continue, and continuing completes the build.

---

## 3. Verification strategy (applies to every phase)

1. Regression tests reproducing the exact live-captured failure shape.
2. Full suites: backend `npx jest`, client `npx vitest run`, `tsc --noEmit` both sides.
3. `Server/eval/ledger-smoke.ts` against the original booking-ledger prompt AND the 7 analogous prompts (Rental, Gym, Loan/EMI, Freelance Invoice, Attendance/Salary, Fleet/Fuel, Event/Wedding). Pass criteria: all sheets created, headers equal spec, no formula errors, no widths under 40pt.
   **Status: never actually done.** These 7 have been listed since the plan was written and have only ever been checked by running `ComputedColumnChecker` over them offline. Every live failure so far has come from the ONE prompt we do test. Until the other 7 run, "works for long prompts in general" is an assumption, not a finding.
   **Both missing checks now exist** (TASKS.md #295, Sept 23, 2026): header text vs. the prompt's own column list, and formulas actually present in the derived column. Both are wired into the VERDICT, and both were self-tested against the #283 and #284 shapes before being trusted with a live run — the harness can no longer pass a sheet whose headers are wrong. The 7 analogous prompts remain unrun.
   **All eight prompts are now wired** (TASKS.md #305, Sept 23, 2026): `eval/smoke-cases.ts` defines them, `CELLIX_SMOKE_CASE=all` runs the suite and fails unless every case passes. `CELLIX_SMOKE_DRY_RUN=1` validates the definitions with no server and no model call. They have not yet been RUN — that needs credits — but the run is now one command rather than seven days of work.
4. Live run in Excel by the user; snapshot logs/Mongo before and diagnose after.
5. Confirm dev server is running fresh code (nodemon restart / process start time) before any live test.
6. Add a TASKS.md row per phase.

## 4. Expected results once Phases 1–5 are done

| Area | Today | After |
|------|-------|-------|
| 12-month build | 12 LLM generations, random subset fails | 1 generation + 11 deterministic clones |
| Headers | sometimes generic/wrong | copied from the prompt's own column list |
| Provider errors | fail the subtask / burn iterations | retried invisibly with backoff |
| Missing sheets | user must notice and retry | auto-detected and auto-filled |
| Main dashboard errors | `#REF!`/`#VALUE!` from missing sheets | none (reconcile guarantees sheets exist first) |
| Time | fast but unreliable | comparable or faster (far fewer LLM calls) |
| Long prompts in other domains | untested / inconsistent | same pipeline, verified on 8 prompts |

Honest limits: prompts whose sheets are genuinely all different still cost one generation each (Phases 3–4 make that reliable, not cheaper). Ambiguous prompts still need a clarifying question. Nothing guarantees a provider outage won't stop a build; it will be reported precisely instead of shipped half-built.

## 5. Implementation log

Update this section after each phase: date, TASKS.md row number, what changed, test counts, live-run result.

| Phase | Date | TASKS.md # | Summary | Tests | Live result |
|-------|------|-----------|---------|-------|-------------|
| 1 | Sept 21, 2026 | #276 | `SpecExtractorAgent` reads the user's column lists once (grounded: any column not verbatim in the prompt drops that sheet); `SubTask.expectedHeaders` + an EXACT COLUMN HEADERS line in the description pins header-writing subtasks; new `SpecConformanceChecker` fails a wrong/missing/reordered header row or a table created with no header row (the Column1..N shape). Extra computed columns allowed. Additive: any extractor failure leaves the plan untouched. **Deviation from plan:** headers are enforced by checker + retry feedback, NOT written deterministically by code (deferred to Phase 2, where clones make it free). | 193 suites / 1797 tests (+14), tsc clean | Pending — next run should show every month sheet's headers equal the prompt's list |
| 2 | Sept 21, 2026 | #277 | New `utils/template-replicate.util.ts`: `findCloneGroups` groups same-wave subtasks whose descriptions are identical once the sheet name AND its 3-letter form (tblJan/tblFeb) are normalized, with equal dependsOn/estimatedActions, min group of 3. `AgenticLoopService` wave now builds the template via the normal Executor path, then stamps the siblings from its accepted actions with `cloneActionsForSheet` (sheetName, sheet-qualified refs, table names renamed; other sheets like Lists untouched). A failed template falls back to building each sibling individually, so it can only remove work. **Deviation from plan:** detection is by normalized-description equality, not by a `spec.repeatedEntities` field (Phase 1's spec carries columns, not the entity list); a subtask that differs beyond the sheet name is simply not cloned. | 194 suites / 1808 tests (+11), tsc clean | Pending — next run should show a single Executor generation for all 12 months |
| 2 (live check) | Sept 22, 2026 | #278 | Live run of the actual 12-month prompt: Phase 1 confirmed working (headers correct wherever a subtask got to write them). Phase 2's code is correct but the template (January) timed out, so all 11 siblings had to be built individually anyway — no benefit, and the attempt+timeout cost contributed to that wave exceeding the 480s loop budget (measured 498s), leaving several months never attempted. Separately found and fixed #278 (see above): `onWaveComplete` shipped partial fragments from incomplete subtasks (May, July) as "Applied" mid-build, a second instance of the bug #274 fixed only in the final result. | +1 test (agentic-loop-multi-failure.spec.ts), 194 suites / 1809 tests, tsc clean | Live-confirmed: Phase 1 headers correct; Phase 2 no benefit on template failure (documented as an open risk, not yet fixed); #278 fixed and will be checked on the next run |
| 1.5 | Sept 22, 2026 | #279, #280 | Pivoted from the phase order (user-approved) after Phase 2's second live-test showed the SAME failure with no concurrency involved. Split the create+header+table piece off each pinned subtask into a zero-LLM-call deterministic step; found and fixed a second bug along the way (#279, ADD_SHEET missing-name client crash) while investigating the same log evidence. | 16 new tests (header-table-split.spec.ts) + 2 (agentic-loop-header-split.spec.ts) + 4 (normalize-executor-output.spec.ts, #279) + 1 Phase-1 test updated, 196 suites / 1828 tests, tsc clean | Pending — next run should show two waves per month-group (instant header/table, then lighter formulas wave) and no ADD_SHEET client errors |
| 1.5 (live check) | Sept 22, 2026 | #281 | Live run: user reported the Stop button doing nothing on a slow build ("still thinking") and asked whether a clarification-answer turn is treated as part of the original prompt (investigated, not changed — confirmed already true at the Planner level via #259). Root-caused two real, separate gaps from the same evidence: abortSignal was never checked inside a subtask's OWN iteration loop (only between waves), so Stop couldn't interrupt a subtask mid-iteration; and `withBuildSpec` fed only the current turn's short reply to the Phase 1 gate, so a resumed long build silently lost every protection built this session and nearly hit the 480s ceiling again running the OLD unsplit path. Fixed both. | 2 new tests (agentic-loop-abort.spec.ts) + 3 (orchestrator-spec-history.spec.ts), 198 suites / 1833 tests, tsc clean | Pending — next run should show Stop actually halting a long-running subtask, and a resumed build after a clarifying question still getting the deterministic header/table split |
| 1.5 (live check 2) | Sept 22, 2026 | #282, #283 | User asked why the Planner's confirmed full-context understanding (#281/#259) still produced a plan covering only 1 of 12 months. Root-caused #282: the Planner's OWN two-pass/token-budget sizing (`needsTwoPassPlanning`, `resolveTier3ComplexityScore`) scored the raw short reply, not `history` — fixed with the same reconstructed-prompt approach #281 used for the spec-extraction gate. A follow-up smoke test (isolated port 4011, real backend, no mocks) then PASSED cleanly for a FRESH (non-resumed) run of the full prompt: all 12 months + Main created, zero dangling refs, zero unreadable columns, wave shape confirming Phase 1.5 fired (36 actions in one wave = 12 months × 3 deterministic actions). User then ran it live and hit a NEW bug: #283, a header-row mismatch between the deterministic step (built from the narrower `expectedHeaders`) and the "rest" step's still-describes-a-wider-layout description, causing INSERT_COLUMN to collide with real data and a scrambled placeholder/real header mix on February. Fixed by parsing the planner's own full intended layout out of the description and preferring it. | +3 tests (planner-resumed-turn-sizing.spec.ts, #282), +7 tests (header-table-split.spec.ts, #283), 199 suites / 1843 tests, tsc clean | Smoke test (isolated instance): PASS. Live workbook: found and fixed #283 mid-run; that specific workbook is already corrupted by the pre-fix code path — needs a fresh run to confirm |
| 1.5 (live check 3) | Sept 22, 2026 | #284 | #283's fix did not hold — the next live run used a DIFFERENT header phrasing ("Write headers in row 1 (A1:M1): ...") than the one #283's parser handled, fell back to the narrow 10-column list, and hit the identical INSERT_COLUMN collision, leaving January as 5 real headers + Column10..Column2. Broadened the parser to all four phrasings seen across this session's real runs (with the range hint matched explicitly, since its own colon was being read as the list separator), and — the more durable half — now STRIP the already-built create/header/table sentences from the rest step instead of only prepending a warning they contradicted. | +10 tests (header-table-split.spec.ts), 199 suites / 1853 tests, tsc clean; additionally verified by running the real parser/stripper over the ACTUAL January and February text pulled from run_1790098924906_2b7eqv6 (both -> 13 cols, Nights at F, stripped down to the formulas) | Pending live re-run |
| BLOCKER | Sept 23, 2026 | #285 | Found from the next live run's logs BEFORE implementing phases 3-5: a whole coarse phase (all twelve month sheets) expanded to ZERO subtasks, and the build shipped "Step 1 of 3 ✓ Applied" without them. `ensureRepeatForCoverage` could not help (it clones a sibling; there was none) and the merged plan hid the failed phase's own low confidence behind the coarse pass's high. Now synthesized from the phase's own repeatFor/kind, with the misleading "could not plan" note dropped once the work is actually in the plan. | +7 tests (planner-empty-phase-recovery.spec.ts), 1 pre-existing two-pass test updated | Pending live re-run |
| 3 | Sept 23, 2026 | #286 | Transient-vs-permanent classification in a new util; the live credit-check 402 is transient (its own message says "Retry shortly") while a genuine insufficient-credit 402 still fails fast. Retry lives in `OpenRouterService.complete` — BELOW the agentic loop — so it is invisible to the iteration budget and "hit max iterations" means non-convergence again. #275's flat cap of 3 replaced by AIMD (halve on fault, +1 per run of successes, floor 1, ceiling 6), held per run. | +22 tests (phase3-transient-retry, phase3-loop-acceptance), #275's cap test updated for the now-adaptive width | Both plan acceptance criteria covered by test; pending live confirmation |
| 4 | Sept 23, 2026 | #287 | New `reconcile.util.ts` + a hook in `finishStepwiseRun`: four outcome checks (planned-but-missing sheet, created-but-headerless sheet, header mismatch, dangling formula refs). Deterministic repairs only — a missing sheet with `expectedHeaders` is rebuilt exactly via Phase 1.5's builder; a dangling reference is reported, never guessed. Repairs go out as a normal acceptable change set; the whole thing is wrapped so the safety net can never break a finished build. | +9 tests (phase4-reconcile.spec.ts), 2 stepwise fixtures made internally consistent | "Restores 3 dropped sheets without user action" and "no-op on a correct build" both pinned by test |
| 5 | Sept 23, 2026 | #288 | One `status` line up front for plans of 6+ subtasks ("Building 14 sheets in 27 steps — roughly 7 minutes…"). Uses `status`, NOT the `plan` event, which is the Plan MODE contract and renders a "Run as Action" button mid-build. Deterministic header steps excluded from the estimate since they cost no model call. A statement, never a question. | +7 tests (phase5-plan-summary.spec.ts) | Pending live confirmation |
| 6 | Sept 23, 2026 | #291 | New `plan-integrity.util.ts`, run after planning and before execution at no model cost. Checks what the REQUEST implies against what the plan targets — the one thing no existing net did, and the gap #285 fell through. Repairs missing months by cloning a month that IS planned; fatal only when there is nothing to model them on. | +9 tests (phase6-plan-integrity.spec.ts) | Pending live confirmation |
| 7 | Sept 23, 2026 | #292, #294 | One realistic 12-month plan driven through every seam — planner → gate → pinning → split → emitted action → client contract → reconciliation — asserting the postconditions each stage owes the next. **Caught a real production bug on its first run** (#292): the split resolved 13 columns but `buildHeaderTableActions`, running later against the header step's own short description, rebuilt from the narrow 10. Then the smoke run exposed #294, the same family: the structural checker was reading a shadow context in which the run's own write had already conjured the sheet. | +13 seam assertions, +3 structural-intent tests | This is the phase that pays for itself — two live-class bugs found without a live run |
| 8 | Sept 23, 2026 | #293 | `findResumableRun` + `resumableRun` on `getConversation`, so a build stranded by a dropped connection can be continued instead of rebuilt. Client half landed the same day (#307): the panel captures it during the hydrate it already does, and offers "Continue" on the composer dock. Resuming continues the EXISTING run rather than starting a new build. | +6 tests (phase8-resumability.spec.ts) | Both sides done; still needs a real killed-client test in Excel |
| 7 (fixes) | Sept 23, 2026 | #300, #301, #303 | Fixed the three defects the smoke runs found: #298 (a rest step reported success having skipped its own formulas; `ComputedColumnChecker` had gone blind to it), #299 (Main written to before its ADD_SHEET), #302 (a subtask's retry refused as an overwrite of its OWN previous attempt). | See TASKS.md rows | #302 and #299 live-confirmed in run 4 (all 12 derived columns carrying formulas, 0 writes-before-create) |
| harness | Sept 23, 2026 | #304, #305 | #304: the harness printed PASS on run 4 even though the run died at wave 7 of 8 — the harness itself committing §6 item 3. `error` frames and waves-vs-`waveTotal` now fail the verdict. #305: all 8 §3 prompts defined in `eval/smoke-cases.ts`; `CELLIX_SMOKE_CASE=all` runs them sequentially; `CELLIX_SMOKE_DRY_RUN=1` validates each case (every column verbatim in its own prompt) with no server. | All 8 cases validate dry | The 7 analogous prompts have never run live |
| 7 (class) | Sept 23, 2026 | #306 | `checker-context-discipline.spec.ts`: the shared root of #294, #296, #302 stated as one rule — a checker asking "what was here before?" gets a context without the run's own writes; one asking "is the result right?" gets one with them. | +6 tests; 210 suites / 1974 tests | n/a (structural) |
| 4 (ext) | Sept 23, 2026 | #309, #310 | #309: `relaxConsolidationDependencies` retargets Main's cross-sheet dependencies onto the months' deterministic header steps, so one month's failed optional tail can no longer gate the dashboard off (cost: a KPI may briefly read a still-blank column). #310: reconcile repairs a missing derived formula by copying a sibling's formula at the same header AND column position; no matching sibling → nothing written, gap stays reported. | 211 suites / 1986 tests, tsc clean | Pending live run |
| 7 (seam) | Sept 25, 2026 | #311, #312 | Live run found the consolidation formula (#142/#269) colliding with the Executor's writes in its spill area, and being re-emitted every wave because it was never recorded with any subtask. Spill area now cleared of value writes; formula attributed to a subtask before `recordWaveResult`. Same §0 family: the consolidation pass and the header step each correct alone, broken at their seam. | +7 tests (consolidation-spill-collision.spec.ts), both fixes verified to fail when disabled; 212 suites / 1993 tests, tsc clean | Pending re-run in a fresh workbook |
| 7 (seam) | Sept 25, 2026 | #314–#318 | Three more live runs' worth of seam bugs, all in how a stepwise wave's result is judged and recorded: earlier-wave dependencies read as unmet (#315), shipped ≠ recorded (#318), identical cross-subtask writes colliding in one apply (#317), a closing summary blind to failures inside accepted waves (#314). Client: blocked-Accept message rewritten for users (#313), selection crash (#316), stale red test (#308). | Backend 213 suites / 2002 tests; client 528/528; tsc clean both | Pending re-run — backend MUST be restarted first (plain ts-node, no watch) |

## 6. Definition of done

"Works smoothly for long prompts" is otherwise unfalsifiable, and without a bar we will keep chasing one more fix. The bar:

1. **The smoke harness passes on 8 of 8 prompts** (the booking ledger plus the 7 analogous ones), with the two added checks from §3 — headers match the prompt, derived columns carry formulas.
2. **Three consecutive clean live runs** of the booking-ledger prompt in a real workbook. Three, not one: after this many surprises, one clean run is luck.
3. **Zero silent failures.** Any run that does not fully succeed says exactly what is missing. A build that reports success with a missing sheet is a failure of this bar even if everything else is right.
4. **A fresh workbook each time.** Leftover sheets from previous attempts have repeatedly made runs impossible to read.

Item 3 is the one that actually matters. Phases 1–5 reduce how often things break; only honest reporting makes a break survivable. Any future work should be judged against that: does it reduce silent failure, or only the visible kind?
