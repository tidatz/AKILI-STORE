# AKILI STORE — final owner setup

## Google sign-in and email redirects

Connected Supabase project: `rtowgcggjmtszziqgmux` (`supabase-indigo-ball`).

1. In Supabase Authentication → URL Configuration, set Site URL to `https://www.akilistore.com`.
2. Allow these exact callbacks: `https://www.akilistore.com/auth/callback` and `https://akilistore.com/auth/callback`. Keep any existing legitimate application redirects. For preview verification, add `https://mifumoyabiashara-git-feat-akili-marketplace-swaburs-projects.vercel.app/auth/callback` temporarily; remove it after verification.
3. Create/select the Google OAuth web client. Add `https://www.akilistore.com` as the authorized JavaScript origin. Authorized redirect URI: `https://rtowgcggjmtszziqgmux.supabase.co/auth/v1/callback`.
4. Enter the Google client ID and secret directly in Supabase Authentication → Sign In / Providers → Google, then enable the provider. Do not share the secret in chat or source files.
5. Verify registration, email confirmation/recovery and Google sign-in from the production domain. The Google button becomes available when Supabase reports the provider enabled. Verify the owner lands on `/admin` and a normal reader cannot open admin APIs.

The existing verified owner `tidatzacademy@gmail.com` already has the admin database permission. Login uses the existing account. No password has been reset or replaced.

## Snippe

1. In Vercel project `mifumoyabiashara`, set server-only `SNIPPE_API_KEY`, `SNIPPE_WEBHOOK_SECRET` and `SITE_URL=https://www.akilistore.com`. Keep `SNIPPE_PAYMENTS_ENABLED=false` during verification.
2. Set Snippe callback to `https://www.akilistore.com/api?action=webhook` and register the correct signing secret.
3. Use Admin → Settings → Check Snippe Connection. This verifies the provider account connection; it does not prove a successful purchase.
4. Use the provider-supported test environment to verify completed, pending and failed payments, amount mismatch, duplicate callback, library entitlement and PDF reading/download. Verify public webhook access without deployment authentication.
5. Activate only after those checks pass, then redeploy production. Perform an agreed, controlled live transaction and reconcile the provider reference against the order and ledger.

Pending/failed payments must never unlock paid content. The admin has no button that invents a successful payment.

## Transactional emails

Authenticated buyers can recover purchased books from My Library. Optional direct access emails and admin resend require a verified Resend sender and the two server variables `RESEND_API_KEY` / `EMAIL_FROM`. Supabase Auth handles registration and recovery email separately; verify its sender/delivery settings before inviting a large audience.
