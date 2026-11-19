import { describe, expect, it } from "vitest";
import type { ThreadAnswer } from "./classify";
import {
  addBusinessDays, applyRun, applyTap, businessDaysBetween, changeLine, countsOf, emptyItems, grouped, viewOf,
  type ItemsState, type OpenItem,
} from "./open-items";
import type { MailMessage, Person } from "./source";
import { sortMail } from "./threads";

// Spec 07 lifecycle, acceptance tests OI1 to OI16 (06-acceptance-tests.md),
// on fixed dates. Mon Nov 16, 2026 is day 0. Tasks the broker adds (OI17,
// OI18) come with Add task, later.

const owner: Person = { name: "Test Broker", address: "test.broker@vantageres.com" };
const client: Person = { name: "Mike Ruiz", address: "mike@cbre.example" };
const alka: Person = { name: "Alka Pema", address: "alka.pema@vantagepm.com" };
const emily: Person = { name: "Emily Stein", address: "emily.stein@vantageres.com" };

// Noon in New Jersey on a November day (EST, UTC-5).
const at = (day: number, hour = 12) => new Date(Date.UTC(2026, 10, day, hour + 5)).toISOString();
const when = (day: number, hour = 12) => new Date(at(day, hour));

let n = 0;
const mail = (over: Partial<MailMessage>): MailMessage => ({
  id: `m${++n}`, conversationId: "c1", folder: "inbox", subject: "LOI counter", from: client, to: [owner], cc: [],
  at: at(16, 9), preview: "", webLink: "https://outlook.office.com/mail/1", ...over,
});

const answer = (threadId: string, over: Partial<ThreadAnswer> = {}): ThreadAnswer => ({
  thread_id: threadId, group: "other", deal_id: null, internal: false, importance: "high", title: "LOI counter response",
  what: "Mike sent a counter.", priority: "Respond to the counter.", waiting: "Outside broker waiting on you", dates: [],
  new_contacts: [], lead: null, ...over,
});

// One run: sort the window's mail like Check now does, answer every thread
// the same way unless told otherwise, and apply the lifecycle.
function run(state: ItemsState, now: Date, messages: MailMessage[], answers: Record<string, Partial<ThreadAnswer>> = {}, seen = new Set<string>()) {
  const sorted = sortMail(messages, owner, seen);
  return applyRun(state, {
    now,
    owner,
    messages,
    threads: sorted.threads,
    answers: sorted.threads.map((t) => answer(t.conversationId, answers[t.conversationId])),
    dealName: new Map([["d1", "400 Commerce Dr Listing"]]),
  });
}

const only = (s: ItemsState) => {
  expect(s.items).toHaveLength(1);
  return s.items[0];
};

// A High item from Monday 9am, added by a run at noon.
function highItem() {
  const first = mail({});
  const out = run(emptyItems(), when(16), [first]);
  return { state: out.state, first, seen: new Set([first.id]) };
}

describe("business days", () => {
  it("counts Monday to Friday and skips weekends", () => {
    expect(businessDaysBetween("2026-11-16", "2026-11-16")).toBe(0);
    expect(businessDaysBetween("2026-11-16", "2026-11-17")).toBe(1);
    expect(businessDaysBetween("2026-11-20", "2026-11-23")).toBe(1); // Fri to Mon
    expect(businessDaysBetween("2026-11-16", "2026-11-30")).toBe(10);
    expect(addBusinessDays("2026-11-20", 1)).toBe("2026-11-23");
  });
});

describe("open items: creating and matching", () => {
  it("a High thread creates item #1; FYI and noise never do", () => {
    const out = run(emptyItems(), when(16), [
      mail({ conversationId: "a" }), mail({ conversationId: "b", subject: "FYI" }), mail({ conversationId: "c", subject: "Promo" }),
    ], { b: { importance: "fyi" }, c: { importance: "noise" } });
    const item = only(out.state);
    expect(item).toMatchObject({ num: 1, conversationId: "a", sender: client.address, importance: "high", state: "open", opened: "2026-11-16" });
    expect(out.nums).toEqual({ a: 1 });
    expect(changeLine(out)).toBe("1 open, 1 new");
  });

  it("leads become items only as High", () => {
    const out = run(emptyItems(), when(16), [mail({})], { c1: { group: "leads", importance: "normal" } });
    expect(only(out.state).importance).toBe("high");
  });

  it("numbers are never reused", () => {
    const { state } = highItem();
    const done = applyTap(state, 1, "done", 1, when(16, 13));
    if (!done.ok) throw new Error("tap failed");
    const out = run(done.state, when(17), [mail({ conversationId: "c2" })]);
    expect(out.state.items.map((i) => i.num)).toEqual([1, 2]);
  });

  it("OI16: three new messages in one window make one item with three events", () => {
    const out = run(emptyItems(), when(16), [mail({ at: at(16, 8) }), mail({ at: at(16, 9) }), mail({ at: at(16, 10) })]);
    const item = only(out.state);
    expect(item.history.map((e) => e.change)).toEqual(["Added by Check now", "New message Nov 16", "New message Nov 16"]);
  });

  it("a new message on an open item refreshes it, never lowers importance, and keeps the newest link", () => {
    const { state, seen } = highItem();
    const next = mail({ at: at(17, 9), webLink: "https://outlook.office.com/mail/2" });
    const out = run(state, when(17, 10), [next], { c1: { importance: "normal", what: "Mike sent a new date.", dates: [{ date: "2026-11-20", what: "Response due" }] } }, seen);
    const item = only(out.state);
    expect(item).toMatchObject({ importance: "high", what: "Mike sent a new date.", due: "2026-11-20", webLink: "https://outlook.office.com/mail/2" });
    expect(out.changes.updated).toEqual([1]);
  });

  it("links that are not https are dropped", () => {
    const out = run(emptyItems(), when(16), [mail({ webLink: "javascript:alert(1)" })]);
    expect(only(out.state).webLink).toBeNull();
  });
});

describe("open items: closing by email", () => {
  it("OI1: a High item reported at 7am with no reply by 11am is still open, and Past due once its age is 1", () => {
    const first = mail({ at: at(16, 6) });
    const morning = run(emptyItems(), when(16, 7), [first]);
    const late = run(morning.state, when(16, 11), [first], {}, new Set([first.id]));
    expect(only(late.state)).toMatchObject({ state: "open", overdue: false });
    const nextDay = run(late.state, when(17, 7), [], {}, new Set([first.id]));
    expect(only(nextDay.state).overdue).toBe(true);
    expect(nextDay.changes.pastDue).toEqual([1]);
    expect(viewOf(only(nextDay.state), "2026-11-17")).toMatchObject({ group: "pastdue", tag: "Past due Nov 17" });
  });

  it("OI2: the broker replies to the sender in the same conversation: closed, \"your email reply\"", () => {
    const { state, seen } = highItem();
    const reply = mail({ folder: "sent", from: owner, to: [client], at: at(16, 14), subject: "RE: LOI counter" });
    const out = run(state, when(16, 15), [reply], {}, seen);
    expect(only(out.state)).toMatchObject({ state: "closed", closedBy: "your email reply", closedOn: "2026-11-16" });
    expect(out.changes.closed).toEqual([{ num: 1, by: "your email reply" }]);
    expect(viewOf(only(out.state), "2026-11-16").group).toBe("closed");
  });

  it("a reply in the same window as the first message closes the new item at once", () => {
    const out = run(emptyItems(), when(16, 15), [mail({}), mail({ folder: "sent", from: owner, to: [client], at: at(16, 14) })]);
    expect(only(out.state).state).toBe("closed");
  });

  it("a reply to someone else does not close it", () => {
    const { state, seen } = highItem();
    const out = run(state, when(16, 15), [mail({ folder: "sent", from: owner, to: [{ name: "X", address: "x@other.example" }], at: at(16, 14) })], {}, seen);
    expect(only(out.state).state).toBe("open");
  });

  it("OI3: forwarded only to Alka: stays open, \"With Alka\", action to confirm", () => {
    const { state, seen } = highItem();
    const fw = mail({ folder: "sent", from: owner, to: [alka], at: at(16, 14), subject: "FW: LOI counter" });
    const out = run(state, when(16, 15), [fw], {}, seen);
    const item = only(out.state);
    expect(item).toMatchObject({ state: "open", delegatedTo: { name: "Alka Pema" }, action: "Confirm Alka Pema completed this." });
    expect(viewOf(item, "2026-11-16")).toMatchObject({ group: "colleague", tag: "With Alka" });
  });

  it("a forward that includes someone outside Vantage is not a delegation", () => {
    const { state, seen } = highItem();
    const fw = mail({ folder: "sent", from: owner, to: [alka, { name: "Y", address: "y@other.example" }], at: at(16, 14), subject: "Fwd: LOI counter" });
    expect(only(run(state, when(16, 15), [fw], {}, seen).state).delegatedTo).toBeNull();
  });

  it("OI4: Alka then replies in that conversation: closed, \"Alka Pema by email\"", () => {
    const { state, seen } = highItem();
    const fw = mail({ folder: "sent", from: owner, to: [alka], at: at(16, 14), subject: "FW: LOI counter" });
    const forwarded = run(state, when(16, 15), [fw], {}, seen);
    const answerBack = mail({ from: alka, to: [owner], at: at(17, 9), subject: "RE: FW: LOI counter" });
    const out = run(forwarded.state, when(17, 10), [answerBack], { c1: { importance: "fyi" } }, seen);
    expect(only(out.state)).toMatchObject({ state: "closed", closedBy: "Alka Pema by email" });
  });

  it("a colleague replies to the client and copies the broker: closed, and it does not reopen itself", () => {
    const { state, seen } = highItem();
    const colleague = mail({ from: emily, to: [client], cc: [owner], at: at(16, 14), subject: "RE: LOI counter" });
    const out = run(state, when(16, 15), [colleague], {}, seen);
    expect(only(out.state)).toMatchObject({ state: "closed", closedBy: "Emily Stein by email" });
    expect(out.changes.reopened).toEqual([]);
  });

  it("a colleague writing only to the broker does not close it", () => {
    const { state, seen } = highItem();
    const note = mail({ from: emily, to: [owner], at: at(16, 14), subject: "RE: LOI counter" });
    expect(only(run(state, when(16, 15), [note], {}, seen).state).state).toBe("open");
  });

  it("OI13: a new message on a closed item reopens it, with the clock restarted", () => {
    const { state, seen } = highItem();
    const reply = mail({ folder: "sent", from: owner, to: [client], at: at(16, 14) });
    const closed = run(state, when(16, 15), [reply], {}, seen);
    const again = mail({ at: at(18, 9) });
    const out = run(closed.state, when(18, 10), [again], {}, seen);
    const item = only(out.state);
    expect(item).toMatchObject({ state: "open", clockStart: "2026-11-18", closedBy: null });
    expect(item.history.map((e) => e.change)).toContain("Reopened by new message");
    expect(out.changes.reopened).toEqual([1]);
  });

  it("the 10-minute overlap does not reopen an item on a message it already counted", () => {
    const { state, first } = highItem();
    const done = applyTap(state, 1, "done", 1, when(16, 13));
    if (!done.ok) throw new Error("tap failed");
    const out = run(done.state, when(16, 15), [first]); // not marked seen: sorted again
    expect(only(out.state).state).toBe("closed");
  });
});

describe("open items: age", () => {
  const normalItem = () => run(emptyItems(), when(16), [mail({})], { c1: { importance: "normal" } });

  it("OI6: a Normal item at age 2 is upgraded and grouped High", () => {
    const day1 = run(normalItem().state, when(17), []);
    expect(only(day1.state).escalated).toBe(false);
    expect(viewOf(only(day1.state), "2026-11-17").group).toBe("normal");
    const day2 = run(day1.state, when(18), []);
    expect(only(day2.state).escalated).toBe(true);
    expect(day2.changes.upgraded).toEqual([1]);
    expect(only(day2.state).history.map((e) => e.change)).toContain("Upgraded to High after 2 business days");
  });

  it("OI7: an item due yesterday is Past due with that date", () => {
    const out = run(emptyItems(), when(16), [mail({})], { c1: { importance: "normal", dates: [{ date: "2026-11-17", what: "Response" }] } });
    const next = run(out.state, when(18), []);
    expect(only(next.state).overdue).toBe(true);
    expect(viewOf(only(next.state), "2026-11-18").tag).toBe("Past due Nov 17");
  });

  it("OI8: at age 8 it is Dropping soon, \"Drops in 2 days\"", () => {
    const out = run(normalItem().state, when(26), []);
    expect(viewOf(only(out.state), "2026-11-26")).toMatchObject({ group: "dropping", tag: "Drops in 2 days" });
  });

  it("OI9 and OI10: at age 10 it gets a notice; the next business day it drops", () => {
    const notice = run(highItem().state, when(30), []);
    expect(only(notice.state)).toMatchObject({ state: "open", dropNoticeOn: "2026-11-30" });
    expect(notice.changes.droppingToday).toEqual([1]);
    expect(viewOf(only(notice.state), "2026-11-30").tag).toBe("Drops today");
    const later = run(notice.state, when(30, 16), []);
    expect(only(later.state).state).toBe("open");
    const dropped = run(later.state, new Date(Date.UTC(2026, 11, 1, 14)), []);
    expect(only(dropped.state)).toMatchObject({ state: "closed", closedBy: "dropped after 10 business days" });
    expect(dropped.changes.dropped).toEqual([1]);
  });

  it("OI11: Keep after the notice restarts the clock; at the new age 10 it gets a fresh notice", () => {
    const notice = run(highItem().state, when(30), []);
    const item = only(notice.state);
    const kept = applyTap(notice.state, 1, "keep", item.version, when(30, 14));
    if (!kept.ok) throw new Error("tap failed");
    expect(kept.item).toMatchObject({ clockStart: "2026-11-30", dropNoticeOn: null, keptCount: 1 });
    const nextDay = run(kept.state, new Date(Date.UTC(2026, 11, 1, 14)), []);
    expect(only(nextDay.state).state).toBe("open");
    const tenLater = run(nextDay.state, new Date(Date.UTC(2026, 11, 14, 14)), []); // Dec 14: age 10 from Nov 30
    expect(only(tenLater.state)).toMatchObject({ state: "open", dropNoticeOn: "2026-12-14" });
  });

  it("an old notice from before Keep does not count", () => {
    const notice = run(highItem().state, when(30), []);
    const stale = structuredClone(notice.state);
    stale.items[0].clockStart = "2026-12-01"; // kept the next day, notice left behind
    const out = run(stale, new Date(Date.UTC(2026, 11, 2, 14)), []);
    expect(only(out.state).state).toBe("open");
  });

  it("OI12: an item never shown in Dropping today reaches age 11: notice first, no drop that run", () => {
    const { state } = highItem();
    const old = run(state, new Date(Date.UTC(2026, 11, 1, 14)), []); // age 11, first run since
    expect(only(old.state)).toMatchObject({ state: "open", dropNoticeOn: "2026-12-01" });
  });

  it("OI15: a snoozed item is not High or Normal, and does not escalate or drop until the snooze ends", () => {
    const out = normalItem();
    const snoozed = applyTap(out.state, 1, "snooze", only(out.state).version, when(16, 13));
    if (!snoozed.ok) throw new Error("tap failed");
    expect(snoozed.item.snoozeUntil).toBe("2026-11-17");
    expect(viewOf(snoozed.item, "2026-11-16")).toMatchObject({ group: "snoozed", tag: "Snoozed to Nov 17" });
    const forced = structuredClone(snoozed.state);
    forced.items[0].snoozeUntil = "2026-12-04";
    const during = run(forced, new Date(Date.UTC(2026, 11, 2, 14)), []);
    expect(only(during.state)).toMatchObject({ state: "open", escalated: false, dropNoticeOn: null });
    const after = run(during.state, new Date(Date.UTC(2026, 11, 4, 14)), []);
    expect(only(after.state)).toMatchObject({ snoozeUntil: null, escalated: true, dropNoticeOn: "2026-12-04" });
  });
});

describe("open items: broker taps", () => {
  it("Done closes it, \"you (Done)\"", () => {
    const { state } = highItem();
    const out = applyTap(state, 1, "done", only(state).version, when(16, 13));
    expect(out.ok && out.item).toMatchObject({ state: "closed", closedBy: "you (Done)", changedBy: "broker" });
  });

  it("OI5: \"Alka finished it\" closes it, \"Alka Pema (you confirmed)\"", () => {
    const { state, seen } = highItem();
    const fw = mail({ folder: "sent", from: owner, to: [alka], at: at(16, 14), subject: "FW: LOI counter" });
    const forwarded = run(state, when(16, 15), [fw], {}, seen).state;
    const out = applyTap(forwarded, 1, "finished", only(forwarded).version, when(16, 16));
    expect(out.ok && out.item.closedBy).toBe("Alka Pema (you confirmed)");
  });

  it("Make High raises a Normal item, and a run never lowers it", () => {
    const out = run(emptyItems(), when(16), [mail({})], { c1: { importance: "normal" } });
    const raised = applyTap(out.state, 1, "high", only(out.state).version, when(16, 13));
    if (!raised.ok) throw new Error("tap failed");
    expect(raised.item).toMatchObject({ importance: "high", raisedByBroker: true });
    const next = run(raised.state, when(17, 10), [mail({ at: at(17, 9) })], { c1: { importance: "normal" } }, new Set());
    expect(only(next.state).importance).toBe("high");
  });

  it("Reopen works for 5 business days after closing; closed items leave the list after that", () => {
    const { state } = highItem();
    const done = applyTap(state, 1, "done", only(state).version, when(16, 13));
    if (!done.ok) throw new Error("tap failed");
    const reopened = applyTap(done.state, 1, "reopen", done.item.version, when(20));
    expect(reopened.ok && reopened.item).toMatchObject({ state: "open", clockStart: "2026-11-20" });
    const later = run(done.state, when(24), []);
    expect(later.state.items).toHaveLength(0);
  });

  it("OI14: Done during a run's update still wins", () => {
    const { state, seen } = highItem();
    const loaded = only(state).version;
    const updated = run(state, when(17, 10), [mail({ at: at(17, 9) })], {}, seen).state;
    const out = applyTap(updated, 1, "done", loaded, when(17, 11));
    expect(out.ok && out.item.state).toBe("closed");
  });

  it("OI14: Done loses when the run reopened the item for a new message after the screen loaded", () => {
    const { state, seen } = highItem();
    const reply = mail({ folder: "sent", from: owner, to: [client], at: at(16, 14) });
    const closed = run(state, when(16, 15), [reply], {}, seen).state;
    const loaded = only(closed).version;
    const reopened = run(closed, when(17, 10), [mail({ at: at(17, 9) })], {}, seen).state;
    const out = applyTap(reopened, 1, "done", loaded, when(17, 11));
    expect(out).toMatchObject({ ok: false, conflict: true });
  });

  it("other taps on a changed item come back as a conflict", () => {
    const { state, seen } = highItem();
    const updated = run(state, when(17, 10), [mail({ at: at(17, 9) })], {}, seen).state;
    expect(applyTap(updated, 1, "snooze", 1, when(17, 11))).toMatchObject({ ok: false, conflict: true });
  });
});

describe("open items: groups and counts", () => {
  it("each item sits in one group, closest to dropping first", () => {
    const items: OpenItem[] = [];
    const base = only(highItem().state);
    const make = (num: number, over: Partial<OpenItem>) => items.push({ ...structuredClone(base), num, conversationId: `c${num}`, ...over });
    make(1, { importance: "normal" });
    make(2, { opened: "2026-11-20" });
    make(3, { opened: "2026-11-18" });
    make(4, { overdue: true });
    make(5, { opened: "2026-11-13" }); // age 9 on Nov 26: dropping
    make(6, { delegatedTo: { name: "Alka Pema", address: alka.address } });
    make(7, { snoozeUntil: "2026-11-27" });
    make(8, { state: "closed", closedOn: "2026-11-25", closedBy: "you (Done)" });
    const today = "2026-11-26";
    const g = grouped(items, today);
    // Opened Nov 16, so age 8 on Nov 26: Dropping soon wins over Normal, Past due and With a colleague.
    expect(g.get("dropping")!.map((x) => x.item.num)).toEqual([5, 1, 4, 6]);
    expect(g.get("high")!.map((x) => x.item.num)).toEqual([3, 2]); // #3 is older: less time left
    const fresh = grouped(items.map((i) => ({ ...i, opened: "2026-11-25" })), today);
    expect(fresh.get("high")!.map((x) => x.item.num)).toEqual([2, 3, 5]);
    expect(fresh.get("normal")!.map((x) => x.item.num)).toEqual([1]);
    expect(fresh.get("pastdue")!.map((x) => x.item.num)).toEqual([4]);
    expect(fresh.get("colleague")!.map((x) => x.item.num)).toEqual([6]);
    expect(fresh.get("snoozed")!.map((x) => x.item.num)).toEqual([7]);
    expect(fresh.get("closed")!.map((x) => x.item.num)).toEqual([8]);
    expect(countsOf(items.map((i) => ({ ...i, opened: "2026-11-25" })), today)).toMatchObject({ open: 7, high: 3, normal: 1, pastdue: 1, colleague: 1, snoozed: 1, closed: 1 });
  });
});
