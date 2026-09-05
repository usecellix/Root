# CREDIT_SYSTEM_SCHEMA.md — Cellix

> Concrete schema companion to `CREDIT_SYSTEM.md` (the "why"). Every collection here is new — nothing in this document alters an existing collection's shape, matching `ARCHITECTURE.md` §7's precedent that additive-by-design is the default posture. Cross-reference `CREDIT_SYSTEM.md`'s CD-N decisions inline; this document does not re-argue them.
>
> *Drafted: September 4, 2026. Status: Proposed — no migration exists yet.*

---

## 1. `credit_cost_catalog` — code, not a collection

Deliberately **not** a Mongo collection. Per `CREDIT_SYSTEM.md` CD-1, catalog prices are a static, versioned, code-reviewed source of truth (`credit-cost-catalog.ts`), the same reasoning `ARCHITECTURE.md` AD-8 gives for keeping domain arithmetic as "plain, versioned, unit-tested code — never runtime-computed." A database-editable price table would let a price change ship without a code review, a test run, or a git history — unacceptable for something that is simultaneously a legal price list and a billing input.

```typescript
type CreditCostEntry =
  | { kind: 'flat'; actionType: string; credits: number; status: 'active' | 'unwired' }
  | { kind: 'per-unit'; actionType: string; creditsPerUnit: number; unitSize: number; status: 'active' | 'unwired' };

// Exhaustiveness enforced by a parity test (creditCatalogParity.spec.ts),
// same pattern as actionCatalogParity.spec.ts (ARCHITECTURE.md AD-7).
// 'unwired' entries (CREDIT_SYSTEM.md CD-5) are explicitly excluded from
// the "every action type must be chargeable" assertion, not silently
// skipped by an incomplete switch.
const CREDIT_COST_CATALOG: CreditCostEntry[] = [
  { kind: 'flat', actionType: 'FORMULA_QA_SIMPLE',        credits: 2,  status: 'active' },
  { kind: 'flat', actionType: 'FORMULA_QA_COMPLEX',       credits: 5,  status: 'active' },
  { kind: 'flat', actionType: 'FORMULA_GENERATE_OR_FIX',  credits: 8,  status: 'active' },
  { kind: 'flat', actionType: 'DATA_CLEANUP_TALLY',       credits: 10, status: 'active' },
  { kind: 'per-unit', actionType: 'GSTIN_VALIDATION_BATCH', creditsPerUnit: 3, unitSize: 100, status: 'active' },
  { kind: 'flat', actionType: 'GST_RECONCILIATION',       credits: 22, status: 'unwired' },  // AD-8
  { kind: 'flat', actionType: 'ITC_COMPUTATION',          credits: 18, status: 'unwired' },  // AD-8
  { kind: 'flat', actionType: 'TDS_COMPLIANCE_CHECK',     credits: 12, status: 'unwired' },  // AD-8
  { kind: 'flat', actionType: 'AUDIT_TRAIL_PDF_EXPORT',   credits: 4,  status: 'active' },
  { kind: 'flat', actionType: 'MIS_DASHBOARD_BUILD',      credits: 28, status: 'active' },
  { kind: 'per-unit', actionType: 'EINVOICE_VALIDATION',  creditsPerUnit: 1, unitSize: 1, status: 'active' },
  { kind: 'flat', actionType: 'BANK_RECONCILIATION_ASSIST', credits: 15, status: 'unwired' }, // AD-8
];
```

---

## 2. `credit_accounts` — one per billing entity

```typescript
interface CreditAccount {
  _id: ObjectId;
  billingEntityType: 'user' | 'org';        // CREDIT_SYSTEM.md CD-7
  billingEntityId: string;                   // userId OR orgId — indexed, unique
  planTier: 'free' | 'solo' | 'firm' | 'enterprise';
  planCredits: number;                       // resets each cycle, no rollover — CD-8
  purchasedCredits: number;                  // top-ups, persist indefinitely — CD-8
  oneTimeCredits: number;                    // Free tier's 30cr grant, issued once — CD-8
  currentPeriodStart?: Date;                 // null for Free (no cycle)
  currentPeriodEnd?: Date;
  seatUserIds?: string[];                    // only set when billingEntityType === 'org'
  createdAt: Date;
  updatedAt: Date;
}

// Indexes
// { billingEntityId: 1 } — unique
// { billingEntityType: 1, planTier: 1 } — for admin/ops queries (e.g. "all Firm accounts")
```

**Balance resolution helper** (not a stored field — always derived at read time to avoid a second source of truth):

```typescript
function availableBalance(acct: CreditAccount): number {
  return acct.planCredits + acct.purchasedCredits + acct.oneTimeCredits;
}
```

**Atomic debit** (CREDIT_SYSTEM.md CD-6 — the operation, not just the shape):

```typescript
// Attempts planCredits first, falls through to purchasedCredits, then
// oneTimeCredits, entirely inside one findOneAndUpdate pipeline using an
// aggregation-pipeline update (Mongo 4.2+) so the fallthrough math and the
// floor check happen atomically, not as three sequential client-side ops.
async function debitCredits(billingEntityId: string, cost: number): Promise<boolean> {
  const result = await CreditAccountModel.findOneAndUpdate(
    {
      billingEntityId,
      $expr: { $gte: [{ $add: ['$planCredits', '$purchasedCredits', '$oneTimeCredits'] }, cost] },
    },
    [
      {
        $set: {
          // consume planCredits first, then purchasedCredits, then oneTimeCredits
          planCredits: { $max: [0, { $subtract: ['$planCredits', cost] }] },
          purchasedCredits: {
            $max: [0, { $subtract: ['$purchasedCredits',
              { $max: [0, { $subtract: [cost, '$planCredits'] }] }] }],
          },
          oneTimeCredits: {
            $max: [0, { $subtract: ['$oneTimeCredits',
              { $max: [0, { $subtract: [cost, { $add: ['$planCredits', '$purchasedCredits'] }] }] }] }],
          },
        },
      },
    ],
    { new: true },
  );
  return result !== null; // null means the $expr floor check failed — insufficient balance
}
```

---

## 3. `credit_ledger` — append-only, never updated

```typescript
interface CreditLedgerEntry {
  _id: ObjectId;
  billingEntityId: string;                   // matches credit_accounts.billingEntityId
  seatUserId?: string;                        // WHO spent it, for pooled org accounts — CD-9
  entryType: 'grant' | 'purchase' | 'debit' | 'one_time_grant';
  amount: number;                             // positive for grant/purchase, negative for debit
  bucket: 'planCredits' | 'purchasedCredits' | 'oneTimeCredits';
  actionType?: string;                        // set for entryType === 'debit', matches catalog key
  conversationId?: string;                    // correlates to the triggering conversation, where applicable
  changeSetId?: string;                       // correlates to the triggering ChangeSet, for write-shaped debits
  stripeEventId?: string;                     // idempotency key for grant/purchase entries — see §4
  createdAt: Date;                            // no updatedAt — this collection is never updated
}

// Indexes
// { billingEntityId: 1, createdAt: -1 } — account history, paginated
// { seatUserId: 1, createdAt: -1 } — per-member usage analytics (Firm plan promised feature)
// { stripeEventId: 1 } — unique, sparse — idempotency check before processing a webhook twice
```

**No TTL.** Same reasoning `ARCHITECTURE.md` AD-4 gives for `change_sets`/`audit_logs`: this is a durable financial record, not working memory — it should outlive any session-scoped collection, and (unlike `conversations`) there is no volume-driven reason to expire it.

---

## 4. `subscriptions` — Stripe-synced, read mostly by webhook handlers

```typescript
interface Subscription {
  _id: ObjectId;
  billingEntityId: string;                   // matches credit_accounts.billingEntityId
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: 'active' | 'past_due' | 'canceled' | 'incomplete';
  planTier: 'solo' | 'firm';                  // Free has no subscription row; Enterprise TBD — CREDIT_SYSTEM.md §8 Q2
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// processed_stripe_events — separate tiny collection, webhook idempotency only
interface ProcessedStripeEvent {
  _id: ObjectId;
  stripeEventId: string;                      // unique index — a duplicate webhook delivery is a no-op
  processedAt: Date;
}
```

**Why a separate `processed_stripe_events` collection rather than relying on `credit_ledger.stripeEventId`'s uniqueness alone:** subscription status changes (`customer.subscription.updated`) don't always produce a ledger entry (e.g. a plan-tier change with no immediate credit grant), so idempotency can't universally hang off the ledger. A dedicated event-id log covers every webhook type uniformly.

---

## 5. API surface additions

```
GET  /billing/account          — current balance (all 3 buckets) + plan tier, for the balance indicator
GET  /billing/ledger?cursor=   — paginated ledger history, for a "usage history" view
POST /billing/checkout/subscribe   — create a Stripe Checkout Session for a plan
POST /billing/checkout/topup       — create a Stripe Checkout Session for a top-up pack
POST /billing/portal               — create a Stripe Billing Portal session (plan change/cancel)
POST /webhooks/stripe              — Stripe webhook receiver (§4's idempotency check first)
```

`GET /billing/account` for an org-billed user resolves `orgId` from the session the same way `ARCHITECTURE.md` AD-9's `workbookId` pattern resolves scope — a lookup at request time, not a client-supplied parameter, for the same reason #170's `userId`-as-parameter-not-DTO-field decision gives: accepting a client-supplied billing entity ID would let any caller query another org's balance.

---

## 6. SSE contract addition

New event type on the existing `POST /excel-ai/conversation` stream (`ARCHITECTURE.md` AD-6):

```
event: credits
data: { "planCredits": 478, "purchasedCredits": 0, "oneTimeCredits": 0, "debited": 8, "actionType": "FORMULA_GENERATE_OR_FIX" }
```

Emitted once, immediately after the debit in `CREDIT_SYSTEM.md` CD-3 succeeds — i.e., at the same point a `ChangeSet` is created or a final answer is streamed, not before.

---

## 7. Migration notes

All four collections (`credit_accounts`, `credit_ledger`, `subscriptions`, `processed_stripe_events`) are wholly new — nothing existing references them, so nothing existing can break by their addition, matching `ARCHITECTURE.md` §7.1's "safe to do independently" classification.

**One coordination point:** every existing user needs a `credit_accounts` document created at rollout (Free tier, 30 `oneTimeCredits`, `billingEntityType: 'user'`) — a one-time backfill script, not a schema migration. Users who sign up after rollout get this document created at signup instead of backfilled.
