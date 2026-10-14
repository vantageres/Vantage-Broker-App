import { normalizePhone, splitEmails, type PersonRecord, type RequirementField } from "../monday/records";
import { findMatches, type MatchCandidate, type MatchResult } from "../matching";
import type { ExtractedPerson, UNCERTAIN_FIELDS } from "./extract";

// Which record field each of Claude's uncertain fields would have filled.
const UNCERTAIN_TO_FIELD: Partial<Record<(typeof UNCERTAIN_FIELDS)[number], RequirementField>> = {
  business_name: "businessName",
  phones: "phone",
  emails: "email",
  contact_type: "contactType",
  property_types: "propertyType",
  size: "size",
  budget: "budget",
  desired_location: "desiredLocation",
  follow_up_date: "followUp",
  source: "source",
};

// A proposal is everything the approval screen shows for one person.
// Nothing in it has been saved.

export interface FieldChange {
  field: RequirementField | "name" | "contactBroker";
  label: string;
  current: string;
  proposed: string;
  // What the approval screen shows when it differs from the saved value,
  // e.g. "Tue, Oct 20, 2026" for 2026-10-20.
  currentDisplay?: string;
  proposedDisplay?: string;
  // Desired Location only: the map point found for the proposed place.
  location?: { lat: number; lng: number; address: string };
}

const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});

// Dates are shown with their weekday so a misread "Tuesday" is easy to spot.
export function formatDate(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? WEEKDAY_FORMAT.format(new Date(`${iso}T00:00:00Z`)) : iso;
}

export interface RecordRef {
  board: "leads" | "contacts";
  boardLabel: string;
  id: string;
  name: string;
  url: string;
  updatedAt: string;
  owner: string;
}

export type Target =
  | { kind: "existing"; record: RecordRef; matchedOn: string[] }
  | { kind: "new-lead" }
  | { kind: "pick"; candidates: (RecordRef & { matchedOn: string[] })[]; recommended?: string };

export type Blocked =
  | { reason: "not-owner"; owner: string }
  | { reason: "unassigned" };

export interface Proposal {
  // What Claude extracted, kept so the proposal can be rebuilt when the
  // broker picks a match.
  person: ExtractedPerson;
  subject: string;
  target: Target;
  blocked?: Blocked;
  changes: FieldChange[];
  noteText: string;
  placedInNotes: { text: string; why: string }[];
  // Asked one at a time, in this order. The approval screen shows the first.
  questions: { field: string; question: string }[];
  automations: string[];
  // The record's current Property Type, so answers and edits add to it
  // instead of silently replacing it.
  currentPropertyType?: string;
}

export interface Broker {
  id: string;
  name: string;
}

const LABELS: Record<string, string> = {
  name: "Name",
  businessName: "Business Name",
  contactType: "Contact Type",
  propertyType: "Property Type",
  budget: "Budget",
  size: "Sq Ft/Acres",
  desiredLocation: "Desired Location",
  notes: "Notes",
  followUp: "Follow Up Date",
  source: "Source",
  phone: "Phone",
  email: "Email",
  contactBroker: "Contact Broker",
  status: "Status",
  contactAddress: "Contact Address",
};

function ref(r: PersonRecord): RecordRef {
  return {
    board: r.board.key,
    boardLabel: r.board.label,
    id: r.id,
    name: r.name,
    url: r.url,
    updatedAt: r.updatedAt,
    owner: r.contactBrokerNames,
  };
}

function isOwner(r: PersonRecord, me: Broker): boolean {
  return r.contactBrokerIds.includes(me.id) || r.coBrokerIds.includes(me.id);
}

// Proposed values for one person, before comparing with any current record.
function proposedValues(p: ExtractedPerson, placedInNotes: Proposal["placedInNotes"]) {
  const values: Partial<Record<RequirementField, string>> = {};
  if (p.business_name) values.businessName = p.business_name;
  if (p.contact_type) values.contactType = p.contact_type;
  if (p.property_types.length) values.propertyType = p.property_types.join(", ");
  if (p.size) values.size = p.size;
  if (p.budget !== null && p.budget > 0) values.budget = String(p.budget);
  if (p.desired_location) values.desiredLocation = p.desired_location;
  if (p.source) values.source = p.source;
  if (p.phones[0]) values.phone = p.phones[0];
  if (p.emails[0]) values.email = p.emails[0];
  // Placed by proposalFor: Contact Address on Contacts, Notes on Leads.
  if (p.address) values.contactAddress = p.address;

  const notes: string[] = [];
  if (p.requirement_notes) {
    notes.push(p.requirement_notes);
    // Name the Budget rule only when a dollar figure was moved to Notes.
    const moneyMoved = /\$|\bper (sq|square)|\/\s*(sf|ft)\b/i.test(p.requirement_notes);
    placedInNotes.push({
      text: p.requirement_notes,
      why: moneyMoved
        ? "Budget holds a single dollar amount, so rent per foot and price ranges go in Notes."
        : "No field holds these details, so they go in Notes.",
    });
  }
  if (p.title) {
    notes.push(`Title: ${p.title}`);
    placedInNotes.push({ text: p.title, why: "No field holds a job title, so it goes in Notes." });
  }
  const extras = p.extra_locations.filter((l) => !p.requirement_notes?.includes(l));
  if (extras.length) {
    notes.push(`Also considering: ${extras.join(", ")}`);
    placedInNotes.push({
      text: extras.join(", "),
      why: "Desired Location holds one place on the map, so further areas go in Notes.",
    });
  }
  if (notes.length) values.notes = notes.join(". ");
  if (p.follow_up_date && /^\d{4}-\d{2}-\d{2}$/.test(p.follow_up_date)) values.followUp = p.follow_up_date;

  // Never fill a field Claude was unsure about. Its question is asked instead.
  for (const u of p.uncertain) {
    const field = UNCERTAIN_TO_FIELD[u.field];
    if (field) delete values[field];
  }
  return values;
}

function questionsFor(p: ExtractedPerson, today: string): Proposal["questions"] {
  const questions: Proposal["questions"] = [];
  const unsureOfDate = p.uncertain.find((u) => u.field === "follow_up_date");
  if (unsureOfDate) {
    questions.push({ field: "followUp", question: unsureOfDate.question });
  } else if (p.follow_up_phrase && !p.follow_up_date) {
    questions.push({
      field: "followUp",
      question: `You said to follow up "${p.follow_up_phrase}". What date should I set?`,
    });
  } else if (p.follow_up_date && p.follow_up_date < today) {
    questions.push({ field: "followUp", question: `The follow-up date ${p.follow_up_date} is in the past. What date should I set?` });
  }
  for (const u of p.uncertain) {
    if (u.field === "follow_up_date" || u.field === "name") continue;
    questions.push({ field: UNCERTAIN_TO_FIELD[u.field] ?? u.field, question: u.question });
  }
  return questions;
}

// Compare proposed values with the record's current ones. Unchanged values are
// left out; a second email or phone is only proposed when it is new.
function diff(values: Partial<Record<RequirementField, string>>, current?: PersonRecord): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const [field, proposed] of Object.entries(values) as [RequirementField, string][]) {
    const now = current?.current[field] ?? "";
    if (field === "phone" && current?.phones.includes(normalizePhone(proposed))) continue;
    if (field === "email" && splitEmails(proposed).every((e) => current?.emails.includes(e))) continue;
    if (field === "propertyType" && now) {
      const merged = [...new Set([...now.split(", "), ...proposed.split(", ")])].join(", ");
      if (merged === now) continue;
      changes.push({ field, label: LABELS[field], current: now, proposed: merged });
      continue;
    }
    if (field === "notes" && now) {
      // Notes are added to, never replaced, so earlier details are kept.
      if (now.toLowerCase().includes(proposed.trim().toLowerCase())) continue;
      changes.push({ field, label: LABELS[field], current: now, proposed: `${now.trim().replace(/[.;]$/, "")}. ${proposed}` });
      continue;
    }
    if (now.trim().toLowerCase() === proposed.trim().toLowerCase()) continue;
    const change: FieldChange = { field, label: LABELS[field], current: now, proposed };
    if (field === "followUp") {
      change.proposedDisplay = formatDate(proposed);
      if (now) change.currentDisplay = formatDate(now);
    }
    changes.push(change);
  }
  return changes;
}

function pickList(candidates: MatchCandidate[]) {
  return candidates.map((c) => ({ ...ref(c.record), matchedOn: c.reasons }));
}

// A proposal for one person against a known record, or a new Lead when
// `record` is null. Used after matching, and again when the broker picks a
// match or chooses "someone new".
export function proposalFor(
  person: ExtractedPerson,
  record: PersonRecord | null,
  me: Broker,
  noteText: string,
  today: string,
  matchedOn: string[] = [],
): Proposal {
  const placedInNotes: Proposal["placedInNotes"] = [];
  const values = proposedValues(person, placedInNotes);
  const questions = questionsFor(person, today);
  const subject = person.name ?? person.business_name ?? "Unnamed person";
  const base = { person, subject, noteText, placedInNotes, questions, automations: [] as string[] };

  // Only Contacts have an address column; on a Lead (new or existing) the
  // address goes in Notes.
  if (values.contactAddress && (!record || !record.board.columns.contactAddress)) {
    const address = values.contactAddress;
    delete values.contactAddress;
    const line = `Address: ${address}`;
    values.notes = values.notes ? `${values.notes}. ${line}` : line;
    placedInNotes.push({ text: address, why: "Leads have no address field, so the address goes in Notes." });
  }

  if (!record) {
    const changes: FieldChange[] = [
      { field: "name", label: LABELS.name, current: "", proposed: subject },
      ...diff(values),
      { field: "contactBroker", label: LABELS.contactBroker, current: "", proposed: me.name },
      { field: "status", label: LABELS.status, current: "", proposed: "New Lead" },
    ];
    return { ...base, target: { kind: "new-lead" }, changes };
  }

  const target: Target = { kind: "existing", record: ref(record), matchedOn };

  if (!isOwner(record, me)) {
    const blocked: Blocked =
      record.contactBrokerIds.length === 0 ? { reason: "unassigned" } : { reason: "not-owner", owner: record.contactBrokerNames };
    return { ...base, target, blocked, changes: [], placedInNotes: [], questions: [] };
  }

  const unset = new Set(["", "not set", "not labeled"]);
  const filled = (field: string) =>
    field in record.current && !unset.has(record.current[field as RequirementField].trim().toLowerCase());

  // Claude often can't tell lease from buy, or the source, from a short note.
  // If the record already says, keep it and don't ask. Doubts about anything
  // else (a place, a size, a number) mean the note wants a change, so ask.
  const settledByRecord = new Set(["contactType", "source"]);
  const openQuestions = questions.filter((q) => !(settledByRecord.has(q.field) && filled(q.field)));

  // "Also near Route 73": Desired Location holds one place, so an added area
  // goes in Notes and the current place stays.
  if (person.location_is_addition && values.desiredLocation && filled("desiredLocation")) {
    const place = values.desiredLocation;
    delete values.desiredLocation;
    const extra = `Also considering: ${place}`;
    values.notes = values.notes ? `${values.notes}. ${extra}` : extra;
    placedInNotes.push({
      text: place,
      why: `Desired Location already holds ${record.current.desiredLocation} and can hold only one place, so ${place} is added to Notes.`,
    });
  }

  const automations: string[] = [];
  if (record.board.key === "contacts") {
    automations.push("Saving a note on a Contact starts the Monday automation that moves Follow Up Date about six months out.");
  } else {
    // Seen on Leads Test, Oct 14: the note sets Last Contact, and an automation
    // then resets Follow Up Date (a week out) and Open Contact Date.
    automations.push("Saving a note on a Lead starts a Monday automation that resets Follow Up Date to a week out and changes Open Contact Date, replacing any date set here.");
  }
  return {
    ...base, target, changes: diff(values, record), questions: openQuestions, automations,
    currentPropertyType: record.current.propertyType || undefined,
  };
}

export function buildProposal(
  person: ExtractedPerson,
  records: PersonRecord[],
  me: Broker,
  noteText: string,
  today: string,
): Proposal {
  const match: MatchResult = findMatches(
    { name: person.name, businessName: person.business_name, phones: person.phones, emails: person.emails },
    records,
  );
  if (match.kind === "none") return proposalFor(person, null, me, noteText, today);
  if (match.kind === "one") return proposalFor(person, match.candidate.record, me, noteText, today, match.candidate.reasons);

  const subject = person.name ?? person.business_name ?? "Unnamed person";
  const candidates = match.kind === "several" ? match.candidates : [match.recommended, match.other];
  const recommended = match.kind === "both-boards" ? match.recommended.record.id : undefined;
  return {
    person,
    subject,
    noteText,
    placedInNotes: [],
    automations: [],
    target: { kind: "pick", candidates: pickList(candidates), recommended },
    changes: [],
    // Only the match question for now: the rest depend on which record is picked.
    questions: [
      {
        field: "match",
        question:
          match.kind === "both-boards"
            ? `${subject} is in both Leads and Contacts. I recommend updating the Contacts record. Which one?`
            : `I found ${candidates.length} possible matches for ${subject}. Which one is it, or is this someone new?`,
      },
      ...questionsFor(person, today),
    ],
  };
}
