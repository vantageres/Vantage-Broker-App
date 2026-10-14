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

1. **Geocoding.** Desired Location is a map column, so saving "I-295, NJ" needs a latitude and longitude. That needs a geocoding service (for example Google Maps or Mapbox). This is a map lookup, not a data source, but it is an outside service and needs a decision.
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

## Open: weekday names

Claude turns a bare weekday ("call him Tuesday") into the next such date without asking. Proposed: keep that, and show the weekday with the date on the approval screen ("Tue, Oct 20") so a misread is easy to spot. Alternative: always ask. Waiting on John.
