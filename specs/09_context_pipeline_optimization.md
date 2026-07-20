# 09 — Context Pipeline Optimization (Speed & Efficiency)

**Phase:** 5 (independent of Phases 2-4, but items 4/5 below assume Phase 1 tiering exists — sequence after `01`-`04`, can run in parallel with `05`-`07`)
**Files touched:**
- `frontend/src/utils/workbookContext.ts` (`buildWorkbookContext`, `pendingToonRef` prebuild logic)
- `cellix_backend/src/excel-ai/services/context-cache.service.ts`
- `cellix_backend/src/excel-ai/services/sheet-analyzer.service.ts`
- `cellix_backend/src/excel-ai/services/llm-router.service.ts` (reorder only)
- `cellix_backend/src/audit/change-set.service.ts` (for item 6's incremental patching)

---

## Goal

Reduce two costs on every chat turn: (a) redundant Office.js reads/re-encodes on the frontend, and (b) redundant backend analysis/context-building when the sheet hasn't actually changed. None of this changes what the LLM sees on any given tier/route — it changes how often work is repeated to produce that same view. Ship as independent, individually-revertible items; don't bundle into one PR.

---

## Item 1 — Frontend: reuse `pendingToonRef` across the full send, not just at selection time

**Problem:** `pendingToonRef` is prebuilt on selection change, but if the send-time code path re-derives context anyway (even partially), the prebuild isn't paying for itself on every turn.

**Change:**
```typescript
// workbookContext.ts
export async function getContextForSend(): Promise<string> {
  if (pendingToonRef.current && !pendingToonRef.stale) {
    return pendingToonRef.current; // zero Office.js calls
  }
  return buildWorkbookContext(); // existing full path, only when no valid prebuild exists
}
```

`pendingToonRef.stale` must be set `true` by exactly three triggers: selection change, sheet change (any edit via the add-in itself or detected external edit), and change-set apply. Audit the existing selection-change handler to confirm it isn't already doing this before adding a second mechanism.

**Acceptance criteria:**
- [ ] A send with no selection/edit since the last prebuild makes zero `context.sync()` calls.
- [ ] Editing a cell outside the add-in (manually in Excel) still invalidates the prebuild — verify via a test that simulates an external edit event, not just add-in-driven changes.

---

## Item 2 — Backend: widen `ContextCacheService` TTL, decouple from staleness risk

**Problem:** 10-minute TTL forces cache rebuilds during long CA working sessions even though the cache key (hash of TOON string) already guarantees correctness — a stale-but-matching hash is not a stale result.

**Change:**
```typescript
// context-cache.service.ts
const CONTEXT_CACHE_TTL_MS = 60 * 60 * 1000; // was 10 min, now 60 min
// Invalidation remains hash-based (unchanged) and change-set-apply-based (unchanged).
// TTL only bounds unbounded memory growth from abandoned conversations, not correctness.
```

**Acceptance criteria:**
- [ ] Cache hit rate (log a counter) measurably increases in a 30+ minute test session with intermittent chat turns.
- [ ] Memory/storage bound confirmed acceptable (check existing cache size limits or add an LRU eviction cap alongside the TTL bump — don't just widen TTL unbounded without a size cap).

---

## Item 3 — Backend: reorder shortcut-pattern routing ahead of sheet analysis

**Problem:** If `SheetAnalyzerService` currently runs before `LlmRouterService`'s regex-based shortcut check, every shortcut-route request (freeze, zoom, protect, etc. — no sheet data needed at all) pays for an analysis pass it never uses.

**Change:**
```typescript
// llm-router.service.ts / conversation.service.ts — reorder, don't rewrite either service
async handleMessage(message: string, rawSheetData: CompressedContext) {
  const shortcutMatch = this.checkShortcutPatterns(message); // existing regex check
  if (shortcutMatch) {
    return this.executeShortcut(shortcutMatch); // no analyzer call, no LLM call
  }
  const analysis = await this.sheetAnalyzer.analyze(rawSheetData); // existing, now conditional
  // ...existing route classification continues unchanged...
}
```

**Acceptance criteria:**
- [ ] `SheetAnalyzerService.analyze()` is confirmed via mock call-count to never run for `route=shortcut` requests.
- [ ] No change in shortcut execution behavior or latency floor (should improve, not regress).

---

## Item 4 — Backend: split structural metadata cache from route-specific LLM-context cache

**Problem:** Structural metadata (headers, shape, dtypes, sheet count) doesn't depend on which route a message resolves to, but if it's currently bundled into the same cached object as the route-tiered LLM context, a `data`-route request and a `write`-route request on the same unchanged sheet can't share the structural work.

**Change:**
```typescript
// context-cache.service.ts — split into two cache maps, same TTL/invalidation triggers
interface StructuralCacheEntry {
  headers: string[][];
  shape: { rows: number; cols: number };
  dtypes: Record<string, string>;
  sheetNames: string[];
}
interface RouteContextCacheEntry {
  route: 'write' | 'ask' | 'data' | 'export';
  tieredContext: string; // the existing per-route sample (headers + N rows, etc.)
}

// Key structural cache on hash(TOON) alone.
// Key route context cache on hash(TOON) + route, so different routes on the
// same unchanged sheet each get their own entry but share the structural pass.
```

**Acceptance criteria:**
- [ ] Two consecutive requests with different routes on the same unchanged sheet trigger exactly one structural analysis and two (route-specific) tiered-context builds — verify via call-count test.
- [ ] Existing single-cache callers are migrated, not duplicated — no dead code path left calling the old bundled cache.

---

## Item 5 — Server-held lightweight index + on-demand range fetch (larger change, do after items 1-4 are stable)

**Problem:** Even with caching, every route still ships *some* row-level sample (5-10 rows) on every fresh-hash turn, when many `ask`/`data` requests are answerable from structure alone ("what's in column B" only needs the header, not 10 sample rows if the header says "Invoice Date").

**Design:**
```typescript
// New: cellix_backend/src/excel-ai/services/workbook-index.service.ts
export interface WorkbookIndex {
  sheets: Array<{
    name: string;
    headers: string[];
    dtypes: Record<string, string>;
    rowCount: number;
    namedRanges: string[];
  }>;
  builtFromHash: string; // ties to existing TOON hash for invalidation
}

// New tool the LLM (Planner/Executor/Ask handler) can call mid-conversation:
export interface FetchRangeTool {
  fetchRange(sheetName: string, range: string): Promise<CompressedRangeData>;
}
```

**Rollout approach:** Ship the index as an *additional* small payload alongside the existing tiered context first (additive, no removal), and only stop sending the default row samples for `ask`/`data` routes once `fetchRange` tool-calling is proven reliable in shadow-mode logging (same shadow-mode pattern used in `08_migration_plan_and_tests.md` for tiering). Do not remove the existing sample-row context until the fetch-tool path has a measured success rate — this is the item most likely to regress correctness if rushed.

**Acceptance criteria:**
- [ ] `WorkbookIndex` built once per hash, reused across all routes (feeds Item 4's structural cache directly — implement as the same underlying object, not a parallel one).
- [ ] `fetchRange` tool-call round trip measured and logged (latency, success rate) in shadow mode before any route stops sending default row samples.
- [ ] Fallback: if `fetchRange` fails or times out, the route falls back to the existing default sample behavior — never fails the whole turn.

---

## Item 6 — Incremental context patching on change-set apply (biggest change, sequence last)

**Problem:** Applying a change set currently invalidates the whole context cache (full re-read + re-compress on the next turn), even when the change touched one row of a 500-row sheet.

**Design:**
```typescript
// change-set.service.ts — extend applyChangeSet, don't replace
async applyChangeSet(changeSet: ChangeSet) {
  // ...existing apply logic unchanged...

  // NEW: instead of a blanket cache invalidation, patch the affected range's
  // slice of the cached TOON representation and recompute the hash from the
  // patched string, IF the change set touches a known, small, contiguous range.
  const affectedRange = this.getAffectedRange(changeSet);
  if (affectedRange && this.isPatchable(affectedRange)) {
    contextCacheService.patchRange(conversationId, affectedRange, changeSet);
  } else {
    contextCacheService.invalidate(conversationId); // existing fallback, unchanged
  }
}
```

**Guardrail:** `isPatchable()` should be conservative — structural changes (row/column insert/delete, sheet add/remove) must always fall back to full invalidation, since patching a TOON string around a structural shift is exactly the kind of subtle bug that produces a wrong-but-plausible-looking context for the LLM. Only cell-value/formula changes within existing structure are safe to patch.

**Acceptance criteria:**
- [ ] Any change set involving row/column insert/delete, sheet add/remove/rename triggers full invalidation, never a patch — covered by explicit tests for each structural-change type.
- [ ] Cell-value-only change sets on large sheets (500+ rows) measurably skip full re-read on the next turn (log a counter: "patched" vs "invalidated" contexts).
- [ ] A deliberately-introduced patch bug (e.g. wrong row offset) is caught by a test that diffs patched-context output against a from-scratch rebuild for the same post-apply state — this is the regression guard for this item specifically, since silent context corruption is worse than a slow rebuild.

---

## Sequencing summary

```
Items 1-3  → ship first, low risk, immediately measurable latency wins
Item 4     → ship next, moderate refactor, no behavior change, just cache shape
Item 5     → ship after 1-4 stable, requires shadow-mode validation before
             removing any existing default context (same discipline as the
             tiering rollout in 08)
Item 6     → ship last, highest risk of subtle correctness bugs if rushed;
             require the diff-against-rebuild test in CI before merging
```

## Final acceptance criteria for this phase

- [ ] Each item ships as an independently revertible change (separate PRs), not one combined optimization pass.
- [ ] No item changes what content the LLM receives for a given route/tier — only how often that content is rebuilt from scratch versus served from cache/index/patch.
- [ ] Latency dashboard (from `08`) extended with cache-hit-rate and patch-vs-invalidate counters to validate real-world impact post-launch.
