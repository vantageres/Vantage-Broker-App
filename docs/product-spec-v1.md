# Broker Assistant App: Product Spec (v1)

Oct 12, 2026 · @John Smyth

## Purpose and goals

The Broker Assistant turns a broker's loose notes into clean Monday.com records, after the broker approves, and answers questions from Monday in real time.

A broker types, speaks, or photographs what happened. The app organizes it, shows the proposed changes, and saves only what the broker confirms. Brokers can also ask what Monday holds on a person, property, or requirement, and ask for summaries across many records.

**Goals**

- Keep Leads and Contacts current without extra data entry.
- Make Monday the single source for contacts, requirements, and notes.
- Give every broker fast answers from the field, on a phone.
- Support the Strategic Operations Plan: standard processes and AI-based tools without adding administrative burden for brokers.

**Users**

Brokers only in v1. They are independent contractors, each with their own Monday seat. Staff roles do not use the app.

## Scope and decisions made

Version 1 covers capture, lookup, and summaries for Leads and Contacts, plus lookup and edit on Property Leads, and read access to other properties. These decisions are settled.

| Area | Decision |
| --- | --- |
| Approval | Every write is confirmed by the broker before it is saved. Rules may loosen later, based on feedback and comfort. |
| Lookup sources | Monday.com and vantageres.com only. No outside sources such as CoStar or public records. |
| Visibility | All brokers see all records and requirements. |
| Editing | A broker edits only records where they are Broker or Co-Broker. Any broker can claim an unassigned record. |
| Input | Typed text, voice, and photos (business cards, signs, images to attach to records). |
| Platform | Installable web app (PWA) for iOS, Android, and desktop. No app store. |
| Lead lifecycle | A new person starts in Leads and moves to Contacts once qualified. |
| Requirements | Stored inline on the Lead or Contact item, not in subitems. |
| Properties | Look up both Vantage Properties New and the old Vantage Properties until the migration finishes, expected within a month. Both are read only. |
| Build | Built with Claude Code, with Claude Design for the front end. |

Property Leads, the seller-side listing pipeline, is fully in scope for lookup and edit.

**Out of v1:** outside data sources, app store release, offline use, and access for staff roles.

## Core workflows

The app does three jobs: capture, lookup, and summarize.

**1. Capture.** The broker enters loose notes. The app finds the matching record, proposes the changes, and waits for approval.

Example input (fictional): "Met Dave Reyes at Garrison Foods. Needs 15 to 20k sf warehouse near 295, rent around $9 a foot, lease ends Q3 2027. Call him in March."

The app replies with a proposal:

- Match: existing Lead Dave Reyes. The broker confirms it is the right person.
- Contact Type: Leasee. Property Type: Industrial. Sq Ft/Acres: 15,000 to 20,000 sf.
- Desired Location: near I-295. Business Name: Garrison Foods.
- Notes: the rent target and lease end date go here, because Budget holds a single dollar amount.
- Follow Up: the app asks for a date, because "March" is not a date.
- A note with the full text is added to the record's Emails & Activities timeline.

The broker approves, edits any item, or cancels. Nothing is saved until approval.

&#91;embedded content: capture flow · 6 steps, 1 decision\]

The broker can edit the proposal before approving, and an edit returns to the same review step.

**2. Lookup.** The broker asks a question and Monday answers live.

- "What do we have on Garrison Foods?" returns the record, requirements, latest notes, assigned brokers, and linked properties.
- "Any listings that fit this requirement?" searches properties and available suites by type, size, and status, plus vantageres.com.

Every answer links to the Monday record and shows when it was last updated. If Monday has nothing, the app says so and does not guess.

**3. Summarize.** The broker asks for a view across records.

- "Summarize open industrial requirements under 20k sf."
- "What changed with my clients this week?"
- "Who is looking near Mount Laurel?"

Summaries cite the records they draw from. They include every broker's requirements, since everyone can view everything.

## Approval rules

In v1 the app never changes Monday without an explicit tap from the broker. Lookups and summaries only read, so they need no approval.

**The approval screen shows**

- The record being changed, or "new Lead" if none matched.
- Each field with its current value and its proposed value.
- The note text that will be saved.
- Anything the app could not place, and where it put it instead. Any Monday automation the change will start, such as moving a Lead to Contacts.

**The broker can** approve all, edit any field, remove an item, or cancel. After a save, the app shows what was written and links to the Monday record.

**When the app is unsure** it asks one question at a time and never fills a field with a guess. Examples: two possible matches, a vague date, a phone number that dictation may have misheard, or an unreadable photo.

**Loosening later.** Approval is stored as a setting for each action type: create a record, change a field, add a note, attach a photo, claim a record, and move a Lead to Contacts. Every type starts at "always confirm," so relaxing one after the pilot needs no rebuild. The Operations Manager controls that setting.

## Matching, claiming, and duplicates

The app searches Leads and Contacts together before proposing anything, and the broker confirms every match.

**Matching**

- Searches by name, phone, email, and business name. Phone numbers are compared as digits only, and a field holding two email addresses is read as two.
- One clear match: propose an update to that record.
- Several matches: show them and let the broker pick.
- No match: propose a new Lead. New people always start in Leads.
- Person found in both Leads and Contacts: show both and recommend the Contacts record.

**Qualifying a Lead.** A Monday automation already moves a Lead to Contacts when its status is set to Qualified. The app proposes setting that status and never moves records itself. The automation requires email, phone, Property Type, Source, and Contact Type, so the app collects any that are missing first. The app will have to confirm all required fields are complete before moving to Contacts.

**Claiming.** A record with no Contact Broker shows as unassigned. Any broker can claim it, which sets that broker as Contact Broker. An unassigned record is read-only until claimed. If two brokers claim at once, the first save wins and the second broker sees who now owns it.

**Property links.** When a broker mentions a property, the app looks in both property boards and proposes a link to the right record. Today, Leads and Contacts link to the old Vantage Properties board.

## Permissions

Every broker can see everything, but can change only the records they are assigned to. Each broker signs in as themselves, so Monday's history shows who made each change.

| Action | Who can do it |
| --- | --- |
| View any Lead, Contact, property, requirement, or note | Every broker |
| Ask lookups and summaries across all records | Every broker |
| Edit a Lead or Contact | The Contact Broker or a Co-Broker on that record |
| Edit a Property Lead (all other properties are read only) | The Broker, Co-Broker, or Co-Broker2 on that Property Lead |
| Claim an unassigned record | Any broker |
| Create a new Lead | Any broker, who becomes its Contact Broker |

If a broker asks to change a record they do not own, the app says so, names the owning broker, and does not propose the change.

**Sensitive property fields** are the exception to view-all. Key for Broker, Outstanding Loans Amount, Current On Loan Payments, and Lender Name & Contact Info are shown only to the Broker, Co-Broker, and Co-Broker2 on that property. The app does not reveal them to other brokers in lookups or summaries. A broker who opens the board directly in Monday can still see them unless column permissions are set there.

**To align in Monday.** The Leads board is set so everyone can edit every item, which is looser than this rule. Property Leads has the same setting, and it is a private board, so every broker must be added to it to see it. The Contacts and Properties New boards already limit editing to assigned people. Aligning Leads means a broker cannot sidestep the rule by editing in Monday directly.

## Monday.com data

Monday stays the single source of truth. The app keeps no separate copy of records, so changes made in Monday show up in the app right away.

| Source | Items | Role in the app |
| --- | --- | --- |
| Vantage Leads | 1,206 | Where new people start. Read and write. |
| Vantage Contacts | 404 | Qualified contacts. Read and write. |
| Vantage Properties New | 18 | Property lookup. Read only. |
| Vantage Properties (old) | 401 | Property lookup until migration finishes. Read only. |
| vantageres.com | n/a | Public listings. Read only. |

**Property Leads.** This seller-side listing pipeline has 5 items. Brokers can look it up and edit the ones where they are Broker, Co-Broker, or Co-Broker2. Changing its status starts Monday automations. Generate Property Folder and LA creates the folder and listing agreement, and needs a linked Vantage Contact. In Marketing needs an LA Signed date. On Market moves the listing to the older properties board. The approval screen names what a status change will start.

All six requirement fields already exist on both Leads and Contacts: Contact Type, Desired Location, Property Type, Budget, Sq Ft/Acres, and Notes. Suite details (size, lease value, status, lease expiration) sit in subitems on Properties New, so availability searches read those.

**Fit rules.** When a value does not fit a field, the app puts it in Notes and says so on the approval screen. Known cases: Budget is a single dollar amount, so rent per square foot and ranges go in Notes. Desired Location is one place on a map, so extra areas go in Notes. Sq Ft/Acres is free text, so a size range is stored as written, such as "15,000 to 20,000 sf."

**Changes needed in Monday**

1. Match option lists between Leads and Contacts so a Lead moves over intact. Done: Residential, Phone, Crexi, and Not Set added to the Property Type and Source lists where they were missing. Contact Type uses "Not Set" on Leads and "Not Labeled" on Contacts. Done: the follow-up date column now has the same name on both boards.
2. Retire the Requirements subitem on Contacts, Only one subitem exists on that board, so this is quick.
3. Keep notes as history. The Notes column is a single text line and cannot hold one. The app saves each new note as an entry in the record's Emails & Activities timeline, using a new Broker Note activity type. The API cannot edit entries, so a correction deletes the entry and creates a new one, with approval. The Notes column stays as the one-line current summary and changes only when the requirement itself changes.
4. When Properties New replaces the old board, repoint Associated Properties on Leads and Contacts to it. Also update the Property Leads automation that moves On Market listings to the older properties board.
5. Add Business Name and Files to the automation that moves Leads to Contacts, or that data will not carry over when a Lead is qualified. This is edited in Monday's automation settings.
6. Add a Files column to Property Leads. It has a Property Report file column only.
7. Add every broker to the Property Leads board, which is private.

If size searches prove unreliable on free text, numeric size minimum and maximum columns can be added later.

## Input modes

Brokers can type, speak, or send a photo, and all three lead to the same approval screen.

**Typing.** Free text in one message box. One message can cover several people or properties, and the app splits it into separate proposals.

**Voice.** On a phone, the broker taps the microphone on the phone's own keyboard, speaks, and sees the text in the message box before sending it. The app has no microphone of its own and never handles audio (decided Oct 14, 2026). Phone numbers, emails and dollar amounts on the approval card carry a reminder to check them, because dictation often mishears them. Desktop needs no voice; Windows and Mac have their own dictation.

**Photos.** Taken with the camera or chosen from the photo library.

- Business card: reads name, title, company, phone, email, and address. Proposes a new Lead or an update to a match, and attaches the card image.
- Sign: reads the phone number and any property or listing details. Looks up the property, proposes a Lead with Source set to Sign, and attaches the photo.
- Image for a record: the broker picks the record and the app attaches the image once approved.

If text in a photo is unreadable, the app asks for a clearer photo. It never guesses digits in a phone number or email address.

## Platform and experience

The app is designed for a phone first and works fully on a desktop browser.

- **Install:** a web app brokers add to the home screen on iPhone and Android. No app store. Desktop runs in the browser.
- **Sign in:** with each broker's own Monday account. The sign-in persists on the phone.
- **Main screen:** a single conversation. A text box and a camera button sit at the bottom (voice is the keyboard's microphone), with the most recent proposals and answers above.
- **Approval:** the Approve button is large and reachable with one thumb. Edits happen in place on the proposal.
- **Live data:** every lookup reads Monday at the moment it is asked. The app is online only, with no offline capture in v1.
- **Calling and email:** phone numbers and email addresses in answers open the phone's dialer and mail app with one tap.
- **Activity:** a short list of what the broker saved today, each linking to its Monday record.
- **Failures:** if Monday cannot be reached, the proposal is kept on screen and the save can be retried. The app never reports a save that did not happen.
- **Speed:** proposed targets are a lookup answer in under 5 seconds and a capture proposal in under 10. These are to confirm during the pilot.
- **Design:** the front end is designed in Claude Design. Technical choices are left to the build.

## Rollout and success measures

The rollout is proposed in four phases. Each phase moves on only when its gate is met.

1. **Prepare Monday.** Make the changes listed above, and align Leads permissions. Gate: Leads and Contacts share matching fields and options.
2. **Pilot capture and lookup.** Typed notes and lookups on Leads and Contacts, with two or three brokers. Every save confirmed. Gate: pilot brokers use it for real work and proposals are mostly accepted as written.
3. **Add voice, photos, properties, and summaries.** Roll out to all brokers. Gate: brokers use all input modes without help.
4. **Loosen approvals.** Relax the action types brokers say are safe, one at a time, based on pilot feedback.

**Success measures.** Targets are set after the pilot gives a baseline.

- Share of proposals approved without edits.
- Share of Leads and Contacts with all six requirement fields filled.
- Time from a client meeting to an updated record.
- Brokers using the app each week.
- Broker satisfaction, from a short survey after the pilot.

## Test scenarios and open items

These scenarios define "working" for the pilot.

| Scenario | Expected result |
| --- | --- |
| New person, no match | Proposes a new Lead. Nothing saved until approval. |
| Phone number matches one Contact | Proposes an update to that record, showing current and new values. |
| Two people named Dave | Asks the broker to pick. |
| Person exists in Leads and Contacts | Shows both and recommends the Contacts record. |
| Broker edits a record owned by someone else | Declines, names the owner, proposes nothing. |
| Record with no Contact Broker | Offers to claim it. Read-only until claimed. |
| Two brokers claim the same record | First save wins. The second broker sees the new owner. |
| "Follow up in March" | Asks for a specific date. |
| "Rent around $9 a foot" | Placed in Notes, with a message explaining why. |
| Business card photo with blurry text | Asks for a clearer photo. No guessed digits. |
| Question with no data in Monday | Says nothing was found. Does not invent an answer. |
| Summary across requirements | Every statement links to its source record. |
| Monday unavailable during save | Proposal stays on screen. Save can be retried. |

**Open items**

1. Resolved: the Operations Manager controls the approval settings.
2. Resolved: brokers only in v1.
3. Resolved: online only. No offline capture in v1.
4. Resolved: an unassigned record is read only until a broker claims it.
5. Resolved: an automation moves a Lead to Contacts when its status is set to Qualified. The app sets the status and does not move records itself.
6. Resolved: only one Requirements subitem exists. Retire it.
7. Resolved: broker keys, loan amounts, loan payment status, and lender contact information are visible only to the assigned brokers on Properties New and Property Leads.
8. Resolved: the Operations Manager repoints the property links and the automations that point to the older board at cutover. The migration is expected within a month.
9. Resolved: no. Properties are read only. Property Leads is editable.
10. Resolved: vantageres.com adds public listing details and photos.
11. Resolved: no. The app declines and names the owning broker.
12. Resolved: Property Leads is in scope for lookup and edit.
13. Resolved: the Broker Note activity type is created and is the only type the app uses.
14. Resolved: a record's Emails & Activities timeline stays with it when moved from Leads to Contacts (tested October 12, 2026). The app does not need to copy note history.
15. Resolved: an Emails & Activities entry made through the API triggers the Contacts automation that pushes the follow-up date out about six months (tested October 13, 2026). The app only logs the note and does not set that date itself. The Leads board was not tested.
16. Resolved for the four statuses that start automations: brokers can set LA Signed from the app, with approval. Generate Property Folder and LA, In Marketing, and On Market are set in Monday only, and the app tells the broker so.
