import { buildProposal } from "../capture/proposal";
import { BOARDS, peopleMatching, resolve, todayInNewJersey, withAssign, type Context } from "../capture/service";
import { matchTerms } from "../matching";
import { teamFor } from "../monday/team";
import { fromContact, fromLead, NotAddable, personFor, resultFor, withTyped, type AddRef, type AddResult } from "./add-to-monday";
import { latestRun } from "./monitor-server";
import { directoryFor } from "./directory-store";

// Add to Monday on the server. The email's details come from the broker's
// latest run in the store, never from the page, and Monday is searched for
// the person before any card is shown. Nothing is written here: the card's
// Approve uses the app's existing save.
export async function proposeFromEmail(ctx: Context, ref: AddRef, asNew = false, typed: { email?: string; phone?: string } = {}): Promise<AddResult> {
  const run = await latestRun(ctx.me.id);
  let from;
  if ("conversationId" in ref) {
    const item = run?.items.find((i) => i.conversationId === ref.conversationId);
    if (!item) throw new NotAddable("That email is no longer in the latest check. Tap Check now and try again.");
    from = fromLead(item);
  } else {
    // A new contact from the latest check, or one from the broker's directory (first-time scan).
    const email = ref.email.toLowerCase();
    const fromRun = run?.newContacts.find((c) => c.email === email);
    const fromDirectory = fromRun ? null : (await directoryFor(ctx.me.id)).contacts.find((c) => c.email === email && c.status !== "removed");
    if (!fromRun && !fromDirectory) throw new NotAddable("That contact is no longer in your list. Tap Check now and try again.");
    from = fromContact(fromRun ?? { name: fromDirectory!.name, email, company: fromDirectory!.company, proposedBin: fromDirectory!.bin, confidence: fromDirectory!.confidence });
  }
  from = withTyped(from, typed);
  // A new Lead from email needs an email or a phone (spec 03, L7).
  if (!from.email && !from.phone) return { kind: "needs-contact", name: from.name ?? from.company ?? "this person" };
  const today = todayInNewJersey();
  const { person, noteText, leftOut } = personFor(from, today);

  // The broker checked the possible matches and said this is someone new.
  if (asNew) return { kind: "card", proposal: await resolve(ctx, person, noteText, "new"), leftOut };

  const query = { name: person.name, businessName: person.business_name, phones: person.phones, emails: person.emails };
  const records = await peopleMatching(ctx.monday, ctx.accountSlug, matchTerms([query]));
  const proposal = buildProposal(person, records, ctx.me, noteText, today);
  if (proposal.target.kind !== "new-lead") return resultFor(proposal, leftOut, ctx.me.name);
  const team = await teamFor(ctx.monday, BOARDS.leads).catch(() => null);
  return resultFor(withAssign(proposal, team, ctx.me), leftOut);
}
