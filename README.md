# Vantage Broker Assistant

Turns a broker's notes into Monday.com records, after the broker approves. See `docs/product-spec-v1.md` and `docs/build-plan.md`.

## Running it

```
npm install
npm run dev
```

Settings, in `.env.local` for development or the host's settings in production:

| Variable | What it is |
| --- | --- |
| `SESSION_SECRET` | At least 32 random characters. Encrypts the sign-in cookie. |
| `MONDAY_CLIENT_ID`, `MONDAY_CLIENT_SECRET` | The Monday OAuth app brokers sign in with. Its "New OAuth Flow" (OAuth 2.1 with PKCE) must be on. Scopes: `me:read`, `boards:read`, `boards:write`, `updates:read` (notes in lookups). |
| `APP_URL` | The app's address, e.g. `https://broker.vantageres.com`. The Monday app's redirect URL is `APP_URL/api/auth/callback`. |
| `BROKER_APP_ANTHROPIC_KEY` | Vantage's Claude API key. |
| `GOOGLE_MAPS_API_KEY` | Google Maps Geocoding key, for Desired Location. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis (added by Vercel's Upstash integration). Holds approval settings and the short sign-in renewal lock; never Monday records. Required in production; development uses an in-memory stand-in. |
| `OPERATIONS_MANAGER_IDS` | Monday user ids, comma-separated, allowed to change approval settings at `/admin/approvals`. |
| `EMAIL_MONITOR_USERS` | Monday user ids, comma-separated, who see the Email tab while it is built (`docs/email-monitor-plan.md`). Unset: nobody. |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT_ID` | The Entra app registration for Connect Outlook (Web platform, delegated `Mail.Read`, `User.Read`, `openid`, `offline_access`). Its redirect URI is `APP_URL/api/email/callback`. |
| `CRON_SECRET` | Random text Vercel Cron sends to `/api/email/cron` (set it in Vercel; Vercel adds it to the request). Scheduled email runs need it and a paid Vercel plan (`vercel.json` runs the cron every 15 minutes). |

Development only (ignored in production):

| Variable | What it is |
| --- | --- |
| `MONDAY_DEV_TOKEN` | A personal Monday token, for development on a PC. "Development sign-in" and the scripts use it. While it is in use, writes outside the Broker App Test workspace are refused. |
| `MONDAY_DEV_PROXY_AUTH=1` | Shows "Development sign-in", which signs in as the owner of the environment's Monday token (added by the cloud environment's network secret). |
| `DEV_EXTRACTION_FILE` | A saved extraction (JSON) used instead of calling Claude, to try the screens without a Claude key. |
| `DEV_MAILBOX_FILE` | A file of emails that stands in for Outlook in the Email tab, e.g. `src/lib/email/fixtures/sample-mailbox.json` (made up). |
| `DEV_CLASSIFICATION_FILE` | Saved answers used instead of calling Claude to sort email, e.g. `src/lib/email/fixtures/sample-classification.json`. |
| `DEV_SCAN_FILE` | Saved answers used instead of calling Claude in the first-time scan (Email tab, Contacts), e.g. `src/lib/email/fixtures/sample-scan.json`. |
| `DEV_HISTORY_FILE` | Saved history lines (one line of background per email) used instead of calling Claude, e.g. `src/lib/email/fixtures/sample-history.json`. |

Phones sign in from a computer: Monday's sign-in page doesn't work in a phone browser, so the phone shows a code and the broker enters it at `/link` on a computer (see `src/lib/link.ts`).

## Checks

```
npm test          # rules, matching, saving, lookups, memory, approvals, sign-in renewal
npm run typecheck
npx next build
npm run try-capture -- "a note"   # a note against the test boards, read only
npm run try-lookup -- "a question"   # a question against the test boards, read only
```

On Windows the npm scripts above that set variables (`dev`, `try-capture`, `try-lookup`) need a POSIX shell. Run them directly instead:

```
npx next dev
npx tsx --env-file=.env.local scripts/try-lookup.ts "retail around 2,000 sf"
```
