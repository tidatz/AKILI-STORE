# AKILI STORE — final owner setup

## Domain connection — completed

The production domain is now connected to Vercel. Namecheap Advanced DNS was updated and both hostnames show **Valid Configuration** in Vercel; HTTPS has been issued.

| Type | Host | Saved value |
|---|---|---|
| A | @ | 216.198.79.1 |
| CNAME | www | 3f409600a8f15249.vercel-dns-017.com. |

Unrelated verification TXT records, mail forwarding/SPF, nameservers and DNSSEC were preserved.

Verified: `https://www.akilistore.com/` returns HTTP 200; `https://akilistore.com/` returns HTTP 308 to the www hostname. The live login route and owner admin dashboard were also verified in the browser. The original deployment remains available at https://ebook-sales-website-development.vercel.app/.

A browser that previously loaded the old Base44 root can temporarily retain its permanent redirect. During verification the direct login route `https://www.akilistore.com/login?next=%2Fadmin` worked and reached `/admin`.

## Google sign-in and email redirects

Connected Supabase project: `rtowgcggjmtszziqgmux` (`supabase-indigo-ball`).

Completed in Supabase Authentication → URL Configuration:

- Site URL: `https://www.akilistore.com`.
- Exact callbacks saved: `https://www.akilistore.com/auth/callback`, `https://akilistore.com/auth/callback`, and `https://ebook-sales-website-development.vercel.app/auth/callback`.
- The existing v0 application redirect was preserved; no wildcard or preview access was added.

Google is now **enabled** in Supabase. The user supplied the OAuth credentials directly; they were not read or copied by the agent. Remaining branding and verification steps:
1. Create/select the Google OAuth web client. Add `https://www.akilistore.com` as the authorized JavaScript origin. Authorized redirect URI: `https://rtowgcggjmtszziqgmux.supabase.co/auth/v1/callback`.
2. In Google Auth Platform → Branding, use **AKILI STORE** as the app name and complete the brand verification requirements. The Google Cloud branding page was unavailable in the agent browser, so this external name change has not been completed. Google controls approval and propagation; a website title change alone cannot replace the Supabase project hostname on Google's screen. Do not rotate the working OAuth credentials just to change the display name.
3. Verify registration, email confirmation/recovery and Google sign-in from the production domain. The Google button becomes available when Supabase reports the provider enabled. Verify the owner lands on `/admin` and a normal reader cannot open admin APIs.

The existing verified owner `tidatzacademy@gmail.com` has the admin database permission. Its existing email/password login was verified end to end on the custom domain and opened `/admin`. No password was reset or replaced. Public Google sign-in and registration-email delivery still require their separate verification.

## Snippe

In Vercel project `mifumoyabiashara`, Production config variables `SITE_URL=https://www.akilistore.com` and `SNIPPE_PAYMENTS_ENABLED=false` have been saved. The `SNIPPE_API_KEY` and `SNIPPE_WEBHOOK_SECRET` variable names are now present; their values were not revealed and the live API connection was successfully verified from Admin → Mauzo na malipo on 14 November 2026. The payment, matching signed webhook and final library delivery still need the controlled launch purchase. Public sales remain disabled.

1. Add server-only `SNIPPE_API_KEY` and `SNIPPE_WEBHOOK_SECRET` directly in Vercel as Secret variables, scoped to Production. Never paste these values into chat or commit them. Redeploy after saving. Keep `SNIPPE_PAYMENTS_ENABLED=false` during connection verification.
2. Set Snippe callback to `https://www.akilistore.com/api?action=webhook` and register the correct signing secret.
3. Use Admin → Mauzo na malipo → Thibitisha muunganisho. This verifies the provider account connection; it does not prove a successful purchase. The old service-status panel has been removed from Settings.
4. Use **Mauzo na malipo → Jaribu malipo · TSh 500** for the owner-approved real launch purchase while public sales remain closed. This is admin-only, fixed at TSh 500 server-side, and labelled as a verification order. Verify the authentic webhook event, paid order, amount, entitlement, ledger and PDF reading/download before activation. The public book price remains TSh 25,000. See [SNIPPE_SETUP.md](SNIPPE_SETUP.md).
5. Activate only after those checks pass, then redeploy production. Perform an agreed, controlled live transaction and reconcile the provider reference against the order and ledger.

Pending/failed payments must never unlock paid content. The admin has no button that invents a successful payment.

## Transactional emails

Authenticated buyers recover purchased books from My Library. Purchase emails link to the authenticated library. Optional branded invitation emails and admin resend use a verified Resend sender and the two server variables `RESEND_API_KEY` / `EMAIL_FROM`. Save the API key as a Secret directly in Vercel; the sender address must belong to a verified Resend domain.

Admin → Watumiaji na waandishi → Alika mwandishi creates a seven-day invitation bound to one email address. The UI reports whether an email was actually accepted by the email provider and offers a manual invitation link. If Resend is not configured, invitations reuse the existing Supabase Auth email sender to send a one-time sign-in link. Its SMTP delivery and rate limits still apply; provider errors are reported honestly and the manual invitation link remains available. A verified user also sees their own pending invitation throughout the reader dashboard and explicitly accepts it there. This preserves the workflow when registration email confirmation opens a separate tab. Other emails and expired/used invitations cannot claim the role; an invitation grants author access only.

Supabase Auth handles registration and recovery email separately; verify its sender/delivery settings before inviting a large audience.

## Bulk SMS

See [EHUB_SETUP.md](EHUB_SETUP.md). Admin → Ujumbe wa SMS now includes mobile forms for API key/secret and webhook signing secret. Server-side sender discovery removes the UUID entry step; credentials are encrypted in Supabase Vault with server-only RPC access. The eHub account already has an approved **AKILI STORE** sender and an active key with that name. The owner must still enter the existing credentials, register the webhook and complete a controlled delivery check. No real messages have been sent during development.
