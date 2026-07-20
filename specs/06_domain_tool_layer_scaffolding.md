# 06 — Domain Tool Layer (Scaffolding Only)

**Phase:** 3 (independent of Phase 1/2, but should target Tier 3's tool-call contract)
**Files touched:** new module `cellix_backend/src/domain-tools/`
**Scope note:** This spec ships **interfaces, folder structure, and stub implementations with full test scaffolding** — not production-correct GST/TDS/Ind-AS compliance logic. That logic requires domain expert sign-off (CA review) per cell of arithmetic and is a separate, longer engagement than this codebase upgrade. Do not ship stub outputs to real users as if they were compliance-correct.

---

## The one rule this entire layer exists to enforce

> **The LLM plans and judges; deterministic code computes and writes.**

Every domain module below is a **plain TypeScript function**, callable as a tool by `ExecutorAgent`, never something the LLM computes in free text. This is the architecture guide's single most load-bearing decision (§8): "the difference between AI that helps and AI that is a liability in a tax filing."

## Folder structure

```
cellix_backend/src/domain-tools/
├── domain-tools.module.ts
├── types/
│   └── domain-tool.types.ts       # shared input/output contracts
├── gst/
│   ├── gst-match.tool.ts          # gst_match
│   ├── itc-compute.tool.ts        # itc_compute
│   └── gst-match.tool.spec.ts
├── tds/
│   ├── tds-26as-match.tool.ts     # tds_26as_match
│   └── tds-26as-match.tool.spec.ts
├── reconciliation/
│   ├── bank-recon.tool.ts         # bank_recon
│   └── bank-recon.tool.spec.ts
├── accounting/
│   ├── ind-as-gen.tool.ts         # ind_as_gen
│   ├── trial-balance-check.tool.ts # trial_balance_check
│   ├── cost-allocation.tool.ts    # cost_allocation
│   └── *.spec.ts
├── ingestion/
│   ├── gstr2b-parser.ts           # normalize GSTR-2B JSON/Excel export
│   ├── form26as-parser.ts         # normalize 26AS PDF/text
│   ├── tally-export-parser.ts     # normalize Tally XML/CSV
│   └── bank-statement-parser.ts   # normalize bank statement PDF/CSV
└── registry.ts                    # tool registry ExecutorAgent queries
```

## Shared contract

```typescript
// types/domain-tool.types.ts
export interface DomainToolResult<T> {
  data: T;
  confidence: number;              // 0-1; below threshold => must be flagged, never auto-accepted
  exceptions: DomainException[];   // never silently dropped
  sourceRefs: SourceRef[];         // feeds Phase 4 citation layer directly
}

export interface DomainException {
  code: string;                    // versioned code, e.g. 'GST_NAME_FUZZY_MATCH'
  severity: 'flag' | 'block';      // 'block' prevents write, 'flag' allows write + review marker
  message: string;
  affectedRows: number[];
}

export interface SourceRef {
  documentType: 'gstr2b' | 'form26as' | 'tally' | 'bank_statement' | 'workbook';
  documentId: string;
  rowOrLine: string | number;
}

// Every domain tool implements this signature — deterministic, no LLM call inside.
export type DomainTool<TInput, TOutput> = (input: TInput) => DomainToolResult<TOutput>;
```

## Example: `gst_match` stub (illustrates the pattern, not final matching logic)

```typescript
// gst/gst-match.tool.ts
export interface GstMatchInput {
  purchaseRegister: NormalizedInvoiceRow[];
  gstr2b: NormalizedInvoiceRow[];
  matchKeys: Array<'gstin' | 'invoiceNumber' | 'invoiceDate'>;
  amountTolerance: number; // e.g. 1 (₹1)
}

export interface GstMatchOutput {
  matched: MatchedPair[];
  partialMatch: MatchedPair[];
  missingIn2B: NormalizedInvoiceRow[];
  missingInRegister: NormalizedInvoiceRow[];
}

export const gstMatch: DomainTool<GstMatchInput, GstMatchOutput> = (input) => {
  // STUB: implement exact-key matching first (deterministic, testable),
  // THEN fuzzy fallback (vendor name similarity) ONLY for rows that fail exact
  // match — and fuzzy matches must always produce a 'flag' exception, never
  // silently join the 'matched' bucket. Confidence scoring required per source
  // doc §5 ("98%+ GST match accuracy" KPI target lives here).
  throw new Error('Not implemented — requires CA-reviewed matching spec before production use.');
};
```

## Tool registry — how `ExecutorAgent` calls these

```typescript
// registry.ts
export const domainToolRegistry: Record<string, DomainTool<any, any>> = {
  gst_match: gstMatch,
  itc_compute: itcCompute,
  tds_26as_match: tds26asMatch,
  bank_recon: bankRecon,
  ind_as_gen: indAsGen,
  trial_balance_check: trialBalanceCheck,
  cost_allocation: costAllocation,
};

// ExecutorAgent, when handling a domain-flagged subtask (from PlannerAgent's
// structured plan — see architecture guide §4 step 6), calls:
//   const result = domainToolRegistry[toolName](toolInput);
// and then writes formulas referencing result.data — NEVER writes result.data
// values as hard-coded literals. This is the same hardcode-lint rule from
// 03_tier2_generate_verify.md, applied here too.
```

## Ingestion parsers — separate from matching logic

Per architecture guide Layer 3: source-document ingestion must normalize GSTR-2B/26AS/Tally/bank-statement formats into a common schema **before** any matching tool runs. These parsers are pure data-transformation, no LLM involvement, and should be independently unit-tested against sample fixtures (redacted/synthetic data only — do not use real client data as test fixtures).

```typescript
// ingestion/gstr2b-parser.ts
export interface NormalizedInvoiceRow {
  gstin: string;
  invoiceNumber: string;
  invoiceDate: string; // ISO 8601
  taxableValue: number;
  taxAmount: number;
  sourceRowRef: SourceRef;
}

export function parseGstr2b(rawExport: Buffer | string): NormalizedInvoiceRow[] {
  // STUB — real implementation needs the actual GSTR-2B JSON/Excel schema,
  // which should come from a CA-reviewed fixture set, not assumed here.
  throw new Error('Not implemented.');
}
```

## Explicit non-goals for this phase

- No production-correct tax computation logic.
- No connector integration (Tally API, GST portal, QuickBooks) — that's Month 13-18 per the existing roadmap and depends on this scaffolding existing first.
- No UI changes — this phase is backend-only; the mode selector (Phase 2) and citation layer (Phase 4) are what surface this to the CA.

## Acceptance criteria

- [ ] Every function in `domainToolRegistry` has the `DomainTool<TInput, TOutput>` signature and a corresponding `.spec.ts` file, even if the implementation throws `Not implemented`.
- [ ] No domain tool contains an LLM call anywhere in its call graph — enforce via a lint rule or code review checklist item, not just documentation.
- [ ] `DomainToolResult.confidence` and `.exceptions` are non-optional in the type — a tool cannot compile if it forgets to consider confidence/exceptions.
- [ ] Ingestion parsers have fixture-based tests using synthetic (non-real) sample documents only.
- [ ] `ExecutorAgent`'s hardcode-lint check (from Phase 1) is confirmed to also catch domain-tool output written as literals — add a specific test case for this.
