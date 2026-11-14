# Snippe — AKILI STORE

The existing production `SNIPPE_API_KEY`, `SNIPPE_WEBHOOK_SECRET` and `SITE_URL` are present. Admin → Mauzo na malipo → **Thibitisha muunganisho** successfully verified the live Snippe account on 14 November 2026. This read-only balance request does not create a payment or prove webhook delivery. Public checkout remains disabled pending the controlled purchase below.

## Production configuration

Vercel project: `mifumoyabiashara`, team `swaburs-projects`.

| Server variable | Purpose |
|---|---|
| `SNIPPE_API_KEY` | Existing Snippe key with `collection:read` and `collection:create` |
| `SNIPPE_WEBHOOK_SECRET` | Matching account signing secret |
| `SITE_URL` | `https://www.akilistore.com` |
| `SNIPPE_PAYMENTS_ENABLED` | Keep `false` until the controlled purchase is verified; set `true` and redeploy to open public sales |

Credentials remain Secret values in Vercel, never in browser code, logs, Git or chat. Environment changes require redeployment. Existing credentials must not be regenerated merely for verification.

## Controlled launch purchase

1. Sign in as an existing admin and open **Mauzo na malipo → Jaribu malipo · TSh 500**. This opens the published book checkout with `?verify=1`.
   A reader or author opening this verification URL sees an account notice and **Ingia kwa akaunti ya admin**, rather than an unrelated normal-price checkout. Switching accounts signs out only the current app session; Google offers account selection and returns to the exact verification URL. No account is automatically promoted.
2. The admin reviews an explicit **real TSh 500 payment**, enters their own mobile number and selects **Lipa TSh 500**. The agent must not initiate it without payer authorization. PIN entry stays on the payer's phone.
3. This is the ordinary checkout/payment/fulfillment flow. The server fixes the amount at 500 only for a confirmed database admin while public payments are disabled. Reader-supplied flags, editable metadata and client-supplied prices cannot claim this amount. The book's listed price remains TSh 25,000.
4. The real order is labelled `verification_test=true` and displayed as **Jaribio la mfumo** in order history. This label never invents a successful state or bypasses payment verification. Only an independently verified Snippe payment can create the paid order, entitlement and ledger allocations.
5. Confirm the provider reference, amount/currency, authentic webhook event, paid order, single entitlement, 60/30/10 ledger allocation and authenticated PDF reading/download. A polling event alone does not prove the webhook secret matches. Database-only checks run inside rolled-back transactions and leave no fake sales.
6. Open public sales only after these checks. Setting `SNIPPE_PAYMENTS_ENABLED=true` closes the discounted launch path; ordinary checkout always uses the book's database price.

## Callback and reconciliation

Every payment includes this public HTTPS callback:

`https://www.akilistore.com/api?action=webhook`

The server verifies HMAC-SHA256 over the exact `timestamp.raw_body`, rejects stale timestamps, then independently reads `GET /v1/payments/{reference}`. Reference, order, amount, currency and provider status must match before the database atomically records payment, library entitlement, ledger allocation and notification. The Vercel adapter preserves the raw body.

The server uses a stable idempotency key below Snippe's 30-character limit. A retry of the same checkout returns the same order/payment. Failed or pending payments never unlock content; a late failed event cannot downgrade a paid order. Checkout status polling can reconcile delayed webhooks with the same provider verification.

Purchased books are available in the authenticated library. Optional purchase emails use a verified Resend sender (`RESEND_API_KEY`, `EMAIL_FROM`); SMS receipts require a separately verified eHub connection and explicit activation.

## Validation

`npm run check` and `npm test` cover private checkout access, price tampering, admin-only verification, idempotency, signatures, stale/tampered callbacks, amount mismatch and protected content. Live connection and final delivery require separate evidence.

Primary documentation: https://docs.snippe.sh/docs/2026-01-25/authentication, https://docs.snippe.sh/docs/2026-01-25/payments/mobile-money, https://docs.snippe.sh/docs/2026-01-25/webhooks.
