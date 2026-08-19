# 21 — Overwrite Guard Blocks Legitimate Follow-Up Refinements to Its Own Recent Edit

**Severity: P1.** This is the opposite failure mode from the original data-loss bug (`14`): the guard is doing its job (blocking unconfirmed overwrites) but has no way to distinguish "a stranger's request accidentally targeting occupied data" (the original bug) from "the user explicitly asking to change values the system itself just wrote one turn ago" (this case). Right now both get blocked identically.

**Files touched:** `cellix_backend/src/excel-ai/services/rich-action-engine.service.ts` (or wherever `guardAgainstOverwrite` lives), `cellix_backend/src/excel-ai/utils/overwrite-confirmation.util.ts` (new), conversation/turn-history tracking (needs to know what the *last* turn wrote)

---

## Repro

**Turn 1:** `add remarks to paid invoices`
> System correctly identifies: for every row where `Payment Status = Paid`, write `"Paid"` into `Remarks`. Applies successfully (Remarks column was presumably blank before this).

**Turn 2 (follow-up, same conversation):** `change to paid invoices`
> `Write blocked: target range L2 already contains data. This action would overwrite existing values. Existing values include: Paid, Paid, Paid...`
> Result: **Changes rejected.**

The guard is factually correct that L2 has data — but that data is exactly what Turn 1 just wrote, in direct response to the same user's own request. "Change to X" is unambiguous confirmation that the user wants to modify those specific values, not a generic write that happens to collide with unrelated existing content.

---

## Why this matters as much as the original bug

Spec `14`'s Fix 1 explicitly said: *"`explicitOverwriteConfirmed` should only ever be set `true` when the user's request is unambiguously about replacing existing content... never inferred by the Executor on its own."* This trace shows that requirement was implemented too conservatively — **nothing currently sets `explicitOverwriteConfirmed = true` at all**, so every follow-up refinement to a column the system already populated gets blocked identically to a genuinely risky blind write. A CA doing iterative work (write something, review it, ask for a tweak) will hit this on nearly every second-pass request, which makes the guard feel broken even though its underlying safety logic is sound.

---

## Fix — two independent signals that should each set `explicitOverwriteConfirmed = true`

### Signal 1: the target range was written by this conversation's own immediately-prior turn
```typescript
interface TurnActionRecord {
  // extends the structured turn-history record already required by
  // 18_tier2_retry_and_context_resolution.md's Bug 2 fix (chart/range tracking)
  actionType: string;
  affectedRange: string; // e.g. "Purchase Register!L2:L51"
  sheetName: string;
  turnIndex: number;
}

function isRefinementOfOwnLastEdit(
  targetRange: string,
  lastNTurns: TurnActionRecord[],
): boolean {
  // If the target range overlaps significantly with a range this same
  // conversation wrote in one of its recent turns (not just the immediately
  // prior one — a user might say "actually change that" a couple turns
  // later), treat this as a refinement, not a fresh unconfirmed overwrite.
  return lastNTurns.some(turn => rangesOverlap(turn.affectedRange, targetRange));
}
```

### Signal 2: explicit overwrite-intent language in the request itself
```typescript
// Distinct from write-intent detection (01/11) — this is specifically about
// CONFIRMING an overwrite of an already-populated target, not just detecting
// that a write is intended at all.
const EXPLICIT_OVERWRITE_LANGUAGE = /\b(change|update|modify|correct|fix|replace|overwrite)\b.*\b(to|with|as)\b/i;
// e.g. "change to paid invoices", "update the remarks to X", "replace with Y"

function hasExplicitOverwriteConfirmation(message: string): boolean {
  return EXPLICIT_OVERWRITE_LANGUAGE.test(message);
}
```

### Integration
```typescript
// Before guardAgainstOverwrite blocks a write:
const explicitOverwriteConfirmed =
  isRefinementOfOwnLastEdit(targetRange, conversationTurnHistory) ||
  hasExplicitOverwriteConfirmation(message);

if (hasExistingData && !explicitOverwriteConfirmed) {
  throw new OverwriteGuardError(/* ... */);
}
```

**Important boundary — do not weaken the original protection:** this fix must remain narrow. It should NOT make the guard permissive for:
- A brand-new request in a fresh conversation targeting a column the user has never discussed (still blocked, correctly — this is exactly the original Bug 6 scenario, and it must stay blocked).
- A request that merely *implies* a write without explicit change/update language and without prior-turn overlap (e.g., "add remarks" targeting an already-populated column with no "change/update" verb and no matching turn history — still blocked, and the user should be asked to confirm explicitly).

The fix is specifically: *recognize legitimate confirmation signals that already exist in the request*, not lower the bar for what counts as confirmation.

---

## Acceptance criteria

- [ ] Turn 1 → Turn 2 repro from this bug succeeds: "change to paid invoices" following "add remarks to paid invoices" in the same conversation applies without being blocked, since it's a refinement of the system's own immediately-prior write.
- [ ] A test confirms the *original* Bug 6 scenario ("Net of Tax" column guessing column K, no prior conversation context about that column, no change/update language) is still correctly blocked — this fix must not regress the original data-loss protection.
- [ ] `hasExplicitOverwriteConfirmation()` is a pure, independently unit-tested function covering: "change to X," "update to X," "replace with X," "correct the values to X" — and explicitly does NOT match plain "add X" or "set X" phrasing (which should still require either prior-turn-overlap or an explicit confirmation prompt).
- [ ] Turn-history overlap detection correctly identifies range overlap even when the follow-up doesn't restate the exact same range (e.g., Turn 1 wrote `L2:L51`, Turn 2 says "change to paid invoices" with no explicit range — the Executor's resolved target range for Turn 2 should still be checked against Turn 1's recorded range).
- [ ] If genuinely ambiguous (no prior-turn overlap AND no explicit change-language, but a plausible column reference), the system should ask a clarifying question rather than silently guessing either "block" or "allow" — ties to `13_benchmark_required_action_types.md`'s clarification-gating requirement.
