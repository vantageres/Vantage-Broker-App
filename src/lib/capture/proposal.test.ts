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
      notes: "", followUp: "", source: "", businessName: "", phone: "", email: "", status: "", contactAddress: "",
    },
    ...overrides,
  };
}

function person(overrides: Partial<ExtractedPerson>): ExtractedPerson {
  return {
    name: null, business_name: null, title: null, address: null, phones: [], emails: [],
    contact_type: null, property_types: [], size: null, budget: null,
    desired_location: null, extra_locations: [], follow_up_phrase: null,
    follow_up_date: null, source: null, requirement_notes: null, location_is_addition: false,
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

  it("explains Notes without mentioning Budget when no money was moved", () => {
    const p = buildProposal(person({ name: "Sam", requirement_notes: "Looking to buy, wants frontage on Route 70" }), [], ME, "note", TODAY);
    expect(p.placedInNotes[0].why).not.toContain("Budget");
  });

  it("shows nothing placed in Notes on a blocked proposal", () => {
    const theirs = record({ name: "Ray Fulton", contactBrokerIds: ["2"], contactBrokerNames: "Emily Stein" });
    const p = buildProposal(person({ name: "Ray Fulton", requirement_notes: "Budget 1.2M to buy" }), [theirs], ME, "note", TODAY);
    expect(p.placedInNotes).toEqual([]);
  });

  it("leaves a field empty and asks when Claude is unsure of it", () => {
    const p = buildProposal(
      person({
        name: "Dave Reyes",
        follow_up_phrase: "call him Tuesday",
        follow_up_date: "2026-10-20",
        uncertain: [{ field: "follow_up_date", question: "Did you mean Tuesday, October 20?" }],
      }),
      [], ME, "note", TODAY,
    );
    expect(p.changes.find((c) => c.field === "followUp")).toBeUndefined();
    expect(p.questions).toEqual([{ field: "followUp", question: "Did you mean Tuesday, October 20?" }]);
  });

  it("puts the match question first and skips first-name-only uncertainty", () => {
    const p = buildProposal(
      person({
        name: "Dave",
        follow_up_phrase: "in March",
        uncertain: [
          { field: "name", question: "Which Dave?" },
          { field: "contact_type", question: "Is he looking to lease or buy?" },
        ],
      }),
      [record({ name: "Dave Reyes" }), record({ name: "Dave Morales" })], ME, "note", TODAY,
    );
    expect(p.questions.map((q) => q.field)).toEqual(["match", "followUp", "contactType"]);
  });

  it("adds to existing Notes instead of replacing them", () => {
    const base = record({ name: "x" }).current;
    const linda = record({ name: "Linda Park", current: { ...base, notes: "First-floor medical office, ADA access" } });
    const p = buildProposal(person({ name: "Linda Park", requirement_notes: "Needs 20 parking spaces" }), [linda], ME, "note", TODAY);
    expect(p.changes.find((c) => c.field === "notes")?.proposed).toBe("First-floor medical office, ADA access. Needs 20 parking spaces");
  });

  it("does not ask about a field the record already fills", () => {
    const base = record({ name: "x" }).current;
    const linda = record({ name: "Linda Park", current: { ...base, contactType: "Leasee" } });
    const p = buildProposal(
      person({ name: "Linda Park", uncertain: [{ field: "contact_type", question: "Lease or buy?" }] }),
      [linda], ME, "note", TODAY,
    );
    expect(p.questions).toEqual([]);
  });

  it("still asks when the field is only 'Not Set'", () => {
    const base = record({ name: "x" }).current;
    const sam = record({ name: "Sam Whitaker", current: { ...base, contactType: "Not Set" } });
    const p = buildProposal(
      person({ name: "Sam Whitaker", uncertain: [{ field: "contact_type", question: "Lease or buy?" }] }),
      [sam], ME, "note", TODAY,
    );
    expect(p.questions).toHaveLength(1);
  });

  it("still asks about a place when the record already has one", () => {
    const base = record({ name: "x" }).current;
    const grace = record({ name: "Grace Kim", current: { ...base, desiredLocation: "Pennsauken Township, NJ, USA" } });
    const p = buildProposal(
      person({ name: "Grace Kim", uncertain: [{ field: "desired_location", question: "What town is the old Bergen Mill site in?" }] }),
      [grace], ME, "note", TODAY,
    );
    expect(p.questions.map((q) => q.field)).toEqual(["desiredLocation"]);
  });

  it("adds an 'also' area to Notes and keeps the current Desired Location", () => {
    const base = record({ name: "x" }).current;
    const linda = record({ name: "Linda Park", current: { ...base, desiredLocation: "Cherry Hill, NJ, USA" } });
    const p = buildProposal(
      person({ name: "Linda Park", desired_location: "Route 73, NJ", location_is_addition: true }),
      [linda], ME, "note", TODAY,
    );
    expect(p.changes.find((c) => c.field === "desiredLocation")).toBeUndefined();
    expect(p.changes.find((c) => c.field === "notes")?.proposed).toBe("Also considering: Route 73, NJ");
    expect(p.placedInNotes[0].why).toContain("Cherry Hill");
  });

  it("replaces Desired Location when the note isn't an addition", () => {
    const base = record({ name: "x" }).current;
    const linda = record({ name: "Linda Park", current: { ...base, desiredLocation: "Cherry Hill, NJ, USA" } });
    const p = buildProposal(person({ name: "Linda Park", desired_location: "Mount Laurel, NJ" }), [linda], ME, "note", TODAY);
    expect(p.changes.find((c) => c.field === "desiredLocation")?.proposed).toBe("Mount Laurel, NJ");
  });

  it("shows the follow-up date with its weekday", () => {
    const p = buildProposal(person({ name: "Linda Park", follow_up_date: "2026-10-20" }), [], ME, "note", TODAY);
    expect(p.changes.find((c) => c.field === "followUp")).toMatchObject({
      proposed: "2026-10-20",
      proposedDisplay: "Tue, Oct 20, 2026",
    });
  });

  it("recognises a second email address held in one field", () => {
    const existing = record({ name: "Kevin O'Brien", emails: ["kobrien@obrienhale.example", "kevin.obrien@mail.example"] });
    const p = buildProposal(person({ name: "Kevin", emails: ["kevin.obrien@mail.example"] }), [existing], ME, "note", TODAY);
    expect(p.target.kind).toBe("existing");
    expect(p.changes.find((c) => c.field === "email")).toBeUndefined();
  });
});

describe("a business card", () => {
  const card = person({
    name: "Pat Testwell", business_name: "Testwell Dental", title: "Practice Manager",
    phones: ["856-555-0199"], emails: ["pat@testwell.example"], address: "12 Main St, Haddonfield, NJ 08033",
  });

  it("puts the title in Notes, and the address in Notes on a new Lead", () => {
    const p = buildProposal(card, [], ME, "Added from a business card.", TODAY);
    expect(p.target.kind).toBe("new-lead");
    expect(p.changes.find((c) => c.field === "notes")?.proposed).toBe("Title: Practice Manager. Address: 12 Main St, Haddonfield, NJ 08033");
    expect(p.changes.find((c) => c.field === "contactAddress")).toBeUndefined();
    expect(p.placedInNotes.map((n) => n.why)).toEqual([
      "No field holds a job title, so it goes in Notes.",
      "Leads have no address field, so the address goes in Notes.",
    ]);
  });

  it("puts the address in Contact Address on a Contact", () => {
    const contact = record({ name: "Pat Testwell", board: TEST_BOARDS.contacts, phones: ["8565550199"] });
    const p = buildProposal(card, [contact], ME, "Added from a business card.", TODAY);
    expect(p.target.kind).toBe("existing");
    expect(p.changes.find((c) => c.field === "contactAddress")).toMatchObject({ label: "Contact Address", proposed: "12 Main St, Haddonfield, NJ 08033" });
    expect(p.changes.find((c) => c.field === "notes")?.proposed).toBe("Title: Practice Manager");
  });
});
