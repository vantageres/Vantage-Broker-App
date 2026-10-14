# Broker Assistant: Build Plan

Companion to [product-spec-v1.md](product-spec-v1.md). Oct 13, 2026.

The spec's four rollout phases stay as written. This plan adds a technical spike up front and breaks each phase into build work, with the points where Claude Design comes in.

## Proposed stack

The spec leaves technical choices to the build. These are the defaults unless there's a reason to change them.

| Concern | Choice | Why |
| --- | --- | --- |
| App | Next.js (App Router) + TypeScript, installable PWA | One codebase for phone and desktop. Server routes keep tokens and the Claude key off the device. |
| Hosting | Vercel (or similar) | Simple deploys, HTTPS by default, which a PWA needs. |
| Sign-in | monday.com OAuth app, one token per broker | Each broker acts as themselves, so Monday history shows who changed what. |
| Monday access | Monday GraphQL API, called from the server with the broker's token | Live reads, no local copy of records. |
| Language work | Claude API with tool use and structured output | Turns notes into a typed proposal object. Vision reads business cards and signs. |
| Voice | Phone's built-in dictation first; server transcription later if needed | Keyboard dictation already works in a PWA. Revisit in Phase 3. |
| App state | Small database (e.g. Postgres) for sessions, approval settings, and the "saved today" list | Holds app state only, never copies of Monday records. |

## Core design: the proposal object

Everything (typed notes, voice, photos) produces the same thing: a **proposal**. It is the contract between the language model, the approval screen, and the save step, so it gets defined first.

A proposal holds:

- Target record: existing item (board, id, name, owner) or "new Lead".
- Match candidates, when there is more than one.
- Field changes: column, current value, proposed value, and a reason when a value was moved to Notes.
- Note text for the Emails & Activities timeline (Broker Note type).
- Attachments (card or sign photo).
- Automations the change will start (e.g. status Qualified moves the Lead to Contacts).
- Open questions, asked one at a time (vague date, two matches, misheard phone number).
- Blocked reason, when the broker doesn't own the record (names the owner, or offers a claim).

Rules the server enforces, not the model:

- Ownership: Contact Broker or Co-Broker on Leads and Contacts; Broker, Co-Broker, or Co-Broker2 on Property Leads. Checked again just before every save.
- Fit rules: Budget is a single dollar amount; rent per foot and ranges go to Notes. Desired Location is one place; extra areas go to Notes.
- Required fields before proposing Qualified: email, phone, Property Type, Source, Contact Type.
- Sensitive property fields are removed from data **before** it reaches the language model, unless the broker is assigned to that property. This keeps them out of lookups and summaries entirely.
- Option-list mapping between boards (Contact Type "Not Set" on Leads vs "Not Labeled" on Contacts).
- Approval settings per action type, all starting at "always confirm."

## Phase 0: Technical spike (about 1 week, alongside the Monday prep)

Goal: prove the risky parts work before building screens.

1. Register a Monday OAuth app and sign in as a test broker.
2. Read the board schemas for Leads, Contacts, Properties New, Properties (old), and Property Leads. Generate a column map in code.
3. Write and delete a Broker Note through the timeline API (`create_timeline_item` / `delete_timeline_item`). Confirm the activity type id and behavior on Leads.
4. Matching: search by name, email, phone (digits only), and business name across Leads and Contacts. Measure speed on the full 1,610 items.
5. Draft the proposal schema and run the spec's capture example ("Met Dave Reyes...") through Claude end to end, without a UI.
6. Check how vantageres.com exposes listings (structured feed, sitemap, or page reads).

Exit: one note becomes a correct proposal and can be saved to a test item as the signed-in broker.

## Phase 1: Prepare Monday (spec phase 1, Operations Manager)

Remaining items from the spec's "Changes needed in Monday":

- [ ] Retire the Requirements subitem on Contacts.
- [ ] Add Business Name and Files to the Leads → Contacts automation.
- [ ] Add a Files column to Property Leads.
- [ ] Add every broker to Property Leads.
- [ ] Align Leads (and Property Leads) edit permissions to assigned people.
- [ ] Set up a test copy or test items so pilot work doesn't touch live clients.

Gate: Leads and Contacts share matching fields and options.

## Phase 2: Pilot capture and lookup (spec phase 2)

Build:

- Sign-in, session persistence, PWA install (manifest, icons, service worker for the shell only; no offline data).
- Conversation screen with text input.
- Capture: parse, match, propose, ask questions, approve / edit / remove / cancel, save, show result with Monday link.
- Claim flow and the "you don't own this" response.
- Lookup on Leads and Contacts with record links and last-updated times; "nothing found" when Monday has nothing.
- Failure handling: proposal stays on screen, save can be retried, never a false success.
- "Saved today" list.
- Approval settings stored per action type, editable by the Operations Manager (simple admin page or a settings board in Monday).
- Automated tests for every row of the spec's test-scenario table, run against a mocked Monday API.

Gate: two or three pilot brokers use it for real work and most proposals are approved as written.

## Phase 3: Voice, photos, properties, summaries (spec phase 3)

- Voice input with a review step that highlights names, phone numbers, and figures.
- Photos: business card, sign (Source = Sign), and attach-to-record. Ask for a clearer photo instead of guessing digits.
- Property lookup across both property boards and suite subitems; property links on Leads and Contacts.
- Property Leads lookup and edit; LA Signed settable with approval, other automation statuses refused with a "set this in Monday" message.
- vantageres.com listing lookup.
- Summaries across records, every statement citing its source record.
- Multi-person notes split into separate proposals.
- Roll out to all brokers.

Gate: brokers use all input modes without help.

## Phase 4: Loosen approvals (spec phase 4)

No rebuild needed. The Operations Manager relaxes action types one at a time. Add usage reporting for the success measures (approval-without-edit rate, requirement completeness, time to record, weekly users).

## When to use Claude Design

| When | What to design | Input to bring |
| --- | --- | --- |
| **Now, during Phase 0** | Pass 1: the main conversation screen and the **approval card** (current vs proposed values, Notes-placement message, automation warning, big Approve button, edit in place, remove item, cancel). Also: match picker, one-at-a-time question, claim / not-yours, save success, save failed + retry, sign-in. | The spec's capture example and test-scenario table; the proposal fields listed above; phone-first, one-thumb reach. |
| **Before Phase 2 build starts** | Hand off pass 1 to Claude Code. Lock the visual system (colors, type, spacing, Vantage branding, app icon for the home screen). | Logo and brand colors. |
| **During the pilot** | Revise the approval card from real broker feedback. | Pilot notes, screenshots. |
| **Before Phase 3 build** | Pass 2: voice review screen, photo capture and "photo read" review, lookup answer card, summary with citations, property and suite cards, desktop layout. | Real lookup and summary output from the pilot. |

The approval card is the most important screen in the app. Start Claude Design on it in parallel with the Phase 0 spike, since the spike decides what data it shows but not how it looks.

## Decisions (Oct 13, 2026)

1. **Approval settings** live on an admin page in the app, used mainly from desktop. Only the Operations Manager can open it.
2. **Claim race.** Accepted. The app re-reads the owner just before saving, and a small gap remains.
3. **Session memory.** Search keys (names, phones, emails) and chat context are kept on the server for one chat session only, and are cleared after 10 minutes with no activity.
4. **Claude API data handling.** Approved, on condition that the API account is set so that data is not used for training and is not stored. See "Claude API data settings" below.
5. **Test boards.** The Operations Manager creates them in a separate workspace. See "Test boards" below.

## Claude API data settings

- Use the Claude API under Anthropic's commercial terms, which do not train on API inputs or outputs by default. Confirm no training or feedback opt-in is turned on in the Console's privacy settings.
- Standard API accounts keep inputs and outputs for a limited period for safety review, then delete them. To have nothing stored, ask Anthropic sales for **Zero Data Retention (ZDR)** on the organization. Confirm the current retention period and ZDR terms with Anthropic before the pilot.
- The app avoids API features that store data on Anthropic's side, such as the Files API and batch jobs. Photos are sent inline with each request.
- The app logs nothing from prompts or answers in its own logs. Only request ids, timing, and errors are logged.

## Test boards

Create them in a separate workspace, for example "Broker App Test".

| Board | How to create | Items |
| --- | --- | --- |
| Vantage Leads | Duplicate, structure only | About 20 fictional items |
| Vantage Contacts | Duplicate, structure only | About 15 fictional items |
| Property Leads | Duplicate, structure only | 2 or 3 fictional items |
| Vantage Properties (old) | Duplicate, structure only | About 5 items, so the property links on test Leads and Contacts never touch live properties |
| Vantage Properties New | Duplicate with items (only 18), including suite subitems | As copied |

Speed tests on the full item counts run read-only against the live Leads and Contacts boards.

**Automations need attention, because duplicating a board can copy automations that still point at live boards:**

- Leads → Contacts on Qualified: repoint it to the **test** Contacts board.
- Contacts follow-up date (about six months out): keep it on the test Contacts board, and add the same rule on test Leads if we want one there.
- Property Leads: turn off Generate Property Folder and LA, and On Market, or repoint them to test targets, so they never create real folders, agreements, or listings. Note what LA Signed starts.
- Test Leads and Contacts: point Associated Properties at the test Properties board.

**Fictional items that cover the test scenarios:**

- Two people named Dave with different companies.
- One person who is in both Leads and Contacts.
- One record with no Contact Broker (for claiming).
- One record owned by a different broker (for the "not yours" response).
- Phone numbers in mixed formats, and one field holding two email addresses.
- One Lead missing some of the fields that Qualified requires.

**Also needed:**

- Emails & Activities turned on for the test boards, with the Broker Note activity type available.
- At least two broker seats with access to the test workspace, to test ownership and claiming.

## New questions from the spike

1. **Geocoding.** Decided: Google Maps (see below).
2. **Follow-up automation on test boards.** Add the six-month Follow Up Date automation to Contacts Test so the approval screen's automation warning can be tested.

## Claude model for capture

**Decision (Oct 14, 2026):** start with Claude Opus 5.5 at medium effort, with server-side fallback on.

First real runs on the test boards (Oct 14): Claude took 2.8 to 7.0 seconds per note, and each extraction was correct for the Dave Reyes example, the two Daves, and Ray Fulton. Results vary between runs of the same note: timing ranged 3.6 to 7.0 seconds, and optional details (such as "Looking to buy" in Notes) appeared in one run and not another.

**To do: compare Sonnet 5.5 and Haiku 5.5 for speed and accuracy.**

- Use a fixed set of about 20 real-style notes covering every test scenario, plus messy ones (dictation errors, several people in one note, vague dates).
- Run each note on Opus 5.5 (medium and low effort), Sonnet 5.5, and Haiku 5.5 with `npm run try-capture -- --model <id> "note"`. Haiku has no server-side fallback.
- Run each note at least three times per model, because results vary between runs. Compare median and worst-case time, not a single run.
- Score each extraction field by field against the expected answer, and record time and cost per note.
- Pick the cheapest, fastest model whose accuracy matches Opus on the scenarios that matter most: never guessing a date, phone number, or email, and placing values that don't fit into Notes.
- Repeat with pilot notes once brokers are using the app.

## Decided Oct 14, 2026

- **Weekday names:** Claude may turn "Tuesday" into the next such date. The approval screen shows dates with the weekday ("Tue, Oct 20, 2026") so a misread is easy to spot.
- **Map lookup:** Google Maps Geocoding turns Desired Location into a map point when the proposal is built. The approval screen shows the address Google found. If nothing is found, the field is left out and the broker is asked. The key is read from `GOOGLE_MAPS_API_KEY`; restrict it to the Geocoding API.
- **Named sites:** "wants to be at the old Bergen Mill site" goes in Notes; Desired Location is not changed. In Phase 3, named sites are looked up on the property boards and the broker is offered a property link.

## Claude Design

Canvas: https://claude.ai/artifact/AN33vsn4sYWVs8vRs1JSbn (first round, Oct 14, 2026). Phone: home, ask (lookup), capture review, question inside the proposal, pick a match, saved. Desktop: home, summary, review with current and proposed columns, business-card photo.

Look: Manrope; navy #1D3F7E for text and links, orange #D2461A for the main action, light grey #F4F5F8 ground, Vantage Commercial logo in the header.

**Decided Oct 14:** values are edited in place on the proposal (tap a value); there is no separate Edit button. "Approve Linda now" stays: when one note covers several people, a broker can save one while the other still has open questions. Every screen's header has a Saved today link.

Round 2 (added to the canvas Oct 14, for review): pick a match by first name, review with in-place editing, two people in one note with "Question 1 of 2" and an automation line, map check for a partial match, someone else's record, claim an unassigned record, save failed with retry, saved today, and the desktop approval settings page. Covers:

1. Blocked: "This record belongs to Emily Stein", with no changes, and the unassigned record with a Claim button.
2. Save failed, with the proposal kept and a Retry button.
3. Notes shown as current text plus the added text, so brokers see nothing is lost.
4. Desired Location with the map address found, and the "is this the right place?" question for a partial match.
5. Dates with the weekday ("Fri, Oct 16, 2026"), including the date chips.
6. A line for automations the save will start (follow-up date, Qualified moving a Lead to Contacts).
7. Several questions: "Question 1 of 3".
8. Several people in one note: one card each.
9. "Saved today" list.
10. Approval settings admin page (desktop only, Operations Manager).

## Phase 2 progress

**Slice 1 (Oct 14, 2026): capture end to end.** Built and tried in a browser against the test boards:

- Sign-in with Monday (OAuth, each broker as themselves; persists 30 days), plus a development-only sign-in.
- Conversation screen, approval card with in-place editing, one question at a time, pick a match, someone else's record, claim, save with retry (a note that fails after the fields saved is retried on its own), Saved today from Monday's activity log, sign out.
- Server re-checks ownership just before every write; claims re-read the owner before and after.
- Matching data is kept per chat session and dropped after 10 idle minutes.
- Installable basics: web manifest and icons.

A real save to Linda Park (Leads Test) wrote Notes, Follow Up Date and the Broker Note correctly. Test records were restored afterwards.

**Finding:** on Leads Test, adding a Broker Note sets Last Contact, and a Monday automation then resets Follow Up Date to a week out and changes Open Contact Date. It overwrote the date the broker approved. The approval card now warns about it. Decision needed: change the automation (e.g. only set Follow Up Date when it is empty), or keep it.

**Service worker (Oct 14):** The installed app has an offline shell (`public/sw.js`, registered in production only). It keeps a small offline page, the logo and the icons. Pages still load from the network every time; when the network can't be reached, the broker sees "You're offline" with Try again instead of the browser's error, and the page reloads when the connection returns. It never caches pages, `/api` answers or Monday data, and never handles `/api` or non-GET requests, so capture, lookups and saving stay online only. To change the shell, edit the files and bump `CACHE` in `sw.js`; old caches are deleted when the new worker starts.

**Signing in a phone (Oct 14):** On an iPhone, Monday's sign-in page shows "come back on desktop or download the app" instead of a login form, and the Monday phone app's sign-in can't be used by other apps. Monday staff have said this sign-in flow isn't supported on mobile. So a phone is signed in from a computer, the way TV apps link an account:

1. On the phone, the sign-in screen offers "Sign in with your computer" and shows an 8-character code (e.g. `VBYX-FW2V`) that works for 10 minutes.
2. On a computer, the broker opens `/link`, signs in with Monday if needed, and enters the code. The step is a form post that checks the request comes from the app, so another site can't start it.
3. The computer runs a fresh Monday sign-in made for the phone, using the same return address as normal sign-in, so the Monday app's settings don't change. The new sign-in must be the same Monday user as the computer's.
4. The phone checks every few seconds and signs itself in. The code works once. Five wrong codes from one computer stop further tries for 10 minutes.

The phone has its own Monday sign-in, separate from the computer's, and stays signed in the usual way (30 days, renewed while in use). While waiting for the phone, its Monday tokens sit in the store sealed with the session secret, for at most 10 minutes. Computers still sign in with Monday directly; on a phone, "Try Monday sign-in on this phone" remains as a small link. Logic is in `src/lib/link.ts`. Confirmed on John's iPhone on the live site; the computer's own sign-in carried on working.

**Next slices:** model comparison (see "Claude model for capture").

**Sign-in update (Oct 14):** Monday requires OAuth 2.1 for tokens since Oct 1, 2026: PKCE (S256) on the authorize step, a new token address (`auth.monday.com/oauth_ms/oauth/token`), and access tokens that expire (reported 24 hours) with single-use refresh tokens. The app now uses that flow and renews tokens before they expire, one renewal at a time per sign-in. The Monday app needs its "New OAuth Flow" setting on.

**Approval settings and shared store (Oct 14):** Hosting is Vercel, and the app's own state is Upstash Redis (Vercel Marketplace) instead of Postgres: it holds only approval settings and a short-lived sign-in renewal lock, never Monday records. The approval settings page is at `/admin/approvals` (linked from Saved today for the Operations Manager, set by `OPERATIONS_MANAGER_IDS`). Each action type is Always confirm or Save without asking, and the page records who changed it last. The settings are stored now but take effect in Phase 4; until then every change is confirmed. Sign-in renewal now locks across all server copies: the copy that renews leaves the new tokens (encrypted) in the store for two minutes, and the others use them, so a single-use refresh token is never spent twice.

**Lookups (Oct 14):** A message that reads as a question ("What do we have on Garrison Foods?", "Who is Owen Gray", "Linda Park?") is answered from Monday instead of being read as a note. The check is made in code, without Claude, so answers come in a second or two. Each answer offers "Read it as a note instead" in case the guess was wrong. The app reads Leads and Contacts fresh, finds records whose full name or business name is in the question (or, failing that, a first name, last name or distinctive business word, labelled "partly match"), and shows up to three records in full and lists up to ten more by name. A record shows its fields, the latest three notes (Broker Notes and updates), Contact Broker and Co-Brokers, linked properties, when it was last updated, and an Open in Monday link. Every value comes straight from Monday; when nothing matches, the app says so. Property and listing searches ("Any listings that fit this requirement?") and summaries across records are Phase 3.
