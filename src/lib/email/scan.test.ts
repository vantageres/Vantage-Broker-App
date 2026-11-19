import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { savedBinner } from "./binner";
import {
  applyDirTap, BinAnswer, checkBins, countMail, directoryBins, directoryDeals, emptyDirectory, findProperty, mergeScan,
  sameProperty, shortlist, weight, type Counted, type KnownProperty,
} from "./scan";
import { parseMailbox, type MailMessage, type Person } from "./source";

// The first-time scan (plan step 6): counting in code, Claude's answer
// checked, properties matched against Monday, and the directory review.

const FIXTURES = join(__dirname, "fixtures");
const owner: Person = { name: "Test Broker", address: "test.broker@vantageres.com" };
const P = (address: string, name = "") => ({ name, address });
let n = 0;
const mail = (over: Partial<MailMessage>): MailMessage => ({
  id: `m${++n}`, conversationId: `c${n}`, folder: "inbox", subject: "Hello", from: P("a@b.example", "A"), to: [owner], cc: [],
  at: "2026-11-01T15:00:00Z", preview: "", ...over,
});

describe("counting who the broker emails", () => {
  it("counts received and sent-to per address, skips Vantage people, and counts noise without listing it", () => {
    const r = countMail([
      mail({ from: P("tom@x.example", "Tom"), subject: "RE: 22 Elm St", preview: "Can we talk  \n tomorrow?" }),
      mail({ folder: "sent", from: owner, to: [P("tom@x.example")], cc: [P("emily.stein@vantageres.com")] }),
      mail({ from: P("emily.stein@vantageres.com", "Emily") }),
      mail({ from: P("news@x.example"), listUnsubscribe: true }),
      mail({ from: P("x@b.example"), subject: "Read: Tour" }),
      mail({ from: P("leads@loopnet.com", "LoopNet"), listUnsubscribe: true }),
    ], owner);
    expect(r.contacts).toEqual([expect.objectContaining({ email: "tom@x.example", name: "Tom", received: 1, sentTo: 1, subjects: ["22 Elm St", "Hello"], snippet: "Can we talk tomorrow?" })]);
    expect(r.noise).toEqual({ newsletter: 1, receipt: 1 });
    expect(r.leadSources.map((c) => c.email)).toEqual(["leads@loopnet.com"]); // a lead platform is never noise
  });

  it("sent-to counts weigh more than received", () => {
    expect(weight({ received: 0, sentTo: 1 })).toBeGreaterThan(weight({ received: 2, sentTo: 0 }));
  });

  it("shortlists two-way traffic, people written to twice, and people who wrote twice; not one-offs", () => {
    const c = (email: string, received: number, sentTo: number): Counted => ({ email, name: null, received, sentTo, last: "", subjects: [], snippet: null });
    expect(shortlist([c("a", 1, 1), c("b", 0, 2), c("c", 2, 0), c("d", 1, 0), c("e", 0, 1)]).map((x) => x.email)).toEqual(["a", "b", "c"]);
  });

  it("the made-up mailbox: 11 people to ask about, LoopNet as a lead source, one-offs left out", () => {
    const box = parseMailbox(readFileSync(join(FIXTURES, "sample-mailbox.json"), "utf8"));
    const since = new Date(Date.now() - 90 * 864e5).toISOString();
    const r = countMail([...box.history, ...box.messages].filter((m) => m.at >= since), box.owner);
    const short = shortlist(r.contacts).map((x) => x.email);
    expect(short).toHaveLength(11);
    expect(short[0]).toBe("tom@alvarezholdings.example");
    expect(short).not.toContain("brian@signshop.example");
    expect(short.some((e) => e.endsWith("@vantageres.com") || e.endsWith("@vantagepm.com"))).toBe(false);
    expect(r.leadSources.map((x) => x.email)).toEqual(["leads@loopnet.com"]);
  });
});

describe("Claude's answer, checked", () => {
  const asked: Counted[] = [
    { email: "tom@x.example", name: "Tom", received: 3, sentTo: 3, last: "", subjects: [], snippet: null },
    { email: "sam@y.example", name: null, received: 2, sentTo: 0, last: "", subjects: [], snippet: null },
  ];

  it("one proposal per contact; a missing one becomes a low-confidence Prospect to check", () => {
    const { proposed } = checkBins(asked, {
      contacts: [{ email: "TOM@x.example", name: null, company: "X", bin: "Client", related_deal: null, why: "Owner.", confidence: "high" },
        { email: "stranger@z.example", name: "Z", company: null, bin: "Vendor", related_deal: null, why: "?", confidence: "high" }],
      properties: [],
    });
    expect(proposed).toEqual([
      expect.objectContaining({ email: "tom@x.example", name: "Tom", bin: "Client" }),
      expect.objectContaining({ email: "sam@y.example", bin: "Prospect", confidence: "low" }),
    ]);
  });

  it("internal types are not accepted from Claude", () => {
    const bad = { contacts: [{ email: "a@b.example", name: null, company: null, bin: "Internal Broker", related_deal: null, why: "", confidence: "high" }], properties: [] };
    expect(BinAnswer.safeParse(bad).success).toBe(false);
  });

  it("property mentions keep only contacts from this batch", () => {
    const { mentions } = checkBins(asked, { contacts: [], properties: [{ text: "22 Elm St", contacts: ["tom@x.example", "other@q.example"] }, { text: "NJ", contacts: [] }] });
    expect(mentions).toEqual([{ text: "22 Elm St", contacts: ["tom@x.example"] }]);
  });

  it("the saved answers file matches the schema and answers only what was asked", async () => {
    const answer = await savedBinner(join(FIXTURES, "sample-scan.json"))("Test Broker", [asked[0], { ...asked[0], email: "tom@alvarezholdings.example" }]);
    expect(answer.contacts.map((c) => c.email)).toEqual(["tom@alvarezholdings.example"]);
    expect(answer.properties.map((p) => p.text)).toEqual(["1200 Commerce Pkwy, Mount Laurel", "Haddon Square Shopping Center"]);
  });
});

describe("properties: in Monday or not", () => {
  const known: KnownProperty[] = [
    { name: "22 Elm St Warehouse - Cherry Hill", address: "", url: "u1", boardLabel: "Property Leads" },
    { name: "Pomona Shopping Center", address: "1200 Main Street, Pomona, NY", url: "u2", boardLabel: "Properties" },
  ];

  it("matches a street address across abbreviations, and a name by all its words", () => {
    expect(findProperty("22 Elm Street, Cherry Hill", known)?.url).toBe("u1");
    expect(findProperty("1200 Main St", known)?.url).toBe("u2");
    expect(findProperty("Pomona Shopping Center", known)?.url).toBe("u2");
  });

  it("does not match a different number, or a single word", () => {
    expect(findProperty("24 Elm St", known)).toBeNull();
    expect(findProperty("Pomona", known)).toBeNull();
    expect(findProperty("Haddon Square Shopping Center", known)).toBeNull();
  });

  it("knows two mentions of the same property", () => {
    expect(sameProperty("22 Elm St", "22 Elm Street, Cherry Hill")).toBe(true);
    expect(sameProperty("22 Elm St", "510 Main St")).toBe(false);
    expect(sameProperty("Haddon Square", "haddon square")).toBe(true);
  });
});

describe("the directory", () => {
  const summary = { inbox: 10, sent: 5, capped: false, noise: 2, inMonday: 1, asked: 2 };
  const found = {
    contacts: [
      { email: "tom@x.example", name: "Tom", company: "X", bin: "Client" as const, related_deal: "22 Elm St", why: "Owner.", confidence: "high" as const, received: 3, sentTo: 3, last: "2026-11-01" },
      { email: "sam@y.example", name: null, company: null, bin: "Vendor" as const, related_deal: null, why: "Photos.", confidence: "low" as const, received: 2, sentTo: 0, last: "2026-10-01" },
    ],
    properties: [{ text: "Haddon Square Shopping Center", contacts: ["tom@x.example"] }],
  };

  it("a scan adds contacts and properties for review", () => {
    const dir = mergeScan(emptyDirectory(), found, summary, "2026-11-19T17:00:00Z");
    expect(dir.contacts.map((c) => [c.email, c.status])).toEqual([["tom@x.example", "review"], ["sam@y.example", "review"]]);
    expect(dir.properties).toEqual([{ id: "p1", name: "Haddon Square Shopping Center", contacts: ["tom@x.example"], status: "review" }]);
    expect(dir.summary).toEqual(summary);
  });

  it("keep, remove and change type; a type the broker chose is certain", () => {
    let dir = mergeScan(emptyDirectory(), found, summary, "2026-11-19T17:00:00Z");
    dir = applyDirTap(dir, { kind: "contact", email: "tom@x.example", action: "keep" }, "2026-11-19");
    dir = applyDirTap(dir, { kind: "contact", email: "sam@y.example", action: "bin", bin: "Appraiser or Inspector" }, "2026-11-19");
    dir = applyDirTap(dir, { kind: "property", id: "p1", action: "keep" }, "2026-11-19");
    expect(dir.contacts[0]).toMatchObject({ status: "kept", changed: "2026-11-19" });
    expect(dir.contacts[1]).toMatchObject({ bin: "Appraiser or Inspector", confidence: "high", status: "review" });
    expect(directoryBins(dir)).toEqual(new Map([["tom@x.example", "Client"]]));
    expect(directoryDeals(dir)).toEqual([{ id: "dir:p1", name: "Haddon Square Shopping Center" }]);
    dir = applyDirTap(dir, { kind: "contact", email: "tom@x.example", action: "remove" }, "2026-11-20");
    expect(directoryBins(dir).size).toBe(0);
  });

  it("keep all keeps only what is still to review", () => {
    let dir = mergeScan(emptyDirectory(), found, summary, "2026-11-19T17:00:00Z");
    dir = applyDirTap(dir, { kind: "contact", email: "sam@y.example", action: "remove" }, "2026-11-19");
    dir = applyDirTap(dir, { kind: "keep-all", emails: ["tom@x.example", "sam@y.example"], ids: ["p1"] }, "2026-11-19");
    expect(dir.contacts.map((c) => c.status)).toEqual(["kept", "removed"]);
    expect(dir.properties[0].status).toBe("kept");
  });

  it("a later scan leaves the broker's choices alone and refreshes counts", () => {
    let dir = mergeScan(emptyDirectory(), found, summary, "2026-11-19T17:00:00Z");
    dir = applyDirTap(dir, { kind: "contact", email: "tom@x.example", action: "bin", bin: "Prospect" }, "2026-11-19");
    dir = applyDirTap(dir, { kind: "contact", email: "tom@x.example", action: "keep" }, "2026-11-19");
    const again = mergeScan(dir, {
      contacts: [{ ...found.contacts[0], bin: "Vendor", received: 9 }],
      properties: [{ text: "Haddon Square Shopping Center", contacts: ["new@z.example"] }, { text: "77 Route 73", contacts: [] }],
    }, summary, "2026-12-01T17:00:00Z");
    expect(again.contacts[0]).toMatchObject({ email: "tom@x.example", bin: "Prospect", status: "kept", received: 9 });
    expect(again.properties.map((p) => [p.id, p.name, p.contacts.length])).toEqual([["p1", "Haddon Square Shopping Center", 2], ["p2", "77 Route 73", 0]]);
  });
});

describe("New Property Lead from a listed property", () => {
  it("names it by the address and takes the owner (a Client in the mail) as its contact", async () => {
    const { propertyLeadDraft } = await import("./scan");
    let dir = mergeScan(emptyDirectory(), {
      contacts: [
        { email: "tom@x.example", name: "Tom Alvarez", company: "Alvarez Holdings", bin: "Client", related_deal: null, why: "", confidence: "high", received: 3, sentTo: 3, last: "" },
        { email: "shots@p.example", name: null, company: "Photo", bin: "Vendor", related_deal: null, why: "", confidence: "high", received: 1, sentTo: 2, last: "" },
      ],
      properties: [{ text: "Haddon Square Shopping Center", contacts: ["shots@p.example", "tom@x.example"] }],
    }, { inbox: 1, sent: 1, capped: false, noise: 0, inMonday: 0, asked: 2 }, "2026-11-19T17:00:00Z");
    const { draft, note } = propertyLeadDraft(dir.properties[0], dir);
    expect(draft).toMatchObject({ address: "Haddon Square Shopping Center", listing_type: null, contact: { name: "Tom Alvarez", business_name: "Alvarez Holdings", emails: ["tom@x.example"] } });
    expect(note).toBe("From email: Haddon Square Shopping Center, in mail with shots@p.example, Tom Alvarez.");
    dir = applyDirTap(dir, { kind: "contact", email: "tom@x.example", action: "remove" }, "2026-11-19");
    expect(propertyLeadDraft(dir.properties[0], dir).draft.contact).toEqual({ name: null, business_name: null, phones: [], emails: [] });
  });
});
