import { z } from "zod";
import { isLeadSource, noiseKind, type NoiseKind } from "./noise";
import type { MailMessage, Person } from "./source";
import type { PropertyLeadDraft } from "../property-leads/extract";
import { isInternal } from "./threads";

// The first-time scan and the broker's directory (plan decision 7, spec 04).
// Code counts who the broker emails, drops noise, and leaves out people
// Monday already knows; Claude proposes a type for the rest and lists the
// properties the mail names; the broker keeps, changes or removes each one.
// Kept contacts and properties form the directory every later check uses.

export const BINS = [
  "Client", "Prospect", "Outside Broker", "Attorney", "Lender", "Title and Escrow", "Appraiser or Inspector",
  "Vendor", "Personal", "Lead Source", "Noise",
] as const;
export type ScanBin = (typeof BINS)[number];

export const SCAN_DAYS = 90;
export const SHORTLIST_MAX = 100;
export const PER_CALL = 25;
const SUBJECTS_KEPT = 3;
const SNIPPET_CHARS = 200;

// ---- Counting (code) ----

export interface Counted {
  email: string;
  name: string | null;
  received: number;
  sentTo: number;
  last: string; // ISO
  subjects: string[]; // a few, for Claude; dropped once sorted
  snippet: string | null; // the latest preview, trimmed; dropped once sorted
}

export interface CountResult {
  contacts: Counted[]; // outside people with real mail, busiest first
  leadSources: Counted[];
  noise: Partial<Record<NoiseKind, number>>;
}

// Sent-to weighs more: people the broker writes to are people they work with.
export const weight = (c: Pick<Counted, "received" | "sentTo">) => c.received + 3 * c.sentTo;

export function countMail(messages: MailMessage[], owner: Person): CountResult {
  const byEmail = new Map<string, Counted>();
  const leadSources = new Map<string, Counted>();
  const noise: CountResult["noise"] = {};
  const entry = (map: Map<string, Counted>, p: Person) => {
    let c = map.get(p.address);
    if (!c) {
      c = { email: p.address, name: p.name && p.name !== p.address ? p.name : null, received: 0, sentTo: 0, last: "", subjects: [], snippet: null };
      map.set(p.address, c);
    }
    if (!c.name && p.name && p.name !== p.address) c.name = p.name;
    return c;
  };
  const touch = (c: Counted, m: MailMessage) => {
    if (m.at > c.last) c.last = m.at;
    const subject = m.subject.replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "").trim();
    if (subject && !c.subjects.includes(subject) && c.subjects.length < SUBJECTS_KEPT) c.subjects.push(subject);
  };

  for (const m of [...messages].sort((a, b) => a.at.localeCompare(b.at))) {
    if (m.folder === "inbox") {
      const from = m.from;
      if (!from.address || from.address === owner.address || isInternal(from.address)) continue;
      if (isLeadSource(from.address)) {
        const c = entry(leadSources, from);
        c.received++;
        touch(c, m);
        continue;
      }
      const kind = noiseKind(m);
      if (kind) {
        noise[kind] = (noise[kind] ?? 0) + 1;
        continue;
      }
      const c = entry(byEmail, from);
      c.received++;
      touch(c, m);
      if (m.preview.trim()) c.snippet = m.preview.replace(/\s+/g, " ").trim().slice(0, SNIPPET_CHARS);
    } else {
      for (const p of [...m.to, ...m.cc]) {
        if (!p.address || p.address === owner.address || isInternal(p.address) || isLeadSource(p.address)) continue;
        const c = entry(byEmail, p);
        c.sentTo++;
        touch(c, m);
      }
    }
  }
  const busiest = (a: Counted, b: Counted) => weight(b) - weight(a) || b.last.localeCompare(a.last);
  return { contacts: [...byEmail.values()].sort(busiest), leadSources: [...leadSources.values()].sort(busiest), noise };
}

// Who is worth asking about: two-way traffic, or written to at least twice,
// or writing in at least twice (spec 04 step 3, widened for brokers who
// mostly receive). Busiest first, capped.
export function shortlist(contacts: Counted[]): Counted[] {
  return contacts.filter((c) => (c.received > 0 && c.sentTo > 0) || c.sentTo >= 2 || c.received >= 2).slice(0, SHORTLIST_MAX);
}

// ---- Claude: types and properties ----

const Proposal = z.object({
  email: z.string(),
  name: z.string().nullable(),
  company: z.string().nullable(),
  bin: z.enum(BINS),
  related_deal: z.string().nullable(),
  why: z.string(),
  confidence: z.enum(["high", "low"]),
});
export const BinAnswer = z.object({
  contacts: z.array(Proposal),
  properties: z.array(z.object({ text: z.string(), contacts: z.array(z.string()) })),
});
export type BinAnswer = z.infer<typeof BinAnswer>;
export type Proposed = z.infer<typeof Proposal>;

export class ScanProblem extends Error {}

export interface Binner {
  (brokerName: string, contacts: Counted[]): Promise<BinAnswer>;
}

export function forModel(c: Counted) {
  return {
    email: c.email, name: c.name, domain: c.email.split("@")[1] ?? "", received: c.received, sent_to: c.sentTo,
    last: c.last.slice(0, 10), subjects: c.subjects, snippet: c.snippet,
  };
}

// Claude's answer checked in code: one proposal per contact asked about
// (missing ones become a low-confidence Prospect to review), no internal
// types, and property mentions tied only to contacts in this batch.
export function checkBins(asked: Counted[], answer: BinAnswer): { proposed: Proposed[]; mentions: { text: string; contacts: string[] }[] } {
  const byEmail = new Map(answer.contacts.map((p) => [p.email.toLowerCase(), p]));
  const proposed = asked.map((c): Proposed => {
    const p = byEmail.get(c.email);
    if (!p) return { email: c.email, name: c.name, company: null, bin: "Prospect", related_deal: null, why: "Not sorted. Check this one.", confidence: "low" };
    return { ...p, email: c.email, name: p.name ?? c.name, why: p.why.slice(0, 120) };
  });
  const emails = new Set(asked.map((c) => c.email));
  const mentions = answer.properties
    .map((p) => ({ text: p.text.trim().slice(0, 120), contacts: p.contacts.map((e) => e.toLowerCase()).filter((e) => emails.has(e)) }))
    .filter((p) => p.text.length >= 4);
  return { proposed, mentions };
}

// ---- Properties: in Monday or not (code) ----

export interface KnownProperty {
  name: string;
  address: string;
  url: string;
  boardLabel: string;
}

const clean = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
const STREET_WORDS = /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|pike|pkwy|parkway|ln|lane|way|hwy|highway|route|rt|ct|court|pl|place)\b/g;

// "22 Elm St" and "22 Elm Street, Cherry Hill" share the number and the first
// street word, which survive abbreviations (as signs are matched, property/near.ts).
function streetKey(text: string): string | null {
  const m = clean(text).match(/ (\d+[a-z]?) ([a-z]+) /);
  return m ? `${m[1]} ${m[2]}` : null;
}

// A name with no number matches a property whose name holds all its words
// ("Pomona Shopping Center" in "Pomona Shopping Center - Pomona, NY").
function nameWords(text: string): string[] {
  return clean(text).replace(STREET_WORDS, " ").trim().split(/\s+/).filter((w) => w.length >= 3);
}

export function findProperty(mention: string, known: KnownProperty[]): KnownProperty | null {
  const key = streetKey(mention);
  if (key) return known.find((k) => streetKey(k.name) === key || streetKey(k.address) === key) ?? null;
  const words = nameWords(mention);
  if (words.length < 2) return null;
  return known.find((k) => {
    const hay = clean(`${k.name} ${k.address}`);
    return words.every((w) => hay.includes(` ${w} `));
  }) ?? null;
}

// Mentions of the same property, once: by street key, else by name.
export function sameProperty(a: string, b: string): boolean {
  const ka = streetKey(a), kb = streetKey(b);
  if (ka || kb) return ka === kb;
  return clean(a).trim() === clean(b).trim();
}

// ---- The directory ----

export type Status = "review" | "kept" | "removed";

export interface DirContact {
  email: string;
  name: string | null;
  company: string | null;
  bin: ScanBin;
  relatedDeal: string | null;
  why: string;
  confidence: "high" | "low";
  received: number;
  sentTo: number;
  last: string;
  status: Status;
  changed?: string; // YYYY-MM-DD the broker last changed it
}

export interface DirProperty {
  id: string; // "p1", "p2"...: stable, used as a deal id ("dir:p1") in checks
  name: string;
  contacts: string[];
  status: Status;
}

export interface Directory {
  scannedAt: string | null;
  summary: { inbox: number; sent: number; capped: boolean; noise: number; inMonday: number; asked: number } | null;
  contacts: DirContact[];
  properties: DirProperty[];
  nextProperty: number;
}

export const emptyDirectory = (): Directory => ({ scannedAt: null, summary: null, contacts: [], properties: [], nextProperty: 1 });

// A new scan adds what it found for review. What the broker already kept or
// removed stays as they left it; counts are refreshed.
export function mergeScan(
  before: Directory,
  found: { contacts: (Proposed & Pick<Counted, "received" | "sentTo" | "last">)[]; properties: { text: string; contacts: string[] }[] },
  summary: NonNullable<Directory["summary"]>,
  at: string,
): Directory {
  const dir: Directory = structuredClone(before);
  for (const c of found.contacts) {
    const existing = dir.contacts.find((d) => d.email === c.email);
    if (existing) {
      Object.assign(existing, { received: c.received, sentTo: c.sentTo, last: c.last });
      if (existing.status === "review") Object.assign(existing, { bin: c.bin, why: c.why, confidence: c.confidence, relatedDeal: c.related_deal, company: c.company ?? existing.company });
      continue;
    }
    dir.contacts.push({
      email: c.email, name: c.name, company: c.company, bin: c.bin, relatedDeal: c.related_deal, why: c.why, confidence: c.confidence,
      received: c.received, sentTo: c.sentTo, last: c.last, status: "review",
    });
  }
  for (const p of found.properties) {
    const existing = dir.properties.find((d) => sameProperty(d.name, p.text));
    if (existing) {
      existing.contacts = [...new Set([...existing.contacts, ...p.contacts])];
      continue;
    }
    dir.properties.push({ id: `p${dir.nextProperty++}`, name: p.text, contacts: p.contacts, status: "review" });
  }
  dir.contacts.sort((a, b) => weight(b) - weight(a));
  return { ...dir, scannedAt: at, summary };
}

export type DirTap =
  | { kind: "contact"; email: string; action: "keep" | "remove" | "review" }
  | { kind: "contact"; email: string; action: "bin"; bin: ScanBin }
  | { kind: "property"; id: string; action: "keep" | "remove" | "review" }
  | { kind: "keep-all"; emails: string[]; ids: string[] };

export function applyDirTap(before: Directory, tap: DirTap, today: string): Directory {
  const dir: Directory = structuredClone(before);
  const status = (action: "keep" | "remove" | "review"): Status => (action === "keep" ? "kept" : action === "remove" ? "removed" : "review");
  if (tap.kind === "keep-all") {
    for (const c of dir.contacts) if (tap.emails.includes(c.email) && c.status === "review") Object.assign(c, { status: "kept", changed: today });
    for (const p of dir.properties) if (tap.ids.includes(p.id) && p.status === "review") p.status = "kept";
    return dir;
  }
  if (tap.kind === "property") {
    const p = dir.properties.find((x) => x.id === tap.id);
    if (!p) throw new Error("That property is no longer in your list.");
    p.status = status(tap.action);
    return dir;
  }
  const c = dir.contacts.find((x) => x.email === tap.email);
  if (!c) throw new Error("That contact is no longer in your list.");
  if (tap.action === "bin") {
    if (!(BINS as readonly string[]).includes(tap.bin)) throw new Error("That type isn't one of the choices.");
    Object.assign(c, { bin: tap.bin, confidence: "high", status: c.status === "removed" ? "review" : c.status, changed: today });
  } else {
    Object.assign(c, { status: status(tap.action), changed: today });
  }
  return dir;
}

// What later checks use: kept contacts' types, and kept properties as deals.
export function directoryBins(dir: Directory): Map<string, ScanBin> {
  return new Map(dir.contacts.filter((c) => c.status === "kept").map((c) => [c.email, c.bin]));
}

export function directoryDeals(dir: Directory): { id: string; name: string }[] {
  return dir.properties.filter((p) => p.status === "kept").map((p) => ({ id: `dir:${p.id}`, name: p.name }));
}

// "New Property Lead" from a listed property (plan step 6, John Nov 19): the
// address as the name, and as its contact the owner the mail was with, when
// a related contact is typed Client. Nothing else is guessed; the broker
// fills the rest on the card.
export function propertyLeadDraft(p: DirProperty, dir: Directory): { draft: PropertyLeadDraft; note: string } {
  const related = p.contacts.map((e) => dir.contacts.find((c) => c.email === e)).filter((c): c is DirContact => !!c && c.status !== "removed");
  const owner = related.find((c) => c.bin === "Client");
  const names = related.map((c) => c.name ?? c.email);
  return {
    draft: {
      address: p.name,
      listing_type: null,
      property_type: null,
      listing_price: null,
      size: null,
      contact: { name: owner?.name ?? null, business_name: owner?.company ?? null, phones: [], emails: owner ? [owner.email] : [] },
      uncertain: [],
    },
    note: `From email: ${p.name}${names.length ? `, in mail with ${names.join(", ")}` : ""}.`,
  };
}
