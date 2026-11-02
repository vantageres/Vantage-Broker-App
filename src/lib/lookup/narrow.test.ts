import { describe, expect, it } from "vitest";
import { describeScope, mentionsType, nearPlace, placeAsked, typesAsked } from "./narrow";
import { TEST_BOARDS } from "../monday/boards";
import type { PersonRecord } from "../monday/records";
import type { Geocoder } from "../geocode";

const rec = (current: Partial<PersonRecord["current"]> = {}, extra: Partial<PersonRecord> = {}): PersonRecord => ({
  board: TEST_BOARDS.leads, id: "1", name: "X", businessName: "", updatedAt: "", url: "", phones: [], emails: [],
  contactBrokerIds: [], coBrokerIds: [], contactBrokerNames: "",
  current: { contactType: "", propertyType: "", budget: "", size: "", desiredLocation: "", notes: "", followUp: "", source: "", businessName: "", phone: "", email: "", status: "", contactAddress: "", ...current },
  ...extra,
});

// Mount Laurel and nearby towns, as Google places them.
const MAP: Record<string, { lat: number; lng: number; address: string; partial?: boolean }> = {
  "mount laurel, nj": { lat: 39.934, lng: -74.891, address: "Mt Laurel Township, NJ, USA" },
  "cherry hill, nj": { lat: 39.935, lng: -75.031, address: "Cherry Hill, NJ, USA" },
  "the market, nj": { lat: 39.9, lng: -75.1, address: "Market St, Camden, NJ 08102, USA" },
  "burlington county, nj": { lat: 40.0, lng: -74.7, address: "Burlington County, NJ, USA" },
  "bergen mill, nj": { lat: 40.26, lng: -74.42, address: "Bergen Mills, Millstone Township, NJ 08535, USA", partial: true },
};
const geocode: Geocoder = async (place) => {
  const hit = MAP[place.toLowerCase()];
  return hit ? { ...hit, partial: hit.partial ?? false } : null;
};

describe("typesAsked", () => {
  it("reads property types from the question", () => {
    expect(typesAsked("Summarize open industrial requirements under 20k sf.").map((t) => t.label)).toEqual(["Industrial"]);
    expect(typesAsked("Who wants office or retail space?").map((t) => t.label)).toEqual(["Office", "Retail"]);
    expect(typesAsked("Any warehouse users near 295?").map((t) => t.label)).toEqual(["Industrial"]);
    expect(typesAsked("Who is looking near Mount Laurel?")).toEqual([]);
  });
});

describe("mentionsType", () => {
  const industrial = typesAsked("industrial");
  it("counts Property Type, Notes and Business Name", () => {
    expect(mentionsType(rec({ propertyType: "Office, Industrial" }), industrial)).toBe(true);
    expect(mentionsType(rec({ notes: "Needs a Warehouse with 2 docks" }), industrial)).toBe(true);
    expect(mentionsType(rec({}, { businessName: "Fulton Logistics" }), industrial)).toBe(true);
    expect(mentionsType(rec({ propertyType: "Retail", notes: "Storefront on Main St" }), industrial)).toBe(false);
  });
  it("doesn't read 'landlord' as land", () => {
    expect(mentionsType(rec({ notes: "Landlord to cover fit-out" }), typesAsked("Any land buyers?"))).toBe(false);
    expect(mentionsType(rec({ notes: "Wants 5 acres" }), typesAsked("Any land buyers?"))).toBe(true);
  });
});

describe("placeAsked", () => {
  it("finds a town on the map", async () => {
    expect(await placeAsked("Who is looking near Mount Laurel?", geocode)).toEqual({ name: "Mount Laurel", point: { lat: 39.934, lng: -74.891 } });
    expect((await placeAsked("industrial requirements near cherry hill under 20k sf", geocode))?.name).toBe("cherry hill");
    expect((await placeAsked("Summarize industrial requirements near Mount Laurel.", geocode))?.name).toBe("Mount Laurel");
  });
  it("skips phrases that aren't places and reads the next one", async () => {
    expect((await placeAsked("Who is interested in retail near Mount Laurel?", geocode))?.name).toBe("Mount Laurel");
  });
  it("matches a highway by name only", async () => {
    expect(await placeAsked("Any warehouse users near 295?", geocode)).toEqual({ name: "295", point: null });
  });
  it("narrows nothing for months, counties, partial matches or phrases like 'the market'", async () => {
    for (const q of ["Who wants to move in March?", "Any buyers in the market?", "Who is looking in Burlington County?", "Anyone near Bergen Mill?", "Who wants retail?"]) {
      expect(await placeAsked(q, geocode)).toBeNull();
    }
  });
  it("narrows nothing when the map isn't available", async () => {
    expect(await placeAsked("Who is looking near Mount Laurel?", null)).toBeNull();
  });
  it("never fails the summary when the map fails", async () => {
    expect(await placeAsked("Who is looking near Mount Laurel?", async () => { throw new Error("down"); })).toBeNull();
  });
});

describe("nearPlace", () => {
  const mountLaurel = { name: "Mount Laurel", point: { lat: 39.934, lng: -74.891 } };
  it("keeps records within 10 miles, or naming the place", () => {
    expect(nearPlace(rec({ desiredLocation: "Cherry Hill, NJ" }, { desiredPoint: { lat: 39.935, lng: -75.031 } }), mountLaurel)).toBe(true); // about 7.5 miles
    expect(nearPlace(rec({ desiredLocation: "Newark, NJ" }, { desiredPoint: { lat: 40.736, lng: -74.172 } }), mountLaurel)).toBe(false);
    expect(nearPlace(rec({ notes: "Prefers Mt Laurel or Marlton" }), mountLaurel)).toBe(true);
    expect(nearPlace(rec({}), mountLaurel)).toBe(false);
  });
  it("matches a highway by its number", () => {
    expect(nearPlace(rec({ desiredLocation: "I-295, New Jersey, USA" }), { name: "295", point: null })).toBe(true);
  });
});

describe("describeScope", () => {
  it("says what was read", () => {
    expect(describeScope(1604, [], null)).toBe("all 1,604 Leads and Contacts with requirements");
    expect(describeScope(48, typesAsked("industrial"), null)).toBe("the 48 Leads and Contacts that mention industrial");
    expect(describeScope(1, [], { name: "295", point: null })).toBe("the 1 Lead or Contact naming 295");
    expect(describeScope(12, typesAsked("office"), { name: "Mount Laurel", point: { lat: 0, lng: 0 } }))
      .toBe("the 12 Leads and Contacts that mention office, within 10 miles of Mount Laurel or naming it");
  });
});
