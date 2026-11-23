import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "../store";
import { BOARDS, peopleMatching, propertyLeadsFor, type Context } from "../capture/service";
import { teamFor } from "../monday/team";
import { claudeClassifier, savedClassifier, type Classifier } from "./classify";
import { accessToken, getConnection, ReconnectNeeded } from "./connection";
import { knownPeople, type Known } from "./people";
import { directoryFor } from "./directory-store";
import { directoryBins, directoryDeals } from "./scan";
import { applyRun, applyTap, changeLine, emptyItems, GROUP_ORDER, nyDate, viewOf, type ItemGroup, type ItemsState, type TapAction, type TapResult } from "./open-items";
import { claudeHistorian, savedHistorian, type Historian } from "./history";
import { dueSlot, nextFullList, upcomingDates, waitingOnThem, type RunKind, type Slot } from "./schedule";
import { runCheck, type ItemLine, type MonitorState, type Run } from "./run";
import { sealer } from "./server";
import { mondayClient } from "../monday/client";
import { MONDAY_ACCOUNT_SLUG } from "../monday/boards";
import { refreshTokens } from "../monday/oauth";
import { mondayTokensFor } from "./monday-link";
import { devMailboxFile, fileSource, outlookSource, type MailSource, type Person } from "./source";

// Wires a run to the real pieces: the broker's mail (Outlook, or the
// development file), Monday for who people are and for deals, Claude (or
// saved answers in development), and the store. Runs and state are sealed
// and expire on their own (plan decision 6).

const RUN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const STATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Open items live while they are open; closed ones are pruned 5 business days
// after closing (open-items.ts). The whole list expires if untouched for 60 days.
const ITEMS_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const runKey = (userId: string) => `email:run:${userId}`;
const stateKey = (userId: string) => `email:state:${userId}`;
const itemsKey = (userId: string) => `email:items:${userId}`;
const itemsLockKey = (userId: string) => `email:items-lock:${userId}`;

export class NotConnected extends Error {
  constructor() {
    super("Connect Outlook first.");
  }
}

export async function mailSourceFor(userId: string): Promise<MailSource> {
  const file = devMailboxFile();
  if (file) return fileSource(file);
  const deps = { store: getStore(), sealer };
  const conn = await getConnection(deps, userId);
  if (!conn) throw new NotConnected();
  const token = await accessToken(deps, userId);
  return outlookSource(token, { name: conn.name, address: conn.address });
}

// Development uses saved answers when DEV_CLASSIFICATION_FILE is set, so made-up
// or snapshot mail never needs the Claude key.
export function classifierFor(env = process.env): Classifier {
  if (env.NODE_ENV !== "production" && env.DEV_CLASSIFICATION_FILE) return savedClassifier(env.DEV_CLASSIFICATION_FILE);
  const apiKey = env.BROKER_APP_ANTHROPIC_KEY;
  if (!apiKey) throw new Error("Claude is not set up for the email monitor.");
  return claudeClassifier(new Anthropic({ apiKey, authToken: null }));
}

export async function lookupInMonday(ctx: Context, people: Person[]) {
  const external = people.filter((p) => !/@(vantageres|vantagepm)\.com$/i.test(p.address)).map((p) => p.address);
  try {
    const [records, team] = await Promise.all([
      external.length ? peopleMatching(ctx.monday, ctx.accountSlug, { words: [], phones: [], emails: external }) : Promise.resolve([]),
      teamFor(ctx.monday, BOARDS.leads).catch(() => null),
    ]);
    return knownPeople(people, records, team?.people.map((p) => p.name) ?? []);
  } catch (error) {
    console.error(`[email] Monday lookup failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    return null;
  }
}

async function readSealed<T>(key: string): Promise<T | null> {
  const sealed = await getStore().get<string>(key);
  return sealed ? sealer.unseal<T>(sealed) : null;
}

export function latestRun(userId: string): Promise<Run | null> {
  return readSealed<Run>(runKey(userId));
}

export class ItemsBusy extends Error {
  constructor() {
    super("Could not save. Try again.");
  }
}

// One writer at a time for a broker's open items: a run's update and the
// broker's taps never overwrite each other. Mail reading and Claude happen
// before the lock is taken.
async function withItems<T>(userId: string, fn: (items: ItemsState) => Promise<{ items: ItemsState | null; result: T }>): Promise<T> {
  const store = getStore();
  const lock = itemsLockKey(userId);
  let got = false;
  for (let i = 0; i < 20 && !got; i++) {
    got = await store.set(lock, 1, { px: 15_000, nx: true });
    if (!got) await new Promise((r) => setTimeout(r, 250));
  }
  if (!got) throw new ItemsBusy();
  try {
    const items = (await readSealed<ItemsState>(itemsKey(userId))) ?? emptyItems();
    const { items: next, result } = await fn(items);
    if (next) await store.set(itemsKey(userId), await sealer.seal(next), { px: ITEMS_TTL_MS });
    return result;
  } finally {
    await store.del(lock);
  }
}

export async function openItems(userId: string): Promise<ItemsState> {
  return (await readSealed<ItemsState>(itemsKey(userId))) ?? emptyItems();
}

export function tapItem(userId: string, num: number, action: TapAction, version: number): Promise<TapResult> {
  return withItems(userId, async (items) => {
    const result = applyTap(items, num, action, version, new Date());
    return { items: result.ok && result.state !== items ? result.state : null, result };
  });
}

// Who a run is for. Check now has the broker's Monday sign-in from their
// cookie; a scheduled run uses the copy kept for it (monday-link.ts). With
// neither (never signed in since, or Monday refused), the run still reads
// mail, sorts it and keeps Open Items current without Monday: people are
// known from the directory, deals are the directory's properties, and the
// report says Monday wasn't read.
interface RunFor {
  userId: string;
  brokerName: string;
  monday: Context | null;
  kind: RunKind;
  slot?: Slot;
}

export function checkNow(ctx: Context): Promise<Run> {
  return runAndSave({ userId: ctx.me.id, brokerName: ctx.me.name, monday: ctx, kind: "manual" });
}

export function historianFor(env = process.env): Historian | undefined {
  if (env.NODE_ENV !== "production" && env.DEV_HISTORY_FILE) return savedHistorian(env.DEV_HISTORY_FILE);
  if (env.NODE_ENV !== "production" && env.DEV_CLASSIFICATION_FILE) return undefined; // saved answers, no Claude: no history lines
  return env.BROKER_APP_ANTHROPIC_KEY ? claudeHistorian(new Anthropic({ apiKey: env.BROKER_APP_ANTHROPIC_KEY, authToken: null })) : undefined;
}

async function runAndSave(f: RunFor): Promise<Run> {
  const source = await mailSourceFor(f.userId);
  const state = (await readSealed<MonitorState>(stateKey(f.userId))) ?? { seen: {} };
  // The broker's directory (first-time scan): kept contacts' types fill in
  // for people Monday doesn't know, and kept properties group mail as deals.
  const directory = await directoryFor(f.userId);
  const bins = directoryBins(directory);
  const withDirectory = (people: Person[], known: Map<string, Known>) => {
    for (const p of people) {
      const bin = bins.get(p.address);
      if (bin && !known.has(p.address)) known.set(p.address, { bin } satisfies Known);
    }
    return known;
  };
  const ctx = f.monday;
  const { run, state: next, forItems } = await runCheck({
    source,
    classify: classifierFor(),
    brokerName: f.brokerName,
    history: historianFor(),
    monday: !!ctx,
    deals: async () => [...(ctx ? (await propertyLeadsFor(ctx)).map((l) => ({ id: l.id, name: l.name })) : []), ...directoryDeals(directory)],
    lookup: async (people) => {
      if (!ctx) return withDirectory(people, knownPeople(people, [], []));
      const known = await lookupInMonday(ctx, people);
      return known ? withDirectory(people, known) : null;
    },
  }, state);
  const outcome = await withItems(f.userId, async (items) => {
    const o = applyRun(items, forItems);
    return { items: o.state, result: o };
  });
  for (const item of run.items) item.num = outcome.nums[item.conversationId] ?? null;

  const now = forItems.now;
  const today = nyDate(now);
  const items = outcome.state.items;
  const byNum = new Map(items.map((i) => [i.num, i]));
  const line = (num: number, extra: Partial<ItemLine> = {}): ItemLine => {
    const i = byNum.get(num);
    return { num, title: i?.title ?? `#${num}`, tag: i ? viewOf(i, today).tag : null, ...extra };
  };
  const open = items.filter((i) => i.state === "open");
  const views = open.map((i) => ({ i, v: viewOf(i, today) }));
  run.openItems = {
    line: changeLine(outcome),
    droppingToday: outcome.changes.droppingToday,
    closed: outcome.changes.closed,
    open: open.length,
    high: views.filter(({ v }) => v.group === "high").length,
    changes: {
      added: outcome.changes.added.map((n) => line(n)),
      closed: outcome.changes.closed.map((c) => line(c.num, { by: c.by })),
      upgraded: outcome.changes.upgraded.map((n) => line(n)),
      pastDue: outcome.changes.pastDue.map((n) => line(n)),
      // Dropping soon is listed in every run while an item is at age 8 or 9 (spec 02).
      dropping: views.filter(({ v }) => v.group === "dropping" && !v.droppingToday).map(({ i }) => line(i.num)),
      droppingToday: outcome.changes.droppingToday.map((n) => line(n)),
    },
  };
  run.kind = f.kind;
  if (f.slot) run.slot = f.slot;
  run.nextFullList = nextFullList(now);
  if (f.kind === "full") {
    const order: ItemGroup[] = GROUP_ORDER.filter((g) => g !== "closed" && g !== "snoozed");
    run.openItems.openList = views
      .filter(({ v }) => order.includes(v.group))
      .sort((a, b) => order.indexOf(a.v.group) - order.indexOf(b.v.group) || a.v.daysLeft - b.v.daysLeft || a.i.num - b.i.num)
      .map(({ i }) => line(i.num));
    run.followUps = await followUps(f, source, bins, items, now);
  }

  const store = getStore();
  await store.set(runKey(f.userId), await sealer.seal(run), { px: RUN_TTL_MS });
  await store.set(stateKey(f.userId), await sealer.seal(next), { px: STATE_TTL_MS });
  return run;
}

// 7am follow-ups (spec 02 step 7): Waiting on them, from the last 10 business
// days of Sent mail, and Upcoming dates from open items. A failure leaves the
// list out; the run still saves.
async function followUps(f: RunFor, source: MailSource, bins: Map<string, string>, items: ItemsState["items"], now: Date): Promise<NonNullable<Run["followUps"]>> {
  const upcoming = upcomingDates(items, now);
  try {
    const since = new Date(now.getTime() - 16 * 24 * 60 * 60 * 1000); // covers 10 business days
    const messages = await (source.scanSince ? source.scanSince(since) : source.messagesSince(since));
    let monday: Map<string, Known> | null = null;
    if (f.monday) {
      const people = new Map<string, Person>();
      for (const m of messages) if (m.folder === "sent") for (const p of m.to) people.set(p.address, p);
      monday = await lookupInMonday(f.monday, [...people.values()]);
    }
    const waiting = waitingOnThem(messages, source.owner, (email) => monday?.get(email)?.bin ?? bins.get(email), now);
    return { waiting, upcoming };
  } catch (error) {
    console.error(`[email] follow-ups skipped: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    return { waiting: [], upcoming };
  }
}

// Monday as the broker for a scheduled run: their kept sign-in, renewed if
// needed. In development, a personal token (MONDAY_DEV_TOKEN) stands in, with
// writes limited to the test workspace as everywhere else.
export async function mondayContextFor(userId: string, fallbackName: string): Promise<Context | null> {
  try {
    const kept = await mondayTokensFor({ store: getStore(), sealer, refresh: (t) => refreshTokens(t) }, userId);
    if (kept) return { monday: mondayClient(kept.tokens.accessToken), sid: "scheduled", accountSlug: kept.accountSlug, me: { id: userId, name: kept.name } };
  } catch (error) {
    console.error(`[email] Monday not read for a scheduled run: ${error instanceof Error ? error.constructor.name : "unknown"}`);
  }
  if (process.env.NODE_ENV !== "production" && process.env.MONDAY_DEV_TOKEN) {
    return { monday: mondayClient(), sid: "scheduled", accountSlug: MONDAY_ACCOUNT_SLUG, me: { id: userId, name: fallbackName } };
  }
  return null;
}

// Development: run now as the schedule would, to try the 7am and changes
// views without waiting for the slot.
export async function tryScheduledRun(userId: string, brokerName: string, kind: "full" | "changes"): Promise<Run> {
  const monday = await mondayContextFor(userId, brokerName);
  return runAndSave({ userId, brokerName: monday?.me.name ?? brokerName, monday, kind, slot: kind === "full" ? "07:00" : "11:00" });
}

// ---- Scheduled runs ----

const slotKey = (userId: string, date: string, slot: Slot) => `email:slot:${userId}:${date}:${slot}`;

export interface SlotResult {
  userId: string;
  outcome: "ran" | "already ran" | "not connected" | "reconnect needed" | "failed";
}

// Everyone on the email monitor list, for the slot due now. Each broker's
// slot runs once (a store marker), so a late or repeated cron never runs it
// twice; a failed run clears its marker so the next firing can try again.
export async function runDueSlot(now = new Date(), users = process.env.EMAIL_MONITOR_USERS): Promise<{ slot: string | null; results: SlotResult[] }> {
  const due = dueSlot(now);
  if (!due) return { slot: null, results: [] };
  const store = getStore();
  const results: SlotResult[] = [];
  for (const userId of (users ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    let brokerName = "the broker";
    if (!devMailboxFile()) {
      const conn = await getConnection({ store }, userId);
      if (!conn) {
        results.push({ userId, outcome: "not connected" });
        continue;
      }
      if (conn.reconnectNeeded) {
        results.push({ userId, outcome: "reconnect needed" });
        continue;
      }
      brokerName = conn.name;
    }
    const key = slotKey(userId, due.date, due.slot);
    if (!(await store.set(key, 1, { px: 2 * 24 * 60 * 60 * 1000, nx: true }))) {
      results.push({ userId, outcome: "already ran" });
      continue;
    }
    try {
      const monday = await mondayContextFor(userId, brokerName);
      await runAndSave({ userId, brokerName: monday?.me.name ?? brokerName, monday, kind: due.kind, slot: due.slot });
      results.push({ userId, outcome: "ran" });
    } catch (error) {
      await store.del(key);
      console.error(`[email] scheduled run failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
      results.push({ userId, outcome: error instanceof ReconnectNeeded ? "reconnect needed" : "failed" });
    }
  }
  return { slot: `${due.date} ${due.slot}`, results };
}

// Development: start again from an empty state, so the made-up mail is sorted afresh.
export async function resetMonitor(userId: string) {
  await getStore().del(runKey(userId));
  await getStore().del(stateKey(userId));
  await getStore().del(itemsKey(userId));
}
