# 24 — Header-Row Formatting Misrouted to FORMAT_MATCHING_ROWS, Raw Internal Error Leaks to User

**Severity: P1.** Not data-destroying, but it's a new, sharper instance of the internal-vocabulary-leak problem (`15_user_facing_response_structure.md`) — this time a literal unhandled validation error string, not just a tier label — shown alongside a contradictory "I've applied" success claim and a "Pending review" state, all at once.

**Files touched:** `cellix_backend/src/excel-ai/prompts/executor.prompt.ts` (action-type selection guidance), wherever `FORMAT_MATCHING_ROWS` is implemented (add proper error handling), `conversation.service.ts` (error-to-user-message boundary)

---

## Repro

Request: `Highlight the header row with light bg green`

Response shown to user:
```
I've applied a light green fill to the header row on the 'Purchase Register' sheet.
Pending review
Accept / Reject
...
FORMAT_MATCHING_ROWS: findMatchingRowOffsets requires hasHeaders: true
```

## Bug 1 — wrong action type selected

`FORMAT_MATCHING_ROWS` is built for conditional row-matching (e.g. "highlight rows where Payment Status = Pending" — a genuine find-then-format operation across the data body). Formatting the header row is not a matching/conditional operation at all — the target is a single, fixed, already-known range (`A1:L1`, or dynamically `A1:{lastCol}1`). This should resolve to a plain `FORMAT_RANGE` action, same as the (now-fixed, per spec 10) "bold the header row" case.

### Fix
Add explicit guidance to `executor.prompt.ts` (or wherever action-type selection happens): requests targeting **the header row specifically** ("highlight/bold/color the header row/headers") always resolve to `FORMAT_RANGE` on the header range — never `FORMAT_MATCHING_ROWS`, which should be reserved for requests with an actual match condition against data rows (a column name + comparison value). This is the same "give the model a concrete example so it stops improvising a shape" principle already applied to `FORMAT_RANGE` in spec 10.

## Bug 2 — raw internal error string leaked directly into the user-facing response

Independent of Bug 1: whatever this validation error is, it should never render as literal text in the chat response. This is a missing error-boundary problem — a thrown/returned internal error (looks like a parameter-validation failure inside `findMatchingRowOffsets`) is passing straight through to the SSE `answer` text instead of being caught and converted into either (a) a proper retry with the missing parameter supplied, or (b) a clean, honest user-facing failure message ("I couldn't apply that formatting — let me try a different approach" / a real error card, not raw text).

### Fix
Add a catch boundary around action execution (or wherever this error originates) that:
- Never lets a raw exception/validation-error string reach the user-facing `answer` field.
- Logs the full technical error for debugging (structured logger, as already done elsewhere in this system).
- Surfaces a plain, honest failure message to the user instead, consistent with `15_user_facing_response_structure.md`'s principle that internal implementation detail (action type names, parameter names, stack-trace-like strings) never belongs in the default response view.

Also fix the specific state contradiction: a response can't simultaneously claim "I've applied [X]" (implying success) **and** show "Pending review" (implying awaiting confirmation) **and** display a raw error (implying failure). Whichever is actually true should be the only state shown — this is the same "final state must reflect the last real result, not a stale/conflicting one" principle from Bug 4b's original investigation in spec 10.

---

## Acceptance criteria

- [ ] "Highlight the header row with light bg green" (and equivalent header-targeting phrasings) resolves to `FORMAT_RANGE`, never `FORMAT_MATCHING_ROWS` — covered by a unit test on action-type selection for header-row requests.
- [ ] No raw exception/validation-error string ever appears in a user-facing `answer` field — covered by a test that forces an internal validation error and asserts the user-facing text is a clean, generic failure message, not the raw error.
- [ ] A single response never shows contradictory states (claimed success + pending review + raw error) simultaneously — the response reflects exactly one accurate state.
- [ ] Re-run the exact repro end-to-end: header row gets a light green fill via `FORMAT_RANGE`, single clean success message, no leaked error text.
