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

Development only (ignored in production):

| Variable | What it is |
| --- | --- |
| `MONDAY_DEV_TOKEN` | A personal Monday token, for development on a PC. "Development sign-in" and the scripts use it. While it is in use, writes outside the Broker App Test workspace are refused. |
| `MONDAY_DEV_PROXY_AUTH=1` | Shows "Development sign-in", which signs in as the owner of the environment's Monday token (added by the cloud environment's network secret). |
| `DEV_EXTRACTION_FILE` | A saved extraction (JSON) used instead of calling Claude, to try the screens without a Claude key. |

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
