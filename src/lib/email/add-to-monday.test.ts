import { describe, expect, it } from "vitest";
import { buildProposal } from "../capture/proposal";
import { TEST_BOARDS } from "../monday/boards";
import type { PersonRecord } from "../monday/records";
import { fromContact, fromLead, mentionsMoney, NotAddable, personFor, resultFor, withTyped, type FromEmail } from "./add-to-monday";
import type { RunItem } from "./run";

// Add to Monday (plan step 5), spec 03 acceptance tests L5 to L13 where they
// apply to building the card. Saving is the app's existing, tested save.

const ME = { id: "1", name: "Test Broker" };
const TODAY = "2026-11-19"; // Thursday

const lead: FromEmail = {
  name: "Russell Nova", email: "Russell@CenterstonePG.example", phone: "917-559-1820", company: "Centerstone PG",
  askedAbout: "Leasing at Pomona Shopping Center", contactType: "Property Owner", source: "Referral",
  title: "Owner asking about leasing", what: "Russell owns Pomona Shopping Center and wants help leasing two units.",
};

function record(over: Partial<PersonRecord> & { name: string }): PersonRecord {
  return {
    board: TEST_BOARDS.leads, id: over.name, url: `https://x.monday.com/${over.name}`, updatedAt: "", businessName: "",
    phones: [], emails: [], contactBrokerIds: ["2"], coBrokerIds: [], contactBrokerNames: "Andrea Hannigan",
    current: { contactType: "", propertyType: "", budget: "", size: "", desiredLocation: "", notes: "", followUp: "", source: "", businessName: "", phone: "", email: "", status: "", contactAddress: "" },
    ...over,
  };
}

const card = (from: FromEmail, records: PersonRecord[] = []) => {
  const { person, noteText, leftOut } = personFor(from, TODAY);
  return resultFor(buildProposal(person, records, ME, noteText, TODAY), leftOut);
};

describe("Add to Monday: the card", () => {
  it("L1: a new person gets a new-Lead card with the email's details, follow up 2 business days out", () => {
    const r = card(lead);
    expect(r.kind).toBe("card");
    if (r.kind !== "card") return;
    const value = (f: string) => r.proposal.changes.find((c) => c.field === f)?.proposed;
    expect(value("name")).toBe("Russell Nova");
    expect(value("email")).toBe("russell@centerstonepg.example");
    expect(value("contactType")).toBe("Property Owner");
    expect(value("source")).toBe("Referral");
    expect(value("followUp")).toBe("2026-11-23");
    expect(value("status")).toBe("New Lead");
    expect(value("contactBroker")).toBe("Test Broker");
    expect(r.proposal.noteText).toContain("Added from email by Broker Assistant.");
    expect(r.proposal.questions).toEqual([]);
  });

  it("L6: Contact Type \"Ask\" and Source \"Not Set\" become questions, never values", () => {
    const r = card({ ...lead, contactType: "Ask", source: "Not Set" });
    if (r.kind !== "card") throw new Error("expected a card");
    expect(r.proposal.changes.find((c) => c.field === "contactType")).toBeUndefined();
    expect(r.proposal.changes.find((c) => c.field === "source")).toBeUndefined();
    expect(r.proposal.questions.map((q) => q.field)).toEqual(["contactType", "source"]);
  });

  it("L13: lines with money or commission are left out of Notes and the note, and counted", () => {
    expect(mentionsMoney("They offered a 3% commission")).toBe(true);
    expect(mentionsMoney("Budget $2.5M")).toBe(true);
    expect(mentionsMoney("Wants 5,000 sf in Cherry Hill")).toBe(false);
    const r = card({ ...lead, what: "Owner offers a 3% commission to lease it.", askedAbout: "Rent at $18/sf" });
    if (r.kind !== "card") throw new Error("expected a card");
    expect(r.leftOut).toBe(2);
    expect(r.proposal.noteText).not.toMatch(/commission|\$/);
    expect(r.proposal.changes.find((c) => c.field === "notes")).toBeUndefined();
  });

  it("people at Vantage are never added", () => {
    expect(() => personFor({ ...lead, email: "emily.stein@vantageres.com" }, TODAY)).toThrow(NotAddable);
  });
});

describe("Add to Monday: duplicates", () => {
  it("L2: the same email on a Contact: already in Monday, owner shown, no card", () => {
    const r = card(lead, [record({ name: "Russ Nova", board: TEST_BOARDS.contacts, emails: ["russell@centerstonepg.example"] })]);
    expect(r).toMatchObject({ kind: "in-monday", records: [{ name: "Russ Nova", owner: "Andrea Hannigan", matchedOn: ["email", "name"], yours: false }] });
  });

  it("an exact full name is the same person", () => {
    expect(card(lead, [record({ name: "Russell Nova" })]).kind).toBe("in-monday");
  });

  it("L4: a similar name with a different phone asks \"Same person?\"", () => {
    const r = card(lead, [record({ name: "Russ Nova", phones: ["6095550000"] })]);
    expect(r).toMatchObject({ kind: "maybe", records: [{ name: "Russ Nova", matchedOn: ["name"] }] });
  });

  it("L12: john@x.com is not bigjohn@x.com", () => {
    const r = card({ ...lead, name: null, email: "john@x.example" }, [record({ name: "Big John", emails: ["bigjohn@x.example"] })]);
    expect(r.kind).toBe("card");
  });
});

describe("Add to Monday: what can be added", () => {
  const item = { title: "t", what: "w", lead: null } as unknown as RunItem;

  it("only emails with a lead", () => {
    expect(() => fromLead(item)).toThrow(NotAddable);
  });

  it("L5: attorneys, lenders and vendors from new contacts are never added", () => {
    const c = { name: "Valerie Wisher", email: "vwisher@hillwallack.example", company: "Hill Wallack", confidence: "high" as const };
    expect(() => fromContact({ ...c, proposedBin: "Attorney" })).toThrow(NotAddable);
    expect(() => fromContact({ ...c, proposedBin: "Vendor" })).toThrow(NotAddable);
    expect(fromContact({ ...c, proposedBin: "Outside Broker" }).contactType).toBe("Broker");
  });

  it("L7: what the broker types for a missing email or phone is checked and used", () => {
    const none = { ...lead, email: null, phone: null };
    expect(() => withTyped(none, { email: "not an email" })).toThrow(NotAddable);
    expect(() => withTyped(none, { phone: "555-1234" })).toThrow(NotAddable);
    expect(withTyped(none, { phone: "(856) 555-1234" }).phone).toBe("(856) 555-1234");
    expect(withTyped(lead, {}).email).toBe(lead.email);
  });
});
