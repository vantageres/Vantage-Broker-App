import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { BoardHidden, type MondayClient } from "../monday/client";
import { LIVE_BOARDS, TEST_BOARDS, USE_LIVE_BOARDS, type PersonBoard } from "../monday/boards";
import { loadPersonRecord, loadPersonRecords, recordsContaining, searchPersonRecords, type PersonRecord, type SearchTerms } from "../monday/records";
import { matchTerms } from "../matching";
import { findBroker, teamFor, type Team } from "../monday/team";
import { googleGeocoder, resolveLocations, type Geocoder } from "../geocode";
import { SavedExtraction, extractPeople, type ExtractedPerson, type Photo, type PhotoReport } from "./extract";
import { buildProposal, proposalFor, type Broker, type Proposal, type ProposalExtra } from "./proposal";
import { findSignProperty } from "../property/near";
import type { MapPoint } from "../monday/properties";
import { findMentioned, questionTerms } from "../lookup/search";
import { lookupAnswer, type LookupAnswer } from "../lookup/details";
import { askKind, asksForListings } from "../lookup/question";
import { summarize, type SummaryAnswer, type SummaryPoint } from "../lookup/summary";
import { describeScope, mentionsType, nearPlace, placeAsked, typesAsked, type TypeAsked } from "../lookup/narrow";
import { LIVE_PROPERTY_BOARDS, TEST_PROPERTY_BOARDS, loadProperties } from "../monday/properties";
import { LIVE_PROPERTY_LEADS, TEST_PROPERTY_LEADS, findLeads, leadView, loadPropertyLeads, type PropertyLeadRecord, type PropertyLeadView } from "../property-leads/board";
import { describeQuery, hasFilters, knownTowns, queryFromRequirement, readQuery, searchProperties, type PropertyHit } from "../property/search";

// The boards the app works on: live when deployed (see USE_LIVE_BOARDS).
export const BOARDS: Record<"leads" | "contacts", PersonBoard> = USE_LIVE_BOARDS ? LIVE_BOARDS : TEST_BOARDS;

// Leads and Contacts whose name, business name, phone or email contains one
// of the terms, read fresh from Monday each time. Nothing is kept between
// requests, so a save or claim is seen at once.
export async function peopleMatching(monday: MondayClient, accountSlug: string, terms: SearchTerms): Promise<PersonRecord[]> {
  return (await Promise.all(Object.values(BOARDS).map((b) => searchPersonRecords(monday, b, accountSlug, terms)))).flat();
}

// Every Lead and Contact. Summaries only: slow on the live boards.
async function allPeople(monday: MondayClient, accountSlug: string): Promise<PersonRecord[]> {
  return (await Promise.all(Object.values(BOARDS).map((b) => loadPersonRecords(monday, b, accountSlug)))).flat();
}

// Dates are Vantage's local dates, not UTC.
export function todayInNewJersey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

function claude() {
  const apiKey = process.env.BROKER_APP_ANTHROPIC_KEY;
  if (!apiKey) throw new Error("BROKER_APP_ANTHROPIC_KEY is not set.");
  return new Anthropic({ apiKey, authToken: null });
}

function geocoder(): Geocoder | null {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  return key ? googleGeocoder(key) : null;
}

async function withMap(proposal: Proposal): Promise<Proposal> {
  const geocode = geocoder();
  return geocode ? resolveLocations(proposal, geocode) : proposal;
}

// A board owner on Leads chooses who a new Lead goes to; anyone else becomes
// its Contact Broker. The list is only a convenience: the save checks again.
export function withAssign(proposal: Proposal, team: Team | null, me: Broker): Proposal {
  const p = proposal.person;
  const askedFor = [p.assign_contact_broker, ...p.assign_co_brokers].filter((n): n is string => !!n?.trim());
  if (proposal.target.kind === "pick") return proposal; // decided once the broker picks
  if (proposal.target.kind !== "new-lead") {
    return askedFor.length ? { ...proposal, assignNotDone: `Brokers are chosen only when a new Lead is added, so ${askedFor.join(" and ")} ${askedFor.length === 1 ? "wasn't" : "weren't"} assigned. Change the Contact Broker in Monday.` } : proposal;
  }
  if (!team?.owners.includes(me.id)) {
    return askedFor.length ? { ...proposal, assignNotDone: `Only an owner of the Leads board can choose who a new Lead goes to, so you'll be the Contact Broker.` } : proposal;
  }
  const assign: NonNullable<Proposal["assign"]> = { people: team.people, me: me.id, ...(team.problem ? { problem: team.problem } : {}) };
  if (!team.problem && askedFor.length) {
    const unmatched: string[] = [];
    const pick = (name: string) => {
      const found = findBroker(name, team.people);
      if ("person" in found) return found.person.id;
      unmatched.push(found.problem);
      return undefined;
    };
    // An unclear name starts with no one chosen (""), so the broker must pick.
    if (p.assign_contact_broker?.trim()) assign.contactBroker = pick(p.assign_contact_broker) ?? "";
    const co = p.assign_co_brokers.filter((n) => n.trim()).map(pick).filter((id): id is string => !!id && id !== assign.contactBroker);
    if (co.length) assign.coBrokers = [...new Set(co)];
    if (unmatched.length) assign.unmatched = unmatched;
  }
  return { ...proposal, assign };
}

async function teamOrNull(monday: MondayClient): Promise<Team | null> {
  try {
    return await teamFor(monday, BOARDS.leads);
  } catch {
    return null; // without the list, the broker adding the Lead is its Contact Broker, as before
  }
}

export interface Context {
  monday: MondayClient;
  sid: string;
  accountSlug: string;
  me: Broker;
}

// Development only: a saved extraction stands in for the Claude call, to try
// the screens without a Claude key. Ignored in production.
function devExtraction() {
  const file = process.env.DEV_EXTRACTION_FILE;
  if (!file || process.env.NODE_ENV === "production") return null;
  return SavedExtraction.parse(JSON.parse(readFileSync(file, "utf8")));
}

export interface CaptureResult {
  proposals: Proposal[];
  photo: PhotoReport | null; // what the photos showed, when photos were sent
}

// The Broker Note for a photo is one short line, plus anything the broker typed.
const PHOTO_NOTE: Record<PhotoReport["kind"], string> = {
  business_card: "Added from a business card.",
  sign: "Added from a sign photo.",
  other: "Added from a photo.",
};

export function photoNoteText(note: string, photo: PhotoReport | null): string {
  if (!photo) return note;
  return [PHOTO_NOTE[photo.kind], note].filter(Boolean).join("\n\n");
}

// For a sign: the listing line for Notes, Source = Sign for a new Lead, and
// the property it stands at (by the phone's location, or the sign's address).
async function signExtra(ctx: Context, photo: PhotoReport, location: MapPoint | null, places: Promise<[Awaited<ReturnType<typeof loadAllProperties>>, PropertyLeadRecord[]]>): Promise<ProposalExtra> {
  const extra: ProposalExtra = { sourceForNew: "Sign" };
  if (photo.sign?.listing) extra.notes = [{ text: `Sign: ${photo.sign.listing}`, why: "What the sign offers describes the property, not what this person wants, so it goes in Notes." }];
  try {
    const [{ properties }, leads] = await places;
    const found = findSignProperty(properties, leads, { location, address: photo.sign?.address });
    if (found) extra.signProperty = found;
  } catch (error) {
    console.error(`[capture] properties not read for a sign: ${error instanceof Error ? error.message : "unknown"}`);
  }
  return extra;
}

export async function capture(ctx: Context, note: string, photos: Photo[] = [], location: MapPoint | null = null): Promise<CaptureResult> {
  const today = todayInNewJersey();
  const dev = devExtraction();
  // A photo may be a sign; read the property boards meanwhile, so finding its
  // property adds no wait.
  const places = photos.length ? Promise.all([loadAllProperties(ctx), propertyLeadsFor(ctx)]) : null;
  places?.catch(() => {}); // a failure is reported where it's used
  const team = teamOrNull(ctx.monday); // read meanwhile; used if a new Lead is proposed
  const extraction = dev ? dev : await extractPeople(claude(), note, today, undefined, photos);
  // Monday is searched for the people Claude found, not read in full.
  const queries = extraction.people.map((p) => ({ name: p.name, businessName: p.business_name, phones: p.phones, emails: p.emails }));
  const records = await peopleMatching(ctx.monday, ctx.accountSlug, matchTerms(queries));
  const photo = photos.length ? extraction.photo ?? { kind: "other" as const, unreadable: null, sign: null } : null;
  if (photo?.unreadable && extraction.people.length === 0) return { proposals: [], photo };
  const noteText = photoNoteText(note, photo);
  const extra = photo?.kind === "sign" && places ? await signExtra(ctx, photo, location, places) : undefined;
  const built = extraction.people.map((p) => buildProposal(p, records, ctx.me, noteText, today, extra));
  const owner = built.some((p) => p.target.kind === "new-lead" || p.person.assign_contact_broker || p.person.assign_co_brokers.length) ? await team : null;
  const proposals = await Promise.all(built.map((p) => withMap(withAssign(p, owner, ctx.me))));
  return { proposals, photo };
}

// The broker picked a record, or chose "someone new".
export async function resolve(
  ctx: Context,
  person: ExtractedPerson,
  noteText: string,
  choice: { board: "leads" | "contacts"; id: string } | "new",
  extra?: ProposalExtra,
): Promise<Proposal> {
  const today = todayInNewJersey();
  if (choice === "new") return withMap(withAssign(proposalFor(person, null, ctx.me, noteText, today, [], extra), await teamOrNull(ctx.monday), ctx.me));
  // Read fresh: the record may have just been claimed.
  const record = await loadPersonRecord(ctx.monday, BOARDS[choice.board], choice.id, ctx.accountSlug);
  if (!record) throw new Error("That record wasn't found. It may have been moved or deleted.");
  return withMap(withAssign(proposalFor(person, record, ctx.me, noteText, today, ["your choice"], extra), null, ctx.me));
}

export interface ListedRecord {
  board: "leads" | "contacts";
  boardLabel: string;
  id: string;
  name: string;
  url: string;
}

// One of three kinds of answer, all read only (see lookup/question.ts).
export type LookupResult =
  | {
      kind: "records";
      answers: LookupAnswer[];
      more: ListedRecord[]; // further matches, listed by name only
      partial: boolean; // the only hits were a first name, last name or business word
    }
  | {
      kind: "properties";
      understood: string; // what the search read from the question
      hits: PropertyHit[];
      more: { name: string; url: string; boardLabel: string }[];
      searched: number; // properties read from Monday
      notSearched: string[]; // property boards the broker can't see in Monday
      // Set when the search is a person's requirement ("Any listings for Ray Fulton?").
      for?: {
        name: string;
        url: string;
        boardLabel: string;
        missing: string[]; // requirement fields empty in Monday
        notChecked: string[]; // filled, but not searchable (Budget, Notes)
        place: string; // the town the record asks for
        elsewhere: boolean; // nothing fit in that town, so these are from anywhere
      };
    }
  | { kind: "summary"; points: SummaryPoint[]; recordsRead: number; scope: string }
  | { kind: "propertyLeads"; leads: PropertyLeadView[] };

const DETAILED = 3;
const LISTED = 10;
const PROPERTIES_SHOWN = 12;

export const PROPERTY_BOARDS = USE_LIVE_BOARDS ? LIVE_PROPERTY_BOARDS : TEST_PROPERTY_BOARDS;
export const PROPERTY_LEADS_BOARD = USE_LIVE_BOARDS ? LIVE_PROPERTY_LEADS : TEST_PROPERTY_LEADS;

// Property Leads is a private board: a broker who hasn't been added to it
// gets nothing here rather than an error.
export async function propertyLeadsFor(ctx: Context): Promise<PropertyLeadRecord[]> {
  try {
    return await loadPropertyLeads(ctx.monday, PROPERTY_LEADS_BOARD, ctx.accountSlug);
  } catch (error) {
    console.error(`[lookup] Property Leads not read: ${error instanceof Error ? error.message : "unknown"}`);
    return [];
  }
}

// Every property on the boards the broker can see. A private board they
// haven't been added to is skipped and named, not an error.
async function loadAllProperties(ctx: Context) {
  const notSearched: string[] = [];
  const read = await Promise.all(Object.values(PROPERTY_BOARDS).map((b) =>
    loadProperties(ctx.monday, b, ctx.accountSlug).catch((error: unknown) => {
      if (!(error instanceof BoardHidden)) throw error;
      notSearched.push(b.label);
      return [];
    })));
  return { properties: read.flat(), notSearched };
}

async function propertySearch(ctx: Context, question: string): Promise<LookupResult> {
  const { properties, notSearched } = await loadAllProperties(ctx);
  const query = readQuery(question, knownTowns(properties));
  const hits = searchProperties(properties, query);
  return {
    kind: "properties",
    understood: describeQuery(query),
    hits: hits.slice(0, PROPERTIES_SHOWN),
    more: hits.slice(PROPERTIES_SHOWN).map(({ property: p }) => ({ name: p.name, url: p.url, boardLabel: p.boardLabel })),
    searched: properties.length,
    notSearched,
  };
}

// Available listings that fit a Lead's or Contact's requirement. When none
// are in the town they want, the same search runs everywhere and says so.
async function listingsFor(ctx: Context, record: PersonRecord): Promise<LookupResult> {
  const { properties, notSearched } = await loadAllProperties(ctx);
  const { query, missing, notChecked, place } = queryFromRequirement(record.current, knownTowns(properties));
  const person = { name: record.name, url: record.url, boardLabel: record.board.label, missing, notChecked, place };
  if (query.types.length === 0 && !query.size) {
    return { kind: "properties", understood: "", hits: [], more: [], searched: properties.length, notSearched, for: { ...person, elsewhere: false } };
  }
  let hits = searchProperties(properties, query);
  // The town is a preference: nothing there (or no listing in that town at all) widens to everywhere.
  const inTown = !place || query.towns.length > 0;
  let elsewhere = false;
  if (place && (!inTown || hits.length === 0)) {
    const anywhere = searchProperties(properties, { ...query, towns: [] });
    elsewhere = anywhere.length > 0;
    if (elsewhere || !inTown) hits = anywhere;
  }
  return {
    kind: "properties",
    understood: describeQuery(elsewhere ? { ...query, towns: [] } : query),
    hits: hits.slice(0, PROPERTIES_SHOWN),
    more: hits.slice(PROPERTIES_SHOWN).map(({ property: p }) => ({ name: p.name, url: p.url, boardLabel: p.boardLabel })),
    searched: properties.length,
    notSearched,
    for: { ...person, elsewhere },
  };
}

// Records with something to summarize: any requirement detail at all. A
// Contact Type of "Not Set" or "Not Labeled" says nothing.
const hasRequirement = (r: PersonRecord) =>
  ["propertyType", "size", "budget", "desiredLocation", "notes"].some((k) => r.current[k as keyof PersonRecord["current"]]?.trim())
  || !/^(not set|not labeled)?$/i.test(r.current.contactType.trim());

// Leads and Contacts that mention a property type, found by Monday's search
// (Property Type, Notes or Business Name) instead of reading the boards.
async function peopleMentioning(monday: MondayClient, accountSlug: string, types: TypeAsked[]): Promise<PersonRecord[]> {
  const words = [...new Set(types.flatMap((t) => [t.label.toLowerCase(), ...t.words]))];
  return (await Promise.all(Object.values(BOARDS).map((b) => recordsContaining(monday, b, accountSlug, [
    { column: b.columns.propertyType, values: types.map((t) => t.label.toLowerCase()) },
    { column: b.columns.notes, values: words },
    { column: b.columns.businessName, values: words },
  ])))).flat();
}

// A summary across Leads and Contacts, sent only the records that could
// answer it (see lookup/narrow.ts).
async function summaryFor(ctx: Context, question: string): Promise<SummaryAnswer> {
  const types = typesAsked(question);
  // A place narrows only when no type does (see lookup/narrow.ts).
  const [found, place] = await Promise.all([
    types.length ? peopleMentioning(ctx.monday, ctx.accountSlug, types) : allPeople(ctx.monday, ctx.accountSlug),
    types.length ? null : placeAsked(question, geocoder()),
  ]);
  const records = found
    .filter(hasRequirement)
    .filter((r) => !types.length || mentionsType(r, types))
    .filter((r) => !place || nearPlace(r, place));
  const scope = describeScope(records.length, types, place);
  if (!records.length) return { points: [], recordsRead: 0, scope };
  return summarize(claude(), question, records, todayInNewJersey(), scope);
}

// Lookups read Monday when asked: only the records the question could name.
export async function lookup(ctx: Context, question: string): Promise<LookupResult> {
  const [records, leads] = await Promise.all([peopleMatching(ctx.monday, ctx.accountSlug, questionTerms(question)), propertyLeadsFor(ctx)]);
  const hits = findMentioned(question, records);
  const kind = askKind(question);
  const named = hits.length > 0 && hits[0].strength === "strong";
  // One person named (Maria Chen in Leads and Contacts is still one person).
  const onePerson = named && new Set(hits.map((h) => h.record.name.toLowerCase())).size === 1;
  if (onePerson && asksForListings(question)) return listingsFor(ctx, hits[0].record);
  // A Property Lead named by name or street address ("22 Elm St").
  const namedLeads = named ? [] : findLeads(question, leads);
  if (namedLeads.length) return { kind: "propertyLeads", leads: namedLeads.slice(0, DETAILED).map((l) => leadView(l, ctx.me)) };

  if (!named && kind === "summary") {
    return { kind: "summary", ...(await summaryFor(ctx, question)) };
  }
  if (!named && kind === "property") return propertySearch(ctx, question);
  // Nothing named, but the question reads as a property search ("Any retail in Haddonfield?").
  if (hits.length === 0 && hasFilters(readQuery(question))) return propertySearch(ctx, question);

  const answers = await Promise.all(hits.slice(0, DETAILED).map((h) => lookupAnswer(ctx.monday, h.record, ctx.accountSlug)));
  return {
    kind: "records",
    answers,
    more: hits.slice(DETAILED, DETAILED + LISTED).map(({ record: r }) => ({ board: r.board.key, boardLabel: r.board.label, id: r.id, name: r.name, url: r.url })),
    partial: hits.length > 0 && hits[0].strength === "weak",
  };
}

export async function findPlace(place: string) {
  const geocode = geocoder();
  if (!geocode) return { available: false, point: null };
  return { available: true, point: await geocode(place) };
}

export function itemUrl(accountSlug: string, board: "leads" | "contacts", itemId: string) {
  return `https://${accountSlug}.monday.com/boards/${BOARDS[board].boardId}/pulses/${itemId}`;
}
