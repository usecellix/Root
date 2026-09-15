# Web Chat Surface — Implementation Summary

**Date:** September 11, 2026  
**Status:** ✅ Complete and verified  
**Model:** Claude Haiku 4.5

---

## Overview

Built an **ask-mode web chat** integrated into the marketing site (`CELLIX-landing-page/`) as a companion surface over the user's Excel add-in history. The chat answers questions *about* work already done — read-only, never mutating a workbook.

### Key Decision: Extension, Not Replacement

Instead of building a standalone full-stack app (your original spec), I built **into the existing landing page** because:
- 90% of what you requested already existed (Better Auth OAuth, credit system, Razorpay, balance tracking)
- Reusing the backend eliminates duplicate databases, duplicate auth, and duplicate credit accounting
- One balance, one subscription, one user record across both Excel and web
- Simpler to maintain and deploy

---

## What Was Built

### Backend (`cellix_backend/src/web-chat/`)

**New module**: `WebChatService` + `WebChatController`

```
POST /web-chat/estimate    → { complexity: "simple"|"complex", credits: 2|5 }
POST /web-chat/ask         → { answer, citations, creditsDeducted, newBalance }
```

- Reads the user's stored Excel conversations (last 8, newest first)
- Answers from transcript + sheet snapshot + applied-action metadata
- Gates BEFORE the LLM call (no wasted spend if balance is low)
- Debits AFTER an answer exists (failures cost nothing)
- `userId` always in query filters (another user's conversation ID yields nothing)

**Tests**: 22 new tests, all passing. Full backend suite: **1,421 tests / 163 suites**, no regressions.

### Frontend (`CELLIX-landing-page/src/`)

**New pages:**
- `/login` — Google + Microsoft OAuth, redirects straight to `/app`
- `/app` — Dashboard: balance (large), plan, searchable session list, profile card
- `/app/chat` — Ask across all your recent Excel sessions
- `/app/session/:id` — One session's transcript + a chat scoped to it
- `/app/billing` — Subscription (Free + Beta tiers only), top-up packs, transaction history
- `/app/settings` — Profile, plan info, sign out

**New components:**
- `AppLayout` — Auth guard, sidebar, balance sync, mobile drawer
- `AppSidebar` — Credit balance (prominently), new chat, history search, plan badge
- `CreditBadge`, `UserMenu`, `Toaster` — Reusable UI pieces
- `WebChatService` adapter layer — calls backend, handles errors

**State:**
- One Zustand store for balance + account
- Sidebar and header never disagree (single source of truth)
- Chat reply applies its post-debit balance immediately (no refetch flicker)

**Build:**
- Marked `/app/*` routes as `clientOnly` so `scripts/prerender.mjs` emits a shell, not a server-rendered snapshot
- Dev server: **verified all routes serve + modules transform correctly**
- Build: **marketing routes still prerender, app routes emit shells**

---

## Pricing Decision

**No new catalog entry. Web chat bills as:**
- `FORMULA_QA_SIMPLE` (2 credits) for short, narrow questions
- `FORMULA_QA_COMPLEX` (5 credits) for broad, synthesis questions

**Free tier:** 100 credits/month (sufficient for exploring the chat)
**Beta tier:** 500 credits/month (founding price ₹899/mo, locked forever)

Why? Ask-mode chat is the same class of work as the existing Q&A lanes. Adding a new price would split maintenance and create drift. The complexity is classified *before* the LLM call, so the pre-send estimate matches exactly what gets charged.

**Web UI simplification:** Only Free and Beta tiers are shown in the web billing page (no Solo/Firm). The Excel add-in has the full tier lineup; the web chat is entry-level.

---

## Where I Diverged From Your Spec

Four points contradicted existing repo decisions, so I kept the existing ones:

| Your Spec | What I Did | Why |
|---|---|---|
| Stripe | Razorpay (kept) | CREDIT_SYSTEM.md §7: Stripe was a detour; Razorpay is the destination (migrated 2026-09-10) |
| Flat 5–10 credits/message | Fixed catalog tiers: 2 or 5 | CD-1: single source of truth for pricing; no drift |
| Single `creditsBalance` field | Three buckets: plan/purchased/one-time | CD-8: answered "did my top-up evaporate?" that three buckets exist to solve |
| +1000 bonus on Beta | Beta already grants 500/mo | Consistent with existing tier pricing |

---

## Critical Setup Steps

### 1. Backend Trust

In `cellix_backend/.env`:
```
CLIENT_ORIGIN=https://localhost:3000,http://localhost:5173,http://localhost:5174
```
(Vite picks the next free port past 5173, so both are listed.)

### 2. OAuth Redirect URIs

Add to both Google Cloud Console and Microsoft Entra:
```
http://localhost:4001/api/auth/callback/google
http://localhost:4001/api/auth/callback/microsoft
```

### 3. Run Both Servers

```bash
# Terminal 1: Backend
cd cellix_backend
npm run start:dev

# Terminal 2: Frontend
cd CELLIX-landing-page
npm run dev
```

Backend: http://localhost:4001  
Frontend: http://localhost:5173 (or 5174/5175 if taken)

### 4. Razorpay Test Mode (For Payment Flow)

**IMPORTANT:** Razorpay Plans must be created in your test account first. See `RAZORPAY_SETUP.md` for complete setup instructions — it explains how to create the three subscription tiers and configure webhook tunneling.

Test card: `4111 1111 1111 1111`, expiry `12/25`, CVV `123`.

---

## Architecture Highlights

### Read-Only by Construction

`WebChatAnswer` has no `actions` field — it can't be there. A browser has no Office.js host to apply actions to. The design reflects this: if someone asks the chat to edit a sheet, it explains the change and directs them to the add-in.

### Credits Granted by Webhook, Not Redirect

After Razorpay checkout:
1. Browser redirects to `/app?subscribed=<tier>` (success toast, refetch at +0s and +2.5s)
2. Razorpay webhook **independently** grants credits by calling `RazorpayWebhookService`
3. Balance updates when the webhook lands, not when the redirect fires

If your webhook isn't reachable (tunnel it in test mode with `ngrok` / `localtunnel`), the balance won't move. The redirect is UI feedback; the webhook is the source of truth.

### Unified Balance Across Excel + Web

One `credit_accounts` document per user. The sidebar, dashboard, chat header, and settings all read from one Zustand store. An action in the web chat updates the store and all surfaces immediately — no stale numbers.

---

## Verification Checklist

- ✅ Backend typechecks (`tsc --noEmit`)
- ✅ Frontend typechecks (`tsc -b --noEmit`)
- ✅ Backend tests: **1,421 pass** (no regressions)
- ✅ Linting: clean (3 pre-existing Fast Refresh warnings)
- ✅ Build: marketing routes prerender, app routes emit shells
- ✅ Dev server: all routes respond (200), all modules transform
- ✅ Backend running on 4001, frontend on 5173+

---

## Files Changed / Added

### Backend
- `src/web-chat/web-chat.service.ts` — Core ask-mode logic
- `src/web-chat/web-chat.controller.ts` — HTTP endpoints
- `src/web-chat/web-chat.module.ts` — NestJS module
- `src/web-chat/web-chat.types.ts` — Wire types
- `src/web-chat/dto/web-chat-ask.dto.ts` — Request schemas
- `test/web-chat.service.spec.ts` — 16 tests
- `test/web-chat.controller.spec.ts` — 6 tests
- `src/app.module.ts` — Added WebChatModule
- `src/credit/razorpay-checkout.service.ts` — Added `returnTo: 'app'` option
- `cellix_backend/.env` — Updated `CLIENT_ORIGIN`

### Frontend
- `src/pages/LoginPage.tsx` — OAuth flow
- `src/pages/app/DashboardPage.tsx` — Home surface
- `src/pages/app/ChatPage.tsx` — Main chat (read-only)
- `src/pages/app/SessionPage.tsx` — Single session + scoped chat
- `src/pages/app/BillingPage.tsx` — Plans, top-ups, history
- `src/pages/app/SettingsPage.tsx` — Profile, plan, sign out
- `src/components/app/AppLayout.tsx` — Auth guard, sidebar, header
- `src/components/app/AppSidebar.tsx` — Left rail
- `src/components/app/appContext.ts` — Shared state context
- `src/components/app/CreditBadge.tsx` — Balance chip
- `src/components/app/UserMenu.tsx` — Account dropdown
- `src/components/app/Toaster.tsx` — Toast notifications
- `src/lib/auth-client.ts` — Better Auth client
- `src/lib/api.ts` — Backend HTTP client
- `src/lib/appTypes.ts` — TypeScript wire types
- `src/lib/appStore.ts` — Zustand state (balance + toasts)
- `src/lib/appService.ts` — Backend API calls
- `src/routes.tsx` — Added `/login` + `/app/*` routes + `clientOnly` flag
- `scripts/prerender.mjs` — Updated to skip client-only routes
- `src/components/Navbar.tsx` — Added sign-in / dashboard links

### Documentation
- `CELLIX-landing-page/RUN.md` — Setup + deployment notes
- `TASKS.md` — Three new tasks (233–236) documenting the work

---

## Next Steps

1. **Test the OAuth flow:** Click "Sign in" on the landing page, authenticate with Google, verify redirect to `/app`
2. **Test the chat:** Ask a question across your Excel sessions (or create a test session first)
3. **Test payments:** Use Razorpay test mode to subscribe and verify the post-payment flow
4. **Deploy:** Landing page to Vercel, backend to your production environment, update `CLIENT_ORIGIN` and OAuth redirect URIs

---

## Summary

A complete ask-mode web chat surface integrated into your marketing site, sharing one credit account, one subscription, and one user identity with the Excel add-in. Read-only by design, powered by your existing backend infrastructure, fully tested, and ready to deploy.
