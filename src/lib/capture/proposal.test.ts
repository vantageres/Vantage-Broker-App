import { describe, expect, it } from "vitest";
import { TEST_BOARDS } from "../monday/boards";
import type { PersonRecord } from "../monday/records";
import type { ExtractedPerson } from "./extract";
import { buildProposal } from "./proposal";

const ME = { id: "1", name: "John Smyth" };
const TODAY = "2026-10-13";

function record(overrides: Partial<PersonRecord> & { name: string }): PersonRecord {
  return {
    board: TEST_BOARDS.leads,
    id: overrides.name,
    url: "",
    updatedAt: "",
    businessName: "",
    phones: [],
    emails: [],
    contactBrokerIds: [ME.id],
    coBrokerIds: [],
    contactBrokerNames: ME.name,
    current: {
      contactType: "", propertyType: "", budget: "", size: "", desiredLocation: "",
      notes: "", followUp: "", source: "", businessName: "", phone: "", email: "", status: "",
    },
    ...overrides,
  };
}

function person(overrides: Partial<ExtractedPerson>): ExtractedPerson {
  return {
    name: null, business_name: null, title: null, phones: [], emails: [],
    contact_type: null, property_types: [], size: null, budget: null,
    desired_location: null, extra_locations: [], follow_up_phrase: null,
    follow_up_date: null, source: null, requirement_notes: null,
    properties_mentioned: [], uncertain: [],
    ...overrides,
  };
}

const daveReyes = person({
  name: "Dave Reyes",
  business_name: "Garrison Foods",
  contact_type: "Leasee",
  property_types: ["Industrial"],
  size: "15,000 to 20,000 sf",
  desired_location: "I-295, NJ",
  follow_up_phrase: "in March",
  requirement_notes: "Target rent about $9/sf, lease ends Q3 2027",
});

describe("buildProposal", () => {
  it("proposes a new Lead when nobody matches", () => {
    const p = buildProposal(daveReyes, [], ME, "note", TODAY);
    expect(p.target.kind).toBe("new-lead");
    expect(p.changes.find((c) => c.field === "contactBroker")?.proposed).toBe("John Smyth");
  });

  it("updates the one matching record and shows current values", () => {
    const existing = record({ name: "Dave Reyes", businessName: "Garrison Foods", current: { ...record({ name: "x" }).current, businessName: "Garrison Foods", size: "10,000 sf" } });
    const p = buildProposal(daveReyes, [existing], ME, "note", TODAY);
    expect(p.target.kind).toBe("existing");
    expect(p.changes.find((c) => c.field === "size")).toMatchObject({ current: "10,000 sf", proposed: "15,000 to 20,000 sf" });
    expect(p.changes.find((c) => c.field === "businessName")).toBeUndefined();
  });

  it("matches on phone digits regardless of format", () => {
    const existing = record({ name: "D. Reyes", phones: ["8565550142"], board: TEST_BOARDS.contacts });
    const p = buildProposal(person({ name: "Dave", phones: ["+1 (856) 555-0142"] }), [existing], ME, "note", TODAY);
    expect(p.target.kind).toBe("existing");
  });

  it("asks the broker to pick between two people named Dave", () => {
    const p = buildProposal(person({ name: "Dave" }), [record({ name: "Dave Reyes" }), record({ name: "Dave Morales" })], ME, "note", TODAY);
    expect(p.target.kind).toBe("pick");
    expect(p.changes).toEqual([]);
  });

  it("recommends the Contacts record when the person is on both boards", () => {
    const lead = record({ name: "Maria Chen" });
    const contact = record({ name: "Maria Chen", id: "c1", board: TEST_BOARDS.contacts });
    const p = buildProposal(person({ name: "Maria Chen" }), [lead, contact], ME, "note", TODAY);
    expect(p.target).toMatchObject({ kind: "pick", recommended: "c1" });
  });

  it("declines and names the owner when someone else owns the record", () => {
    const theirs = record({ name: "Ray Fulton", contactBrokerIds: ["2"], contactBrokerNames: "Emily Stein" });
    const p = buildProposal(person({ name: "Ray Fulton", size: "15,000 sf" }), [theirs], ME, "note", TODAY);
    expect(p.blocked).toEqual({ reason: "not-owner", owner: "Emily Stein" });
    expect(p.changes).toEqual([]);
  });

  it("lets a Co-Broker edit", () => {
    const shared = record({ name: "Victor Ramos", contactBrokerIds: ["2"], coBrokerIds: [ME.id] });
    const p = buildProposal(person({ name: "Victor Ramos", size: "12,000 sf" }), [shared], ME, "note", TODAY);
    expect(p.blocked).toBeUndefined();
  });

  it("offers a claim on an unassigned record", () => {
    const open = record({ name: "Tom Alvarez", contactBrokerIds: [], contactBrokerNames: "" });
    const p = buildProposal(person({ name: "Tom Alvarez" }), [open], ME, "note", TODAY);
    expect(p.blocked).toEqual({ reason: "unassigned" });
  });

  it("asks for a date instead of guessing from 'March'", () => {
    const p = buildProposal(daveReyes, [], ME, "note", TODAY);
    expect(p.changes.find((c) => c.field === "followUp")).toBeUndefined();
    expect(p.questions.some((q) => q.field === "followUp")).toBe(true);
  });

  it("puts rent per foot in Notes and says why", () => {
    const p = buildProposal(daveReyes, [], ME, "note", TODAY);
    expect(p.changes.find((c) => c.field === "notes")?.proposed).toContain("$9/sf");
    expect(p.changes.find((c) => c.field === "budget")).toBeUndefined();
    expect(p.placedInNotes.length).toBeGreaterThan(0);
  });

  it("recognises a second email address held in one field", () => {
    const existing = record({ name: "Kevin O'Brien", emails: ["kobrien@obrienhale.example", "kevin.obrien@mail.example"] });
    const p = buildProposal(person({ name: "Kevin", emails: ["kevin.obrien@mail.example"] }), [existing], ME, "note", TODAY);
    expect(p.target.kind).toBe("existing");
    expect(p.changes.find((c) => c.field === "email")).toBeUndefined();
  });
});
