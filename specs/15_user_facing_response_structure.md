# 15 — User-Facing Response Structure (Hide Agent Internals, Show What Matters)

**Phase:** 2 (UX layer, independent of backend fixes in `10`/`11`/`12`/`13`/`14` — can ship in parallel, but should reuse those specs' underlying data, e.g. `sourceRefs`, `tier`, action lists, once available)
**Files touched:** frontend `ConversationPanel.tsx`, `MessageBubble`/response-rendering components, backend response-shaping in `conversation.service.ts` (deciding what to include in the SSE payload vs. what stays server-side-only)

---

## The problem, stated plainly

Compare what a user currently sees for a Tier 1 conditional-format request:

> `Tier 1 single-action (CONDITIONAL_FORMAT) — one LLM call, no verification. 1 Direct Change Applied.`

against what Shortcut shows for a comparable request:

> `Working with: This workbook. Shortcut will make the following changes: • Sort Purchase Register sheet rows A2:L51 by column K in ascending order. [Accept] [Accept All] [Reject]`

The first exposes **implementation details a user has no use for** ("Tier 1," "single-action," "no verification" — this is internal routing metadata, not something a CA needs to make a decision) while failing to say **what the change actually is**. The second says nothing about internals and states, in one plain sentence, exactly what will happen.

This isn't cosmetic — per your own earlier findings, "1 Direct Change Applied" gave zero visibility into whether the payment-status summary used formulas or hardcoded values, whether the location was sensible, or what "1 change" even covered (it was actually ~9 cells). A user cannot make an informed Accept/Reject decision from that string.

---

## What the research says (grounding this in more than opinion)

A few consistent findings across current agent-UX literature and practice:

- **"Visible thoughts, plans, and actions" is the dominant transparency pattern** — but the same research flags the core tension explicitly: *"managing granularity: too little detail undermines oversight, while too much risks overwhelming users and reducing usability."* Your current output has this backwards — it shows internal routing detail (low value, high noise) while omitting the actual plan detail (high value).
- **The "Progress Reveal" pattern** (used by tools like Replit's agent) shows reasoning/actions *as they unfold*, then — critically — **collapses that trace into a summary once the work is done**, leaving only the durable result visible. The process is available on demand (expandable), not gone, but it's not the default view once a turn completes.
- **Dual-pane / collapse-on-completion layout** (documented in current agentic-UI design work): live thinking-traces and tool calls appear in one area while the turn is running, then collapse into a short summary once complete, with results remaining persistent and the collapsed trace re-openable if the user wants to audit it later.
- A separate concern flagged in this same body of work — worth being honest with yourself about: **transparency benefits depend on the shown reasoning being faithful to what the system actually did.** If "no verification" is shown as a badge but doesn't correspond to a real, meaningfully different code path, that's worse than not showing it — showing internal-sounding labels that don't map to real distinctions erodes trust rather than building it once a technical user notices.

**The synthesis for Cellix:** internal architecture terms (Tier 0/1/2/3, "no verification," agent names, model names) belong in a **collapsed, opt-in detail view** — available for a power user or for your own debugging, never in the default response. The default response should look structurally like Shortcut's: plain statement of *what will change*, then Accept/Reject.

---

## Required response structure (default / collapsed view)

```
[Optional 1-line context: "Working with: Purchase Register"]

[Plain-English statement of the actual change — not a routing label]
  e.g. "I'll sort the sheet so Pending payments appear before Paid ones."
  e.g. "I'll add a summary below the table with total Tax Amount and total
        Amount Collected, split by Payment Status."

[If applicable: a short bullet list if more than one distinct change]
  • Sort rows by Payment Status (Pending first)
  • [only if genuinely multiple distinct actions — don't bullet a single action]

[Accept] [Accept All] [Reject]   ← your existing UI, unchanged per prior scope decision
```

**What must NEVER appear in this default view:**
- Tier numbers, complexity labels, model names, "no verification" badges, agent names (Planner/Executor/Verifier), internal confidence scores, `subtaskId`s, raw action-type strings (`CONDITIONAL_FORMAT`, `SET_FORMULA`) — these are implementation vocabulary, not user vocabulary.
- Vague counts without content — "1 Direct Change Applied" must become either the plain-English description above, or if genuinely multiple cells changed, a real count **paired with** what those cells represent ("Updated 51 rows' Payment Status formatting" not "1 Direct Change").

---

## Expandable detail view (opt-in, for the user who wants it — this is where the current content moves, not disappears)

Behind a "Show details" / "How was this done?" toggle on each response:

```
Model: openai/gpt-5
Processing tier: Tier 1 (single action, no separate verification step)
Reasoning: [the model's actual reasoning text, if meaningfully distinct
            from the plain-English summary above — don't duplicate it]
Raw action: CONDITIONAL_FORMAT on Purchase Register!A2:L51
```

This preserves 100% of what currently ships (nothing is lost for debugging/power users, and per the earlier scope decision, no functional flow changes) — it just isn't the *default* thing a CA has to read past to decide whether to click Accept.

---

## Fixing the "1 Direct Change" undercount problem specifically

Per your own earlier finding (the payment-status summary that was actually ~9 cells written but displayed as "1 Direct Change"), the change-count and change-description shown to the user must be derived from the **actual `ChangeSet`/diff**, not from "number of top-level actions the Executor emitted." One `WRITE_TABLE`-style action covering 9 cells is one *action* but nine *changes* — the user-facing copy should describe changes, matching what `ChangeHistoryPanel` already tracks per-cell (per `07_citation_provenance_layer.md`'s model), not the backend's internal action-batching.

```typescript
// Response-shaping logic, backend or frontend (wherever the summary string is built)
function buildUserFacingSummary(changeSet: ChangeSet): string {
  const cellCount = changeSet.cellChanges.length;
  const affectedRange = describeRangeCompactly(changeSet.cellChanges); // e.g. "A53:C55" not a cell list
  // Prefer a semantic description over a raw count where one is available
  // from the request/plan (e.g. "Added a Payment Status summary" beats
  // "9 cells changed" as the LEAD line, but the cell count can follow as
  // supporting detail: "Added a Payment Status summary (9 cells, A53:C55)").
}
```

---

## Handling ambiguous/typo'd requests in the visible response (ties to the earlier Planner-response conversation)

Your own trace shows the model silently noticing an apparent typo ("paid should be first then paid") and quietly resolving it to "Paid first, then Pending" **inside its hidden reasoning**, never surfacing that judgment call to the user. Per the earlier `clarificationsNeeded` discussion: if the model had to guess what you meant, **that guess itself belongs in the visible summary**, not buried in a reasoning trace the user never sees by default:

```
"I noticed 'paid should be first then paid' looks like it may have a typo —
I've sorted with Paid first, then Pending. Let me know if you meant something
different."
```

This is a middle ground between full auto-execution-with-hidden-assumptions (current behavior) and blocking execution entirely for every minor ambiguity (which would be annoying for genuinely low-stakes guesses). The rule: **any assumption the model made to resolve ambiguity must be stated in the plain-English summary, every time** — not conditionally, not only when confidence is low.

---

## Acceptance criteria

- [ ] Default response view for every write-route turn (Tier 0-3) shows: plain-English change description, optionally a short bullet list for genuinely multi-part changes, and the existing Accept/Accept All/Reject controls — nothing else, by default.
- [ ] Zero occurrences of tier numbers, agent names, model names, or raw action-type strings in the default view — covered by a snapshot/component test asserting these strings never render outside the expandable detail section.
- [ ] Expandable "Show details" section preserves all currently-shown internal metadata (tier, model, reasoning, raw action) — nothing is deleted, only relocated.
- [ ] Change-count/description in the default view is derived from actual `ChangeSet` cell diffs, not raw action count — covered by a test using the 9-cell-summary-shown-as-"1-change" case as a regression fixture.
- [ ] Any assumption the model made to resolve an ambiguous/typo'd request is stated in the plain-English summary itself, not only in the hidden reasoning trace — covered by a test using the "paid should be first then paid" case as a fixture.
- [ ] No change to the underlying Accept/Reject/apply mechanics — this spec is response-copy and information-architecture only, per the existing scope decision to keep the current interaction flow.
