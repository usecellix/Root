# 18 — Tier 2 Has No Retry-on-Verification-Failure, Plus a Field-Dropping Normalize Bug for UPDATE_CHART

**Severity: P1.** Not a data-safety issue like Bug 6 — the verifier did its job and blocked a bad chart. The gap is that a **correctable** mistake (wrong source range) becomes a full dead end for the user instead of a one-shot self-correction, which is exactly the kind of friction that makes an AI tool feel unreliable even when it's technically "working as designed."

**Context — this is good news too:** this trace confirms Tier 2's mandatory verifier (`03_tier2_generate_verify.md`) is live and catching real issues. The `CREATE_CHART` action referenced `sourceRange: "A4:B54"`, and the Verifier correctly identified that this range omits the header and early data rows that actually exist starting at A1. That's the system working exactly as intended at the verification layer — the gap is purely in what happens next.

**Files touched:** `cellix_backend/src/excel-ai/services/tier2-generate-verify.service.ts`, `cellix_backend/src/excel-ai/services/conversation.service.ts` (context resolution for follow-up requests referencing "the current" chart/table)

---

## Repro

Turn 1: user creates a chart successfully (works fine, not shown as a problem in this trace).
Turn 2: `Also create a bar chart along with the current`

```
Executor produces: CREATE_CHART, sourceRange: "A4:B54", chartType: BarClustered
Verifier: passed=false — "sourceRange 'A4:B54' begins at row 4 and will omit
  the header and data in rows 2-3... data begins at row 1 and continues at
  least through row 10. Use a sourceRange that includes the header and all
  data, e.g. 'A1:B10'..."
Tier2GenerateVerifyService: complete, verifierPassed=false, durationMs=20359
→ User sees: "Verification failed: Chart action will be created but the
  sourceRange likely omits existing data (starts at A4)."
```

That's it. No retry, no attempt to apply the Verifier's own suggested fix, no fallback. The Verifier even supplied a concrete correction (`'A1:B10'`) in its `suggestion` field — and nothing consumed it.

---

## Bug 1 — Tier 2 has no retry-with-feedback loop on verification failure

Per `03_tier2_generate_verify.md`, Tier 2's design is: Executor generates once, deterministic checks run, Verifier runs once, mandatory — but the spec never defined what happens when the Verifier fails. In practice, that gap resolved to "surface the failure and stop," which is strictly worse than Tier 3's behavior (retry the specific failed subtask with the verifier's feedback appended to the next attempt).

### Fix
Add exactly one retry attempt to `Tier2GenerateVerifyService`, feeding the Verifier's `issues`/`suggestion` back into a second Executor call before giving up:

```typescript
// tier2-generate-verify.service.ts
async execute(message: string, actionHint: string, workbookContext: WorkbookContext): Promise<Tier2Result> {
  let executorResult = await this.executorAgent.executeSubtask(subtask, workbookContext);
  let verifierResult = await this.runVerification(executorResult, workbookContext);

  if (!verifierResult.passed) {
    // ONE retry, with the verifier's specific feedback appended to the
    // executor's context — not a blind re-roll of the same prompt.
    const correctionContext = {
      ...workbookContext,
      priorAttemptFeedback: verifierResult.issues.map(i => `${i.description} Suggestion: ${i.suggestion}`).join('\n'),
    };
    executorResult = await this.executorAgent.executeSubtask(subtask, correctionContext);
    verifierResult = await this.runVerification(executorResult, workbookContext);
  }

  if (!verifierResult.passed) {
    // Only now surface failure to the user — after one genuine self-correction
    // attempt, not zero.
    return this.buildFailureResult(executorResult, verifierResult);
  }

  return { actions: executorResult.actions, answer: executorResult.answer, verifierPassed: true, verifierSkipped: false };
}
```

**Cap this at exactly one retry** — Tier 2 exists to be fast (per its own latency budget in spec `03`); an unbounded retry loop here would defeat the purpose and start looking like Tier 3. If the single retry still fails, surfacing the failure to the user (with the Verifier's actual suggestion shown, not just "verification failed") is the correct fallback — that's still better than what happens today, but it should be the second line of defense, not the first.

---

## Bug 2 — Follow-up requests referencing "the current" data have no reliable range-context resolution

### Root cause
"Also create a bar chart along with the current" requires knowing exactly what range/table the prior turn's chart/aggregate actually used. The Executor guessed `A4:B54` — plausible if it assumed a table starting after some header rows, but wrong for this sheet's actual layout. This is a **conversation-memory gap**, not a one-off model mistake: the system has no structured record of "the last chart's source range was X" that a follow-up turn can look up deterministically instead of re-guessing from a compressed context sample.

### Fix
When a `CREATE_CHART` (or `AGGREGATE_TABLE`) action succeeds, store its `sourceRange`/`destStartCell`/`chartId` in the conversation's turn history in a structured, retrievable form (this is the same chart-identity tracking already required by `13_benchmark_required_action_types.md`'s Fix 1 for follow-up chart *edits* — this is the same mechanism, needed for follow-up chart *creation referencing prior context* too). A follow-up request containing "the current," "that chart," "the same data," etc. should resolve against this structured record first, before falling back to re-deriving it from a sampled workbook context.

```typescript
// conversation.service.ts — extend turn history
interface TurnActionRecord {
  actionType: 'CREATE_CHART' | 'AGGREGATE_TABLE' | ...;
  sourceRange?: string;
  destStartCell?: string;
  chartId?: string;
  sheetName: string;
}
// Store this on every successful write-route turn. Pass the last N records
// into the next turn's Executor context explicitly (not just relying on the
// LLM to infer it from chat history text).
```

---

---

## Bug 3 (confirmed by a second trace) — `UPDATE_CHART`'s `colorScheme` field is silently dropped during normalize/parse

### Repro
Request: `also create a bar chart use greeen color`

Executor's **raw** LLM output correctly includes the color:
```json
{ "type": "UPDATE_CHART", "sheetName": "Dashboard", "chartId": "Chart_TotalTaxByDate", "chartType": "BarClustered", "colorScheme": "green" }
```

But the **parsed** action that reaches the Verifier/downstream pipeline has silently lost the field:
```json
{ "type": "UPDATE_CHART", "sheetName": "Dashboard", "chartType": "BarClustered", "chartId": "Chart_TotalTaxByDate" }
```
No `colorScheme` key at all — not `null`, not an empty string, just absent. The Verifier then (correctly) fails the action for not fulfilling "use green color" — but the model never actually got this wrong. Something in the normalize/parse step between raw LLM output and the action object used downstream is dropping `colorScheme` specifically for `UPDATE_CHART`.

### Why this matters beyond this one bug
This is the **same failure shape as the original `FORMAT_RANGE` bug in `10_critical_bugfixes.md`** — a field the model correctly supplied gets lost in normalization, and everything downstream (verifier, in this case) reacts to the *stripped* version as if it were the model's mistake. That earlier fix only patched `FORMAT_RANGE`'s row/col handling — this confirms the same class of bug exists for `UPDATE_CHART` too, and probably other newer action types (`AGGREGATE_TABLE`, `COPY_FILTERED_RANGE`) that were added after the original normalize logic was written and may not have been fully wired into whatever whitelist/shape normalize expects per action type.

### Fix
1. Audit `normalizeSingleAction` (or wherever the raw-to-parsed transform happens) for every action type added since the original `FORMAT_RANGE` fix — confirm `UPDATE_CHART`'s `colorScheme` and `chartType` fields are explicitly preserved, not silently dropped by a field whitelist that wasn't updated when `UPDATE_CHART` was added (per `13_benchmark_required_action_types.md`).
2. Add a general regression pattern, not just a one-off fix: a test that constructs a raw action object for every known action type with every one of its optional fields populated, runs it through normalize, and asserts **zero fields are lost** unless explicitly and intentionally stripped (e.g. a deprecated field). This is a stronger guarantee than testing individual bugs one at a time — it would have caught this before it shipped.
3. Once fixed, this repro should combine with Bug 1's retry fix to either (a) pass on the first attempt (since the color was actually specified correctly all along), making the retry unnecessary here, or (b) if it still fails for a genuinely new reason, retry correctly with real feedback.

---

## Acceptance criteria

- [ ] `Tier2GenerateVerifyService` retries exactly once on verifier failure, with the verifier's specific feedback passed into the retry's context — covered by a test using this exact repro (wrong sourceRange → retry → corrected range → pass).
- [ ] After the single retry, if still failing, the user-facing failure message includes the Verifier's actual suggestion (e.g. "try A1:B10"), not just a generic "verification failed" string — ties into `15_user_facing_response_structure.md`'s plain-English response principle.
- [ ] Successful `CREATE_CHART`/`AGGREGATE_TABLE` actions are recorded in structured turn history (range, destination, chart ID), retrievable by a following turn.
- [ ] Re-run this exact repro ("create a chart" then "also create a bar chart along with the current") and confirm the second chart's source range resolves correctly from the structured record rather than being re-guessed, and passes verification on the first attempt.
- [ ] No change to Tier 2's fundamental design (Planner-skipping, mandatory verification) — this is additive: one bounded retry, plus better context for follow-ups.
- [ ] `UPDATE_CHART`'s `colorScheme` field (and any other currently-dropped fields found during the audit) survives normalize intact — covered by the exact "use green color" repro plus the general per-action-type field-preservation test described in Bug 3.
- [ ] The field-preservation audit in Bug 3 is run against every action type in the system (not just `UPDATE_CHART`), since this bug shape (raw output correct, parsed output silently missing fields) has now been confirmed twice across two different action types (`FORMAT_RANGE` in spec `10`, `UPDATE_CHART` here).
