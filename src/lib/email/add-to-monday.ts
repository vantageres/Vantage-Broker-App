import type { ExtractedPerson } from "../capture/extract";
import { CONTACT_TYPES, SOURCES } from "../monday/boards";
import type { Proposal, RecordRef } from "../capture/proposal";
import { addBusinessDays } from "./open-items";
import type { NewContact, RunItem } from "./run";
import { isInternal } from "./threads";

// Add to Monday (plan decision 8, spec 03): a new Lead from an email, through
// the app's own approval card and save. New Leads only: someone already in
// Monday is shown with their owner, and nothing is written. The card is
// built from what Claude already read in the email (the lead, or a new
// contact), so no second Claude call is needed.

// Only these may become a Lead from a contact (spec 03 hard rule 3).
export const ADDABLE_BINS = ["Client", "Prospect", "Outside Broker"] as const;

export type AddRef = { conversationId: string } | { email: string };

export type AddResult =
  | { kind: "card"; proposal: Proposal; leftOut: number }
  | { kind: "in-monday"; records: (Pick<RecordRef, "name" | "boardLabel" | "owner" | "url"> & { matchedOn: string[]; yours: boolean })[] }
  | { kind: "needs-contact"; name: string } // no email or phone yet (L7): the broker types one first
  | { kind: "maybe"; records: (Pick<RecordRef, "name" | "boardLabel" | "owner" | "url"> & { matchedOn: string[] })[] };

export class NotAddable extends Error {}

// Notes and the Monday update never carry money or commission (spec 03 rule 6):
// such a line is left out before the card, and the card says so.
const MONEY = /\$\s?\d|\b\d[\d,.]*\s?(k|m|million|thousand)?\s?dollars\b|commission|\bfees?\b/i;
export const mentionsMoney = (text: string) => MONEY.test(text);

const asContactType = (t: string | null | undefined) => (CONTACT_TYPES as readonly string[]).includes(t ?? "") ? t as ExtractedPerson["contact_type"] : null;
const asSource = (s: string | null | undefined) => (SOURCES as readonly string[]).includes(s ?? "") ? s as ExtractedPerson["source"] : null;

export interface FromEmail {
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  askedAbout: string | null;
  contactType: string | null; // "Ask" or anything not on the board: the broker chooses
  source: string | null; // "Not Set" or anything not on the board: the broker chooses
  title: string; // what the email was about, for the note
  what: string | null;
}

export function fromLead(item: RunItem): FromEmail {
  if (!item.lead) throw new NotAddable("This email has no lead to add.");
  const l = item.lead;
  return {
    name: l.name, email: l.email, phone: l.phone, company: l.company, askedAbout: l.asked_about,
    contactType: l.proposed_contact_type, source: l.proposed_source, title: item.title, what: item.what,
  };
}

export function fromContact(c: NewContact): FromEmail {
  if (!(ADDABLE_BINS as readonly string[]).includes(c.proposedBin)) throw new NotAddable(`${c.proposedBin} contacts are not added to Leads.`);
  return {
    name: c.name, email: c.email, phone: null, company: c.company, askedAbout: null,
    contactType: c.proposedBin === "Outside Broker" ? "Broker" : null, source: null, title: "New contact from email", what: null,
  };
}

// What the capture flow would have read from a note, built in code.
export function personFor(e: FromEmail, today: string): { person: ExtractedPerson; noteText: string; leftOut: number } {
  if (e.email && isInternal(e.email)) throw new NotAddable("People at Vantage are not added to Leads.");
  let leftOut = 0;
  const keep = (line: string | null) => {
    if (!line?.trim()) return null;
    if (mentionsMoney(line)) {
      leftOut++;
      return null;
    }
    return line.trim();
  };
  const contactType = asContactType(e.contactType);
  const source = asSource(e.source);
  const who = e.name ?? e.company ?? "this person";
  const uncertain: ExtractedPerson["uncertain"] = [];
  if (!contactType) uncertain.push({ field: "contact_type", question: `Is ${who} a property owner, a tenant (Leasee), a buyer or a broker?` });
  if (!source) uncertain.push({ field: "source", question: `How did ${who} find you (the Source)?` });
  const person: ExtractedPerson = {
    name: e.name,
    business_name: e.company,
    title: null,
    address: null,
    phones: e.phone ? [e.phone] : [],
    emails: e.email ? [e.email.toLowerCase()] : [],
    contact_type: contactType,
    property_types: [],
    size: null,
    budget: null,
    desired_location: null,
    extra_locations: [],
    location_is_addition: false,
    follow_up_phrase: null,
    qualify: false,
    assign_contact_broker: null,
    assign_co_brokers: [],
    follow_up_date: addBusinessDays(today, 2),
    source,
    requirement_notes: keep(e.askedAbout ? `Asked about: ${e.askedAbout}` : null),
    properties_mentioned: [],
    uncertain,
  };
  const noteText = [keep(`From email: ${e.title}.`), keep(e.what), "Added from email by Broker Assistant."].filter(Boolean).join("\n");
  return { person, noteText, leftOut };
}

// The broker's own typed email or phone, when the email had neither.
export function withTyped(from: FromEmail, typed: { email?: string; phone?: string }): FromEmail {
  const email = typed.email?.trim();
  const phone = typed.phone?.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new NotAddable("That email doesn't look right.");
  if (phone && phone.replace(/\D/g, "").length < 10) throw new NotAddable("Enter the full phone number, with area code.");
  return { ...from, email: email || from.email, phone: phone || from.phone };
}

// Decide from a proposal what the broker sees: a new-Lead card, the record
// that already exists (and stop), or possible matches to check first.
export function resultFor(proposal: Proposal, leftOut: number, myName = ""): AddResult {
  const t = proposal.target;
  const brief = (r: RecordRef) => ({ name: r.name, boardLabel: r.boardLabel, owner: r.owner, url: r.url });
  // The same email, phone or full name is the same person (spec 03, duplicate
  // check). A weaker hit ("Russ" for Russell) is asked about instead.
  const STRONG = ["email", "phone", "full name"];
  if (t.kind === "existing" && t.matchedOn.some((m) => STRONG.includes(m))) {
    const yours = !!myName && t.record.owner.split(/,\s*/).includes(myName);
    return { kind: "in-monday", records: [{ ...brief(t.record), matchedOn: t.matchedOn, yours }] };
  }
  if (t.kind === "existing") return { kind: "maybe", records: [{ ...brief(t.record), matchedOn: t.matchedOn }] };
  if (t.kind === "pick") return { kind: "maybe", records: t.candidates.map((c) => ({ ...brief(c), matchedOn: c.matchedOn })) };
  return { kind: "card", proposal, leftOut };
}
