import { describe, expect, it } from "vitest";
import type { MondayClient } from "../monday/client";
import { TEST_PROPERTY_LEADS } from "./board";
import { createPropertyLead } from "./create";
import { asksForNewPropertyLead } from "./intent";

const ME = { id: "1", name: "John Smyth" };
const CONTACTS = "555";
const b = TEST_PROPERTY_LEADS;

// Records mutations; answers an item's board and the read-back of the new lead.
function fakeMonday(contactBoard = CONTACTS) {
  const mutations: Record<string, unknown>[] = [];
  const client: MondayClient = {
    async query<T>(query: string, vars: Record<string, unknown> = {}) {
      if (query.trim().startsWith("mutation")) {
        mutations.push(JSON.parse(vars.values as string));
        return { create_item: { id: "900" } } as T;
      }
      if (!query.includes("column_values")) return { items: [{ board: { id: contactBoard } }] } as T;
      return { items: [{ id: "900", name: "140 Main St, Moorestown, NJ", updated_at: "", board: { id: b.boardId }, column_values: [
        { id: b.info.broker, text: "John Smyth", value: JSON.stringify({ personsAndTeams: [{ id: 1, kind: "person" }] }) },
      ] }] } as T;
    },
  };
  return { client, mutations };
}

describe("creating a Property Lead", () => {
  it("makes the broker its Broker, with the values and the linked Contact", async () => {
    const { client, mutations } = fakeMonday();
    const record = await createPropertyLead(client, b, CONTACTS, ME, {
      name: "140 Main St, Moorestown, NJ",
      location: { lat: 39.96, lng: -74.95, address: "140 Main St, Moorestown, NJ 08057, USA" },
      values: { listingType: "Sale", propertyType: "Industrial/Flex", listingPrice: "$1,800,000", sizeAvailable: "12,000 sf" },
      linkContact: "77",
    }, "acct");
    expect(mutations[0]).toEqual({
      [b.info.broker]: { personsAndTeams: [{ id: 1, kind: "person" }] },
      [b.columns.listingType]: { label: "Sale" },
      [b.columns.propertyType]: { label: "Industrial/Flex" },
      [b.columns.listingPrice]: "$1,800,000",
      [b.columns.sizeAvailable]: "12,000 sf",
      [b.info.location]: { lat: "39.96", lng: "-74.95", address: "140 Main St, Moorestown, NJ 08057, USA" },
      [b.info.contact]: { item_ids: [77] },
    });
    expect(record.ownerIds).toEqual(["1"]);
  });

  it("refuses before creating anything when a value doesn't fit", async () => {
    for (const [request, message] of [
      [{ name: " ", values: {} }, "A Property Lead needs an address."],
      [{ name: "1 A St", values: { listingType: "Rent" } }, '"Rent" is not a Listing Type option.'],
      [{ name: "1 A St", values: { propertyType: "Warehouse" } }, '"Warehouse" is not a Property Type option.'],
    ] as const) {
      const { client, mutations } = fakeMonday();
      await expect(createPropertyLead(client, b, CONTACTS, ME, request, "acct")).rejects.toThrow(message);
      expect(mutations).toEqual([]);
    }
  });

  it("links only records on the Contacts board", async () => {
    const { client, mutations } = fakeMonday("leads-board");
    await expect(createPropertyLead(client, b, CONTACTS, ME, { name: "1 A St", values: {}, linkContact: "77" }, "acct"))
      .rejects.toThrow("Property Contacts links only to records on the Contacts board.");
    expect(mutations).toEqual([]);
  });
});

describe("asksForNewPropertyLead", () => {
  it.each([
    "New Property Lead: 140 Main St, Moorestown. Owner Jack Smyth wants to sell.",
    "Add a property lead for 22 Elm St",
    "Can you create a new property lead for 9 Oak Ave?",
    "Property lead - 300 Route 73, Marlton",
  ])("creates: %s", (t) => expect(asksForNewPropertyLead(t)).toBe(true));
  it.each([
    "Any new property leads this week?",
    "What's the status of the 22 Elm St property lead?",
    "Met Dave Reyes, needs 5,000 sf",
    "How many property leads did we add?",
  ])("doesn't: %s", (t) => expect(asksForNewPropertyLead(t)).toBe(false));
});

describe("the Property Lead answer format", () => {
  // A structured answer allows only so many fields that can be empty; the
  // first version of this format, with the whole person format inside, failed.
  it("stays well under the limit on fields that can be empty", async () => {
    const { betaZodOutputFormat } = await import("@anthropic-ai/sdk/helpers/beta/zod");
    const { PropertyLeadDraft } = await import("./extract");
    let unions = 0;
    const walk = (s: unknown): void => {
      if (!s || typeof s !== "object") return;
      if (Array.isArray(s)) return s.forEach(walk);
      const o = s as Record<string, unknown>;
      if (o.anyOf || Array.isArray(o.type)) unions++;
      Object.values(o).forEach(walk);
    };
    walk((betaZodOutputFormat(PropertyLeadDraft) as { schema: unknown }).schema);
    expect(unions).toBeLessThanOrEqual(8);
  });
});
