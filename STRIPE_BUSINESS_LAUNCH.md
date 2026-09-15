# Luxia P&C Stripe business launch

The website has two deliberately separate payment environments.

## Development through September 2026

- Branch: `develop`
- Website: `https://dev.luxiapc.com`
- Stripe mode: test
- Stripe account: existing development/sandbox account
- Vercel Preview variables:
  - `STRIPE_MODE=test`
  - `STRIPE_SECRET_KEY=sk_test_...`
  - `STRIPE_WEBHOOK_SECRET=whsec_...` from the test webhook
  - `PUBLIC_SITE_URL=https://dev.luxiapc.com`
  - `COACHING_PRICE_CENTS=100` while the €1 checkout test remains intentional

## Official business release

Before release, the business owner must create or take ownership of the Stripe account using `luxiapc@outlook.com`, complete Stripe's business verification, and add the official business bank account for payouts. The account website/business URL must be `https://luxiapc.com`.

Create a live webhook endpoint for:

`https://luxiapc.com/api/stripe-webhook`

Subscribe it to:

- `checkout.session.completed`
- `checkout.session.expired`

Then configure only the Vercel Production environment with:

- `STRIPE_MODE=live`
- `STRIPE_SECRET_KEY=sk_live_...` from the business Stripe account
- `STRIPE_WEBHOOK_SECRET=whsec_...` from the live webhook endpoint
- `PUBLIC_SITE_URL=https://luxiapc.com`
- `COACHING_PRICE_CENTS` set to the approved live price in cents

Do not copy live Stripe secrets into Preview or Development. Do not copy the existing sandbox keys into Production. The application refuses to create a checkout when the Stripe key type, declared mode, and website domain do not match.

After business verification and payout setup are complete, perform one explicitly approved low-value live transaction. Verify the webhook updates the booking, verify the owner and client emails, and confirm the payment appears in the business Stripe balance before opening bookings publicly.
