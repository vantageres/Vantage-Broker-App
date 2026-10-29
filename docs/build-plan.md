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
| Voice | The phone keyboard's dictation; no in-app microphone (decided Oct 14) | Works in the installed app on iPhone and Android, needs nothing built, and the app never handles audio. |
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

- Voice: the keyboard's dictation (decided Oct 14). The approval card marks new phone numbers ("Check every digit"), emails ("Check the spelling") and dollar amounts ("Check the amount"); capture reads spoken numbers, emails and sizes, and asks when a dictated number or spelling is unclear; phones show a tip to use the keyboard microphone.
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
3. **Session memory.** Search keys (names, phones, emails) and chat context are kept on the server for one chat session only, and are cleared after 10 minutes with no activity. Since Oct 29 the server keeps no Monday records between requests at all: each capture or lookup asks Monday for the records it needs.
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

**Property search and summaries (Oct 14, pulled forward from Phase 3 at John's request):** A question now gets one of three answers, all read only:

1. **A record** when it names a Lead or Contact (as before), whatever else it says.
2. **A summary** when it asks across people's requirements ("Who is looking near Mount Laurel?", "Summarize open industrial requirements under 20k sf"). Claude (Opus 5.5, low effort, server-side fallback) reads one line per Lead and Contact with requirement details: names, business, requirement fields, status, follow-up date, Contact Broker, last updated. No phones or emails are sent. Every point must cite its records; points citing no real record are dropped in code. The card links each point to its records.
3. **A property search** when it asks about properties, space, sizes or listings ("retail around 2,000 sf", "available industrial 15 to 20k sf in Mount Laurel", "land for sale"). Done in code, without Claude: both property boards are read fresh, and the question is read for type, size (a single size means a quarter either side), town, sale or lease, and "available". The answer says what it understood ("Retail · about 2,000 sf (1,500 to 2,500)"). Properties New is searched by suite; the old board by property. A property with no size or type in Monday is left out of a search on that, never guessed. The sensitive columns are never requested.

When nothing is named and nothing is found, the reply now says what can be asked. Column ids for the property boards come from `scripts/seed_test_boards.py` (`src/lib/monday/properties.ts`). Still to come: listings that fit a person's requirement, vantageres.com, Property Leads in searches, "what changed this week" (needs the activity log), and narrowing records in code before a summary once the live boards (about 1,600 records) are used. Confirmed on the live site Oct 14: property searches answer in about 2 seconds, summaries in about 5, with the right records cited.

**Listings that fit a person (Oct 14):** "Any listings for Ray Fulton?", "What fits Marcus Bell?" A question that names one Lead or Contact and asks about listings, properties, space or what fits runs the property search on that record's requirement: Property Type, Sq Ft/Acres (a single size means a quarter either side), Contact Type (Leasee means lease, Buyer means sale) and Desired Location, available listings only. When nothing is in the town they want, or no listing is in that town at all, it searches everywhere and says so. A record with no type and no size gets "can't match listings without guessing" and the fields to add. Budget and Notes aren't searchable and are named as not checked. Asking which properties are *linked* to someone still shows their record. Tried on the test boards: Ray Fulton gets Garrison Suite A; Marcus Bell (Bellmawr) gets two Mount Laurel options with "None are in Bellmawr"; Rachel Lin gets 300 Corporate Center Dr; Grace Kim gets nothing anywhere; Dave Reyes gets the missing fields.

**Property Leads lookup and edit (Oct 14):** Naming a Property Lead ("22 Elm St", "What's the status of 510 Main St?") shows its card: Status, Listing Type, Property Type, Listing Price, Size Available, Date Listed, Listing Expiration, LA Signed date, the linked Vantage Contact and folder, and Open in Monday. Key for Broker, Outstanding Loans, Current On Loan Payments and Lender are sent only to the Broker, Co-Broker and Co-Broker2. Those brokers tap a value to change it; the changes are listed (current → new, each with Undo) and nothing is saved until Approve. Just before writing, the server re-reads the lead and refuses if the broker isn't assigned, if a value changed in Monday since it was shown, or if a value doesn't fit its column. Statuses the app sets: New Lead, Listing Presentation, LA In Progress, LA Signed, Marketing Review, Unqualified Lead/Archive. Set in Monday only, with the reason shown: Generate Property Folder and LA, In Marketing, On Market, and the automation-set Error - See Update and Ready for New Documents; a lead already in one of those can't have its Status changed from the app. Choosing LA Signed also proposes today's LA Signed date. Dates can't be cleared from the app.

**Finding (Oct 14): LA Signed starts the marketing automations.** Setting 22 Elm St (Property Leads Test) to LA Signed from the app, with today's LA Signed date: about 4 seconds later Monday began adding 11 marketing-checklist subitems (Submit Sign Request, Submit Brochure Request, Property Uploaded to Vantage Website, Property Uploaded to CoStar, Brochure Reviewed and in Marketing Folder, Sign Installed, Site Photography Requested, Site Photography Complete, Broker Commission Split Agreement Created and Signed, Social Media Post Schedule), then moved the lead from Leads to Pre-Listing, set Status to In Marketing and set In Marketing Date, all within 30 seconds. So LA Signed leads straight to In Marketing, which the spec treats as Monday-only. **Decided (John, Oct 14):** LA Signed stays settable from the app, with one plain line on the approval card: "This moves the listing into marketing." Other statuses haven't been tried; their line says "Monday may update this listing after the change."

**Voice and tap-to-call (Oct 14):** Built as above. Also: phone numbers in lookups open the dialer (`tel:`), each email address opens mail (`mailto:`), and the approval card shows a budget as "$650,000". Tried in the local app at phone size with a saved extraction (no Claude call); the dictation rules in the capture prompt still need a real Claude run, on Vercel or with the key.

**Photos, decided with John (Oct 14):** a camera button in the composer on phone and desktop (the phone offers Take Photo or Photo Library). A second photo, such as a card's back, is optional ("Add the back (optional)"). Photos are shrunk on the device to a JPEG of about 1,600 pixels before sending, go to Claude inline, and reach Monday only on approval; the server keeps no copy. The Broker Note for a photo is one short line ("Added from a business card.") plus anything typed. Signs will use the phone's location, with permission, to find the property. Built in three steps, each tested before the next:

1. **Business cards (built Oct 14).** Claude reads name, title, business, phones, emails and address, and the card works like a typed note: matching, a new Lead or an update, check marks on phone and email. Title goes to Notes; address goes to Contact Address on Contacts (a map column, found on the map like Desired Location) and to Notes on Leads, with the reason shown. If a digit or letter can't be read, that value is left out and the broker is asked; if the photo can't be used at all, the app asks for a clearer one. On approval the photos go to the record's Files column after the fields and before the note; if one fails, the retry sends only what's missing. Tried end to end in the local app on Dave Reyes (Leads Test) with a saved reading in place of Claude: Notes, the photo in Files and the short note all landed, then Dave was restored. The reading itself needs a real Claude run (live site).
2. **Signs (built Oct 14).** Claude reads the contact on the sign (a person, or the company or brokerage) and its phone number, plus what the sign offers and any street address, kept apart from the person's requirement fields. A new Lead gets Source = Sign and "Sign: <what it offers>" in Notes; when the sign's number matches someone already in Monday, that record is updated and its Source is left alone. When a photo is sent from a phone, the app asks for the phone's location (the phone asks permission the first time; off or slow means none, after about 5 seconds) and looks for the nearest property within 200 m across Properties New, the old Properties board and Property Leads. If two properties are about equally close (within 40 m of each other, e.g. both mapped to a town's centre), location decides nothing; the street address on the sign is tried instead, and must match exactly one property. A property on the old board can be linked to Associated Properties (added to existing links, never replacing them; the server checks the board before writing). One on Properties New or Property Leads is shown with its Monday link and "Not linked: Associated Properties links to the old Properties board only." Tried end to end in the local app on Dave Reyes with a saved reading and a stand-in location 56 m from Route 73 Parcel: Notes, the link, the photo and the note landed, Source stayed Referral; Dave restored afterwards. Note: the test properties are mapped to town centres, so several share a point; live properties need real addresses for location matching to work well.
3. **Attach a photo to a record (built Oct 14).** After picking photos, "Attach to a record instead" turns the message box into "Which record?". The app finds matching Leads, Contacts and Property Leads by name or street address; the broker picks one if several match, and approves "Attach the photo to Files". Only the record's assigned brokers can attach (someone else's record names the owner; an unassigned person needs claiming first), checked again on the server just before uploading. If one of several photos fails, the retry sends only the rest. No Broker Note is added, so a Lead's follow-up automation isn't started by a picture. Tried in the local app: a photo attached to 22 Elm St (Property Leads Test) and cleared afterwards; Emily's 510 Main St refused with her name.

**Photos confirmed (Oct 14):** John tried a business card, a sign, and attaching a photo to a contact and a property on his iPhone against the live site; all worked.

**Model (John, Oct 14):** stay on Opus 5.5 for capture and summaries for now; the comparison can wait.

## Pilot readiness (survey of the live boards, Oct 14, read only)

| Board | Live id | Workspace | Items | Columns vs test |
| --- | --- | --- | --- | --- |
| Vantage Leads | 8842865081 | Main | 1,216 | all 24 ids match |
| Vantage Contacts | 8842962019 | Main | 406 | 23 of 24 match (see below) |
| Vantage Properties (old) | 5076736644 | Main | 402 | all 45 match |
| Vantage Properties New | 18420767182 | Brokerage | 18 | all 108 match |
| Property Leads | 18420767300 | Brokerage | 5 | all 110 match |

Moving the app to the live boards is mostly a change of board ids. Found:

1. **Speed (fixed Oct 29).** Loading all 1,622 live Leads and Contacts takes about 10 seconds, so capture and lookups no longer do it. Monday is asked for candidates instead: records whose name or business name contains a word from the note's names (or the question), or whose phone or email contains a number or address from the note. The app's own matching rules then run on those few records, so the results are the same as reading every record (checked on the test boards and, read only, on the live boards). Measured on the live boards: capture's Monday step 0.6 to 1.0 seconds (was 9 to 12), capture about 3.5 to 7 seconds in all with Claude, lookups 0.8 to 1.9 seconds (was 9 to 11). Summaries still read every record: 1,560 of the 1,622 have some requirement detail, too many to send to Claude, so they need narrowing in code first.
2. **A second Property Leads board.** Property Leads in the Brokerage workspace (18420767300, 5 items, the spec's count) and another in the Main workspace (8637648844, 3 items). The plan assumes the Brokerage one.
3. **Private boards.** Properties New (Brokerage) has only John subscribed, and Property Leads (Brokerage) only John and Emily. Brokers read through their own sign-in, so pilot brokers must be added to both or property searches and Property Leads show them nothing.
4. **Edit permissions.** Leads and Property Leads allow everyone to edit (spec: align to assigned people). Contacts and Properties New already limit editing to assignees.
5. **Requirements subitem.** One live Contact still has subitems; the subitem is still to retire.
6. **Stray columns.** Live Contacts has an empty, unconnected column "link to Vantage Properties New Test" (board_relation_mm8378e5) that can be deleted. Properties New Test's "Back Office - Vouchers" link column points at the live Vouchers board (5024344343).
7. **Broker Note** is an account-wide activity type (same id), so it works on the live boards.

**Next slices:** pilot readiness (see above) (see "Claude model for capture").

**Sign-in update (Oct 14):** Monday requires OAuth 2.1 for tokens since Oct 1, 2026: PKCE (S256) on the authorize step, a new token address (`auth.monday.com/oauth_ms/oauth/token`), and access tokens that expire (reported 24 hours) with single-use refresh tokens. The app now uses that flow and renews tokens before they expire, one renewal at a time per sign-in. The Monday app needs its "New OAuth Flow" setting on.

**Approval settings and shared store (Oct 14):** Hosting is Vercel, and the app's own state is Upstash Redis (Vercel Marketplace) instead of Postgres: it holds only approval settings and a short-lived sign-in renewal lock, never Monday records. The approval settings page is at `/admin/approvals` (linked from Saved today for the Operations Manager, set by `OPERATIONS_MANAGER_IDS`). Each action type is Always confirm or Save without asking, and the page records who changed it last. The settings are stored now but take effect in Phase 4; until then every change is confirmed. Sign-in renewal now locks across all server copies: the copy that renews leaves the new tokens (encrypted) in the store for two minutes, and the others use them, so a single-use refresh token is never spent twice.

**Lookups (Oct 14):** A message that reads as a question ("What do we have on Garrison Foods?", "Who is Owen Gray", "Linda Park?") is answered from Monday instead of being read as a note. The check is made in code, without Claude, so answers come in a second or two. Each answer offers "Read it as a note instead" in case the guess was wrong. The app reads Leads and Contacts fresh, finds records whose full name or business name is in the question (or, failing that, a first name, last name or distinctive business word, labelled "partly match"), and shows up to three records in full and lists up to ten more by name. A record shows its fields, the latest three notes (Broker Notes and updates), Contact Broker and Co-Brokers, linked properties, when it was last updated, and an Open in Monday link. Every value comes straight from Monday; when nothing matches, the app says so. Property and listing searches ("Any listings that fit this requirement?") and summaries across records are Phase 3.
