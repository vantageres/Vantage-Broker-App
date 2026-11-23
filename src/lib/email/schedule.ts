import { addBusinessDays, businessDaysBetween, nyDate, shortDay, type OpenItem } from "./open-items";
import type { MailMessage, Person } from "./source";

// Scheduled runs (plan step 7, spec 02 "Schedule and window"): a cron fires
// every 15 minutes in UTC; the slot is worked out here in America/New_York,
// so daylight saving never shifts it. Weekdays 7am (FULL: the whole open
// list and follow-ups), 11am, 3pm and 7pm (CHANGES). Business days ignore
// holidays (v1).

export const SLOTS = ["07:00", "11:00", "15:00", "19:00"] as const;
export type Slot = (typeof SLOTS)[number];
export type RunKind = "full" | "changes" | "manual";

// A slot still runs if the cron fires within this long after it (a missed or
// late cron catches up on the next firing, never twice).
const GRACE_MINUTES = 60;

const nyParts = (at: Date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { weekday: get("weekday"), minutes: Number(get("hour")) * 60 + Number(get("minute")) };
};

// The slot due now, or null outside one.
export function dueSlot(now: Date): { date: string; slot: Slot; kind: "full" | "changes" } | null {
  const { weekday, minutes } = nyParts(now);
  if (weekday === "Sat" || weekday === "Sun") return null;
  for (const slot of [...SLOTS].reverse()) {
    const [h, m] = slot.split(":").map(Number);
    const since = minutes - (h * 60 + m);
    if (since >= 0 && since < GRACE_MINUTES) return { date: nyDate(now), slot, kind: slot === "07:00" ? "full" : "changes" };
  }
  return null;
}

export function nextFullList(now: Date): string {
  const today = nyDate(now);
  const { weekday, minutes } = nyParts(now);
  const beforeSevenOnWeekday = weekday !== "Sat" && weekday !== "Sun" && minutes < 7 * 60;
  return beforeSevenOnWeekday ? "7am today" : `7am ${shortDay(addBusinessDays(today, 1))}`;
}

export const slotLabel = (slot: Slot) => ({ "07:00": "7am", "11:00": "11am", "15:00": "3pm", "19:00": "7pm" })[slot];

// ---- Follow-ups (7am only) ----

// Waiting on them: mail the broker sent 3 to 10 business days ago to a
// Client, Prospect, Attorney or Lender, with nothing back since in that
// conversation. At most 10. Only who and when are kept, never the subject.
export const WAITING_BINS = ["Client", "Prospect", "Attorney", "Lender"];

export interface Waiting {
  name: string;
  email: string;
  sentOn: string; // YYYY-MM-DD
  businessDays: number;
  webLink: string | null;
}

export function waitingOnThem(messages: MailMessage[], owner: Person, binOf: (email: string) => string | undefined, now: Date): Waiting[] {
  const today = nyDate(now);
  const byConversation = new Map<string, MailMessage[]>();
  for (const m of messages) byConversation.set(m.conversationId, [...(byConversation.get(m.conversationId) ?? []), m]);
  const out: Waiting[] = [];
  for (const list of byConversation.values()) {
    const sent = list.filter((m) => m.folder === "sent").sort((a, b) => b.at.localeCompare(a.at))[0];
    if (!sent) continue;
    const days = businessDaysBetween(nyDate(sent.at), today);
    if (days < 3 || days > 10) continue;
    const answered = list.some((m) => m.folder === "inbox" && m.from.address !== owner.address && m.at > sent.at);
    if (answered) continue;
    const to = sent.to.find((p) => WAITING_BINS.includes(binOf(p.address) ?? ""));
    if (!to) continue;
    out.push({ name: to.name || to.address, email: to.address, sentOn: nyDate(sent.at), businessDays: days, webLink: sent.webLink?.startsWith("https:") ? sent.webLink : null });
  }
  return out.sort((a, b) => b.businessDays - a.businessDays).slice(0, 10);
}

// Upcoming dates: open items due in the next 14 days.
export function upcomingDates(items: OpenItem[], now: Date): { num: number; title: string; due: string }[] {
  const today = nyDate(now);
  const until = new Date(`${today}T12:00:00Z`);
  until.setUTCDate(until.getUTCDate() + 14);
  const last = until.toISOString().slice(0, 10);
  return items
    .filter((i) => i.state === "open" && i.due && i.due >= today && i.due <= last)
    .sort((a, b) => a.due!.localeCompare(b.due!) || a.num - b.num)
    .map((i) => ({ num: i.num, title: i.title, due: i.due! }));
}

// History lines are at most 35 words (spec, history-line schema).
export function capWords(text: string, max = 35): string {
  const words = text.trim().split(/\s+/);
  return words.length <= max ? text.trim() : `${words.slice(0, max).join(" ")}…`;
}
