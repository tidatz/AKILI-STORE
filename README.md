# AKILI STORE

A Kiswahili digital book marketplace operated by TIDA TZ COMPANY. The existing book, cover, private PDF and owner account are preserved. The storefront shows only published, real products; the admin can add more books.

## User journeys

- Reader: discover and search → book details → separate approved PDF sample → direct checkout → verified payment → personal library → protected reader with saved progress.
- Author: admin invitation → verified email account → accept invitation → draft → upload cover, full private PDF and sample → submit → admin moderation → publish. Authors see only their own products, sales and balance.
- Admin: overview, book editor and moderation, invitations and account restrictions, sales verification, withdrawal records, reviews, support replies, branding, integration status and audit history.

There is no cart or subscription flow. AI, affiliate, course and audio features are future expansion; no simulated versions are presented as production features.

## Runtime and deployment

Vanilla HTML/CSS/JavaScript, Node API on Vercel, Supabase Auth/Postgres/private Storage. The Netlify adapter is retained. Vercel project: `mifumoyabiashara`, repository: `tidatz/AKILI-STORE`, production branch: `main`, public output: `public`. Install with `npm ci`. No frontend build step is required.

The original schema is `supabase/schema.sql`; `supabase/marketplace.sql` is the additive marketplace upgrade. Both have been applied to the connected store. Do not re-seed or reset a running database. All business tables use RLS with browser access revoked; authenticated API handlers validate the user, role, account status, ownership and purchase entitlement before reading or writing private records.

## Important routes

- Public: `/`, `/books`, `/categories`, `/book/:slug`, `/help`, `/platform-policies`.
- Accounts: `/login`, `/register`, `/forgot-password`, `/auth/callback`, `/profile-settings`.
- Reader: `/reader-dashboard`, `/my-library`, `/order-history`, `/notifications`, `/reader.html?book=<id>`.
- Author: `/author-dashboard`, `/author/books`, `/author/books/new`, `/author/books/:id/edit`, `/sales-analytics`, `/withdrawal-request`.
- Admin: `/admin`, `/admin/books`, `/admin/users`, `/admin/orders`, `/admin/withdrawals`, `/admin/support`, `/admin/settings`.
- Snippe callback: `/api?action=webhook`.

The older paid access-token reader remains supported. Admin access is authorized through `ebook_admins`, never a frontend email comparison or user-editable metadata. The existing `tidatzacademy@gmail.com` account is already an admin. Its password is not changed by this upgrade.

## Payment and finance controls

Checkout uses the authenticated, confirmed buyer, database price and an idempotency key. Live payments remain disabled unless `SNIPPE_PAYMENTS_ENABLED=true` is explicitly set after a verified provider test. HMAC webhook verification and an independent provider lookup validate reference, amount, currency and status. One database transaction commits paid status, entitlement, allocation ledger and notification. Duplicate completion callbacks have no duplicate financial/access effects.

Sale allocations use the existing 60% author / 30% platform / 10% operations policy. Withdrawal requests reserve balance under a database lock. Minimum request TSh 10,000; fee TSh 2,000. The admin records a payout reference only after actual payout outside the application; clicking a status button does not transfer money.

Full PDFs and sample PDFs use separate private buckets. Samples are validated before publication; the reader uses short-lived signed URLs and server-side access checks. Unpublished books stay available to existing entitled readers. Reviews require a purchase and admin moderation. Support and notifications use real saved records.

## Environment and owner setup

Server variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SITE_URL`. Snippe uses `SNIPPE_API_KEY`, `SNIPPE_WEBHOOK_SECRET`, `SNIPPE_PAYMENTS_ENABLED`. Optional returning access emails use `RESEND_API_KEY` and `EMAIL_FROM`. Never put server secrets in frontend files, Git or chat.

See `OWNER_SETUP.md` for Google provider/redirect configuration and the final payment test. Supabase email confirmation and password recovery also require the correct Site URL and allowed callback. A configured email sender is needed for reliable high-volume transactional mail.

## Validation

`npm run check` and `npm test` cover syntax, signature verification, payment reconciliation, duplicate processing, role escalation, cross-author access, unconfirmed email and unpaid/revoked access. A database transaction test verifies entitlement/ledger idempotency and withdrawal reservations, then rolls back all test records. Passing these checks is not a claim that a live Snippe charge or Google OAuth round trip has been completed.
