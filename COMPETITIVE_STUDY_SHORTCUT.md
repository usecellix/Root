# Cellix vs Shortcut — Comparative Prompt Study

**Purpose:** Run identical prompts through Cellix (Excel add-in) and Shortcut, side by side, to find gaps in intent understanding, action correctness, and response quality. Findings here should feed into `TASKS.md` as concrete, numbered follow-ups — not fixed inline during the study.

**Method:** Same prompt, same/equivalent starting workbook, run in both tools. Paste raw responses (text + actions taken) below per trial. Analysis focuses on *gaps*, not style preference, unless a style gap causes a real usability problem.

**Started:** 2026-08-25

---

## How to log a trial

Copy this block per prompt:

```
### Trial N — <short title>

**Prompt:** <exact text used in both tools>

**Starting state:** <workbook/sheet setup, if not identical defaults>

**Cellix response:**
<paste — include actions taken / preview shown, not just chat text>

**Shortcut response:**
<paste>

**Gap observed:** <what differed — missed action, wrong scope, worse formula, slower/more steps, misread intent, etc.>

**Severity:** <blocker | notable | minor | none — Cellix is fine>

**Follow-up:** <link to TASKS.md item if one is opened, or "none needed">
```

---

## Trials

### Trial 1 — Guest/booking payment tracker (12 monthly sheets + Main dashboard)

**Prompt:** "i like to have multiple sheets for all months in a year, and need a main sheet it has all the details of the remaining sheets, in the main sheet i need to have dashboard also, my need to record payments and related things ,which all month sheets include Unit No, Guest, Guest name, check in, check out, Rate per night, total amount, source, payment status, bank account"

**Starting state:** Workbook already contained an unrelated "Purchase Register" sheet (invoice/supplier data) — irrelevant to the guest-stay tracker being requested.

**Shortcut response — full run (user answered the 3 clarifying questions with a bare "yes"):**

Phase 1 — Initial questions (see above): kept Purchase Register untouched by default rather than deleting, kept both Guest/Guest Name columns (interpreted as reference vs. full name), defaulted currency to USD since "yes" didn't disambiguate — and stated these interpretations back to the user rather than silently guessing.

Phase 2 — Build, in ~10 discrete accept-gated steps, each shown as a scoped diff before applying (not one big opaque batch):
1. Create Dashboard + 12 month sheets, headers, Total Amount formula (`=(CheckOut-CheckIn)*Rate`) for 120 pre-provisioned rows/sheet.
2. Format headers/titles/column widths/date+currency number formats on all 12 month sheets.
3. **Self-inflicted bug #1:** the formatting step's `setCellRange` call passed empty placeholder values across a range that overlapped the Total Amount formula column, wiping those formulas back to blank. Caught by its own diff review, immediately re-ran a step to restore them.
4. Added a Payment Status dropdown (Paid/Pending/Partial/Cancelled) via data validation on all 12 sheets.
5. Built the Dashboard: KPI cards (Total Revenue, Total Bookings, Paid, Pending, Avg Rate/Night) and a Monthly Summary table (Bookings/Nights/Revenue/Paid/Pending/Outstanding per month + totals), formulas referencing the month sheets.
6. Built a **consolidated "All Bookings" detail table** on the Dashboard — 1,440 rows (120/month × 12), pulling every column from every month sheet via cross-sheet formula so the Main sheet genuinely mirrors "all the details of the remaining sheets" as asked, not just aggregates.
7. **Self-inflicted bug #2 (same root cause as #3 above, twice more):** applying number formats/column widths again clobbered the Monthly Summary formulas, then separately clobbered the consolidated detail table's Check-In/Check-Out/Rate/Total columns. Both times it was caught via its own verification pass and fully rewritten/restored before moving on.
8. Wrapped the Avg Rate/Night KPI in `IF(nights=0,"",revenue/nights)` proactively, to avoid showing `#DIV/0!` on an empty workbook — a small but real polish step Cellix's transcript never exhibited anywhere.
9. **Screenshot-based visual verification loop:** took a screenshot of the built Dashboard/month sheet, ran it through a vision read to check for overlapping/truncated text, found headers rendering as garbled/overlapping (`###`, smushed labels). Spent several rounds diagnosing root cause — first suspecting the wrapped `setColumnWidthAt` API wasn't applying, testing with raw Office.js `columnWidth`, then discovering via a diagnostic **file export + openpyxl inspection** that the real bug was a **unit mismatch**: it had been passing small numbers (15, 20) assuming "points," but had actually been conflating character-width and point-width units, producing genuinely tiny columns (~2.7–5 characters). Recalculated proper point values (~85–140pt) and reapplied.
10. Re-verified via screenshot that both the month sheets and Dashboard now render cleanly with no overflow/truncation.
11. Ran a workbook-wide error check (clean), deleted its own temporary diagnostic export file, wrote a `docs/decisions.md` explaining the interpretations it made under ambiguity (currency, kept columns, kept Purchase Register), and updated its own memory note.
12. Gave a concise final summary, explicitly re-surfacing the still-open ambiguities (currency confirmation, formatting preference) instead of treating its own defaults as final, and proactively offered a chart.

Phase 3 — User said "do anything": Shortcut interpreted this as license to take the chart offer it had just made, rather than doing something unrelated. Added a "Monthly Revenue" column chart to the Dashboard sourced from the Monthly Summary table, positioned in unused sheet space to the right of the detail table, removed the extra auto-generated series (Bookings/Nights) so only Revenue plotted, verified via another screenshot, and correctly noted the chart is legitimately empty right now because there's no booking data yet (not a bug).

Total: 10+ accept-gated rounds, two distinct self-caused regressions (both from the same "format step overwrites formulas underneath" pattern), both caught and repaired via the tool's own verification (screenshot + export/openpyxl) before declaring done, ending in a working, visually clean, fully-linked workbook.

**Cellix response:**
Went straight to execution, no clarifying questions, no mention of the pre-existing Purchase Register sheet at all (left ambiguous whether/how it factors in). Streamed a long sequence of low-level step logs (ADD_SHEET / CREATE_SHEET / SET_CELL per month, individually) rather than a short plan summary. Notably:
- Used **both** `ADD_SHEET` and `CREATE_SHEET` action types interchangeably across the 12 months (e.g. February and June used `CREATE_SHEET`, the rest used `ADD_SHEET`) for what should be one consistent action.
- Built a "Monthly Totals" table on Main (`A4:D16`: Month / Total Amount / Paid Amount / Pending Amount) referencing `SUM(Month!G:G)` and `SUMIF(Month!I:I, "Paid"/"Pending", Month!G:G)` — reasonable formula design, comparable in spirit to what Shortcut would eventually build, but assumes column G = Total Amount and column I = Payment Status without having confirmed the header layout was accepted/applied yet.
- Failed outright on one step: attempting to create the "Main" sheet "if it doesn't exist" instead created a second sheet named **"Main 2"**, ignoring the existence check. Error surfaced after 2 retry attempts: *"Action creates a sheet named 'Main 2' instead of 'Main' and does not respect the 'if it doesn't exist' condition."*
- Final state offered for preview: "completed 12 step(s) and prepared 13 change(s)... could not finish the full request," listing 12 sheet-creation steps as ready to accept, with the Main-sheet/dashboard formula work seemingly stuck behind the failed conditional-create step.
- **After clicking Accept: only the 12 month sheets were created with their header row (Unit No...Bank Account) populated correctly. The Main sheet / dashboard / Monthly Totals formulas were not applied at all** — the work the assistant's own log described as "prepared" and "ready" did not make it into the workbook.

**Gap observed:** Multiple, stacked. Grouped by what they actually reveal:

*Planning/UX gaps:*
1. **No clarification step** — Cellix committed to building against an ambiguous prompt (redundant Guest/Guest Name columns, undefined currency, unaddressed pre-existing unrelated sheet) where Shortcut paused to confirm, and later — even after a non-answer ("yes") — still explicitly stated back the interpretations it landed on rather than silently assuming. For a 13-sheet structural build, guessing wrong risks doing the wrong thing at scale rather than a small correction.
2. Verbose raw step-by-step tool-log streamed to the user (ADD_SHEET on January, Prepared SET_CELL on January, ...) instead of a compact plan/summary. Shortcut's steps were similarly numerous under the hood but were packaged as ~10 named, scoped, accept-gated changes with a one-line description each — materially easier to follow and to selectively reject.
3. Cellix produced only aggregate monthly totals on Main; it never attempted the literal "main sheet has all the details of the remaining sheets" ask (a full consolidated row-level table). Shortcut built exactly that (1,440-row consolidated detail table), which is closer to the actual request. **✅ ROOT-CAUSED (TASKS.md #82)** — and the cause was not a planning-quality gap at all. `logs/planner.log` shows the planner's output was **cut off by its token budget mid-subtask**; because the model closed the JSON around what it had emitted, the short plan *parsed cleanly* and passed every downstream check (`fallback: false`, `retried: false`). A prompt rule requiring exactly this consolidated table already existed and was correct (added Aug 21 as #79) — it simply sits *after* the KPI-row subtask that got truncated, so it was never generated. The malformed final subtask was then silently dropped (16 → 15) by a `.filter()` with no logging. Fixed by surfacing the provider's `finishReason` to callers, treating truncation like a parse failure in the retry ladder, and warning on dropped subtasks. *This is the same silent-partial pattern as the Accept bug, one layer earlier: something incomplete presenting as complete because the only signal was discarded.*
4. No proactive edge-case polish — e.g. Shortcut noticed and pre-emptively wrapped a likely `#DIV/0!` (Avg Rate/Night with zero bookings) before it ever surfaced. Cellix's plan had no equivalent self-review pass.

*Correctness bugs:*
5. **Inconsistent action-type selection** — `ADD_SHEET` vs `CREATE_SHEET` used interchangeably for identical intent across the 12 month-sheet steps, suggesting the planner/executor isn't normalizing to one canonical action for "create sheet if absent."
6. **"If it doesn't exist" conditional-create is broken** — produced a duplicate "Main 2" sheet instead of respecting idempotency, and this failure could not be recovered within 2 attempts. Interestingly, Shortcut's own pipeline has a parallel weak spot — its formatting step's `setCellRange` calls repeatedly clobbered formula cells it had just written (hit 3 separate times across the run: Total Amount formulas, Monthly Summary formulas, consolidated detail formulas). **The difference is entirely in what happens next**: Shortcut appears to run its own diff/verification after each step and visibly catches and repairs the regression before moving on or declaring done; Cellix hit its failure, retried twice, then surfaced an explicit user-facing error and stopped requesting confirmation to retry — arguably the more honest behavior of the two failure modes, but it never recovered on its own the way Shortcut did.
7. **Silent partial-apply gap — the most severe issue.** The assistant's own status log claimed 13 changes were "prepared"/"ready for preview," but Accept only materialized the 12 header rows; the Main sheet/dashboard (the actual centerpiece of the user's ask) never landed, with **no error or explanation shown to the user at Accept time.** This is categorically worse than Shortcut's mid-run bugs: Shortcut's regressions were self-detected and self-healed before being called done; Cellix's regression shipped past its own "ready for preview" claim, past Accept, and into the final workbook state undetected — the user had to discover it by inspecting the sheet manually.

**Severity:** blocker — the core ask (Main sheet + dashboard) was not delivered and the failure was silent at Accept time; user had to discover it manually. Shortcut took ~10x more visible steps and hit comparable internal bugs, but none of them reached the user as an undetected gap between "what the tool claimed was ready" and "what actually got applied."

**Follow-up:** none opened yet — pending more trials before filing to TASKS.md (see Running Themes).

---

### Trial 2 — Edit existing workbook: cross-month booking, bank-account breakdown, discount column

**Prompt:** "A guest checked in on the 28th of one month and checks out on the 3rd of the next month — I want to log that as a single booking. Also, some of my bank accounts got renamed (the old ones are still in the sheets) — I want a way to see, on the Dashboard, total paid amount broken down by bank account, not just by month. And I noticed Total Amount doesn't account for a discount I sometimes give — add a Discount column and make sure Total Amount still stays correct without me having to fix every row by hand."

**Starting state:** The 12-month + Dashboard workbook from Trial 1 (populated structure, live formulas, pre-provisioned rows) — deliberately chosen over a fresh workbook so the tool has to reason about existing structure/formulas rather than generate from scratch. **Confirmed: this was the same empty-of-bookings workbook state for both tools** — the monthly sheets have headers/formulas but zero actual booking rows in either run, so the comparison below is apples-to-apples on that point.

**Shortcut response — Phase 1, investigation (still running; outcome/build not yet available):**

Before writing anything, Shortcut read the workbook structure first: sheet list, Dashboard content, a monthly sheet (Jan), and the Purchase Register. This surfaced a finding neither the user nor Cellix's transcript had surfaced: **the entire guest-stay data model is empty** — all 12 month sheets have their header row and the `Total Amount` formula seeded, but zero actual booking rows (confirmed by scanning `B3:K122` across all 12 sheets, plus checking the Dashboard's 1,440-row consolidated detail table, which was correspondingly all-blank except the literal month-name labels). The only populated data anywhere in the workbook is the unrelated Purchase Register (50 rows of supplier/invoice data with no guest, bank-account, or check-in/out concept at all).

It then reasoned at length through what this implies before committing to any write:
- Explicitly considered and rejected several alternative readings (Is the Purchase Register secretly the intended target despite the column mismatch? Is data hiding in a different range/hidden sheet? — checked and ruled out each).
- Recognized that fulfilling the three sub-asks (cross-month booking, bank-account breakdown, discount column) requires either real booking data or applying purely structural/template changes that only become verifiable once data exists — and weighed whether that gap warranted stopping to ask the user versus proceeding with the structural change and flagging the emptiness afterward.
- Started scoping the concrete implementation questions this creates, e.g. where to insert the Discount column (before vs. after Total Amount) and how that column shift would ripple into the Dashboard's consolidated detail table, which mirrors the monthly sheets' column positions via relative-reference formulas.

This phase alone (no cells written yet) already surfaces the gap worth studying: **Shortcut checked whether the premise of the request (existing bookings to modify) was even true before acting; nothing in Cellix's Trial 2 transcript indicates it checked this at all.** Full build outcome pending — to be added once the rest of the response is available.

**Cellix response:**
Plan text was shown but the pending-change card (and with it, the earlier reasoning/plan text) **disappeared from the UI after clicking Accept**, so the explanation of how it handled the three sub-asks (which month the cross-boundary booking landed in, whether/how it addressed renamed bank accounts, the discount-formula approach) could not be recovered or reviewed after the fact. What's known from the visible action list before Accept:
- `Update cell values` on all 12 month sheets (Jan–Dec)
- `Add formulas on Jan` — 13 cells: `Apr!L2, Aug!L2, Dec!L2, Feb!L2, Jan!H2:L3, Jul!L2, Jun!L2, Mar!L2, May!L2, Nov!L2, Oct!L2, Sep!L2`
- This footprint (one new column L, formula seeded on row 2/3 of each month, presumably meant to propagate) is consistent with an attempt at the "add Discount column, keep Total Amount correct everywhere" ask, but far too small a footprint (2 rows) to have actually propagated across the ~120 pre-provisioned rows/sheet built in Trial 1 — suggesting even the *plan itself*, before any Accept-time drop, may not have covered "without me having to fix every row by hand" as asked.

**Post-Accept verification:** Checked `Jan!H2:L3` and `L2` on the other 11 month sheets directly in the workbook — **all blank/unchanged**. Nothing from the accepted changeset actually landed.

**Gap observed:**
1. **Confirms the Trial 1 silent-partial-apply bug is not a one-off — same failure signature repeats on a completely different request type** (editing an existing populated workbook vs. greenfield sheet creation). The common thread across both trials: the UI shows a plan, claims changes are "prepared"/"ready," the user clicks Accept, and the workbook is left unchanged with no error surfaced. This is now a pattern, not an isolated incident, and should be treated as a priority bug in the preview→accept pipeline rather than something to keep passively observing.
2. **New failure mode this trial:** the pending-change UI card (and its accompanying plan/reasoning text) disappeared entirely after Accept, even though nothing was applied. This is worse than Trial 1's presentation — Trial 1 at least left a static diff/list visible for inspection after the failure; here the evidence vanished, making the failure harder to diagnose or report. Whether this is "card cleared because the app believes Accept succeeded" or "card cleared for an unrelated UI-state reason" is exactly the kind of ambiguity a repro in the codebase would resolve.
3. **Possible under-scoping even before the drop:** the 13-cell formula footprint touches only row 2/3 per sheet, not the full pre-provisioned row range from Trial 1 (~120 rows/sheet) — if true, the "keep Total Amount correct without fixing every row by hand" part of the ask wasn't going to be satisfied even had Accept worked. Needs confirmation once the plan text is recoverable (e.g. by re-running the prompt and capturing the full response before clicking Accept).
4. No visibility yet into whether Cellix handled the cross-month-boundary booking or the renamed-bank-account breakdown at all — the action list gives no direct evidence either way, and the explanatory text that would have shown it is the same text that disappeared. This sub-question needs a re-run to answer.
5. **No premise-check before acting — confirmed by contrast with Shortcut.** Shortcut, given the identical starting workbook, read the sheets first and discovered the guest-stay data model was entirely empty (headers/formulas present, zero actual booking rows) before deciding how — or whether — to proceed, and reasoned explicitly about what that implies for each of the three sub-asks. Cellix's action list (`Update cell values` on all 12 sheets, a 13-cell formula add) gives no indication it verified there was booking data to update, renamed bank accounts to reconcile, or existing Total Amount values to preserve — all three things the prompt explicitly referred to as already existing ("the old ones are still in the sheets," "Total Amount doesn't account for..."). If Cellix acted without checking, it was building against a false premise the same way a junior engineer would if they started implementing before confirming the bug report's premise was even true.

**Severity:** blocker — same class as Trial 1 (nothing applied despite an accepted changeset), now confirmed recurring, plus a new UI issue (evidence disappearing on Accept) that will make this bug harder for users to report and harder for engineering to reproduce from bug reports alone.

**Follow-up:** This is ready to file to `TASKS.md` as a real bug, not just a study note — see Running Themes. Recommend re-running this exact prompt once to capture the full pre-Accept plan text (screenshot or copy before clicking Accept) so the under-scoping question (point 3) can be settled, and to get the Shortcut side of this trial for comparison.

---

## Running Themes

- **Clarification gap:** Shortcut proactively asks before large/ambiguous structural builds (redundant columns, unaddressed existing data, unstated currency), and even on a non-answer, states its interpretation back to the user instead of assuming silently. Cellix went straight to execution on the same ambiguity with no acknowledgment of the choices it was implicitly making. (Trial 1)
- **Partial-apply is silent — ✅ ROOT-CAUSED AND FIXED (TASKS.md #80, Aug 25 2026).** Investigation confirmed a real bug, and also corrected part of this study's own reading of it. The two incidents were *not* the same failure end-to-end: **Trial 1 was largely the staged accept-wave feature working as designed** — `splitIntoActionWaves` deliberately splits big multi-sheet builds into "create the sheets" then "fill them in," so wave 2 genuinely needed a second Accept; the failure was that no UI explained this, compounded by the failed `Main`/`Main 2` step likely leaving wave 2 unacceptable. **Trial 2 was the genuine bug**: `PreviewSummaryBar`'s Accept had no wave-dependency gating (unlike the in-conversation card, which correctly disables and explains), `findPendingActionBlock` selected a gated block anyway, `acceptActions` refused it with a bare `return` that was indistinguishable from success because it returned `void`, and `handlePreviewAccept` set `applied = true` unconditionally — clearing the preview card. Hence: nothing written, card vanishes, no error. Fixed by making refusal detectable (`Promise<boolean>`), honoring it before clearing the preview, and filtering block selection through the same `isWaveDependencySatisfied` predicate the card already used. Mutation-verified regression test added. *Lesson for the study method: the user-visible symptom was identical across both trials, but the underlying causes differed — one a UX/explanation gap in a working feature, one a real correctness bug. Worth resisting the pull to merge same-looking symptoms into one finding before reading the code.*
- **Original framing, kept for the record —** *Partial-apply is silent — CONFIRMED RECURRING, now the top-priority finding.* Trial 1: Accept claimed 13 changes "prepared"/"ready" but only 12 of 13 landed (Main/dashboard silently dropped). Trial 2, a completely different request (editing an existing workbook, not greenfield creation): Accept again reported a changeset ready, and again **zero of the listed cells changed** in the actual workbook — confirmed by direct inspection of `Jan!H2:L3` and `L2` on all other month sheets. Trial 2 also surfaced a compounding issue: the pending-change UI card and its plan text vanished after Accept, so there's no artifact left to diagnose what was even attempted. Two-for-two across structurally different prompts is enough to stop treating this as "worth watching" — it should be filed and reproduced directly in the codebase (preview/changeset apply path — see `change-set.service.ts` and the Tier 3 executor) rather than waited out for a third trial. (Trial 1, Trial 2)
- **Action-type inconsistency:** `ADD_SHEET` vs `CREATE_SHEET` used interchangeably for the same intent within one plan. (Trial 1)
- **Idempotent "if it doesn't exist" create is broken:** produced a duplicate sheet ("Main 2") rather than detecting the existing one. (Trial 1)
- **No self-verification pass:** Shortcut's process included an explicit "build → screenshot/inspect → catch rendering or formula bugs → fix → re-verify" loop before declaring done (including exporting to openpyxl to root-cause a unit-mismatch bug). Nothing in Cellix's transcript suggests any equivalent self-check step exists in its pipeline — it goes straight from "prepared" to presenting the diff for Accept. (Trial 1)
- **Scope-matching:** Shortcut built the literal "main sheet has all the details of the remaining sheets" ask (a full row-level consolidated table across all 12 months), where Cellix only ever staged month-level aggregates on Main. Worth watching whether this recurs on prompts that explicitly ask for a full detail rollup vs. a summary. (Trial 1)
- **Step granularity/legibility:** Shortcut's ~10 accept-gated steps each came with a short scoped description ("Restore Total Amount formulas", "Set point-based column widths") that doubled as a changelog; Cellix streamed raw per-cell action logs (ADD_SHEET on January, SET_CELL on January, ...) with no equivalent scoped summary. (Trial 1)
- **No premise-check / read-before-write:** Given the identical workbook (guest-stay sheets structurally complete but with zero actual booking rows — confirmed same starting state for both tools), Shortcut read the data first and discovered it was empty before deciding how to proceed, reasoning explicitly about what that meant for a request that referred to existing bookings, renamed bank accounts, and existing Total Amount values. Cellix's action list gives no evidence it checked this at all before writing `Update cell values` / formula-add actions against sheets it may never have confirmed had rows to update. This is a distinct failure class from the silent-partial-apply bug — it's about whether the tool verifies its premises before acting, not whether its accepted changes land. (Trial 2)

---

## Open Follow-ups Raised

| TASKS.md | What | Status |
|---|---|---|
| **#80** | Summary-bar Accept could apply nothing and then clear the preview — wave-dependency gating enforced in 2 of 3 Accept paths, and `acceptActions` returned `void` so a refusal was indistinguishable from success | ✅ Fixed, mutation-verified. **Not verified in live Excel** |
| **#81** | `jsdom` / `@testing-library/react` declared in `frontend/package.json` but absent from `node_modules` — the 2 spec files covering the Accept path cannot run at all | ⬜ Open (likely an incomplete `npm install`; confirm whether CI installs them) |
| **#82** | Planner accepted token-truncated plans as complete; malformed subtasks dropped silently (16 → 15) | ✅ Fixed, mutation-verified. **Trigger never fired live** — unconfirmed whether OpenRouter reports `finishReason: 'length'` for gpt-5 |
| **#83** | ~53% of the plan's tokens were month-sheet boilerplate emitted *before* the Main-sheet work truncation destroys | ✅ Fixed (emission reordering). **Compliance unverified** — unknown whether gpt-5 honors the new rule |
| **#84** | `rowCount` counts header + template rows, so a scaffolded-but-empty sheet (121 rows, 0 bookings) read as populated — a request premised on non-existent data could not be caught | ✅ Fixed (derived data-row count + false-premise rule), mutation-verified. **Planner compliance unverified** |
| **#85** | Sorting destroyed date formats (`12-09-26` → `120926`) — the format restore shared an Office.js batch with the value write, so Excel's smart-entry re-parse won | ✅ Fixed (`sync()` barrier), mutation-verified. **Not verified in live Excel** |

**Docs updated Aug 26 2026** to carry these findings out of this file and into the places work actually starts from: `CODEBASE_ANALYSIS.md` §3.7 (the false-success bug class was declared closed and was not — #80/#82 are two more instances), §3.8 (this study's real headline), new §3.15 (the outcome-verification gap), §3.14 (a correction: the cross-repo action-type drift detector had been silently dead due to a stale import path — now repointed and passing); `PRD.md` M4 (post-apply outcome check + the return-type rule, and an honest `Exists` → effectively-`Partial` status note), M10 (revert reachable from where the change happened), §9.2 (head-to-head evidence that the reliability differentiator is not yet earned); `ARCHITECTURE.md` AD-3 (simulation's structural ceiling, and why the complement must live on the frontend per AD-1); `CLAUDE.md` (the three load-bearing invariants a future session would otherwise silently break — the `sync()` barrier, the three Accept paths, and LLM truncation not being self-announcing).

Both remaining verifications (#82's trigger, #83's compliance) need OpenRouter credits and can be settled in a single tier-3 run. #80 needs the live add-in.

---

## What This Study Actually Found

Worth separating from the trial-by-trial notes, because the headline conclusion changed twice under investigation.

**The recurring defect class was not "bad plans" — it was *incomplete work presenting as complete*.** Every hard failure had the same shape: a signal that would have revealed the gap existed, but was discarded before anyone could act on it.

- `acceptActions` refused a staged wave with a bare `return` — a refusal that looked exactly like success to its caller, which then cleared the preview. (#80)
- `complete()` returned a bare `string`, discarding the provider's `finishReason` — so a plan cut off mid-generation, which the model closed into valid JSON, parsed cleanly and passed every downstream check. (#82)
- `normalizePlannerOutput`'s `.filter()` dropped a malformed subtask with no logging, silently shortening the plan 16 → 15. (#82)

Cellix's Verifier is genuinely substantial (four checkers, scoped retry), but it checks **actions** — did the executor emit enough, of valid types, with required fields — against `estimatedActions` taken *from the same possibly-truncated plan*. Shortcut's loop checks **outcomes**: it read the workbook back, screenshotted it, and even exported to openpyxl to root-cause a unit bug. Those answer different questions, and the study's failures all lived in the gap between them.

**Two corrections the investigation forced on this study's own conclusions**, both worth keeping as method lessons:

1. **Identical symptoms, different causes.** Trials 1 and 2 produced the same user-visible failure (click Accept → nothing happens). They were unrelated: Trial 1 was largely the staged-wave feature working *as designed* with no UI explaining that a second Accept was needed; Trial 2 was the real bug. Merging them before reading the code would have produced a wrong fix.
2. **Shortcut hit *more* bugs than Cellix and still shipped a working result.** It clobbered its own formulas three separate times and got column-width units wrong. It recovered because it looked at what it had just done. The gap this study found is not model quality or prompt engineering — it is the absence of a read-back-and-check step.

**What is NOT established by this study:** that any of the four fixes improves real-world outcomes. Trial 1's re-run did produce a correct 18-subtask plan including the previously-missing consolidated table — but with ~40% more output on the same prompt/tier/model, which is run-to-run variance in a non-deterministic model, **not evidence the fixes worked**. #82 never fired; #83 postdates that run entirely. Treat all four as structurally sound and unit-tested, and as unproven in production until the live verifications above are done.

**The read-before-write gap (Trial 2) — ✅ ADDRESSED (TASKS.md #84), and the study's own diagnosis was wrong.** This section previously proposed "capture per-target-sheet `usedRange` + row count before planning." Reading the code showed Cellix **already does that**: `buildPlannerUserMessage` sends `rowCount` per sheet, the frontend's TOON compressor emits `rowCount`/`usedRange`, and `logs/planner.log` confirms live requests carry them. The inference from transcripts — "it never checked" — was mistaken.

The real defect is narrower and more interesting: **`rowCount` counts the header row and every pre-provisioned template row.** A Trial 2 month sheet of "headers + 120 rows each seeded with `=(F-E)*G`" reports `rowCount: 121` while holding zero bookings. The signal wasn't missing — it was *ambiguous*, and every reasonable reading of "121x10" says there is data there. Fixed by deriving an unambiguous one (count rows below the header with a non-blank computed value — template formulas returning `""` correctly read as empty), disclosing only the sheets that are structurally present but empty, and adding a rule requiring the planner to name the false premise **while still planning the structural work that remains valid**.

*Method lesson, and the third time this study's headline changed under investigation: a transcript can show you a symptom but not a cause. "The tool didn't check X" and "the tool checked X but X was misleading" produce identical transcripts and demand completely different fixes.*

**Highest-value next work:** the *outcome-verification* gap named above — Cellix's Verifier checks emitted actions against `estimatedActions` from the same plan, never reading the workbook back after apply. That is the one structural difference from Shortcut that none of #80–#84 touch, and it is what let Shortcut ship working results despite hitting more bugs.
