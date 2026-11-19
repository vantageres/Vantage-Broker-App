import type { ThreadAnswer } from "./classify";
import type { MailMessage, Person } from "./source";
import { isInternal, type Thread } from "./threads";

// Open items (spec 07, plan step 4): an email conversation that needs the
// broker stays on the list until it is resolved. All lifecycle logic is
// here, in code; Claude only supplies the title, what, action, waiting,
// importance and dates. Dates are YYYY-MM-DD in America/New_York; business
// days are Monday to Friday, holidays ignored (v1).

export type Importance = "high" | "normal";
export type ItemGroup = "high" | "normal" | "pastdue" | "dropping" | "colleague" | "snoozed" | "closed";
export type TapAction = "done" | "finished" | "keep" | "high" | "snooze" | "unsnooze" | "reopen";

export interface ItemEvent {
  on: string; // YYYY-MM-DD
  change: string;
  actor: "monitor" | "broker";
}

export interface OpenItem {
  num: number; // #N, never reused
  conversationId: string;
  title: string;
  dealId: string | null;
  deal: string | null;
  what: string;
  action: string | null;
  waiting: string | null;
  sender: string; // the other party's address
  senderName: string | null;
  webLink: string | null; // newest message; https only
  importance: Importance;
  raisedByBroker: boolean;
  due: string | null;
  escalated: boolean;
  overdue: boolean;
  delegatedTo: { name: string; address: string } | null;
  delegatedAt: string | null; // ISO, the forward
  state: "open" | "closed";
  opened: string;
  clockStart: string | null;
  keptCount: number;
  snoozeUntil: string | null;
  dropNoticeOn: string | null;
  closedAt: string | null; // ISO: the closing message, or the tap
  closedOn: string | null;
  closedBy: string | null;
  lastInboundAt: string; // ISO, latest message from the other party
  reopenedVersion: number; // version at the last reopen (a Done tap from before it loses)
  changedBy: "monitor" | "broker";
  version: number;
  history: ItemEvent[];
}

export interface ItemsState {
  nextNum: number;
  items: OpenItem[];
}

export const emptyItems = (): ItemsState => ({ nextNum: 1, items: [] });

const HISTORY_KEPT = 20;
const DROP_AGE = 10;
const DROPPING_AGE = 8;
const UPGRADE_AGE = 2;
const CLOSED_KEPT_DAYS = 5;

// ---- Dates ----

const asDate = (d: string) => new Date(`${d}T12:00:00Z`);
const asText = (d: Date) => d.toISOString().slice(0, 10);
const weekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

export function nyDate(at: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(typeof at === "string" ? new Date(at) : at);
}

// Business days after `from`, up to and including `to`.
export function businessDaysBetween(from: string, to: string): number {
  let n = 0;
  const d = asDate(from);
  for (;;) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (asText(d) > to) return n;
    if (!weekend(d)) n++;
  }
}

export function addBusinessDays(from: string, days: number): string {
  const d = asDate(from);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (!weekend(d)) left--;
  }
  return asText(d);
}

export const shortDay = (date: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(asDate(date));

export const ageOf = (item: OpenItem, today: string) => businessDaysBetween(item.clockStart ?? item.opened, today);

// A notice from before the clock restarted (Keep, Reopen) does not count.
function validNotice(item: OpenItem): string | null {
  return item.dropNoticeOn && item.dropNoticeOn >= (item.clockStart ?? item.opened) ? item.dropNoticeOn : null;
}

const snoozed = (item: OpenItem, today: string) => !!item.snoozeUntil && item.snoozeUntil > today;

// ---- What the screen shows (derived, never stored) ----

export interface ItemView {
  age: number;
  group: ItemGroup;
  tag: string | null;
  daysLeft: number;
  droppingToday: boolean;
}

export const GROUP_ORDER: ItemGroup[] = ["high", "normal", "pastdue", "dropping", "colleague", "snoozed", "closed"];

export function viewOf(item: OpenItem, today: string): ItemView {
  const age = ageOf(item, today);
  const notice = item.state === "open" ? validNotice(item) : null;
  const group: ItemGroup = item.state === "closed" ? "closed"
    : snoozed(item, today) ? "snoozed"
    : age >= DROPPING_AGE || notice ? "dropping"
    : item.overdue ? "pastdue"
    : item.delegatedTo ? "colleague"
    : item.importance === "high" || item.escalated ? "high"
    : "normal";
  const firstName = item.delegatedTo?.name.split(/\s+/)[0];
  const tag = item.state === "closed" ? `Closed ${shortDay(item.closedOn!)}`
    : notice ? "Drops today"
    : age >= DROPPING_AGE ? `Drops in ${DROP_AGE - age} day${DROP_AGE - age === 1 ? "" : "s"}`
    : item.overdue ? `Past due ${shortDay(item.due && item.due < today ? item.due : addBusinessDays(item.clockStart ?? item.opened, 1))}`
    : firstName ? `With ${firstName}`
    : snoozed(item, today) ? `Snoozed to ${shortDay(item.snoozeUntil!)}`
    : item.escalated ? "Upgraded to High"
    : item.due ? `Due ${shortDay(item.due)}`
    : null;
  return { age, group, tag, daysLeft: notice ? 0 : Math.max(0, DROP_AGE - age), droppingToday: !!notice };
}

export function closedRecently(item: OpenItem, today: string) {
  return item.state === "closed" && !!item.closedOn && businessDaysBetween(item.closedOn, today) <= CLOSED_KEPT_DAYS;
}

// Groups in display order; within a group, least time left first, then #.
export function grouped(items: OpenItem[], today: string) {
  const out = new Map<ItemGroup, { item: OpenItem; view: ItemView }[]>(GROUP_ORDER.map((g) => [g, []]));
  for (const item of items) {
    if (item.state === "closed" && !closedRecently(item, today)) continue;
    const view = viewOf(item, today);
    out.get(view.group)!.push({ item, view });
  }
  for (const list of out.values()) list.sort((a, b) => a.view.daysLeft - b.view.daysLeft || a.item.num - b.item.num);
  return out;
}

export function countsOf(items: OpenItem[], today: string) {
  const g = grouped(items, today);
  return {
    open: items.filter((i) => i.state === "open").length,
    high: g.get("high")!.length,
    normal: g.get("normal")!.length,
    pastdue: g.get("pastdue")!.length,
    dropping: g.get("dropping")!.length,
    colleague: g.get("colleague")!.length,
    snoozed: g.get("snoozed")!.length,
    closed: g.get("closed")!.length,
  };
}

// ---- A run (lifecycle rules 1 to 10) ----

export interface RunInput {
  now: Date;
  owner: Person;
  messages: MailMessage[]; // everything read in the window, inbox and Sent
  threads: Thread[]; // the threads Claude sorted
  answers: ThreadAnswer[]; // checked answers, one per thread
  dealName: Map<string, string>;
}

export interface RunChanges {
  added: number[];
  updated: number[];
  reopened: number[];
  closed: { num: number; by: string }[];
  delegated: number[];
  upgraded: number[];
  pastDue: number[];
  droppingToday: number[]; // every open item with a drop notice
  dropped: number[];
}

export interface RunOutcome {
  state: ItemsState;
  changes: RunChanges;
  nums: Record<string, number>; // conversation id -> #N
  open: number;
}

const people = (m: MailMessage) => [...m.to, ...m.cc];
const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// A message counts as the other party writing when it comes from the item's
// sender or from anyone outside Vantage. A colleague's message never reopens
// or refreshes an item; it can only close one (rule 4).
const fromOtherParty = (m: MailMessage, sender: string) => sameAddress(m.from.address, sender) || !isInternal(m.from.address);

function dueFrom(answer: ThreadAnswer, today: string): string | null {
  const dates = answer.dates.map((d) => d.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today).sort();
  return dates[0] ?? null;
}

function note(item: OpenItem, on: string, change: string, actor: ItemEvent["actor"]) {
  item.history.push({ on, change, actor });
  if (item.history.length > HISTORY_KEPT) item.history.splice(0, item.history.length - HISTORY_KEPT);
}

function close(item: OpenItem, at: string, by: string, actor: ItemEvent["actor"]) {
  item.state = "closed";
  item.closedAt = at;
  item.closedOn = nyDate(at);
  item.closedBy = by;
  item.snoozeUntil = null;
  note(item, nyDate(at), `Closed: ${by}`, actor);
}

function reopen(item: OpenItem, today: string, change: string, actor: ItemEvent["actor"]) {
  item.state = "open";
  item.clockStart = today;
  item.dropNoticeOn = null;
  item.closedAt = item.closedOn = item.closedBy = null;
  item.escalated = false;
  item.overdue = false;
  note(item, today, change, actor);
}

export function applyRun(before: ItemsState, input: RunInput): RunOutcome {
  const state: ItemsState = structuredClone(before);
  const today = nyDate(input.now);
  const changes: RunChanges = { added: [], updated: [], reopened: [], closed: [], delegated: [], upgraded: [], pastDue: [], droppingToday: [], dropped: [] };
  const touched = new Set<OpenItem>();
  const byConversation = new Map(state.items.map((i) => [i.conversationId, i]));
  const threadById = new Map(input.threads.map((t) => [t.conversationId, t]));
  const owner = input.owner.address;

  // Rule 1: snoozes that have ended.
  for (const item of state.items) {
    if (item.state === "open" && item.snoozeUntil && item.snoozeUntil <= today) {
      item.snoozeUntil = null;
      note(item, today, "Snooze ended", "monitor");
      touched.add(item);
    }
  }

  // Rules 5 and 6: match new threads to items, or create them.
  for (const answer of input.answers) {
    const t = threadById.get(answer.thread_id);
    if (!t || answer.importance === "noise" || !t.latestInbound) continue;
    const actionable = answer.importance === "high" || answer.importance === "normal";
    const importance: Importance = answer.group === "leads" || answer.importance === "high" ? "high" : "normal";
    const item = byConversation.get(t.conversationId);

    if (!item) {
      if (!actionable) continue;
      const external = t.inbound.filter((m) => !isInternal(m.from.address));
      const from = (external.at(-1) ?? t.latestInbound).from;
      const theirs = t.inbound.filter((m) => fromOtherParty(m, from.address));
      const created: OpenItem = {
        num: state.nextNum++,
        conversationId: t.conversationId,
        title: answer.title,
        dealId: answer.deal_id,
        deal: answer.deal_id ? input.dealName.get(answer.deal_id) ?? null : null,
        what: answer.what,
        action: answer.priority,
        waiting: answer.waiting,
        sender: from.address,
        senderName: from.name || null,
        webLink: safeHttps(t.webLink),
        importance,
        raisedByBroker: false,
        due: dueFrom(answer, today),
        escalated: false,
        overdue: false,
        delegatedTo: null,
        delegatedAt: null,
        state: "open",
        opened: today,
        clockStart: null,
        keptCount: 0,
        snoozeUntil: null,
        dropNoticeOn: null,
        closedAt: null,
        closedOn: null,
        closedBy: null,
        lastInboundAt: (theirs.at(-1) ?? t.latestInbound).at,
        reopenedVersion: 0,
        changedBy: "monitor",
        version: 0,
        history: [],
      };
      note(created, today, "Added by Check now", "monitor");
      for (const m of theirs.slice(1)) note(created, today, `New message ${shortDay(nyDate(m.at))}`, "monitor");
      state.items.push(created);
      byConversation.set(created.conversationId, created);
      changes.added.push(created.num);
      touched.add(created);
      continue;
    }

    const fresh = t.inbound.filter((m) => fromOtherParty(m, item.sender) && m.at > item.lastInboundAt && (item.state === "open" || m.at > (item.closedAt ?? "")));
    if (!fresh.length) continue;
    if (item.state === "closed") {
      if (!actionable) continue;
      reopen(item, today, "Reopened by new message", "monitor");
      item.delegatedTo = null;
      item.delegatedAt = null;
      item.reopenedVersion = item.version + 1;
      changes.reopened.push(item.num);
    } else {
      changes.updated.push(item.num);
    }
    for (const m of fresh) note(item, today, `New message ${shortDay(nyDate(m.at))}`, "monitor");
    item.lastInboundAt = fresh.at(-1)!.at;
    item.webLink = safeHttps(t.webLink) ?? item.webLink;
    if (actionable) {
      item.title = answer.title;
      item.what = answer.what;
      item.waiting = answer.waiting;
      if (!item.delegatedTo) item.action = answer.priority;
      item.due = dueFrom(answer, today) ?? item.due;
      if (answer.deal_id) {
        item.dealId = answer.deal_id;
        item.deal = input.dealName.get(answer.deal_id) ?? item.deal;
      }
      if (importance === "high" && item.importance === "normal") {
        item.importance = "high";
        note(item, today, "Raised to High by a new message", "monitor");
      }
    }
    touched.add(item);
  }

  // Rules 2, 3 and 4: replies, forwards and colleagues, oldest message first.
  const inWindow = new Map<string, MailMessage[]>();
  for (const m of input.messages) inWindow.set(m.conversationId, [...(inWindow.get(m.conversationId) ?? []), m]);
  for (const item of state.items) {
    if (item.state !== "open") continue;
    const list = (inWindow.get(item.conversationId) ?? []).slice().sort((a, b) => a.at.localeCompare(b.at));
    for (const m of list) {
      if (item.state !== "open") break;
      if (m.folder === "sent") {
        if (m.at <= item.lastInboundAt) continue;
        if (people(m).some((p) => sameAddress(p.address, item.sender))) {
          close(item, m.at, "your email reply", "monitor");
          changes.closed.push({ num: item.num, by: item.closedBy! });
          touched.add(item);
        } else if (/^\s*(fw|fwd)\s*:/i.test(m.subject) && people(m).length && people(m).every((p) => isInternal(p.address))
          && (!item.delegatedAt || m.at > item.delegatedAt)) {
          const to = people(m)[0];
          const name = to.name || to.address;
          item.delegatedTo = { name, address: to.address };
          item.delegatedAt = m.at;
          item.action = `Confirm ${name} completed this.`;
          note(item, nyDate(m.at), `Forwarded to ${name}`, "monitor");
          changes.delegated.push(item.num);
          touched.add(item);
        }
        continue;
      }
      const from = m.from.address;
      if (sameAddress(from, owner) || !isInternal(from) || sameAddress(from, item.sender)) continue;
      const delegateAnswered = !!item.delegatedTo && sameAddress(from, item.delegatedTo.address) && m.at > (item.delegatedAt ?? "");
      const colleagueAnswered = m.at > item.lastInboundAt && people(m).some((p) => sameAddress(p.address, item.sender));
      if (delegateAnswered || colleagueAnswered) {
        close(item, m.at, `${m.from.name || from} by email`, "monitor");
        changes.closed.push({ num: item.num, by: item.closedBy! });
        touched.add(item);
      }
    }
  }

  // Rules 7 to 10: age. Snoozed items skip them until the snooze ends.
  for (const item of state.items) {
    if (item.state !== "open" || snoozed(item, today)) continue;
    const age = ageOf(item, today);
    if (item.importance === "normal" && !item.escalated && age >= UPGRADE_AGE) {
      item.escalated = true;
      note(item, today, "Upgraded to High after 2 business days", "monitor");
      changes.upgraded.push(item.num);
      touched.add(item);
    }
    const reason = item.due && item.due < today ? `Past due: due ${shortDay(item.due)}`
      : (item.importance === "high" || item.escalated) && age >= 1 ? "Past due: no reply after 1 business day"
      : null;
    if (reason && !item.overdue) {
      item.overdue = true;
      note(item, today, reason, "monitor");
      changes.pastDue.push(item.num);
      touched.add(item);
    } else if (!reason && item.overdue) {
      item.overdue = false;
      touched.add(item);
    }
    const notice = validNotice(item);
    if (notice && today >= addBusinessDays(notice, 1)) {
      close(item, input.now.toISOString(), "dropped after 10 business days", "monitor");
      changes.dropped.push(item.num);
      changes.closed.push({ num: item.num, by: item.closedBy! });
      touched.add(item);
      continue;
    }
    if (!notice && age >= DROP_AGE) {
      item.dropNoticeOn = today;
      note(item, today, "Dropping today: shown in Check now", "monitor");
      touched.add(item);
    }
    if (validNotice(item)) changes.droppingToday.push(item.num);
  }

  for (const item of touched) {
    item.version++;
    item.changedBy = "monitor";
  }
  state.items = state.items.filter((i) => i.state === "open" || closedRecently(i, today));

  const nums: Record<string, number> = {};
  for (const i of state.items) nums[i.conversationId] = i.num;
  return { state, changes, nums, open: state.items.filter((i) => i.state === "open").length };
}

export function safeHttps(link: string | undefined | null): string | null {
  if (!link) return null;
  try {
    return new URL(link).protocol === "https:" ? link : null;
  } catch {
    return null;
  }
}

// "12 open, 2 new, 3 closed, 1 upgraded, 1 dropping"
export function changeLine(outcome: { open: number; changes: RunChanges }): string {
  const c = outcome.changes;
  const parts = [`${outcome.open} open`];
  if (c.added.length) parts.push(`${c.added.length} new`);
  if (c.reopened.length) parts.push(`${c.reopened.length} reopened`);
  if (c.closed.length) parts.push(`${c.closed.length} closed`);
  if (c.upgraded.length) parts.push(`${c.upgraded.length} upgraded`);
  if (c.pastDue.length) parts.push(`${c.pastDue.length} past due`);
  if (c.droppingToday.length) parts.push(`${c.droppingToday.length} dropping`);
  return parts.join(", ");
}

// ---- Broker taps ----

export type TapResult =
  | { ok: true; state: ItemsState; item: OpenItem }
  | { ok: false; conflict: true; item: OpenItem }
  | { ok: false; conflict: false; error: string };

export function applyTap(before: ItemsState, num: number, action: TapAction, version: number, now: Date): TapResult {
  const state: ItemsState = structuredClone(before);
  const item = state.items.find((i) => i.num === num);
  if (!item) return { ok: false, conflict: false, error: "That item is no longer on the list." };
  const today = nyDate(now);
  const closing = action === "done" || action === "finished";

  if (item.version !== version) {
    // Done wins over a run's update, unless the run reopened the item after the screen loaded (OI14).
    const doneStillFits = closing && item.state === "open" && item.reopenedVersion <= version;
    if (closing && item.state === "closed" && item.reopenedVersion <= version) return { ok: true, state: before, item };
    if (!doneStillFits) return { ok: false, conflict: true, item };
  }

  const refuse = (error: string): TapResult => ({ ok: false, conflict: false, error });
  switch (action) {
    case "done":
      if (item.state !== "open") return refuse("That item is already closed.");
      close(item, now.toISOString(), "you (Done)", "broker");
      break;
    case "finished":
      if (item.state !== "open") return refuse("That item is already closed.");
      close(item, now.toISOString(), `${item.delegatedTo?.name ?? "A colleague"} (you confirmed)`, "broker");
      break;
    case "keep":
      if (item.state !== "open") return refuse("That item is closed.");
      item.clockStart = today;
      item.keptCount++;
      item.dropNoticeOn = null;
      note(item, today, "Kept 10 more days", "broker");
      break;
    case "high":
      if (item.state !== "open" || item.importance === "high" || item.escalated) return refuse("That item is already High.");
      item.importance = "high";
      item.raisedByBroker = true;
      note(item, today, "Made High", "broker");
      break;
    case "snooze":
      if (item.state !== "open") return refuse("That item is closed.");
      item.snoozeUntil = addBusinessDays(today, 1);
      note(item, today, `Snoozed to ${shortDay(item.snoozeUntil)}`, "broker");
      break;
    case "unsnooze":
      if (item.state !== "open" || !item.snoozeUntil) return refuse("That item is not snoozed.");
      item.snoozeUntil = null;
      note(item, today, "Unsnoozed", "broker");
      break;
    case "reopen":
      if (!closedRecently(item, today)) return refuse("That item can't be reopened.");
      reopen(item, today, "Reopened", "broker");
      break;
  }
  item.version++;
  item.changedBy = "broker";
  return { ok: true, state, item };
}
