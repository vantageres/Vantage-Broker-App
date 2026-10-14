import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import type { MondayClient } from "../monday/client";
import { TEST_BOARDS, type PersonBoard } from "../monday/boards";
import { loadPersonRecords, type PersonRecord } from "../monday/records";
import { IdleCache } from "../memory";
import { googleGeocoder, resolveLocations, type Geocoder } from "../geocode";
import { SavedExtraction, extractPeople, type ExtractedPerson, type Photo, type PhotoReport } from "./extract";
import { buildProposal, proposalFor, type Broker, type Proposal } from "./proposal";
import { findMentioned } from "../lookup/search";
import { lookupAnswer, type LookupAnswer } from "../lookup/details";
import { askKind, asksForListings } from "../lookup/question";
import { summarize, type SummaryPoint } from "../lookup/summary";
import { TEST_PROPERTY_BOARDS, loadProperties } from "../monday/properties";
import { TEST_PROPERTY_LEADS, findLeads, leadView, loadPropertyLeads, type PropertyLeadRecord, type PropertyLeadView } from "../property-leads/board";
import { describeQuery, hasFilters, knownTowns, queryFromRequirement, readQuery, searchProperties, type PropertyHit } from "../property/search";

// The boards the app works on. Only the test boards until cutover.
export const BOARDS: Record<"leads" | "contacts", PersonBoard> = TEST_BOARDS;

// Matching data for each chat session, dropped after 10 idle minutes.
const sessionRecords = new IdleCache<PersonRecord[]>();

export async function recordsFor(monday: MondayClient, sid: string, accountSlug: string): Promise<PersonRecord[]> {
  const cached = sessionRecords.get(sid);
  if (cached) return cached;
  const records = (await Promise.all(Object.values(BOARDS).map((b) => loadPersonRecords(monday, b, accountSlug)))).flat();
  sessionRecords.set(sid, records);
  return records;
}

// After a save or claim the cached copy is stale.
export function forgetRecords(sid: string) {
  sessionRecords.delete(sid);
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

export async function capture(ctx: Context, note: string, photos: Photo[] = []): Promise<CaptureResult> {
  const today = todayInNewJersey();
  const dev = devExtraction();
  const [extraction, records] = await Promise.all([
    dev ? Promise.resolve(dev) : extractPeople(claude(), note, today, undefined, photos),
    recordsFor(ctx.monday, ctx.sid, ctx.accountSlug),
  ]);
  const photo = photos.length ? extraction.photo ?? { kind: "other" as const, unreadable: null } : null;
  if (photo?.unreadable && extraction.people.length === 0) return { proposals: [], photo };
  const noteText = photoNoteText(note, photo);
  const proposals = await Promise.all(extraction.people.map((p) => withMap(buildProposal(p, records, ctx.me, noteText, today))));
  return { proposals, photo };
}

// The broker picked a record, or chose "someone new".
export async function resolve(
  ctx: Context,
  person: ExtractedPerson,
  noteText: string,
  choice: { board: "leads" | "contacts"; id: string } | "new",
): Promise<Proposal> {
  const today = todayInNewJersey();
  if (choice === "new") return withMap(proposalFor(person, null, ctx.me, noteText, today));
  forgetRecords(ctx.sid); // read fresh: the record may have just been claimed
  const records = await recordsFor(ctx.monday, ctx.sid, ctx.accountSlug);
  const record = records.find((r) => r.board.key === choice.board && r.id === choice.id);
  if (!record) throw new Error("That record wasn't found. It may have been moved or deleted.");
  return withMap(proposalFor(person, record, ctx.me, noteText, today, ["your choice"]));
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
  | { kind: "summary"; points: SummaryPoint[]; recordsRead: number }
  | { kind: "propertyLeads"; leads: PropertyLeadView[] };

const DETAILED = 3;
const LISTED = 10;
const PROPERTIES_SHOWN = 12;

export const PROPERTY_BOARDS = TEST_PROPERTY_BOARDS;
export const PROPERTY_LEADS_BOARD = TEST_PROPERTY_LEADS;

// Property Leads is a private board: a broker who hasn't been added to it
// gets nothing here rather than an error.
async function propertyLeadsFor(ctx: Context): Promise<PropertyLeadRecord[]> {
  try {
    return await loadPropertyLeads(ctx.monday, PROPERTY_LEADS_BOARD, ctx.accountSlug);
  } catch (error) {
    console.error(`[lookup] Property Leads not read: ${error instanceof Error ? error.message : "unknown"}`);
    return [];
  }
}

const loadAllProperties = async (ctx: Context) =>
  (await Promise.all(Object.values(PROPERTY_BOARDS).map((b) => loadProperties(ctx.monday, b, ctx.accountSlug)))).flat();

async function propertySearch(ctx: Context, question: string): Promise<LookupResult> {
  const properties = await loadAllProperties(ctx);
  const query = readQuery(question, knownTowns(properties));
  const hits = searchProperties(properties, query);
  return {
    kind: "properties",
    understood: describeQuery(query),
    hits: hits.slice(0, PROPERTIES_SHOWN),
    more: hits.slice(PROPERTIES_SHOWN).map(({ property: p }) => ({ name: p.name, url: p.url, boardLabel: p.boardLabel })),
    searched: properties.length,
  };
}

// Available listings that fit a Lead's or Contact's requirement. When none
// are in the town they want, the same search runs everywhere and says so.
async function listingsFor(ctx: Context, record: PersonRecord): Promise<LookupResult> {
  const properties = await loadAllProperties(ctx);
  const { query, missing, notChecked, place } = queryFromRequirement(record.current, knownTowns(properties));
  const person = { name: record.name, url: record.url, boardLabel: record.board.label, missing, notChecked, place };
  if (query.types.length === 0 && !query.size) {
    return { kind: "properties", understood: "", hits: [], more: [], searched: properties.length, for: { ...person, elsewhere: false } };
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
    for: { ...person, elsewhere },
  };
}

// Records with something to summarize: any requirement detail at all.
const hasRequirement = (r: PersonRecord) =>
  ["contactType", "propertyType", "size", "budget", "desiredLocation", "notes"].some((k) => r.current[k as keyof PersonRecord["current"]]?.trim());

// Lookups read Monday when asked, never the cached copy.
export async function lookup(ctx: Context, question: string): Promise<LookupResult> {
  forgetRecords(ctx.sid);
  const [records, leads] = await Promise.all([recordsFor(ctx.monday, ctx.sid, ctx.accountSlug), propertyLeadsFor(ctx)]);
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
    const relevant = records.filter(hasRequirement);
    return { kind: "summary", ...(await summarize(claude(), question, relevant, todayInNewJersey())) };
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
