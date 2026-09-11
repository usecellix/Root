# Razorpay Test Mode Setup

The web chat feature requires Razorpay subscriptions and payment links for checkout. This guide explains how to set them up.

## 1. Create a Razorpay Account

1. Go to [razorpay.com](https://razorpay.com)
2. Sign up for a test account (or use an existing one)
3. Navigate to **Settings** → **API Keys** (or **Test Mode** if you see that option)
4. Copy your **Key ID** (starts with `rzp_test_`) and **Key Secret**
5. Update `.env` in `cellix_backend/`:
   ```
   RAZORPAY_KEY_ID=rzp_test_YOUR_KEY_HERE
   RAZORPAY_KEY_SECRET=YOUR_SECRET_HERE
   ```

## 2. Create Plans for Subscriptions

The backend needs three **Razorpay Plans** for the three subscription tiers. Plans are templates that subscriptions reference.

### Via Razorpay Dashboard (Easy)

1. In Razorpay Dashboard, go to **Settings** → **Subscriptions** (or search for "Plans")
2. Click **Create Plan**
3. Create three plans with these settings:

   **Plan 1: Beta**
   - Plan Period: Monthly
   - Interval: 1
   - Amount: ₹899 (89900 paise)
   - Billing Cycle: 0 (unlimited)
   - Notes: `tier=beta`

   **Plan 2: Solo**
   - Plan Period: Monthly
   - Interval: 1
   - Amount: ₹1,299 (129900 paise)
   - Billing Cycle: 0 (unlimited)
   - Notes: `tier=solo`

   **Plan 3: Firm**
   - Plan Period: Monthly
   - Interval: 1
   - Amount: ₹5,999 (599900 paise)
   - Billing Cycle: 0 (unlimited)
   - Notes: `tier=firm`

4. Copy each Plan ID (starts with `plan_`) and update `.env`:
   ```
   RAZORPAY_PLAN_ID_BETA=plan_YOUR_BETA_ID
   RAZORPAY_PLAN_ID_SOLO=plan_YOUR_SOLO_ID
   RAZORPAY_PLAN_ID_FIRM=plan_YOUR_FIRM_ID
   ```

### Via Razorpay API (Scripted)

```bash
curl -u KEY_ID:KEY_SECRET https://api.razorpay.com/v1/plans \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "period": "monthly",
    "interval": 1,
    "period": "monthly",
    "amount": 89900,
    "currency": "INR",
    "description": "Cellix Beta Plan",
    "notes": {"tier": "beta"}
  }'
```

Repeat for solo (129900) and firm (599900).

## 3. Update Backend .env

After creating plans, your `.env` should look like:

```env
RAZORPAY_KEY_ID=rzp_test_TadshV7lmDpyxG
RAZORPAY_KEY_SECRET=your_actual_secret_here
RAZORPAY_PLAN_ID_BETA=plan_YOUR_BETA_ID
RAZORPAY_PLAN_ID_SOLO=plan_YOUR_SOLO_ID
RAZORPAY_PLAN_ID_FIRM=plan_YOUR_FIRM_ID
```

## 4. Test Checkout

1. Start the backend: `npm run start:dev`
2. Start the frontend: `npm run dev`
3. Sign in to http://localhost:5173
4. Go to `/app/billing` → "Plans & credits"
5. Click "Subscribe" on any plan
6. You'll be redirected to Razorpay's hosted checkout
7. Use test card: `4111 1111 1111 1111`, expiry `12/25`, CVV `123`

## Post-Payment Redirect (Subscriptions Only)

Razorpay's Subscriptions API has **no `callback_url` parameter** — unlike
Payment Links (used for top-ups), a subscription's hosted checkout can't be
told per-API-call where to send the customer afterwards. If you want
subscribers to land back on `/app` instead of Razorpay's own confirmation
page, configure it once from the Dashboard:

1. Razorpay Dashboard → **Settings** → **Subscriptions** (or **Payment
   Configuration**, naming varies by account) → look for a redirect/return
   URL field
2. Set it to your site's origin + `/app` (e.g. `http://localhost:5173/app`
   in dev, your real domain in production)

This is account/settings-level, not something `cellix_backend` sends in the
API request. Regardless of which page the customer is looking at, the
**webhook** (`/webhooks/razorpay`) is what actually grants credits — so a
subscription still works correctly even before this redirect is configured;
it only affects where the browser tab ends up.

## Webhook Setup (Optional)

For the balance to update after payment, the Razorpay webhook must reach your backend. In test mode:

1. Use a tunnel tool (`ngrok`, `localtunnel`):
   ```bash
   npx localtunnel --port 4001
   ```
   This gives you a public URL like `https://xyz.loca.lt`

2. In Razorpay Dashboard → **Webhooks**, add:
   - URL: `https://xyz.loca.lt/webhooks/razorpay`
   - Events: Check `payment.authorized`, `subscription.activated`, `subscription.charged`

3. Get the webhook secret from Razorpay and update `.env`:
   ```
   RAZORPAY_WEBHOOK_SECRET=whsec_your_secret
   ```

## Troubleshooting

- **Invalid Plan ID**: Plan doesn't exist or is from a different account. Check Dashboard → Subscriptions.
- **API Authentication Failed**: Key ID/Secret mismatch or wrong mode (test vs live).
- **Webhook not firing**: Tunnel URL must be reachable. Test with `curl https://your-tunnel-url/health`.
- **Balance not updating**: Webhook isn't being called or secret doesn't match.

## Reference

- Razorpay Docs: https://razorpay.com/docs/subscriptions/
- Test Card: https://razorpay.com/docs/payments/payments-dashboard/#test-mode-cards
