import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import type { MondayClient } from "../monday/client";
import { TEST_BOARDS, type PersonBoard } from "../monday/boards";
import { loadPersonRecords, type PersonRecord } from "../monday/records";
import { IdleCache } from "../memory";
import { googleGeocoder, resolveLocations, type Geocoder } from "../geocode";
import { Extraction, extractPeople, type ExtractedPerson } from "./extract";
import { buildProposal, proposalFor, type Broker, type Proposal } from "./proposal";
import { findMentioned } from "../lookup/search";
import { lookupAnswer, type LookupAnswer } from "../lookup/details";
import { askKind } from "../lookup/question";
import { summarize, type SummaryPoint } from "../lookup/summary";
import { TEST_PROPERTY_BOARDS, loadProperties } from "../monday/properties";
import { describeQuery, hasFilters, knownTowns, readQuery, searchProperties, type PropertyHit } from "../property/search";

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
  return Extraction.parse(JSON.parse(readFileSync(file, "utf8")));
}

export async function capture(ctx: Context, note: string): Promise<Proposal[]> {
  const today = todayInNewJersey();
  const dev = devExtraction();
  const [extraction, records] = await Promise.all([
    dev ? Promise.resolve(dev) : extractPeople(claude(), note, today),
    recordsFor(ctx.monday, ctx.sid, ctx.accountSlug),
  ]);
  return Promise.all(extraction.people.map((p) => withMap(buildProposal(p, records, ctx.me, note, today))));
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
    }
  | { kind: "summary"; points: SummaryPoint[]; recordsRead: number };

const DETAILED = 3;
const LISTED = 10;
const PROPERTIES_SHOWN = 12;

export const PROPERTY_BOARDS = TEST_PROPERTY_BOARDS;

async function propertySearch(ctx: Context, question: string): Promise<LookupResult> {
  const properties = (await Promise.all(Object.values(PROPERTY_BOARDS).map((b) => loadProperties(ctx.monday, b, ctx.accountSlug)))).flat();
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

// Records with something to summarize: any requirement detail at all.
const hasRequirement = (r: PersonRecord) =>
  ["contactType", "propertyType", "size", "budget", "desiredLocation", "notes"].some((k) => r.current[k as keyof PersonRecord["current"]]?.trim());

// Lookups read Monday when asked, never the cached copy.
export async function lookup(ctx: Context, question: string): Promise<LookupResult> {
  forgetRecords(ctx.sid);
  const records = await recordsFor(ctx.monday, ctx.sid, ctx.accountSlug);
  const hits = findMentioned(question, records);
  const kind = askKind(question);
  const named = hits.length > 0 && hits[0].strength === "strong";

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
