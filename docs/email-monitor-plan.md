# Email monitor: plan

Agreed with John, Nov 16, 2026. Companion to John's spec package (`broker-assistant-email-module.zip`, version 2, Nov 12), which was written without seeing this code. Where the package and this plan differ, this plan wins.

The email monitor is a second tab on the home screen at brokers.vantageres.com. The Broker App (the conversation) is one tab; Email is the other.

## Branch and testing

- All email work is on `claude/email-monitor`, started from `claude/spec-review-planning-8omcwd`. Nothing goes to `claude/spec-review-planning-8omcwd` until John says it is ready, because Vercel deploys that branch to the live site.
- Broker App fixes keep landing on `claude/spec-review-planning-8omcwd`; merge them into the email branch.
- Testing is local, against the Monday test boards. Vercel previews of this branch cannot sign in with Monday. Real mailbox tests need John to sign in to Microsoft himself in a browser.
- Code lives apart: `src/app/email/`, `src/app/api/email/`, `src/lib/email/`, `src/components/email/`.

## What the package assumed, and what the app really is

| Package assumed | The app | Resolution |
| --- | --- | --- |
| Brokers sign in with Microsoft (Entra); add Graph scopes to it | Brokers sign in with Monday (OAuth 2.1). No Entra registration exists | Keep Monday sign-in. Add a one-time "Connect Outlook" step in the Email tab, with a new Entra registration |
| A database | Upstash Redis only (approval settings, sign-in lock) | Use Redis, with timers that delete data by themselves. Everything taken from email is encrypted at rest |
| Cloudflare Worker, Queues | Next.js on Vercel | Vercel cron, once John upgrades the Vercel plan |
| `config/monday.json` and `monday_env` | `src/lib/monday/boards.ts` (test boards locally, live on Vercel) | Use the app's board switch |
| A second Monday write path for the leads push | Capture already proposes new Leads, checks duplicates, assigns the Contact Broker, and saves only after approval | Email leads go through the existing capture flow and approval card |
| Web push | None | Not in v1 |

## Decisions (John, Nov 16)

1. **Mailbox.** Microsoft 365. Each broker's own inbox. No shared mailbox.
2. **Connection.** A new Entra app registration, "Broker Assistant", Web platform, client secret, delegated permissions. Each broker approves access to their own mailbox only. No application (tenant-wide) access.
3. **Permissions.** `Mail.Read`, `User.Read`, `openid`, `offline_access`. Nothing that sends, moves, flags or deletes mail. If the tenant blocks user consent, Leor grants admin consent once.
4. **When it runs.** First, when the broker opens the tab or taps Check now; each run catches up from the last one. Then scheduled runs (weekdays 7am, 11am, 3pm, 7pm ET; 7am is the full list), after John upgrades Vercel to a paid plan.
5. **State.** Upstash Redis, encrypted, with timers.
6. **Email data.**
   - Sent to Claude: sender, recipients' names and addresses, subject, dates, and the trimmed new text of each message (Graph `uniqueBody`, capped). No attachments.
   - Stored: never bodies or attachments. Graph ids, the other party's address, and Claude's short title, summary, action and history line.
   - Deleted by timer: run summaries after 14 days; open items 5 business days after they close; seen-message ids after 14 days. The directory (decision 7) stays while the broker has the module on, and is deleted when they turn it off.
   - Logs: status codes, counts, timing and run ids only. Never subjects, addresses, names, summaries or tokens.
   - Claude: no training, no retention, as for the rest of the app (`build-plan.md`, "Claude API data settings"). **John confirms Zero Data Retention is in place before the monitor reads real mail.**
   - Model calls get no tools. Email text is data, never instructions. Model output is shown as plain text.
7. **Directory: a first-time scan.** When a broker connects, the app reviews their recent mail and builds a list of contacts and properties that are not in Monday, for the broker to review. See "First-time scan" below.
8. **Leads from email.** Brokers can push a new Lead from an email into Monday, as a manual step: "Add to Monday" on an email or a scanned contact opens the existing approval card. New Leads only; if the person is already in Monday, show who owns them and stop.
9. **Monday boards.** The app's own switch in `boards.ts`.

## Closing items when someone else replies

The app reads only the signed-in broker's mailbox. What it can see decides what it can close.

| Case | Seen by the app? | Plan |
| --- | --- | --- |
| A colleague replies to the client and copies the broker (or replies all) | Yes, it lands in the broker's inbox in the same conversation | Close: `closed_by` "[name] by email". Applies whether or not the broker forwarded it first. The item reopens if the client writes again |
| The broker forwarded it to a colleague, who replies to the broker | Yes | Spec rule 4: close, "[name] by email" |
| A colleague replies without copying the broker | No, it is only in the colleague's mailbox | The broker taps "[Name] finished it". Later, if both brokers are connected, match the reply across their mailboxes by message headers (`In-Reply-To`, `References`), comparing ids only and reading nothing else from the colleague's mail. Needs John's go-ahead before it is built |

"Colleague" means an address at `vantageres.com` or `vantagepm.com`. A reply that only says "thanks" still closes the item; the broker can Reopen it.

## First-time scan (decision 7)

1. 90 days of received and Sent mail, at most 1,000 messages per folder, run in the background with progress shown.
2. Count per address: received, sent to, last date. Sent-to counts weigh more. Noise is filtered in code and counted.
3. Look each frequent address up in Monday (Leads and Contacts, by exact email). People found there are not listed; Monday already knows them.
4. For the rest, Claude proposes a type (Client, Prospect, Outside Broker, Attorney, Lender, Title and Escrow, Appraiser or Inspector, Vendor, Personal, Lead Source, Noise) and a related property, from sender details and subjects plus short snippets.
5. Properties: Claude lists property addresses and names mentioned in the mail. Each is checked against the property boards and Property Leads with the app's existing property search. Those not found are listed.
6. The broker reviews in batches: keep, change the type, or remove. Kept contacts and properties form the broker's directory, used by every later run.
7. From the review, a contact can go to "Add to Monday" (decision 8).

**Open question for John:** what happens to a property that is not in Monday? Recommended: listed for the broker, used to group mail by deal, with "New Property Lead" (the existing flow) as an option. Nothing is created without approval.

## Prerequisites outside the code (John or Leor)

1. Create the Entra app registration (portal.azure.com, App registrations):
   - Name: Broker Assistant. Accounts in this organizational directory only.
   - Platform: Web. Redirect URIs: `https://brokers.vantageres.com/api/email/callback` and, for local testing, `http://localhost:3000/api/email/callback`.
   - API permissions, Microsoft Graph, delegated: `Mail.Read`, `User.Read`, `openid`, `offline_access`. Admin consent if the tenant requires it.
   - A client secret. Put it in Vercel and `.env.local` yourself; never paste it in chat. Note its expiry date.
2. Vercel settings: `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT_ID`, `EMAIL_MONITOR_USERS` (Monday user ids allowed to see the tab; John first).
3. Upgrade Vercel to a paid plan before scheduled runs (step 7).
4. Confirm Zero Data Retention with Anthropic before reading real mail.

## Build order

Each step is tried locally and reviewed by John before the next.

1. **This plan.**
2. **Email tab and Connect Outlook.** A tab switch on the home screen, shown only to `EMAIL_MONITOR_USERS`. Connect Outlook runs the Microsoft sign-in on the server. Microsoft's tokens are too large for the sign-in cookie, so the refresh token is sealed with the session secret and kept in Redis under the broker's Monday user id; it is replaced on every renewal and deleted on Disconnect. The tab then shows "Connected as [address]. [N] emails in the last 24 hours." Nothing else is read or stored.
   - **Built Nov 16** (`src/lib/email/`, `src/app/api/email/`, `src/components/email/`): the tab switch, Connect, Check again and Disconnect; "Reconnect Outlook" when Microsoft refuses the stored token; the admin-approval message. Unit tests in `src/lib/email/email-connect.test.ts`. Not yet tried against a real mailbox: needs the Entra registration and John's own Microsoft sign-in.
3. **Check now.** Reads mail since the last check (first time: the last business day), filters noise in code, looks senders up in Monday and the directory, asks Claude to classify and summarize, and shows the result grouped by deal: Leads, Deals, Other, Internal Brokers, Internal Staff. Each item links to the email in Outlook.
4. **Open Items.** The lifecycle from spec 07 in code with tests (fixed "today"), including the colleague-reply rule above. The Open Items screen with Done, Keep, Snooze, Make High, Reopen and "[Name] finished it".
5. **Add to Monday.** From an email, pre-fill a note and open the existing capture approval card. Test boards first.
6. **First-time scan** and the directory.
7. **Scheduled runs.** Vercel cron every 15 minutes, slot worked out in America/New_York; 7am full list, later runs show changes; history lines (up to 15 per run).
8. **Later:** Add task, matching colleague replies across connected mailboxes, importing from the Claude version, Settings for rules (Always High, Always Noise), other brokers.

## Kept from the package

The noise rules (`config/noise-senders.json`), the classification groups and importance levels, the open-item lifecycle and its tests (OI1 to OI18), the history cap, writing style (plain, short, no em dashes), and the rule that Monday writes block `$` amounts and the words "commission" and "fee". Prompts are kept as files so John can tune them.
