# Snippe Mobile Money — Muunganisho wa eBook

Mfumo unatumia Snippe API version `2026-01-25` kupitia HTTPS. Checkout inatengeneza **order** yenye bei halisi kutoka database, Snippe inatuma USSD prompt, webhook inahakikiwa kwa HMAC-SHA256, na server inakagua tena `GET /v1/payments/{reference}`. PDFs hufunguliwa baada ya order kuwa `paid` pekee.

## 1. Taarifa za Snippe

Ingia kwenye dashboard yako ya **Snippe**. Chagua:

- **Settings → API Keys → Create API Key**. Ruhusa: `collection:create` na `collection:read` pekee. Nakili key mara moja, lakini **usiitumie kwenye chat, code ya GitHub au screenshot**.
- **Settings → Webhook Secret**. Nakili signing key kwa faragha. Usiiweke kwenye public frontend.

Maelekezo rasmi:
- https://docs.snippe.sh/docs/2026-01-25/authentication
- https://docs.snippe.sh/docs/2026-01-25/payments/mobile-money
- https://docs.snippe.sh/docs/2026-01-25/webhooks

## 2. Vercel — Configuration

Fungua project **mifumoyabiashara** kwenye Vercel → **Settings → Environment Variables**, kisha weka:

| Variable | Value |
|---|---|
| `SNIPPE_API_KEY` | API Key ya Snippe yenye `collection:create` na `collection:read` |
| `SNIPPE_WEBHOOK_SECRET` | Signing key kutoka Snippe → Webhook Secret |
| `SITE_URL` | URL halisi ya HTTPS kwa environment husika bila slash ya mwisho |

Kwa branch `preview/ebook-functional`, mfano wa `SITE_URL` ni:

```text
https://mifumoyabiashara-git-preview-ebook-functional-swaburs-projects.vercel.app
```

Kwa **Production**, tumia domain inayosomeka kwenye Vercel → Project → Domains (si preview alias). Set `SITE_URL` tofauti kwa Preview na Production inapofaa.

Taarifa hizi lazima ziwe **server-side environment variables**. `SNIPPE_API_KEY` na `SNIPPE_WEBHOOK_SECRET` zisionekane kwenye `public/`, HTML, JavaScript ya browser, au repo. Kubadili Vercel environment variables kunahitaji redeploy ili functions zitumie values mpya.

Muunganisho wa Supabase uliopo unahitaji pia `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` na `SUPABASE_PUBLISHABLE_KEY`. Usichanganye Supabase `service_role` key na public publishable key.

## 3. Webhook

Backend inatuma URL ifuatayo kwenye Snippe kila inapounda payment:

```text
<SITE_URL>/api?action=webhook
```

Hii ni `POST` endpoint ya backend, si ukurasa wa kuingia kwa browser. Snippe inatuma event ya `payment.completed` au `payment.failed`. Server inakataa signature isiyolingana, timestamp ya zamani, reference isiyojulikana, amount/currency zisizolingana na duplicates. Inathibitisha status tena moja kwa moja kutoka Snippe.

Kama webhook imechelewa, ukurasa wa mteja pia unaomba status kwa server. Server inaweza kuhakiki Snippe, lakini haionyeshi `paid` bila uthibitisho wa provider.

## 4. Kuhakikisha connection

1. Redeploy branch iliyowekewa environment variables.
2. Ingia kwenye `/admin.html`.
3. Nenda **Mipangilio → Kagua Muunganisho wa Snippe**. Hiki kinafanya ombi la kusoma balance ya akaunti (**hakianzishi malipo**) na kurudisha matokeo bila kuonyesha salio wala API key.
4. Hakikisha kitabu kina PDF na bei yake ni **TSh 25,000**.
5. Fanya muamala wa kweli kwa ridhaa ya mlipaji. Thibitisha USSD, webhook/order kuwa `paid`, reader na PDF download. Usiwashe mauzo ya umma mpaka jaribio hili lifaulu.

Kwa kutuma PDF access kwa email baada ya malipo, ongeza pia `RESEND_API_KEY` na `EMAIL_FROM` inayotoka kwenye verified sender domain; vinginevyo mnunuzi anapata access katika browser ya checkout lakini email link haiwezi kutumwa.

## 5. Usalama

- Usishiriki API key au webhook secret kwenye mazungumzo; ziweke **Vercel Environment Variables** pekee.
- Snippe idempotency key ina urefu usiozidi characters 30 na huzuia duplicate intents kwenye retries.
- Server inahakiki amount, currency, reference na status. Event ya webhook pekee haipewi mamlaka ya kufungua PDF.
- `ebook_payments.last_checked_at` inapunguza verification requests zinazorudiwa.
- Hakuna `paid` state ya kubuni, hakuna transaction ya test kwenye live database.
