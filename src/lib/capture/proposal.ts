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
  subject: string;
  target: Target;
  blocked?: Blocked;
  changes: FieldChange[];
  noteText: string;
  placedInNotes: { text: string; why: string }[];
  // Asked one at a time, in this order. The approval screen shows the first.
  questions: { field: string; question: string }[];
  automations: string[];
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
    if (now.trim().toLowerCase() === proposed.trim().toLowerCase()) continue;
    changes.push({ field, label: LABELS[field], current: now, proposed });
  }
  return changes;
}

function pickList(candidates: MatchCandidate[]) {
  return candidates.map((c) => ({ ...ref(c.record), matchedOn: c.reasons }));
}

export function buildProposal(
  person: ExtractedPerson,
  records: PersonRecord[],
  me: Broker,
  noteText: string,
  today: string,
): Proposal {
  const placedInNotes: Proposal["placedInNotes"] = [];
  const values = proposedValues(person, placedInNotes);
  const questions = questionsFor(person, today);
  const subject = person.name ?? person.business_name ?? "Unnamed person";

  const match: MatchResult = findMatches(
    { name: person.name, businessName: person.business_name, phones: person.phones, emails: person.emails },
    records,
  );

  const base = { subject, noteText, placedInNotes, questions, automations: [] as string[] };

  if (match.kind === "none") {
    const changes: FieldChange[] = [
      { field: "name", label: LABELS.name, current: "", proposed: subject },
      ...diff(values),
      { field: "contactBroker", label: LABELS.contactBroker, current: "", proposed: me.name },
      { field: "status", label: LABELS.status, current: "", proposed: "New Lead" },
    ];
    return { ...base, target: { kind: "new-lead" }, changes };
  }

  if (match.kind === "several" || match.kind === "both-boards") {
    const candidates = match.kind === "several" ? match.candidates : [match.recommended, match.other];
    const recommended = match.kind === "both-boards" ? match.recommended.record.id : undefined;
    return {
      ...base,
      target: { kind: "pick", candidates: pickList(candidates), recommended },
      changes: [],
      questions: [
        {
          field: "match",
          question:
            match.kind === "both-boards"
              ? `${subject} is in both Leads and Contacts. I recommend updating the Contacts record. Which one?`
              : `I found ${candidates.length} possible matches for ${subject}. Which one is it, or is this someone new?`,
        },
        ...questions,
      ],
    };
  }

  const record = match.candidate.record;
  const target: Target = { kind: "existing", record: ref(record), matchedOn: match.candidate.reasons };

  if (!isOwner(record, me)) {
    const blocked: Blocked =
      record.contactBrokerIds.length === 0 ? { reason: "unassigned" } : { reason: "not-owner", owner: record.contactBrokerNames };
    return { ...base, target, blocked, changes: [], placedInNotes: [], questions: [] };
  }

  const automations: string[] = [];
  if (record.board.key === "contacts") {
    automations.push("Saving a note on a Contact starts the Monday automation that moves Follow Up Date about six months out.");
  }
  return { ...base, target, changes: diff(values, record), automations };
}
