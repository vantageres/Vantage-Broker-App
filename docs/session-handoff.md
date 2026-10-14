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
- John's Windows PC (`C:\Claude Projects\Vantage Broker App`) reaches the test boards with John's personal Monday token, `MONDAY_DEV_TOKEN` in `.env.local` (added Oct 14; never print it). "Development sign-in" and the scripts use it, and while it is in use any write outside the Broker App Test workspace is refused in code (`testWorkspaceOnly` in `src/lib/monday/client.ts`). Ask questions with `npx tsx --env-file=.env.local scripts/try-lookup.ts "question"`. The npm scripts that set variables don't run in Windows' default shell; run `npx next dev` directly.
- Pushing from the PC uses Git's sign-in on Windows. If a push hangs, ask John to check for a GitHub sign-in window. The `gh` account `jsmyth3rd` can't push to this repository.

## Rules to keep

- Never ask John to paste tokens or keys into chat. Never print the Claude key. Never use the session's own Claude credentials for the app.
- Claude data settings: no training, no retention (see `build-plan.md`).
- Write only to the test workspace "Broker App Test" (`18004807`). Live boards are read only.
- Undo test saves afterwards: reset Linda Park and delete any test Broker Notes.
  - Exception (Oct 14): John asked to keep Linda Park as she is after his capture test (Leasee, Healthcare and Office, 2,500 sf, $6,000, Moorestown, follow-up Oct 20, plus his Broker Note). Don't reset her unless he asks. His note says 2,000 sq ft and the field says 2,500 sf; not yet confirmed whether he edited it on the proposal.
- Users: John Smyth `44432289` (tester and Operations Manager), Emily Stein `25374507` (second broker).

## Next work, in order

1. **Notes in lookups:** confirmed Oct 14. After signing in again with `updates:read`, John sees the notes section with no error line.
2. **Service worker** for the installed app. Built Oct 14 (`public/sw.js`, offline page `public/offline.html`). Tried locally with `next build && next start`: it registers, caches only the shell files, and shows the offline page when the server is down. Confirmed by John on his iPhone: the offline page shows in airplane mode and the app returns afterwards.
3. **Phone sign-in from a computer** (built Oct 14; see `build-plan.md`, "Signing in a phone"). Confirmed by John on the live site: his iPhone signed in with a code entered at `/link`, and the computer stayed signed in (a second Monday sign-in for the same user doesn't end the first).
4. **Property search and summaries:** confirmed by John on the live site Oct 14. The retail 2,000 sf question found 45 Kings Hwy E and Kings Crossing Suite 102 in about two seconds. Summaries linked the right records and took about 5 seconds, which John finds acceptable. A short search without a question mark ("Available industrial 15 to 20k sf") was read as a note; fixed in `question.ts`.
   - John turned off some test-board automations on Oct 14 and will adapt them once the app works; the Follow Up Date questions are on hold.
5. **Listings that fit a person** (built Oct 14; see `build-plan.md`). Tried against the test boards from John's PC. John to try on the live site: "Any listings for Ray Fulton?", "What fits Marcus Bell?", "Any listings for Dave Reyes?".
6. **Property Leads lookup and edit** (built Oct 14; see `build-plan.md`). Tried in the local app against Property Leads Test: lookup, sensitive fields hidden on Emily's 510 Main St, refusals (not assigned, changed meanwhile, Monday-only status), and a real save.
   - **Keep 22 Elm St as it is** (John, Oct 14). The LA Signed test set off Monday's marketing automations: Status In Marketing, LA Signed and In Marketing Date Oct 14, Pre-Listing group, 11 checklist subitems. Don't restore it unless he asks.
   - LA Signed stays settable, with the short warning "This moves the listing into marketing."
7. **Model comparison:** Opus 5.5 at medium and low effort, Sonnet 5.5, Haiku 5.5, with 3+ runs per test note. It must run where `BROKER_APP_ANTHROPIC_KEY` is available.
8. **John's decisions and setup:**
   - The Leads automation that resets Follow Up Date when a note is added.
   - Adding the six-month follow-up automation to Contacts Test.
   - A Vantage domain later.
9. **Phase 3** (spec): voice, photos, vantageres.com listings, "what changed this week". Property search, requirement summaries, listings for a person, and Property Leads lookup and edit are done (items 4 to 6).
