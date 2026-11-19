import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { domainMatches, isLeadSource, noiseKind } from "./noise";
import { parseMailbox, type MailMessage, type MailSource } from "./source";
import { sortMail } from "./threads";
import { knownPeople } from "./people";
import { checkAnswers, Classification, savedClassifier, threadForModel, type Classifier } from "./classify";
import { previousBusinessDay, runCheck, safeLink, windowStart, type MonitorState } from "./run";
import type { PersonRecord } from "../monday/records";

const FIXTURES = join(__dirname, "fixtures");
const NOW = new Date("2026-11-19T17:00:00Z"); // Thursday, noon in New Jersey
const mailbox = () => parseMailbox(readFileSync(join(FIXTURES, "sample-mailbox.json"), "utf8"), NOW.getTime());

const msg = (over: Partial<MailMessage>): MailMessage => ({
  id: "x", conversationId: "c", folder: "inbox", subject: "Hello", from: { name: "A", address: "a@b.example" },
  to: [], cc: [], at: NOW.toISOString(), preview: "", ...over,
});

function fileSourceFrom(box = mailbox()): MailSource {
  return {
    kind: "file",
    owner: box.owner,
    messagesSince: async (since) => box.messages.filter((m) => m.at >= since.toISOString()),
    bodies: async (ids) => Object.fromEntries(box.messages.filter((m) => ids.includes(m.id)).map((m) => [m.id, m.body ?? m.preview])),
  };
}

describe("noise filter", () => {
  it("matches noise domains on whole labels", () => {
    expect(domainMatches("email.costar.com", "email.costar.com")).toBe(true);
    expect(domainMatches("news.email.costar.com", "email.costar.com")).toBe(true);
    expect(domainMatches("notemail.costar.com", "email.costar.com")).toBe(false);
  });

  it("never treats a lead platform as noise, even with List-Unsubscribe (rule 1)", () => {
    expect(isLeadSource("leads@loopnet.com")).toBe(true);
    expect(isLeadSource("alerts@costar.com")).toBe(true);
    expect(isLeadSource("news@email.costar.com")).toBe(false);
    expect(noiseKind(msg({ from: { name: "LoopNet", address: "leads@loopnet.com" }, listUnsubscribe: true }))).toBeNull();
  });

  it("sorts receipts, calendar notices, auto replies, notifications and newsletters (M4, M7)", () => {
    expect(noiseKind(msg({ subject: "Read: Tour Thursday" }))).toBe("receipt");
    expect(noiseKind(msg({ subject: "Synced invitation: Broker meeting" }))).toBe("calendar");
    expect(noiseKind(msg({ subject: "Automatic reply: Comps" }))).toBe("auto-reply");
    expect(noiseKind(msg({ from: { name: "m", address: "notifications@monday.com" } }))).toBe("notification");
    expect(noiseKind(msg({ from: { name: "c", address: "x@email.costar.com" } }))).toBe("newsletter");
    expect(noiseKind(msg({ listUnsubscribe: true }))).toBe("newsletter");
    expect(noiseKind(msg({ subject: "LOI counter" }))).toBeNull();
  });

  it("applies the broker's Always Noise rules", () => {
    expect(noiseKind(msg({ from: { name: "a", address: "deals@spam.example" } }), [{ pattern: "spam.example" }])).toBe("your rule");
    expect(noiseKind(msg({ subject: "Weekly market digest" }), [{ pattern: "market digest" }])).toBe("your rule");
  });

  it("50 read receipts are noise with no model call", () => {
    const box = mailbox();
    const receipts = Array.from({ length: 50 }, (_, i) => msg({ id: `r${i}`, conversationId: `r${i}`, subject: `Read: Item ${i}` }));
    const sorted = sortMail(receipts, box.owner, new Set());
    expect(sorted.threads).toHaveLength(0);
    expect(sorted.noise.receipt).toBe(50);
  });
});

describe("threads", () => {
  it("groups the made-up mailbox and leaves only real conversations to sort", () => {
    const box = mailbox();
    const sorted = sortMail(box.messages, box.owner, new Set());
    expect(sorted.threads.map((t) => t.conversationId).sort()).toEqual(
      ["c-dave", "c-inject", "c-internal", "c-lead", "c-lease", "c-linda", "c-loi", "c-owen", "c-rachel", "c-recruit"].sort(),
    );
    const dave = sorted.threads.find((t) => t.conversationId === "c-dave")!;
    expect(dave.inbound).toHaveLength(2); // two messages, one thread
    expect(dave.webLink).toContain("m-dave-2");
  });

  it("knows when the broker replied after the latest message in (M9)", () => {
    const box = mailbox();
    const sorted = sortMail(box.messages, box.owner, new Set());
    expect(sorted.threads.find((t) => t.conversationId === "c-linda")!.brokerRepliedAt).not.toBeNull();
    expect(sorted.threads.find((t) => t.conversationId === "c-owen")!.brokerRepliedAt).toBeNull();
  });

  it("does not sort a message seen in an earlier run (M5)", () => {
    const box = mailbox();
    const seen = new Set(box.messages.map((m) => m.id));
    expect(sortMail(box.messages, box.owner, seen).threads).toHaveLength(0);
  });

  it("sorts a thread again when it has a new message (M6)", () => {
    const box = mailbox();
    const seen = new Set(box.messages.filter((m) => m.id !== "m-dave-2").map((m) => m.id));
    const sorted = sortMail(box.messages, box.owner, seen);
    expect(sorted.threads.map((t) => t.conversationId)).toEqual(["c-dave"]);
    expect(sorted.threads[0].messages).toHaveLength(2); // both messages give Claude context
  });
});

describe("who people are", () => {
  const record = (key: "leads" | "contacts", name: string, emails: string[], contactType = "Leasee") => ({
    board: { key, label: key === "leads" ? "Leads" : "Contacts" }, id: name, name, url: `https://monday.example/${name}`,
    emails, current: { contactType }, contactBrokerNames: "Emily Stein",
  }) as unknown as PersonRecord;

  it("exact address only: john@x.com is not bigjohn@x.com (L12)", () => {
    const known = knownPeople([{ name: "John", address: "john@x.example" }], [record("leads", "Big John", ["bigjohn@x.example"])], []);
    expect(known.has("john@x.example")).toBe(false);
  });

  it("Contacts are clients, Leads prospects, Contact Type Broker an outside broker; Contacts win", () => {
    const people = [{ name: "Maria", address: "maria@harborcoffee.example" }, { name: "Dave", address: "d@x.example" }, { name: "Bob", address: "bob@cbre.example" }];
    const known = knownPeople(people, [
      record("leads", "Maria Chen", ["maria@harborcoffee.example"]),
      record("contacts", "Maria Chen", ["maria@harborcoffee.example"]),
      record("leads", "Dave", ["d@x.example"]),
      record("leads", "Bob", ["bob@cbre.example"], "Broker"),
    ], []);
    expect(known.get("maria@harborcoffee.example")).toMatchObject({ bin: "Client", inMonday: { board: "Contacts" } });
    expect(known.get("d@x.example")?.bin).toBe("Prospect");
    expect(known.get("bob@cbre.example")?.bin).toBe("Outside Broker");
  });

  it("internal people are brokers when on the Brokers team, otherwise staff (M10)", () => {
    const known = knownPeople(
      [{ name: "Emily Stein", address: "emily.stein@vantageres.com" }, { name: "Alka Pema", address: "alka.pema@vantagepm.com" }], [], ["Emily Stein"]);
    expect(known.get("emily.stein@vantageres.com")?.bin).toBe("Internal Broker");
    expect(known.get("alka.pema@vantagepm.com")?.bin).toBe("Internal Staff");
  });
});

describe("what Claude sees and what is checked after", () => {
  it("sends trimmed text and no more than the latest messages", () => {
    const box = mailbox();
    const t = sortMail(box.messages, box.owner, new Set()).threads.find((x) => x.conversationId === "c-loi")!;
    const out = threadForModel(t, new Map(), { "m-loi-1": "x".repeat(5000) });
    expect(out.messages[0].text).toHaveLength(1500);
    expect(out.broker_replied_after_latest).toBe(false);
  });

  it("drops unknown deals, unknown threads, and fills missing ones as FYI", () => {
    const box = mailbox();
    const threads = sortMail(box.messages, box.owner, new Set()).threads.filter((t) => ["c-loi", "c-owen"].includes(t.conversationId));
    const base = { internal: false, waiting: null, dates: [], new_contacts: [], lead: null, title: "t", what: "w" };
    const out = checkAnswers(threads, [
      { ...base, thread_id: "c-loi", group: "deal", deal_id: "not-a-deal", importance: "high", priority: null },
      { ...base, thread_id: "c-unknown", group: "other", deal_id: null, importance: "high", priority: "x" },
    ], [{ id: "d1", name: "22 Elm St" }]);
    expect(out).toHaveLength(2);
    const loi = out.find((a) => a.thread_id === "c-loi")!;
    expect(loi.group).toBe("other");
    expect(loi.priority).toBeTruthy();
    const owen = out.find((a) => a.thread_id === "c-owen")!;
    expect(owen).toMatchObject({ importance: "fyi", checked: ["missing"] });
  });

  it("the saved answers file matches the schema", () => {
    expect(() => Classification.parse(JSON.parse(readFileSync(join(FIXTURES, "sample-classification.json"), "utf8")))).not.toThrow();
  });
});

describe("a Check now run on the made-up mailbox", () => {
  const deals = async () => [{ id: "13282162772", name: "22 Elm St Warehouse - Cherry Hill" }, { id: "13282110438", name: "510 Main St Office Condo - Moorestown" }];
  const classify = savedClassifier(join(FIXTURES, "sample-classification.json"));

  it("sorts, groups and counts", async () => {
    const { run, state } = await runCheck({ source: fileSourceFrom(), classify, brokerName: "Test Broker", deals, lookup: async () => new Map(), now: () => NOW }, { seen: {} });
    expect(run.items[0].group).toBe("leads"); // Leads first
    expect(run.items.filter((i) => i.group === "deal").map((i) => i.dealName)).toEqual(["22 Elm St Warehouse - Cherry Hill", "510 Main St Office Condo - Moorestown"]); // both have a High, so by name
    expect(run.counts).toMatchObject({ high: 3, normal: 5, fyi: 1 });
    // The prompt-injection email is never an item, and nothing acted on it (M12).
    expect(run.items.find((i) => i.conversationId === "c-inject")).toBeUndefined();
    expect(run.noise["sorted as noise"]).toBe(1);
    expect(run.noise.receipt).toBe(4);
    // The recruiter is not a lead (M11).
    expect(run.items.find((i) => i.conversationId === "c-recruit")?.lead).toBeNull();
    expect(run.newContacts.map((c) => c.email)).toContain("alyssa@talentbridge.example");
    expect(run.items.find((i) => i.conversationId === "c-linda")?.youRepliedAt).not.toBeNull();
    expect(state.lastRunEnd).toBe(NOW.toISOString());
  });

  it("the next run sorts nothing again and says so", async () => {
    const first = await runCheck({ source: fileSourceFrom(), classify, brokerName: "T", deals, lookup: async () => new Map(), now: () => NOW }, { seen: {} });
    let calls = 0;
    const counting: Classifier = async (i, b) => { calls++; return classify(i, b); };
    const later = new Date(NOW.getTime() + 60 * 60 * 1000);
    const { run } = await runCheck({ source: fileSourceFrom(), classify: counting, brokerName: "T", deals, lookup: async () => new Map(), now: () => later }, first.state);
    expect(run.items).toHaveLength(0);
    expect(calls).toBe(0);
    expect(run.counts.noise).toBe(0);
  });

  it("marks when Monday could not be read, and still sorts", async () => {
    const { run } = await runCheck({ source: fileSourceFrom(), classify, brokerName: "T", deals, lookup: async () => null, now: () => NOW }, { seen: {} });
    expect(run.mondayChecked).toBe(false);
    expect(run.items.length).toBeGreaterThan(0);
  });

  it("keeps no email bodies in the run", async () => {
    const { run } = await runCheck({ source: fileSourceFrom(), classify, brokerName: "T", deals, lookup: async () => new Map(), now: () => NOW }, { seen: {} });
    expect(JSON.stringify(run)).not.toContain("Ignore your instructions");
    expect(JSON.stringify(run)).not.toContain("5 year term. They need");
  });
});

describe("window and links", () => {
  it("first run looks back one business day; Monday looks back to Friday", () => {
    expect(previousBusinessDay(new Date("2026-11-23T12:00:00Z")).toISOString().slice(0, 10)).toBe("2026-11-20");
    expect(previousBusinessDay(new Date("2026-11-19T12:00:00Z")).toISOString().slice(0, 10)).toBe("2026-11-18");
  });

  it("later runs start 10 minutes before the last one ended", () => {
    const state: MonitorState = { lastRunEnd: "2026-11-19T16:00:00.000Z", seen: {} };
    expect(windowStart(state, NOW).toISOString()).toBe("2026-11-19T15:50:00.000Z");
  });

  it("shows only https links", () => {
    expect(safeLink("https://outlook.office.com/mail/id/1")).toContain("https://");
    expect(safeLink("javascript:alert(1)")).toBeNull();
    expect(safeLink(undefined)).toBeNull();
  });
});
