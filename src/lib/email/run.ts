import { checkAnswers, type Classifier, type Deal, type ThreadAnswer } from "./classify";
import type { Known } from "./people";
import type { NoiseKind } from "./noise";
import type { MailSource, Person } from "./source";
import { sortMail } from "./threads";

// One "Check now" run (plan step 3): read mail since the last run, filter
// noise in code, look people up, have Claude sort what is left, and keep a
// summary. Summaries only: no email bodies are kept.

export type Group = "leads" | "deal" | "other" | "internal_broker" | "internal_staff";

export interface RunItem {
  conversationId: string;
  group: Group;
  dealId: string | null;
  dealName: string | null;
  internal: boolean;
  importance: "high" | "normal" | "fyi";
  title: string;
  what: string;
  priority: string | null;
  waiting: string | null;
  dates: { date: string; what: string }[];
  youRepliedAt: string | null;
  webLink: string | null;
  lead: ThreadAnswer["lead"];
  inMonday: Known["inMonday"][]; // people on the thread already in Monday
}

export interface NewContact {
  name: string | null;
  email: string;
  company: string | null;
  proposedBin: string;
  confidence: "high" | "low";
}

export interface Run {
  at: string;
  windowStart: string;
  windowEnd: string;
  source: MailSource["kind"];
  mailbox: string;
  counts: { high: number; normal: number; fyi: number; noise: number };
  noise: Partial<Record<NoiseKind | "sorted as noise", number>>;
  items: RunItem[];
  newContacts: NewContact[];
  mondayChecked: boolean;
}

export interface MonitorState {
  lastRunEnd?: string;
  seen: Record<string, string>; // message id -> when first seen (ISO); kept 14 days
}

export interface RunDeps {
  source: MailSource;
  classify: Classifier;
  brokerName: string;
  deals: () => Promise<Deal[]>;
  // Who the addresses are (Monday, internal domains). Null when Monday could not be read.
  lookup: (people: Person[]) => Promise<Map<string, Known> | null>;
  now?: () => Date;
}

const OVERLAP_MS = 10 * 60 * 1000;
const SEEN_DAYS = 14;
const NEW_CONTACTS_MAX = 10;

export function todayInNewJersey(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

// The first run looks back one business day (Monday looks back to Friday).
export function previousBusinessDay(now: Date): Date {
  const d = new Date(now);
  do d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d;
}

// Window start: the last run's end minus a 10-minute overlap for late mail.
export function windowStart(state: MonitorState, now: Date): Date {
  return state.lastRunEnd ? new Date(new Date(state.lastRunEnd).getTime() - OVERLAP_MS) : previousBusinessDay(now);
}

// Only https links to Outlook are shown.
export function safeLink(link: string | undefined): string | null {
  if (!link) return null;
  try {
    const url = new URL(link);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

const GROUP_ORDER: Group[] = ["leads", "deal", "other", "internal_broker", "internal_staff"];
const IMPORTANCE_ORDER = { high: 0, normal: 1, fyi: 2 } as const;

export function orderItems(items: RunItem[]): RunItem[] {
  const dealsWithHigh = new Set(items.filter((i) => i.group === "deal" && i.importance === "high").map((i) => i.dealId));
  return [...items].sort((a, b) =>
    GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)
    || (a.group === "deal" ? Number(!dealsWithHigh.has(a.dealId)) - Number(!dealsWithHigh.has(b.dealId)) || (a.dealName ?? "").localeCompare(b.dealName ?? "") : 0)
    || IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance]);
}

export async function runCheck(deps: RunDeps, state: MonitorState): Promise<{ run: Run; state: MonitorState }> {
  const now = (deps.now ?? (() => new Date()))();
  const start = windowStart(state, now);
  const messages = await deps.source.messagesSince(start);
  const owner = deps.source.owner;
  const seen = new Set(Object.keys(state.seen));
  const sorted = sortMail(messages, owner, seen);

  const people = new Map<string, Person>();
  for (const t of sorted.threads) for (const p of t.participants) people.set(p.address, p);
  const [known, deals] = await Promise.all([deps.lookup([...people.values()]), deps.deals()]);
  const knownMap = known ?? new Map<string, Known>();

  let answers: ThreadAnswer[] = [];
  if (sorted.threads.length) {
    const ids = sorted.threads.flatMap((t) => t.messages.filter((m) => m.folder === "inbox").map((m) => m.id));
    const bodies = await deps.source.bodies(ids);
    answers = await deps.classify({ brokerName: deps.brokerName, today: todayInNewJersey(now), deals, threads: sorted.threads, known: knownMap }, bodies);
  }
  const checked = checkAnswers(sorted.threads, answers, deals);
  const dealName = new Map(deals.map((d) => [d.id, d.name]));
  const threadById = new Map(sorted.threads.map((t) => [t.conversationId, t]));

  const noise: Run["noise"] = { ...sorted.noise };
  const items: RunItem[] = [];
  const contacts = new Map<string, NewContact>();
  for (const a of checked) {
    const t = threadById.get(a.thread_id)!;
    if (a.importance === "noise") {
      noise["sorted as noise"] = (noise["sorted as noise"] ?? 0) + 1;
      continue;
    }
    for (const c of a.new_contacts) {
      const email = c.email.toLowerCase();
      if (!knownMap.has(email) && !contacts.has(email) && contacts.size < NEW_CONTACTS_MAX) {
        contacts.set(email, { name: c.name, email, company: c.company, proposedBin: c.proposed_bin, confidence: c.confidence });
      }
    }
    items.push({
      conversationId: a.thread_id,
      group: a.group,
      dealId: a.deal_id,
      dealName: a.deal_id ? dealName.get(a.deal_id) ?? null : null,
      internal: a.internal,
      importance: a.importance,
      title: a.title,
      what: a.what,
      priority: a.priority,
      waiting: a.waiting,
      dates: a.dates,
      youRepliedAt: t.brokerRepliedAt,
      webLink: safeLink(t.webLink),
      lead: a.lead,
      inMonday: t.participants.map((p) => knownMap.get(p.address)?.inMonday).filter((m): m is NonNullable<typeof m> => !!m),
    });
  }

  const ordered = orderItems(items);
  const noiseTotal = Object.values(noise).reduce((s, n) => s + (n ?? 0), 0);
  const run: Run = {
    at: now.toISOString(),
    windowStart: start.toISOString(),
    windowEnd: now.toISOString(),
    source: deps.source.kind,
    mailbox: owner.address,
    counts: {
      high: ordered.filter((i) => i.importance === "high").length,
      normal: ordered.filter((i) => i.importance === "normal").length,
      fyi: ordered.filter((i) => i.importance === "fyi").length,
      noise: noiseTotal,
    },
    noise,
    items: ordered,
    newContacts: [...contacts.values()],
    mondayChecked: known !== null,
  };

  // Every received message in the window counts as seen, so the overlap never sorts it twice.
  const cutoff = now.getTime() - SEEN_DAYS * 24 * 60 * 60 * 1000;
  const nextSeen: Record<string, string> = {};
  for (const [id, at] of Object.entries(state.seen)) if (new Date(at).getTime() >= cutoff) nextSeen[id] = at;
  for (const m of messages) if (m.folder === "inbox" && !nextSeen[m.id]) nextSeen[m.id] = now.toISOString();

  return { run, state: { lastRunEnd: now.toISOString(), seen: nextSeen } };
}
