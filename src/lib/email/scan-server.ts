import Anthropic from "@anthropic-ai/sdk";
import { BoardHidden } from "../monday/client";
import { loadProperties } from "../monday/properties";
import { getStore } from "../store";
import { PROPERTY_BOARDS, propertyLeadsFor, propertyLeadProposal, todayInNewJersey, type Context } from "../capture/service";
import type { NewPropertyLeadProposal } from "../property-leads/create";
import { lookupInMonday, mailSourceFor } from "./monitor-server";
import {
  applyDirTap, checkBins, countMail, findProperty, mergeScan, PER_CALL, SCAN_DAYS, sameProperty,
  propertyLeadDraft, shortlist, type Binner, type Counted, type Directory, type DirTap, type KnownProperty, type Proposed,
} from "./scan";
import { sealer } from "./server";
import { claudeBinner, savedBinner } from "./binner";
import { deleteDirectoryOnly, directoryFor, saveDirectory } from "./directory-store";

export { directoryFor };

// Runs the first-time scan in steps the screen drives, one request each, so
// it shows progress, survives the broker leaving the tab, and needs no
// queue: read the mail, check Monday, ask Claude in batches, check the
// properties, then add what was found to the directory for review.
// The working state holds a few subjects and snippets per contact for
// Claude; it is sealed, lives at most a day, and is deleted when the scan
// ends. The directory keeps no subjects or snippets.

const SCAN_TTL_MS = 24 * 60 * 60 * 1000;
const scanKey = (userId: string) => `email:scan:${userId}`;
const scanLockKey = (userId: string) => `email:scan-lock:${userId}`;

type Found = Proposed & Pick<Counted, "received" | "sentTo" | "last">;

interface ScanState {
  phase: "reading" | "monday" | "sorting" | "properties";
  startedAt: string;
  summary: NonNullable<Directory["summary"]>;
  pending: Counted[];
  leadSources: Counted[];
  found: Found[];
  mentions: { text: string; contacts: string[] }[];
  total: number;
}

export type ScanStatus =
  | { running: false; directory: Directory }
  | { running: true; phase: ScanState["phase"]; done: number; total: number; directory: Directory };

async function readSealed<T>(key: string): Promise<T | null> {
  const sealed = await getStore().get<string>(key);
  return sealed ? sealer.unseal<T>(sealed) : null;
}
const writeSealed = async (key: string, value: object, px?: number) => getStore().set(key, await sealer.seal(value), px ? { px } : undefined);

export function binnerFor(env = process.env): Binner {
  if (env.NODE_ENV !== "production" && env.DEV_SCAN_FILE) return savedBinner(env.DEV_SCAN_FILE);
  const apiKey = env.BROKER_APP_ANTHROPIC_KEY;
  if (!apiKey) throw new Error("Claude is not set up for the email monitor.");
  return claudeBinner(new Anthropic({ apiKey, authToken: null }));
}

function status(state: ScanState | null, directory: Directory): ScanStatus {
  if (!state) return { running: false, directory };
  const done = state.phase === "sorting" || state.phase === "properties" ? state.total - state.pending.length : 0;
  return { running: true, phase: state.phase, done, total: state.total, directory };
}

export async function scanStatus(userId: string): Promise<ScanStatus> {
  const [state, directory] = await Promise.all([readSealed<ScanState>(scanKey(userId)), directoryFor(userId)]);
  return status(state, directory);
}

export async function startScan(userId: string): Promise<ScanStatus> {
  const state: ScanState = {
    phase: "reading", startedAt: new Date().toISOString(),
    summary: { inbox: 0, sent: 0, capped: false, noise: 0, inMonday: 0, asked: 0 },
    pending: [], leadSources: [], found: [], mentions: [], total: 0,
  };
  await writeSealed(scanKey(userId), state, SCAN_TTL_MS);
  return status(state, await directoryFor(userId));
}

export async function cancelScan(userId: string) {
  await getStore().del(scanKey(userId));
}

async function knownProperties(ctx: Context): Promise<KnownProperty[]> {
  const boards = await Promise.all(Object.values(PROPERTY_BOARDS).map((b) =>
    loadProperties(ctx.monday, b, ctx.accountSlug).catch((error: unknown) => {
      if (error instanceof BoardHidden) return [];
      throw error;
    })));
  const leads = await propertyLeadsFor(ctx);
  return [
    ...boards.flat().map((p) => ({ name: p.name, address: p.address, url: p.url, boardLabel: p.boardLabel })),
    ...leads.map((l) => ({ name: l.name, address: l.info.location, url: l.url, boardLabel: "Property Leads" })),
  ];
}

// One step. Two tabs stepping at once is harmless: the second waits its turn.
export async function stepScan(ctx: Context, binner: () => Binner = binnerFor): Promise<ScanStatus> {
  const userId = ctx.me.id;
  const store = getStore();
  if (!(await store.set(scanLockKey(userId), 1, { px: 120_000, nx: true }))) return scanStatus(userId);
  try {
    const state = await readSealed<ScanState>(scanKey(userId));
    const directory = await directoryFor(userId);
    if (!state) return status(null, directory);

    if (state.phase === "reading") {
      const source = await mailSourceFor(userId);
      const since = new Date(Date.now() - SCAN_DAYS * 24 * 60 * 60 * 1000);
      const messages = await (source.scanSince ? source.scanSince(since) : source.messagesSince(since));
      const counted = countMail(messages, source.owner);
      const inbox = messages.filter((m) => m.folder === "inbox").length;
      const sent = messages.length - inbox;
      state.summary = { ...state.summary, inbox, sent, capped: inbox >= 1000 || sent >= 1000, noise: Object.values(counted.noise).reduce((s, n) => s + (n ?? 0), 0) };
      // Contacts the broker already kept or removed are not asked about again.
      const settled = new Set(directory.contacts.filter((c) => c.status !== "review").map((c) => c.email));
      state.pending = shortlist(counted.contacts).filter((c) => !settled.has(c.email));
      state.leadSources = counted.leadSources.filter((c) => !settled.has(c.email));
      state.phase = "monday";
    } else if (state.phase === "monday") {
      const stillUnknown: Counted[] = [];
      for (let i = 0; i < state.pending.length; i += PER_CALL) {
        const batch = state.pending.slice(i, i + PER_CALL);
        const known = await lookupInMonday(ctx, batch.map((c) => ({ name: c.name ?? c.email, address: c.email })));
        if (!known) throw new Error("Monday didn't respond. Try again in a minute.");
        for (const c of batch) {
          if (known.get(c.email)?.inMonday) state.summary.inMonday++;
          else stillUnknown.push(c);
        }
      }
      state.pending = stillUnknown;
      state.total = stillUnknown.length;
      state.summary.asked = stillUnknown.length;
      state.phase = state.pending.length ? "sorting" : "properties";
    } else if (state.phase === "sorting") {
      const batch = state.pending.slice(0, PER_CALL);
      const { proposed, mentions } = checkBins(batch, await binner()(ctx.me.name, batch));
      const counts = new Map(batch.map((c) => [c.email, c]));
      state.found.push(...proposed.map((p) => ({ ...p, received: counts.get(p.email)!.received, sentTo: counts.get(p.email)!.sentTo, last: counts.get(p.email)!.last })));
      state.mentions.push(...mentions);
      state.pending = state.pending.slice(PER_CALL);
      if (!state.pending.length) state.phase = "properties";
    } else {
      const unique: ScanState["mentions"] = [];
      for (const m of state.mentions) {
        const same = unique.find((u) => sameProperty(u.text, m.text));
        if (same) same.contacts = [...new Set([...same.contacts, ...m.contacts])];
        else unique.push({ ...m });
      }
      const known = unique.length ? await knownProperties(ctx) : [];
      const notInMonday = unique.filter((m) => !findProperty(m.text, known));
      const leadSources: Found[] = state.leadSources.map((c) => ({
        email: c.email, name: c.name, company: null, bin: "Lead Source", related_deal: null, why: "Listing platform.", confidence: "high",
        received: c.received, sentTo: c.sentTo, last: c.last,
      }));
      const next = mergeScan(directory, { contacts: [...state.found, ...leadSources], properties: notInMonday }, state.summary, new Date().toISOString());
      await saveDirectory(userId, next);
      await store.del(scanKey(userId));
      return status(null, next);
    }
    await writeSealed(scanKey(userId), state, SCAN_TTL_MS);
    return status(state, directory);
  } finally {
    await store.del(scanLockKey(userId));
  }
}

export async function tapDirectory(userId: string, tap: DirTap): Promise<Directory> {
  const next = applyDirTap(await directoryFor(userId), tap, todayInNewJersey());
  await saveDirectory(userId, next);
  return next;
}

// Turning the module off (Disconnect) deletes the directory and any scan.
export async function deleteDirectory(userId: string) {
  await deleteDirectoryOnly(userId);
  await getStore().del(scanKey(userId));
}

export type PropertyLeadResult =
  | { kind: "card"; proposal: NewPropertyLeadProposal }
  | { kind: "in-monday"; name: string; url: string; boardLabel: string };

// The New Property Lead card for a property from the scan. Monday is checked
// again first: it may have been added since. Nothing is saved here; the
// card's own Approve creates it, as for a typed note.
export async function proposePropertyLead(ctx: Context, id: string): Promise<PropertyLeadResult> {
  const dir = await directoryFor(ctx.me.id);
  const p = dir.properties.find((x) => x.id === id && x.status !== "removed");
  if (!p) throw new Error("That property is no longer in your list.");
  const found = findProperty(p.name, await knownProperties(ctx));
  if (found) return { kind: "in-monday", name: found.name, url: found.url, boardLabel: found.boardLabel };
  const { draft, note } = propertyLeadDraft(p, dir);
  return { kind: "card", proposal: await propertyLeadProposal(ctx, draft, note) };
}
