# Minimal eBook Sales Website

Single featured PDF today, multiple books supported later. Vanilla HTML/CSS/JS and one Netlify Function; Supabase Postgres, Auth and Storage; Snippe mobile money; optional Resend transactional emails. No marketplace, cart, testimonials or customer account requirements.

## Routes
- `/` — featured book, buy, checkout and menu.
- `/book/:slug` — sales page for any published book.
- `/reader.html?token=...` — authorized PDF reader with page controls, zoom and download.
- `/admin.html` — Books, Website Editor, Sales and Settings.
- `/api?action=webhook` — Snippe signed webhook.

## Deploy with GitHub → Netlify

1. Import this repository in Netlify and deploy the `main` branch after merging the implementation PR. Base directory: repository root. Publish directory: `public`. Functions directory: `netlify/functions`. The included `netlify.toml` configures these.
2. In Supabase, run `supabase/schema.sql` on a project dedicated to the eBook store. This creates eight isolated `ebook_*` tables, locks them behind RLS (no browser table policies), creates the private `ebook-pdfs` and public `ebook-assets` buckets, and seeds the requested single book at **25,000 TZS**. Re-running seed inserts is harmless.
3. In Netlify **Site configuration → Environment variables**, configure:

| Name | Description |
|---|---|
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret server-side key; NEVER publish |
| `SUPABASE_PUBLISHABLE_KEY` | Public Supabase key for Auth REST |
| `SNIPPE_API_KEY` | Snippe live API key |
| `SNIPPE_WEBHOOK_SECRET` | Snippe Settings → Webhook Secret; mandatory signature verification |
| `SITE_URL` | Final HTTPS origin, no trailing slash |
| `RESEND_API_KEY` | Email service for returning access links (optional until enabling email) |
| `EMAIL_FROM` | Verified sender address, for example `Books <books@your-verified-domain>` |

**No real payments are allowed until Snippe API key, signing secret, valid SITE_URL and a PDF have been configured.** The frontend never displays fabricated payment success. The public publishable key is safe to expose; the service_role key is not.

4. Create an Admin user in **Supabase → Authentication → Users** with an email/password, then authorize their UUID only:
   ```sql
   insert into public.ebook_admins(user_id)
   select id from auth.users where email='YOUR_ADMIN_EMAIL'
   on conflict do nothing;
   ```
   Public registration is intentionally absent. Admin can change password after login. Admin login is checked server-side against `ebook_admins`, not client metadata.
5. Open `/admin.html`. Upload the **final** PDF to the existing book, optionally upload its cover and logo, then save the book and publish branding changes. If Resend is configured, an email with a 30-day access link goes to the verified buyer. Immediately after payment, the original checkout browser can claim access securely using its own random secret.

### Payment lifecycle

Checkout reserves an order at the **database** price, uses a client-generated checkout UUID and 256-bit checkout secret, and sends Snippe an idempotency key of under 30 characters. The provider sends an HMAC-SHA256 webhook over the original raw JSON body, signed with `SNIPPE_WEBHOOK_SECRET`. The server validates signature and freshness, then independently calls `GET /v1/payments/{reference}`. A Postgres RPC marks the payment and order atomically after verifying reference, amount and currency. Repeated callbacks cannot grant duplicate purchases. PDFs are stored only in the private bucket and a paid order with valid access token gets a 15-minute signed read URL.

PDF access tokens are bearer capabilities. Anyone holding a valid token can read that specific purchased book until expiration. Treat email access links as private; use HTTPS and avoid public forwarding. Storage-signed URLs may remain valid briefly after a token is revoked.

### Security / operational notes

- All business tables have RLS enabled, no `anon`/`authenticated` access, and writes go through server-side authorized endpoints.
- PDF upload permission is granted only via signed upload URL after admin authorization. Images are public for storefront rendering.
- Sales dashboard lists the 100 most recent orders; download counts measure **download requests**, not guaranteed completed transfer bytes.
- A book with no uploaded PDF cannot initiate payment. A book with past sales cannot be deleted (unpublish instead).
- If email delivery fails after the payment is confirmed, retrying the signed webhook can send it; Admin can also reissue a link. Without Resend, browser access works immediately after checkout, but email retrieval cannot operate.
- For realistic payment testing, use a valid Snippe test or live account and provider callbacks. Never substitute fake paid statuses.

## Tests

```bash
npm run check
npm test
```

Manual launch checks: mobile page, checkout validation and USSD, legitimate completed/failed webhook, duplicate webhook, access link on purchased book, rejected nonbuyer, PDF download, admin CRUD, site preview/publish, and multiple-book listing.

## Configuration still needed after code delivery

The GitHub repository does not hold your **final PDF/cover**, Supabase secret key, Snippe credentials, or verified email sender. The Netlify GitHub connection and production end-to-end tests are deployment-time steps.
