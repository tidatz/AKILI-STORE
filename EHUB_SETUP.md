# eHub SMS — AKILI STORE

API contract reviewed against https://sms.ehub.co.tz/api-docs. The linked developer documentation requires a signed Bearer request. API keys are never placed in browser code, SQL tables or Git.

## Production variables

Save these directly in Vercel project `mifumoyabiashara` → Environment Variables, scoped to Production, as Secret values:

| Variable | Value from your eHub account |
|---|---|
| `EHUB_API_KEY` | Developer → API Keys |
| `EHUB_API_SECRET` | Secret belonging to that same API key |
| `EHUB_SENDER_ID` | UUID of an approved sender, not its display name |
| `EHUB_WEBHOOK_SECRET` | Developer → Webhook signing secret |

Configure the delivery-report endpoint in eHub:

`https://www.akilistore.com/api?action=sms-webhook`

Keep `EHUB_TRANSACTIONAL_SMS_ENABLED=false` until the sender and a controlled delivery test are verified. Setting it to `true` enables a receipt SMS for a confirmed, paid order. This receipt links to the authenticated library and contains no PDF access token.

## Verification

1. Redeploy after saving the variables. In Admin → Ujumbe wa SMS, use **Angalia salio** to verify the API signature, sender approval and account connection. This sends no SMS.
2. eHub Developer → Webhook → Send a test event should receive HTTP 200. Wrong or missing HMAC signatures must fail.
3. Submit one agreed test message to the owner's own phone. Verify its provider message ID, actual cost and delivery report before a larger campaign.
4. Use the preview to check recipient count and exact message text before confirming a bulk send. Maximum: 1,000 recipients and 640 characters. Duplicate phone numbers are sent once.

## Delivery and retries

The API signs the exact `timestamp`, HTTP method, full path and raw JSON body with HMAC-SHA256. A campaign has a request ID and a stored fingerprint; a repeated submission cannot send it twice. eHub acceptance means queued/processing, not delivery. Signed delivery reports update message statuses; a later failed event cannot overwrite a delivered message.

eHub does not document an idempotency header for send requests. A network timeout after POST is therefore recorded as **Haijathibitishwa** and is never automatically submitted again. Check the provider history before starting another send.

Only admins can compose, submit or inspect campaigns. Reader and author accounts have no SMS API access. All campaign recipients and delivery records are protected by server-only table grants and RLS.
