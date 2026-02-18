# How Echo Payments Work (API vs Worker)

## Short answer: **API only. The worker is not involved.**

| Part of Echo | Handles payments? | Why |
|--------------|-------------------|-----|
| **.NET API** | ✅ Yes | Creates Stripe Checkout links, receives Stripe webhooks, updates `subscription_tier` in PostgreSQL. |
| **Python Worker** | ❌ No | Only does transcription and summarization. It never sees payment or Stripe. |
| **Extension / Dashboard** | Shows “Upgrade” | Sends user to the API; API returns a Stripe URL; user pays on Stripe’s page. |

---

## Flow (high level)

1. **User clicks “Upgrade”** (in extension or future dashboard).
2. **Frontend** calls **your API**: e.g. `POST /payments/create-checkout-session` with the chosen plan (Arcade Pass or Echo Pro) and the user’s JWT.
3. **API** (using Stripe’s server SDK and your **secret key**):
   - Creates a Stripe Checkout Session (price = $9/mo or $5/mo).
   - Sends back the **Checkout URL** to the frontend.
4. **Frontend** opens that URL in a new tab → user pays on **Stripe’s hosted page** (Stripe handles card, etc.).
5. **After payment**, Stripe calls **your API** at a **webhook URL** (e.g. `POST /webhooks/stripe`) with events like “payment succeeded” or “subscription updated.”
6. **API** (webhook handler):
   - Verifies the request is really from Stripe (signature).
   - Finds the user (e.g. by `client_reference_id` = user id you sent when creating the session).
   - Updates **PostgreSQL**: `echo_users.subscription_tier = 'arcade_pass'` or `'echo_pro'`.
7. Next time the user logs in or the extension refreshes, the API returns the new `subscriptionTier` from the DB. No worker involved.

---

## Why API and not Worker?

- **Security:** Only the API should hold your Stripe **secret key** and talk to Stripe. The worker runs in a different process and doesn’t need payment data.
- **Stripe webhooks:** Stripe sends HTTP POST to a **single URL** you configure (your API). The worker has no HTTP endpoint for Stripe; the API does.
- **Database:** The API already has auth and DB access. It’s the right place to update `subscription_tier` when a webhook says “payment succeeded.”

---

## What we add in code

| Where | What |
|-------|------|
| **API** | Stripe SDK, `POST /payments/create-checkout-session`, `POST /webhooks/stripe`, config for Stripe keys and Price IDs. |
| **Extension** | “Upgrade” button that calls the API and opens the returned Stripe URL. |
| **Worker** | Nothing. |

After this, when a user pays, the API updates the DB and the next login/refresh shows Arcade Pass or Echo Pro.

---

## Setup (Stripe + API + Extension)

### 1. Stripe Dashboard

1. Create a [Stripe account](https://dashboard.stripe.com) and get your **Secret key** (API keys).
2. Create two **Products** and recurring **Prices**:
   - **Arcade Pass** – $9/month recurring → copy the **Price ID** (e.g. `price_xxx`).
   - **Echo Pro** – $5/month recurring → copy the **Price ID**.
3. **Webhooks:** Developers → Webhooks → Add endpoint:
   - URL: `https://your-api-domain.com/webhooks/stripe` (must be HTTPS in production).
   - Events: `checkout.session.completed`, `customer.subscription.deleted`.
   - Copy the **Signing secret** (starts with `whsec_`).

### 2. API configuration

Add a `Stripe` section to `appsettings.json` / `appsettings.Production.json` (or use env vars in production):

| Config key | Env var | Description |
|------------|--------|-------------|
| `Stripe:SecretKey` | `STRIPE_SECRET_KEY` | Stripe secret key (sk_test_... or sk_live_...) |
| `Stripe:WebhookSecret` | `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (whsec_...) |
| `Stripe:ArcadePassPriceId` | `STRIPE_ARCADE_PASS_PRICE_ID` | Price ID for $9/mo |
| `Stripe:EchoProPriceId` | `STRIPE_ECHO_PRO_PRICE_ID` | Price ID for $5/mo |
| `Stripe:SuccessUrl` | (optional) | Override success redirect |
| `Stripe:CancelUrl` | (optional) | Override cancel redirect |

Example (do not commit real keys):

```json
"Stripe": {
  "SecretKey": "sk_test_...",
  "WebhookSecret": "whsec_...",
  "ArcadePassPriceId": "price_...",
  "EchoProPriceId": "price_...",
  "SuccessUrl": "",
  "CancelUrl": ""
}
```

### 3. Extension

When the user is on **Free** tier, two buttons appear: **Arcade Pass $9/mo** and **Echo Pro $5/mo**. Clicking one opens Stripe Checkout in a new tab. After payment, Stripe redirects to your API’s `/payments/success`; the user can close the tab and refresh the extension to see the new tier.
