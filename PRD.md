# PRD.md — Cellix v1

> **Status: DRAFT — pending review.**
> Derived from `VISION.md` (source of truth for product vision). This document holds detailed requirements only.
> Architecture belongs in `ARCHITECTURE.md`; implementation work in `TASKS.md`.
>
> *Drafted: August 17, 2026*

---

## 1. Scope Decisions for v1

Four decisions resolve ambiguities left open by `VISION.md`. They govern everything below.

| # | Decision | Consequence |
|---|---|---|
| **D1** | **Task pane only.** v1 operates on the workbook already open in Excel via the Office.js add-in. | "Create a new workbook" means creating sheets and structure in the live session — not emitting a downloadable file. Web upload and server-side file generation are **non-goals** (§5). Independently corroborated by Rows' failure as a replacement spreadsheet — see §9.2. |
| **D2** | **Two co-primary personas, equal weight.** India CA / tax practitioner and general finance analyst. | Every must-have feature must serve both. Where they diverge, the PRD names the divergence explicitly rather than silently favouring one. |
| **D3** | **Conditional formatting is a v1 must-have.** Pivot tables and data validation are nice-to-have. | CF requires a new rule-based action type; static `HIGHLIGHT_CELL` does not satisfy it. See M7. |
| **D4** | **Tiered metrics.** Hard numeric gates on reliability and safety; definitions with TBD targets for UX and usage. | Launch is blocked by Tier A only. Tier B needs real traffic to baseline. See §6. |
| **D5** | **Both safety gaps close in v1.** Full-fidelity revert and snapshot-backed checkpoints are must-have, not deferred. | Promotes two items out of nice-to-have and into M5. Every `VISION.md` safety promise is kept in v1 — at a real cost in engineering scope. See M5.1, M5.2. |

> **On D1 and VISION.md.** `VISION.md` says a user can "open **or upload**" a workbook and receive "a usable file." v1 delivers the *open* half. This is a deliberate deferral, not a contradiction — the file-generation path is a roadmap item, and the vision document does not need editing to accommodate it.

---

## 2. User Personas

Personas are archetypes derived from the target users named in `VISION.md`. They are design tools, not research findings — no user study backs the specific details, and they should be revised once real usage data exists.

### 2.1 Primary — Priya, Chartered Accountant (India, practice or in-house)

**Context.** Works across many client workbooks in a compliance calendar. Files arrive from clients in inconsistent shapes: merged header cells, stray totals mid-table, mixed date formats, a sheet per month with drifting column orders.

**Jobs to be done**
- Normalize a client-supplied workbook into a consistent structure without losing a single original row.
- Reconcile one dataset against another (books vs. portal extract, bank vs. ledger) and surface only the mismatches.
- Build recurring statements and schedules — the same output shape, new data, every period.
- Trace any number back to its source when a reviewer or client challenges it.

**Pains today**
- Manual restructuring is the bulk of the work and none of the value.
- A wrong formula that *looks* right propagates silently into a filing.
- Generic AI tools explain formulas instead of applying them, and cannot see the workbook.

**What success looks like.** The agent restructures the workbook, states plainly what it changed and what it assumed, and Priya can verify the assumptions faster than she could have done the work.

**Adoption blocker.** One incident of silent data loss in a client file ends adoption permanently. Trust is the gating constraint, not capability breadth.

**Divergence from Arjun.** Priya's tolerance for a clarification question is *high* — she would rather be asked than have the agent guess at a tax treatment. Weight clarification behaviour toward her.

### 2.2 Primary — Arjun, Financial Analyst (FP&A / corporate finance)

**Context.** Owns a small number of workbooks he knows intimately — a model, a monthly reporting pack, a board dashboard. Works under a close deadline each cycle.

**Jobs to be done**
- Build reports, summaries, and dashboards from data he already has.
- Add analysis to an existing model — a variance column, a scenario, a new driver — without disturbing what's around it.
- Refresh a recurring pack with a new period's data.
- Make output presentable for an audience that will not read a raw grid.

**Pains today**
- Repetitive rebuild work each cycle.
- Chart and layout fiddling consumes time better spent on analysis.
- Multi-step asks ("summarize by region, chart it, highlight the drops") require decomposing the work himself.

**What success looks like.** He describes the outcome in one long message and gets a working, presentable result — then iterates conversationally ("use EBITDA instead," "move it to its own sheet").

**Adoption blocker.** If the agent breaks his model's formula dependencies, the recovery cost exceeds the time saved.

**Divergence from Priya.** Arjun's tolerance for clarification questions is *low* — mid-flow interruptions break his working rhythm. Weight inference-when-safe toward him. **Resolving D2's tension:** ask only when the ambiguity is materially consequential *and* unresolvable from workbook context; otherwise infer and disclose the assumption in the report (M10). Disclosure is what lets one behaviour serve both personas.

### 2.3 Secondary Personas

Served if the primary journeys serve them; never a reason to add scope.

- **Consultant / small-business owner** — needs a usable workbook built from nothing; lower Excel fluency, higher tolerance for imperfect output.
- **Manager** — consumes rather than builds; wants a readable summary and to ask follow-up questions of the data.
- **Student / Excel power user** — exploratory usage; tolerant of failure, valuable for surfacing edge cases early.

---

## 3. Must-Have Features (v1)

Ordered by the priority stack from `VISION.md`: **Accuracy → Reliability → Safety → Verifiability → Speed**.

Each feature carries a **state** flag: `Exists` (shipped, needs hardening to hit §6 targets), `Partial` (implemented with a named gap), `New` (to be built).

---

### M1 — Workbook Understanding · `Exists`

Before planning any change, the agent reads workbook structure: sheets, used ranges, tables, formulas, formatting, named ranges, charts.

**Requirements**
- Never assume a workbook or target range is empty because the user's phrasing implies a fresh start.
- Represent large sheets within token budget without discarding structural signal — the TOON compression path in `frontend/src/context/`.
- Distinguish header rows, data rows, and total rows; identify input cells vs. calculated cells.

**Acceptance.** Given a workbook with drifting column orders across sheets, the agent reports the actual per-sheet schema rather than assuming uniformity.

---

### M2 — Request Routing and Complexity Tiering · `Exists`

Each request is classified and dispatched at proportionate cost: deterministic shortcuts, read-only data queries, and Tier 0–3 write paths.

**Requirements**
- Small prompts execute immediately; large prompts trigger deeper planning. Both must work (`VISION.md`, *Core Product Requirement*).
- Misroute cost is asymmetric — routing a mutation to a read-only path is a correctness failure; over-escalating a simple task costs only latency. **Bias escalation.**
- Route classification is recorded on every request for metric attribution (§6).

**Acceptance.** The four complexity levels named in `VISION.md` — small, medium, large, and complex-existing-workbook — each complete end to end on representative prompts.

---

### M3 — Execution Action Set · `Exists`

All changes flow through typed actions in `shared/action.types.ts`, applied via the frontend engine.

**v1 coverage.** Values and formulas; row/column insert, delete, hide; sheet create, rename, copy, delete; tables; charts (create + restyle); aggregation; named ranges; sort, filter, freeze, merge; comments; column width and autofit.

**Requirements**
- Semantic shape matters, not just the resulting cells: "add a column" must insert a column, not write into a guessed index. Structural intent must survive into the action.
- Unsupported requests fail explicitly and say what is unsupported — never a silent partial application.

---

### M4 — Verification Before Reporting Success · `Exists`

Generated changes are treated as unsafe until checked. Verification covers completeness, formatting, formula semantics, and overwrite occupancy, with scoped retry of only the failed subtasks.

**Requirements**
- **A response of "Done!" is not success unless verification passed.** This is the single hardest rule in the product (`VISION.md`, *Reliability Is a Core Feature*).
- Verification failure that cannot be repaired must be reported as partial completion, naming what failed.
- Dry-run against the shadow workbook before Office.js apply, so a failing plan never touches the real workbook.
- **Post-apply outcome check (added Aug 26 2026).** After a change set is applied, the affected cells must be read back and compared against the change set's own recorded `after` values; any divergence is reported to the user rather than being absorbed silently. Everything above this line verifies *intent* — the plan, the actions, the pre-write state. None of it can observe what the workbook actually became.
- **A function that can refuse, truncate, or partially fail must have a return type that can express it.** A `void` return or a bare `string` cannot, and the result is indistinguishable from success at the call site. This is a requirement, not a style note: it is the shared root cause of the defects in `TASKS.md` #80 and #82.

**Acceptance.** Tier A metric `false_success_rate` = 0% (§6.1). No exceptions — this gates launch.

**Status note (Aug 26 2026).** This feature was marked `Exists`; the Aug 25–26 competitor study (`COMPETITIVE_STUDY_SHORTCUT.md`) shows the existing verification cannot deliver its own acceptance metric, and the honest status is closer to `Partial`. Two independent reasons:
1. **Circular completeness check.** `CompletenessChecker` compares emitted actions against `estimatedActions` — a number produced by the same plan it is verifying. When the Planner under-plans, the plan verifies as complete *by construction*. Observed live: a token-truncated plan silently lost its final subtasks and passed with `fallback: false, retried: false` (#82).
2. **No outcome verification.** Nothing reads the workbook back after apply. Three separate user-visible failures in the study were invisible to action-level checking — a sheet created under the wrong name, an Accept that applied nothing, and a sort that destroyed date formats. Each would have been caught by comparing actual post-write cells to expected ones.

The machinery is largely present and unwired: `ChangeSetService` already captures before/after diffs, and `shadowWorkbook.ts` already models expected post-write state. See `CODEBASE_ANALYSIS.md` §3.15 for the gap analysis and the open scoping question (all writes vs. Tier 3 only; blocking vs. advisory).

---

### M5 — Non-Destructive Safety · `Partial` → must ship complete

Four layers: overwrite guard, preview with explicit accept/reject, change-set capture, and revert.

**Requirements**
- Every value-writing action passes the overwrite guard. Writing to an occupied cell without explicit confirmation must throw, not warn.
- The user sees what will change *before* it changes, and accepts or rejects.
- Every applied change set captures before/after cell state for audit and revert.

#### M5.1 — Full-fidelity revert · `New` (per D5)

Inverse-action coverage today spans cell values and formulas only ([`diff.engine.ts:113-149`](cellix_backend/src/audit/diff.engine.ts#L113-L149)). Formatting, charts, and sheet creation are not restored — reverting a dashboard build currently leaves cleared cells and an orphaned sheet.

**Requirements**
- **Any action the agent can apply, it must be able to undo.** No action type ships without a defined inverse. This is a standing constraint on M3, not a one-time cleanup: adding a new action type means adding its inverse.
- Where a true inverse is genuinely impossible, the action is identified as irreversible **at preview time**, before the user accepts — never discovered at revert time.
- Revert is itself verified (M4). A revert that half-restores must fail loudly rather than report success — the A1 rule applies to undo exactly as it applies to forward execution.

**Acceptance.** After a full dashboard build (new sheet, formulas, chart, conditional formatting, column widths), a single revert returns the workbook to a state indistinguishable from before the request.

#### M5.2 — Snapshot-backed checkpoints · `New` (per D5)

`CheckpointAction` carries only `{ message }` ([`action.types.ts:284-287`](shared/action.types.ts#L284-L287)) — a log marker. `VISION.md` promises the user can "restore a previous checkpoint."

**Requirements**
- A checkpoint captures enough workbook state that restoring returns the workbook to its condition at capture time.
- Checkpoints are created automatically before significant changes, per the never-destroy-user-work principle — not only when the agent thinks to emit one.
- Restore is a distinct user affordance from single-change revert: revert undoes the last change, restore returns to a named point.

> **M5.1 and M5.2 are the highest-risk items in this PRD.** Both personas' adoption blockers (§2) sit precisely here, which is why D5 promoted them out of nice-to-have. Expect them to dominate v1 safety engineering — and note that M5.1's "every action needs an inverse" constraint raises the marginal cost of every future action type, including M7.

---

### M6 — Ask / Plan / Action Modes · `Exists`

Three modes, persisted per workbook. `ask` and `plan` are read-only; write actions are stripped server-side, not merely hidden in the UI.

**Requirements**
- Read-only enforcement is server-side. A client-side-only guard is not acceptable.
- `plan` returns the intended plan without a change set, so a user can inspect intent before authorizing execution.

---

### M7 — Rule-Based Conditional Formatting · `New`

**Per D3.** The headline example in `VISION.md` — *"highlight the regions where revenue dropped more than 10%"* — is a conditional-formatting rule, not a set of statically coloured cells.

**Requirements**
- A new action type expressing a rule over a range: cell-value comparison, formula-driven, top/bottom N, and colour scale.
- Rules are live: they re-evaluate when the underlying data changes. Statically colouring cells that match *today* is an explicit non-solution — it produces a workbook that lies after the next data refresh.
- Rules survive the round trip: readable by M1 so a follow-up request can modify an existing rule rather than stacking a duplicate.

**Acceptance.** After the agent applies a >10% drop rule, editing a source value so a different region crosses the threshold updates the highlighting with no further agent involvement.

---

### M8 — Large Multi-Step Prompts · `Partial`

A single large prompt describing an entire workbook system must work without the user decomposing it.

**Requirements**
- Decompose into dependent subtasks; execute in verifiable phases (structure → sheets → formulas → consolidation → dashboard → formatting → verification) rather than one uncontrolled operation.
- **Dependency awareness.** A dashboard must reference the underlying data. A dashboard of hardcoded numbers disconnected from the monthly sheets is a failure even if every displayed number is currently correct.
- **Partial-failure recovery.** On failure, identify completed work, identify what failed, repair only that, re-verify, continue from the last valid state. Never restart a large task from scratch.
- Works against **existing** workbooks: preserve existing data, detect inter-sheet differences, normalize where appropriate.

**Acceptance.** The hospitality workbook prompt (`VISION.md`, *Example: Hospitality / Payment Management Workbook*) produces a workbook satisfying every bullet in *Definition of Success for Large Prompts* — including that cross-sheet references still work after new records are added.

---

### M9 — Intelligent Clarification · `Exists`

**Requirements**
- Ask only when a requirement is materially ambiguous **and** cannot be resolved from workbook context.
- When inference is safe, infer and disclose the assumption in the report (M10) rather than interrupting.
- One consolidated question, not a sequence of prompts.

> This is the D2 tension resolved in practice — see §2.2. Tune against Priya's higher tolerance and Arjun's lower one by making disclosure, not interrogation, the default.

---

### M10 — Change Reporting · `Exists`

After execution the user is told: what changed, where, what was created, what was assumed, and what remains unresolved.

**Requirements**
- Assumptions are stated explicitly — this is what makes M9's inference-by-default safe.
- Unresolved issues are surfaced, never omitted to make the summary read cleanly.
- Changed locations are specific enough to navigate to.
- **Undoing the change just made is reachable from where it happened**, not only from a separate history surface. Reverting the most recent applied change is the overwhelmingly common case and should not require opening a panel and locating its top entry. *(Implemented Aug 26 2026: `LastChangeRevert` renders inline at the end of the conversation, showing the latest applied change set and a Revert control; the full per-entry history, source citations, and older reverts remain in `ChangeHistoryPanel` behind the composer's history icon.)*
- A revert control must only be offered for a change set that is actually revertable — never for one already reverted (which would re-apply it) or one never applied. A failed revert reports the failure; it does not quietly leave the row unchanged (M4's return-type requirement applies here too).

---

### M11 — Conversational Continuity · `Exists`

Follow-up instructions operate on the existing workbook and prior work: *"now add a chart," "actually use EBITDA," "undo the last change."*

**Requirements**
- Targeted modification of previously built structure — never a silent full rebuild.
- Workbook and task context persist across turns within a session.

---

## 4. Nice-to-Have Features

Valuable, explicitly **not** gating v1. Ordered by expected value per unit of effort.

> Full-fidelity revert and snapshot-backed checkpoints previously sat in this table. **D5 promoted both into M5** — they are must-have. What remains here is genuinely deferrable.

| Feature | Rationale | Note |
|---|---|---|
| **Data validation / dropdowns** | Required for the hospitality example's Payment Status and Source columns. Moderate Office.js lift. | Highest-value deferral — promote first if the hospitality-class prompt proves central. |
| **Pivot tables** | Named in `VISION.md`. Heaviest lift in this table; `AGGREGATE_TABLE` partially substitutes for the common summarize-by-group case. | Do not promote until aggregation demonstrably falls short. |
| **Sample-data self-test** | `VISION.md` asks the agent to test with representative data before declaring completion. Strong reliability signal. | Meaningfully raises verified-completion confidence; consider promoting if Tier A targets prove hard to hit. |
| **Domain tools (GST / ITC / TDS / Ind-AS)** | Deterministic stubs exist, unwired. Priya-facing differentiator. | **Blocked on CA sign-off** — do not wire on engineering judgment alone. |
| **Chart styling depth** | Beyond the current colour-scheme options. | Arjun-facing polish. |
| **.xlsm support** | `VISION.md` lists it "where technically supported." | Office.js constraints likely make this a non-starter in the task pane; verify before scheduling. |

---

## 5. Non-Goals (Explicitly Out of Scope for v1)

Listing these is the point of the section — each is a plausible request that gets a clear "not now."

### 5.1 Deferred by scope decision D1

| Non-goal | Reasoning |
|---|---|
| **Web upload surface** | A second execution path (server-side workbook manipulation) doubles the correctness surface while M5's gaps are still open. |
| **Standalone file generation (downloadable .xlsx/.csv)** | Requires a server-side writer independent of Office.js. Deferred with the upload surface. |
| **PDF / PowerPoint generation** | Named as future work in `VISION.md`. |

### 5.2 Deferred per `VISION.md` *Explicit Non-Goals*

| Non-goal | Reasoning |
|---|---|
| **Google Sheets** | Different API model; v1 correctness work would not transfer cleanly. |
| **Real-time multi-user collaboration** | Concurrent edits invalidate the read → plan → verify → apply sequence that M4 depends on. |
| **Enterprise permissions / RBAC** | No multi-tenant requirement in v1. |
| **Scheduled autonomous workflows** | Running unattended requires reliability the product has not yet demonstrated. Revisit only after Tier A targets hold in production. |
| **Large-scale external data integrations** | Data arrives in the workbook. |
| **Advanced web research** | Out of the spreadsheet-execution problem. |
| **Mobile applications** | Excel task pane is desktop-first. |

### 5.3 Additional exclusion (not in `VISION.md`, ruled out here)

| Non-goal | Reasoning |
|---|---|
| **Financial / tax advice as output** | The agent executes spreadsheet work. It does not advise on tax positions or accounting treatment — material given Priya's persona and the unwired GST/ITC/TDS domain tools. Assumptions get disclosed (M10); professional judgment stays with the professional. |

---

## 6. Success Metrics

**Per D4.** Tier A gates launch with hard numbers. Tier B is defined and instrumented but baselined from real traffic.

> **The numeric targets in Tier A are proposed, not derived.** They are drafted for you to adjust — they encode a judgment about acceptable risk, which is a product decision, not an engineering one. Flagged again in §8.

### 6.1 Tier A — Launch Gates (hard targets)

| # | Metric | Definition | Target | Source |
|---|---|---|---|---|
| A1 | **False success rate** | Requests reported complete where verification failed, was skipped, or did not run. | **0%** — no tolerance | `request_logs` + verifier outcome |
| A2 | **Workbook corruption rate** | Applied change sets leaving the workbook unopenable or structurally invalid. | **0%** | Manual + automated post-apply open test |
| A3 | **Overwrite guard integrity** | Writes reaching Office.js that touch an occupied cell without explicit confirmation. | **0 occurrences** | Guard instrumentation |
| A4 | **Verified task completion rate** | Write-route requests where actions applied *and* verification passed with no unresolved failures. Denominator excludes requests the user cancelled at preview. | **≥ 90%** | `request_logs` |
| A5 | **Unintended modification rate** | Applied change sets containing ≥1 cell change outside the planned scope. | **< 1%** | `change_sets` vs. plan scope — ⚠️ **needs new instrumentation** |
| A6 | **Formula error rate** | Applied formulas evaluating to an Excel error (`#REF!`, `#VALUE!`, `#NAME?`, `#DIV/0!`) not present before the change. | **< 2%** | ⚠️ **needs new instrumentation** — post-apply evaluation check |
| A7 | **Recovery success rate** | Of runs with ≥1 failed subtask, share where scoped retry produced a passing result. | **≥ 60%** | `planner_logs` |

**A1–A3 are absolute.** They encode the never-destroy-user-work principle and the "Done! is not success" rule. A single A3 occurrence is a release blocker, not a bug in the queue.

**A4's 90% is the most debatable number here.** It trades reach against trust: raising it narrows the prompt range v1 accepts, lowering it admits more failures into both personas' adoption-blocker territory. Worth an explicit call.

**Instrumentation gaps — closed 2026-08-19, `TASKS.md` #48–49.** A5 and A6 are now computed on every change set (`ChangeSet.unintendedChanges`/`formulaErrorsIntroduced`, `Server/src/audit/diff.engine.ts`), tier-agnostically. Two scoping notes worth carrying into any use of these numbers: A5 is sheet-granularity (an action's own declared `sheetName`), not cell/range-granularity — it catches a change landing on a sheet nobody touched, not a wrong-range write within an already-declared sheet. A6 detects an error string appearing as a changed cell's value; it cannot detect a syntactically-valid formula that would evaluate to an error in real Excel, since the shadow workbook doesn't evaluate formulas (that's `FormulaValidatorService.validateReferences`'s job, pre-apply). Rollup/dashboard surfacing (`TASKS.md` #50–51) is still open — the raw per-change-set signal exists, the aggregate view does not yet.

### 6.2 Tier B — Baselined from Real Traffic (targets TBD)

Defined and instrumented for v1; thresholds set after a baseline period.

**Accuracy**

| Metric | Definition |
|---|---|
| Formula correctness | Applied formulas that compute the intended result — beyond merely not erroring. Requires a curated evaluation set; not derivable from production logs alone. |
| Data transformation correctness | Cleaning/restructuring operations preserving all original data and producing the requested shape. |
| Report/dashboard correctness | Generated outputs whose figures reconcile to source data, and whose references are live rather than hardcoded (M8). |

**User experience**

| Metric | Definition |
|---|---|
| Time to first successful task | New user's first message → first verified completion. |
| Tasks completed without manual correction | No user edit to agent-written cells within the session. |
| Corrections per task | Mean follow-up turns correcting rather than extending prior work. Distinguishing correction from extension needs a classification rule — define before instrumenting. |
| Preview acceptance rate | Previews accepted vs. rejected. **Interpret with care:** a high rate may mean good output or insufficiently scrutinized previews. Read alongside correction rate, never alone. |
| Revert frequency | Applied change sets subsequently reverted. Readable as a clean signal only because M5.1 ships full fidelity — a partial revert feature would have made low usage ambiguous. Still directional: rising revert frequency indicates output quality problems, near-zero may indicate either good output or an undiscovered affordance. |

**Product usage**

| Metric | Definition |
|---|---|
| Daily / weekly active users | Users issuing ≥1 request. |
| Tasks per user | Requests per active user per period. |
| Repeat usage | Users returning in a subsequent period. |
| Successful tasks per session | Verified completions per session — pairs with A4 to distinguish "works often" from "works often enough to finish a job." |

### 6.3 Segmentation

All Tier A and B metrics segment by **route** and **complexity tier**. An aggregate A4 of 90% masks the case that matters: large multi-sheet prompts (M8) failing at a materially higher rate than single-cell edits. **Report per-tier or the number misleads.**

---

## 7. Definition of Done for v1

From `VISION.md`, *What "Done" Looks Like for v1*, with D1 applied — a user opens a workbook in Excel, describes a task in natural language, and the agent:

1. Understands the workbook (M1)
2. Understands the request and routes it proportionately (M2)
3. Creates an execution plan for complex requests (M8)
4. Modifies or creates the required content (M3, M7)
5. Preserves unrelated existing content (M5)
6. Validates the changes (M4)
7. Detects and repairs common failures (M4, M8)
8. Clearly summarizes the work and its assumptions (M10)
9. Allows the user to undo any change and restore a checkpoint (M5.1, M5.2)
10. Leaves a working workbook (A2)

**The success criterion is not how impressive the response sounds. It is that the resulting workbook is correct, usable, and safe.**

---

## 8. Open Questions

Carried forward for resolution — each changes what gets built or how success is judged.

| # | Question | Owner | Blocking |
|---|---|---|---|
| Q1 | **Checkpoint granularity.** What counts as a "significant change" that triggers automatic capture (M5.2), and how much state must a snapshot hold to be restorable within Office.js constraints? | Eng | M5.2 — D5 settled *whether*, not *how* |
| Q2 | **Irreversible actions.** Which action types, if any, have no practical inverse? Each one found becomes a preview-time warning (M5.1). | Eng | M5.1 |
| Q3 | **Instrumentation sequencing.** A5 and A6 are unmeasurable today. Build before or alongside feature work? | Eng | §6.1 — gates cannot bind until measurable |
| Q4 | **Domain tools.** Who provides CA sign-off, and on what timeline? | Product | Nice-to-have promotion for Priya |
| Q5 | **Correction vs. extension.** What rule distinguishes a corrective follow-up from an additive one? | Product + Eng | §6.2 UX metrics |
| Q6 | **Prompt evaluation set.** Who curates the representative prompts across all four complexity levels that A4 and B-accuracy are measured against? | Product | Makes every accuracy metric real |

**Resolved during drafting:** v1 surface (D1), persona weighting (D2), conditional formatting as must-have (D3), metric tiering (D4), safety-gap closure (D5), and the A4 target at ≥90%.

---

## 9. Competitive Landscape

*Researched August 17, 2026. Pricing and product status change frequently — re-verify before using any figure in an external document.*

### 9.1 Summary

| Product | Core value proposition | Pricing model | Clearest gap |
|---|---|---|---|
| **Microsoft Copilot for Excel** | Native, in-the-box AI. **Agent Mode** (GA March 2026) takes outcome-based instructions, autonomously plans steps, writes formulas, cleans data, applies formatting, checks its own output, and iterates. Dual-model (GPT 5.2 / Claude Opus 4.5). Unmatched distribution — already inside the product the user has open. | Per-seat add-on **on top of** an existing M365 licence. **$30**/user/mo enterprise; **$21**/user/mo Copilot Business (≤300 users, repriced up from an $18 promo on July 1, 2026); bundles at $23.50 (Business Standard) and $32 (Business Premium); E7 Frontier Suite $99. | **Microsoft disclaims determinism in its own documentation.** The `COPILOT` worksheet function is documented as suited to scenarios "where deterministic accuracy is not required," explicitly advising against numerical calculations, "tasks with legal, regulatory or compliance implications," and "financial reporting, legal documents, or other high-stakes scenarios." Independent testing also reports weak error-detection/auditing and trouble with merged cells, blank rows, and inconsistent headers. |
| **Rows AI** | *(Historical)* AI-native browser spreadsheet with built-in data integrations and an AI Analyst. Reached 2.2M users and 17B function executions. | *(Historical)* Free (5 AI tasks); Plus $8/user/mo; Pro $79/mo + $8/user; Enterprise custom. | **The product no longer exists.** Acquired by Superhuman (announced Feb 2026); Rows.com fully wound down **May 31, 2026** — roughly eleven weeks before this draft. Spreadsheets, data connections, automations, and published dashboards stopped working. The team went to strengthen Coda. |
| **Shortcut AI** | The stated inspiration in `VISION.md`. Autonomous Excel agent for finance that builds and edits workbooks end to end, across web, desktop, Excel, and Google Sheets. Closest analogue to Cellix's ambition. | **Credit-based.** Free: 20 weekly credits. Pro: **$100**/mo (annual) for 1,000 monthly credits, unlimited file creation/edits, API access. Teams: $320/mo base + $100/additional user, 1,000 pooled credits. Enterprise custom. Consumption stated as **2–15 credits per message**. | **Credit-model opacity and instability.** At 2–15 credits/message, a 1,000-credit plan buys somewhere between ~65 and ~500 messages — a 7× spread the buyer cannot forecast. Users additionally report mid-subscription terms changes (daily + monthly credits switched to weekly-only, a >90% reduction) and buggy credit refresh. |
| **Numerous AI** | Cheapest path to AI inside a spreadsheet: in-cell `=AI` / `=NUM.AI` functions for Excel and Google Sheets, designed to run AI across thousands of rows. | ~**$10**/mo billed annually ($1 for the first 7 days); 1,000 tokens, 500K characters of I/O, 500 formula generations. Enterprise $10/user for up to 8 users. | **Not an agent — a formula.** It populates cells with model output row by row. It cannot read workbook structure, restructure a workbook, build multi-sheet systems, verify its own results, or undo. Different category entirely. |

### 9.2 What This Means for Cellix

**Copilot is the competitor that matters, and the honest read is uncomfortable.** Agent Mode already does plan → execute → verify → iterate. **Cellix's differentiation therefore cannot be "we have an agent architecture" — that ground is taken, by an incumbent bundled into the product our users already own.** Any positioning that leans on multi-stage planning as the novelty is dead on arrival.

The defensible wedge is narrower and more specific: **Microsoft has documented itself out of exactly the work Priya does.** Guidance steering users away from financial reporting and regulatory/compliance work fences off the high-stakes finance segment (§2.1) at the vendor's own hand. That is where Cellix's Tier A gates (§6.1) become the product rather than an engineering nicety — A1 (`false_success_rate` = 0%) and A5/A6 are the claim Copilot declines to make.

> **Caveat, stated plainly:** the strongest quotes come from the `COPILOT` *worksheet function* documentation — a narrower surface than Agent Mode, and one being retired September 14, 2026. Do not represent it externally as a blanket Copilot disclaimer; that overstates the case and is checkable. The durable point is a pattern in how Microsoft hedges AI output in Excel, not a single quotable gotcha.

**Rows is the most instructive entry here, precisely because it lost.** It asked users to leave Excel for a better spreadsheet — and 2.2M users were not enough to sustain it. **This is direct evidence for D1.** The task-pane decision is not merely a scoping convenience; it avoids the migration demand that a well-funded, well-built competitor could not overcome. Worth reflecting in `VISION.md` if the file-generation roadmap ever tempts a pivot toward being a destination rather than an add-in.

**Shortcut validates the category and hands us a pricing opening.** Its credit model is its softest point: unpredictable consumption plus a mid-subscription reduction is precisely how a finance-tooling vendor loses finance buyers, who budget. A predictable model — flat seat price, or credits with a published per-task cost — is a real differentiator against the closest competitor, and cheap to deliver.

**Head-to-head evidence (Aug 25–26 2026) — the reliability differentiator is not yet earned.** `COMPETITIVE_STUDY_SHORTCUT.md` runs identical prompts through both tools with full transcripts. The uncomfortable result: **Shortcut made more mistakes than Cellix on the same task and still delivered a working workbook.** It overwrote its own formulas three times and misapplied column-width units — then caught and repaired each one, because after every step it read back what it had just done (re-reading ranges, screenshotting the sheet, once exporting the file and inspecting it with openpyxl). Cellix made fewer mistakes with worse outcomes, because nothing inspected the result.

Two consequences for this section's argument:
1. **"Verified reliability" is currently the claim, not the product.** Cellix verifies plans and actions thoroughly and never verifies outcomes (`CODEBASE_ANALYSIS.md` §3.15). Selling reliability against Shortcut requires closing that gap first; on the evidence available today the claim would not survive a head-to-head trial run by a prospect.
2. **The differentiator is available and cheap.** Shortcut's self-correction is visible, slow, and expensive — 10+ accept-gated rounds with the user watching it debug itself. Cellix's batched preview/accept is a genuinely better shape *when it works*. Outcome verification plus honest partial-failure reporting would give the same reliability with far less user-visible thrash — which is a sharper pitch than "we validate more before writing."

This does not weaken the pricing opening above; it relocates the work needed to justify it.

**Numerous sets a price floor but not a comparison.** It answers "put AI in a cell." Cellix answers "operate the workbook." Cite it only to show the category's low end; a buyer weighing Numerous against Cellix has misunderstood one of them.

**Where this leaves pricing.** The band runs $10 (Numerous) → $21–30 (Copilot) → $100 (Shortcut Pro). Copilot is the anchor nearly every buyer will compare against, and it arrives pre-bundled. **Cellix must justify a price against a competitor the buyer may already be paying for** — which points back to verified reliability and the M5 safety guarantees as the thing being sold, not raw capability. Pricing itself is out of scope for this PRD; flagged for whoever owns it.

### 9.3 Follow-on Questions

These sit outside §8 because they are go-to-market rather than product-definition, but they bear on the same decisions.

| Question | Why it matters |
|---|---|
| Does Copilot Agent Mode carry the same high-stakes caveats as the `COPILOT` function, or is it positioned more confidently? | Determines whether the §9.2 wedge is real or an artifact of one narrow doc page. **Verify before any external positioning.** |
| What does Copilot Agent Mode actually score on the §6 Tier A metrics? | If Cellix sells verified reliability, the claim needs a measured comparison — not an inference from documentation. Ties to Q6's evaluation set. |
| Does Coda inherit Rows' spreadsheet AI, and does it re-enter this market? | The Rows team and technology still exist inside Superhuman. |

---

## Appendix A — Implementation Baseline

State of the codebase as of this draft, so the `Exists` / `Partial` / `New` flags in §3 are auditable rather than asserted.

| Area | State |
|---|---|
| Action types | ~50 types in [`shared/action.types.ts`](shared/action.types.ts) — values, formulas, structure, sheets, tables, charts, aggregation, named ranges, layout, comments |
| Conditional formatting | **Absent.** `HIGHLIGHT_CELL` is static colouring, not a live rule (M7) |
| Data validation | **Absent** |
| Pivot tables | **Absent**; `AGGREGATE_TABLE` partially substitutes |
| Overwrite guard | Present — runs on value-writing actions before Office.js apply |
| Change sets / audit | Present — before/after cell capture, revert endpoint |
| Revert fidelity | **Cell values and formulas only** ([`diff.engine.ts:113-149`](cellix_backend/src/audit/diff.engine.ts#L113-L149)) — must reach full coverage per M5.1 |
| Checkpoints | **Marker only** — `{ message }`, no snapshot ([`action.types.ts:284-287`](shared/action.types.ts#L284-L287)) — must be snapshot-backed per M5.2 |
| Complexity tiering | Present — Tier 0–3, feature-flagged |
| Verification | Present — completeness, formatting, semantic-formula, overwrite-occupancy checkers with scoped retry |
| Modes | Present — ask / plan / action, read-only enforced server-side |
| Logging | NDJSON files + MongoDB (`request_logs`, `planner_logs`, `frontend_logs`); Dashboard viewer |
| Domain tools | Deterministic stubs, **unwired** pending CA sign-off |
