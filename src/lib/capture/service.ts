import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import type { MondayClient } from "../monday/client";
import { TEST_BOARDS, type PersonBoard } from "../monday/boards";
import { loadPersonRecords, type PersonRecord } from "../monday/records";
import { IdleCache } from "../memory";
import { googleGeocoder, resolveLocations, type Geocoder } from "../geocode";
import { Extraction, extractPeople, type ExtractedPerson } from "./extract";
import { buildProposal, proposalFor, type Broker, type Proposal } from "./proposal";

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

export async function findPlace(place: string) {
  const geocode = geocoder();
  if (!geocode) return { available: false, point: null };
  return { available: true, point: await geocode(place) };
}

export function itemUrl(accountSlug: string, board: "leads" | "contacts", itemId: string) {
  return `https://${accountSlug}.monday.com/boards/${BOARDS[board].boardId}/pulses/${itemId}`;
}
