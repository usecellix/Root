# 19 — Overwrite Guard Confirmed Working, But Retry Ignores Its Own Feedback + Blocked Action Still Shown as Acceptable

**Context:** This trace confirms `14_critical_data_loss_column_overwrite.md`'s Fix 1 (`guardAgainstOverwrite`) is live and correctly blocking the exact class of data loss that destroyed the Payment Status column earlier in this project. That is the single most important fix validated so far — treat this as confirmed, not still-open.

**Severity: P0 for Bug 3 below (needs safety confirmation before any user clicks Accept on a blocked action). P1 for Bugs 1-2.**

**Files touched:** `executor.agent.ts` (retry must consume guard feedback), `executor.prompt.ts` (surface `INSERT_COLUMN` as an available action if not already), `conversation.service.ts` (narration accuracy), `rich-action-engine.service.ts` / preview-building logic (whether a guard-blocked action can reach "Pending review" state at all)

---

## Repro

Request: `Add a column called "Net of Tax" that subtracts Tax Amount from Total Amount` (same request that caused the original data-loss bug in `14`).

**Guard message (correct, confirms the fix):**
> `Write blocked: target range K2 already contains data. This action would overwrite existing values. Existing values include: Paid. If you meant to add a new column, use INSERT_COLUMN with position "afterLastColumn" instead of writing into an occupied column.`

**User-facing summary (incorrect/hallucinated):**
> `Could not complete after 2 attempts: The workbook already contains a 'Net of Tax' column. Inserting a new column after 'Total Amount' would create a duplicate column and shift existing data — this does not match the user's intent...`

**UI state:** `1 cell, Purchase Register!K2 — Pending review — Accept / Reject`

---

## Bug 1 — Retry (2 attempts) never used the guard's own suggested fix (`INSERT_COLUMN`)

The guard's message explicitly says what to do instead: use `INSERT_COLUMN`. Two retry attempts happened and neither one switched to it — both apparently kept trying to write into the occupied column K.

### Investigation needed before fixing
```
Read-only first: confirm whether INSERT_COLUMN (from 14_critical_data_loss_column_overwrite.md
Fix 2) has actually been implemented and is present in the Executor's available
action types / prompt. If it doesn't exist yet, that's the root cause — the
Executor can't switch to a tool it doesn't have. If it does exist, trace why
the retry loop didn't pass the guard's blocking message into the Executor's
next-attempt context as usable feedback (same "retry needs the specific
feedback message wired in" gap as 18_tier2_retry_and_context_resolution.md's
Bug 1, but for the overwrite guard's error rather than the Verifier's).
```

### Fix
Same principle as spec `18`'s retry fix: when a write is blocked by `guardAgainstOverwrite`, the specific guard message (including its concrete suggestion) must be fed into the next Executor attempt's context, and `INSERT_COLUMN` must be a real, callable action the Executor can switch to — not just documented in a spec file.

---

## Bug 2 — User-facing narration is factually wrong and contradicts the correct guard message shown alongside it

The Executor's own summary claims a duplicate `'Net of Tax'` column already exists — it doesn't; column K contains `Payment Status`. This is a hallucinated explanation for *why* it's blocked, generated independently of (and inconsistent with) the actual, correct guard message shown in the same response.

### Fix
Per `15_user_facing_response_structure.md`'s principle: when a structural guard (like `guardAgainstOverwrite`) fires with a concrete, factual reason, that message should be **the** explanation shown to the user — not a separate, model-generated narrative that may not match reality. Do not let the Executor construct its own explanation for a block that a deterministic system component already explained correctly and factually. Surface the guard's own message as the primary summary, not as a secondary "Show details" artifact sitting beside a wrong headline explanation.

---

## Bug 3 — CRITICAL, confirm before anything else: does Accept re-check the guard, or bypass it?

**This needs an explicit answer before any user trusts Accept on a blocked action.** The blocked action still appears in the UI as a normal, clickable "Pending review — Accept/Reject" item for `Purchase Register!K2`. Two very different possibilities:

- **(a) Safe:** clicking Accept re-runs the write through the same `guardAgainstOverwrite` check at actual apply time, and it blocks again with the same message — annoying UX (a dead-end preview card) but not dangerous.
- **(b) Dangerous regression:** the guard only ran during generation/verification, and the preview/Accept path executes the raw Office.js write without re-checking — meaning clicking Accept would silently overwrite `Payment Status` data again, recreating the original Bug 6 data-loss scenario, just with an extra (ignored) warning message shown first.

### Investigation prompt (read-only, run before any fix)
```
Do NOT write code. Read-only investigation, urgent.

Trace what happens when a user clicks "Accept" on a preview/ChangeSet item
whose underlying action was flagged by guardAgainstOverwrite during
generation. Specifically:
1. Does the Accept/apply code path call guardAgainstOverwrite (or equivalent)
   again at actual write time, or does it go straight to the Office.js
   range.values = ... write?
2. If a blocked action reached "Pending review" state at all, trace how —
   guardAgainstOverwrite is supposed to throw an OverwriteGuardError per
   14_critical_data_loss_column_overwrite.md's Fix 1. Why did an action that
   should have thrown still end up in a ChangeSet ready for preview?
3. Report file paths and line numbers for both the generation-time guard
   check and the apply-time write path, so we can confirm whether they're
   the same code path (safe) or two different ones (potentially unsafe).
```

### Required fix, pending investigation results
Regardless of what the investigation finds, the correct end state is: **a `guardAgainstOverwrite`-blocked action must never reach "Pending review" / Accept-able state at all.** It should be excluded from the ChangeSet entirely, with the guard's message shown as a plain explanation (per Bug 2's fix) and no Accept button for that specific blocked cell. If Bug 3's investigation confirms Accept currently bypasses the guard, this is a second, independent P0 fix on top of anything found — the guard must be enforced at the actual write boundary (immediately before the Office.js call), not only at generation time, specifically so it cannot be bypassed by a stale/already-generated preview.

---

## Acceptance criteria

- [ ] Bug 3's investigation completed and reported before any other fix in this file ships — this determines whether there's a second critical gap beyond what's already known.
- [ ] `guardAgainstOverwrite` (or an equivalent check) runs at the actual apply/write boundary, immediately before the Office.js call, regardless of whether it also ran earlier at generation time — this is the only way to guarantee Accept can never bypass it.
- [ ] A guard-blocked action is excluded from "Pending review" entirely — no Accept button offered for a cell the system has already determined it cannot safely write to.
- [ ] Retry after a guard block uses `INSERT_COLUMN` (confirmed implemented, not just speced) and the guard's specific message as feedback — covered by a test using this exact repro, asserting the corrected retry successfully adds a new column (e.g. at M) rather than retrying the same blocked write twice.
- [ ] User-facing summary matches the guard's actual, factual block reason — no independently-hallucinated explanation shown as the primary message.
- [ ] Re-run the exact repro end-to-end after fixes: request should succeed by adding `Net of Tax` as a genuinely new column, with `Payment Status` in K completely untouched throughout — including confirming Accept was never offered for the blocked K2 write in the first place.
