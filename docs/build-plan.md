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

## Open questions for the build

1. **Where approval settings live.** The Operations Manager controls them, but staff don't use the app. Options: a small admin page in the app, or a settings board in Monday that the app reads. A Monday board is simplest for the Operations Manager.
2. **Claim race.** Monday has no conditional write. The app re-reads the owner just before saving, which narrows the race to well under a second but can't fully close it. Acceptable for v1?
3. **Short-lived search cache.** Phone and email matching on 1,610 items may need a cache of a minute or two to hit the 5-second target. It would hold search keys only, not records. Acceptable under "no separate copy"?
4. **Follow-up date on Leads.** The six-month follow-up automation was tested on Contacts only. Test on Leads in Phase 0.
5. **Voice quality.** Is the phone's built-in dictation good enough, or do we add server transcription in Phase 3?
6. **Test environment.** A duplicate workspace or test boards, so development never writes to live client records.
7. **Model and data handling.** Confirm Vantage is comfortable sending client notes and Monday data to the Claude API (no training on API data by default).
