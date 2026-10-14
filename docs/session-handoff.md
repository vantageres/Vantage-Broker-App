# Session hand-off (Oct 14, 2026)

What a new Claude Code session needs to pick up the Broker Assistant work. Read this with `product-spec-v1.md`, `build-plan.md` and `monday-test-boards.md`.

## Where things stand

- Branch `claude/spec-review-planning-8omcwd`. Commit and push there. No pull request unless John asks.
- Live at https://vantage-broker-app.vercel.app. Vercel deploys from the branch.
- Built and confirmed on Vercel by John:
  - Monday sign-in (OAuth 2.1 with PKCE)
  - capture with in-place editing, one question at a time, pick, claim and blocked records
  - saving, including a Broker Note
  - Saved today
  - the approval settings page (`/admin/approvals`, Upstash Redis)
  - lookups ("What do we have on Maria Chen?")
- Monday app scopes: `me:read`, `boards:read`, `boards:write`, and now `updates:read`.
  - `updates:read` was added after a lookup showed an error in the notes section.
  - Confirmed Oct 14: after signing in again, notes show with no error line.

## Seeing the live app from a session

- The session can open the sign-in page and call the API, but it cannot sign in as a broker. Monday sign-in needs John's own login in a browser.
- So checks of signed-in screens on Vercel are done by John, who reports what he sees.
- To check behaviour, a session runs the app locally against the test boards:
  - `NODE_USE_ENV_PROXY=1 npx next dev`, with `MONDAY_DEV_PROXY_AUTH=1` in `.env.local`
  - the network secret adds the Monday token
  - drive it with Playwright using `executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"`
- `.env.local` is gitignored. A new session needs `SESSION_SECRET` (any 32+ characters), `MONDAY_DEV_PROXY_AUTH=1`, and optionally `DEV_EXTRACTION_FILE` (a saved extraction JSON used instead of calling Claude).
- The Claude key is not in this environment, so local capture uses the saved extraction.
- A session on John's Windows PC (`C:\Claude Projects\Vantage Broker App`) has no network secret, so it cannot reach the test boards as a signed-in broker. It can build, test, and run signed-out screens. Use Git Bash for `npm run dev` (the script sets variables the POSIX way).

## Rules to keep

- Never ask John to paste tokens or keys into chat. Never print the Claude key. Never use the session's own Claude credentials for the app.
- Claude data settings: no training, no retention (see `build-plan.md`).
- Write only to the test workspace "Broker App Test" (`18004807`). Live boards are read only.
- Undo test saves afterwards: reset Linda Park and delete any test Broker Notes.
- Users: John Smyth `44432289` (tester and Operations Manager), Emily Stein `25374507` (second broker).

## Next work, in order

1. **Notes in lookups:** confirmed Oct 14. After signing in again with `updates:read`, John sees the notes section with no error line.
2. **Service worker** for the installed app. Built Oct 14 (`public/sw.js`, offline page `public/offline.html`). Tried locally with `next build && next start`: it registers, caches only the shell files, and shows the offline page when the server is down. Confirmed by John on his iPhone: the offline page shows in airplane mode and the app returns afterwards.
3. **Phone sign-in from a computer** (built Oct 14; see `build-plan.md`, "Signing in a phone"). John to test on the live site: phone shows a code, computer at `/link` enters it, phone signs in. Also check the computer is still signed in afterwards (a second Monday sign-in for the same user might end the first one; not yet known).
4. **Model comparison:** Opus 5.5 at medium and low effort, Sonnet 5.5, Haiku 5.5, with 3+ runs per test note. It must run where `BROKER_APP_ANTHROPIC_KEY` is available.
5. **John's decisions and setup:**
   - The Leads automation that resets Follow Up Date when a note is added.
   - Adding the six-month follow-up automation to Contacts Test.
   - A Vantage domain later.
6. **Phase 3** (spec): voice, photos, Property Leads lookup and edit, property and listing searches, summaries.
