import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { capWords, dueSlot, nextFullList, upcomingDates, waitingOnThem } from "./schedule";
import { earlierFor, NOT_CHECKED, savedHistorian } from "./history";
import type { OpenItem } from "./open-items";
import { runCheck } from "./run";
import { savedClassifier } from "./classify";
import { fileSource, type MailMessage, type Person } from "./source";

// Scheduled runs (plan step 7): slots in New Jersey time, the 7am
// follow-ups, history lines, and the slot runner that never runs twice.

const FIXTURES = join(__dirname, "fixtures");
const owner: Person = { name: "Test Broker", address: "test.broker@vantageres.com" };

describe("slots", () => {
  it("works the slot out in New Jersey time, in winter and in summer", () => {
    expect(dueSlot(new Date("2026-11-23T12:05:00Z"))).toEqual({ date: "2026-11-23", slot: "07:00", kind: "full" }); // Mon 7:05 EST
    expect(dueSlot(new Date("2026-07-13T11:00:00Z"))).toEqual({ date: "2026-07-13", slot: "07:00", kind: "full" }); // Mon 7:00 EDT
    expect(dueSlot(new Date("2026-11-23T16:15:00Z"))).toMatchObject({ slot: "11:00", kind: "changes" });
    expect(dueSlot(new Date("2026-11-23T20:30:00Z"))).toMatchObject({ slot: "15:00" });
    expect(dueSlot(new Date("2026-11-24T00:45:00Z"))).toMatchObject({ date: "2026-11-23", slot: "19:00" }); // 7:45pm Monday
  });

  it("nothing between slots, before 7am or at weekends", () => {
    expect(dueSlot(new Date("2026-11-23T13:00:00Z"))).toBeNull(); // 8:00am: past the hour's grace
    expect(dueSlot(new Date("2026-11-23T11:45:00Z"))).toBeNull(); // 6:45am
    expect(dueSlot(new Date("2026-11-21T12:05:00Z"))).toBeNull(); // Saturday
  });

  it("names the next full list", () => {
    expect(nextFullList(new Date("2026-11-23T11:00:00Z"))).toBe("7am today"); // Mon 6am
    expect(nextFullList(new Date("2026-11-23T20:00:00Z"))).toBe("7am Nov 24");
    expect(nextFullList(new Date("2026-11-27T20:00:00Z"))).toBe("7am Nov 30"); // Friday evening
  });
});

describe("7am follow-ups", () => {
  const now = new Date("2026-11-23T12:00:00Z"); // Monday
  const tom: Person = { name: "Tom Alvarez", address: "tom@x.example" };
  const sam: Person = { name: "Sam Photo", address: "sam@p.example" };
  let n = 0;
  const mail = (over: Partial<MailMessage>): MailMessage => ({
    id: `m${++n}`, conversationId: "c1", folder: "sent", subject: "s", from: owner, to: [tom], cc: [], at: "2026-11-16T15:00:00Z", preview: "", ...over,
  });
  const bins = (e: string) => ({ "tom@x.example": "Client", "sam@p.example": "Vendor" })[e];

  it("waiting on them: sent 3 to 10 business days ago to a client, no answer since", () => {
    const w = waitingOnThem([mail({ webLink: "https://outlook.office.com/x" })], owner, bins, now);
    expect(w).toEqual([{ name: "Tom Alvarez", email: "tom@x.example", sentOn: "2026-11-16", businessDays: 5, webLink: "https://outlook.office.com/x" }]);
  });

  it("not when they answered, when it is too recent or too old, or for a vendor", () => {
    expect(waitingOnThem([mail({}), mail({ folder: "inbox", from: tom, to: [owner], at: "2026-11-18T15:00:00Z" })], owner, bins, now)).toEqual([]);
    expect(waitingOnThem([mail({ at: "2026-11-20T15:00:00Z" })], owner, bins, now)).toEqual([]); // 1 business day
    expect(waitingOnThem([mail({ at: "2026-11-05T15:00:00Z" })], owner, bins, now)).toEqual([]); // 12 business days
    expect(waitingOnThem([mail({ to: [sam] })], owner, bins, now)).toEqual([]);
  });

  it("upcoming dates: open items due in the next 14 days", () => {
    const base = { state: "open", due: null, num: 0, title: "" } as unknown as OpenItem;
    const items = [
      { ...base, num: 1, title: "Lease comments", due: "2026-11-25" },
      { ...base, num: 2, title: "Too far", due: "2026-12-15" },
      { ...base, num: 3, title: "Closed", due: "2026-11-24", state: "closed" },
      { ...base, num: 4, title: "Survey", due: "2026-11-24" },
    ] as OpenItem[];
    expect(upcomingDates(items, now)).toEqual([{ num: 4, title: "Survey", due: "2026-11-24" }, { num: 1, title: "Lease comments", due: "2026-11-25" }]);
  });
});

describe("history lines", () => {
  it("are at most 35 words", () => {
    expect(capWords(Array(40).fill("word").join(" ")).split(" ")).toHaveLength(35);
    expect(capWords("First message on this.")).toBe("First message on this.");
  });

  it("send Claude only earlier messages, trimmed, as data", () => {
    const now: MailMessage = { id: "n", conversationId: "c", folder: "inbox", subject: "", from: owner, to: [], cc: [], at: "2026-11-20T15:00:00Z", preview: "" };
    const ask = earlierFor({ conversationId: "c", messages: [now] }, [
      { ...now, id: "a", from: { name: "Mike Ruiz", address: "m@x" }, at: "2026-10-30T15:00:00Z", preview: "Offer   at $8.25" },
      { ...now, id: "b", folder: "sent", at: "2026-11-02T15:00:00Z", preview: "Counter at $9.00" },
      now,
    ], "LOI counter. Mike sent a counter.");
    expect(ask).toEqual({ thread_id: "c", summary: "LOI counter. Mike sent a counter.", earlier: [
      { from: "Mike Ruiz", date: "2026-10-30", preview: "Offer at $8.25" },
      { from: "the broker", date: "2026-11-02", preview: "Counter at $9.00" },
    ] });
  });

  it("M13: a run adds history to High and Normal items, Highs first, and says when it didn't", async () => {
    const source = fileSource(join(FIXTURES, "sample-mailbox.json"));
    const asked: string[][] = [];
    const saved = savedHistorian(join(FIXTURES, "sample-history.json"));
    const { run } = await runCheck({
      source,
      classify: savedClassifier(join(FIXTURES, "sample-classification.json")),
      brokerName: "Test Broker",
      deals: async () => [{ id: "13282162772", name: "22 Elm St" }, { id: "13282110438", name: "510 Main St" }],
      lookup: async () => new Map(),
      history: async (asks) => {
        asked.push(asks.map((a) => a.thread_id));
        return saved(asks);
      },
    }, { seen: {} });
    expect(asked[0].slice(0, 3).sort()).toEqual(["c-lead", "c-lease", "c-loi"]); // Highs first
    expect(run.items.find((i) => i.conversationId === "c-loi")?.history).toMatch(/^Second round since Oct 30/);
    expect(run.items.find((i) => i.conversationId === "c-rachel")?.history).toBe(NOT_CHECKED); // no saved line
    expect(run.items.find((i) => i.importance === "fyi")?.history ?? null).toBeNull();
  });
});

describe("the slot runner", () => {
  const env = { ...process.env };
  beforeAll(() => {
    Object.assign(process.env, {
      SESSION_SECRET: "test-secret-0123456789abcdefghijklmnopqrstuvwxyz",
      DEV_MAILBOX_FILE: join(FIXTURES, "sample-mailbox.json"),
      DEV_CLASSIFICATION_FILE: join(FIXTURES, "sample-classification.json"),
      DEV_HISTORY_FILE: join(FIXTURES, "sample-history.json"),
    });
  });
  afterAll(() => {
    process.env = env;
  });

  it("runs each broker's 7am slot once, as a full run with the open list, without Monday", async () => {
    const { runDueSlot, latestRun, openItems } = await import("./monitor-server");
    const at = new Date("2026-11-23T12:05:00Z");
    expect(await runDueSlot(at, "u1")).toEqual({ slot: "2026-11-23 07:00", results: [{ userId: "u1", outcome: "ran" }] });
    expect((await runDueSlot(new Date("2026-11-23T12:20:00Z"), "u1")).results).toEqual([{ userId: "u1", outcome: "already ran" }]);
    const run = await latestRun("u1");
    expect(run).toMatchObject({ kind: "full", slot: "07:00", mondayChecked: false });
    expect(run?.openItems?.openList?.length).toBe((await openItems("u1")).items.filter((i) => i.state === "open").length);
    expect(run?.followUps).toBeDefined();
    expect(await runDueSlot(new Date("2026-11-23T13:30:00Z"), "u1")).toEqual({ slot: null, results: [] }); // between slots
  });
});
