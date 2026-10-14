import { describe, expect, it } from "vitest";
import { describeQuery, knownTowns, readQuery, searchProperties } from "./search";
import { TEST_PROPERTY_BOARDS, toPropertyRecord, type PropertyRecord } from "../monday/properties";

// The test boards' properties (scripts/seed_test_boards.py), as Monday returns them.
const col = (id: string, text: string | number | null) => ({ id, text: text === null ? null : String(text) });
const old = (id: string, name: string, cv: Record<string, string | number>) =>
  toPropertyRecord(TEST_PROPERTY_BOARDS.propertiesOld, { id, name, updated_at: "2026-10-13T00:00:00Z", column_values: Object.entries(cv).map(([k, v]) => col(k, v)) }, "acct");
const suite = (id: string, name: string, sqft: number, status: string, type: string, leaseValue: number, expires = "") => ({
  id, name, column_values: [col("numbers15", sqft), col("status6", status), col("dropdown_mkp4t33a", type), col("color_mkqy6pz4", "Lease"), col("numbers", leaseValue), col("date_mknyafwd", expires)],
});
const fresh = (id: string, name: string, address: string, status: string, deal: string, suites: ReturnType<typeof suite>[]) =>
  toPropertyRecord(TEST_PROPERTY_BOARDS.propertiesNew, {
    id, name, updated_at: "2026-10-13T00:00:00Z",
    column_values: [col("status", status), col("location", address), col("person", "John Smyth"), col("status_15", deal)],
    subitems: suites,
  }, "acct");

const PROPERTIES: PropertyRecord[] = [
  old("1", "1200 Commerce Pkwy - Mount Laurel", { status: "On Market - Vantage", location: "Mount Laurel, NJ, USA", numbers7: 18000, status_15: "Lease", dropdown97: "Industrial", text5: "NNN" }),
  old("2", "45 Kings Hwy E - Haddonfield", { status: "On Market - Vantage", location: "Haddonfield, NJ, USA", numbers7: 1600, status_15: "Lease", dropdown97: "Retail", text5: "Modified Gross" }),
  old("3", "300 Corporate Center Dr - Mount Laurel", { status: "On Market - Vantage", location: "Mount Laurel, NJ, USA", numbers7: 7500, status_15: "Lease", dropdown97: "Office" }),
  old("4", "7 Industrial Ave - Pennsauken", { status: "Under Agreement", location: "Pennsauken Township, NJ, USA", numbers7: 35000, numbers: 4200000, status_15: "Sale", dropdown97: "Industrial" }),
  old("5", "Route 73 Parcel - Marlton", { status: "On Market - Vantage", location: "Marlton, NJ, USA", numbers8: 4.2, numbers: 1850000, status_15: "Sale", dropdown97: "Land" }),
  fresh("6", "Garrison Business Center - Mount Laurel", "Mount Laurel, NJ, USA", "On Market - Vantage", "Lease", [
    suite("61", "Suite A", 15000, "On Market", "Industrial", 135000),
    suite("62", "Suite B", 8000, "Lease Signed", "Industrial", 76000, "2028-06-30"),
    suite("63", "Suite C", 20000, "On Market", "Industrial", 170000),
  ]),
  fresh("7", "Kings Crossing Retail Plaza - Haddonfield", "Haddonfield, NJ, USA", "Partially Leased", "Lease", [
    suite("71", "Suite 101", 1400, "On Market", "Retail", 33600),
    suite("72", "Suite 102", 2200, "Lease Signed", "Retail", 52800, "2027-09-30"),
  ]),
  fresh("8", "Route 38 Flex Center - Moorestown", "Moorestown, NJ, USA", "On Market - Vantage", "Sale or Lease", [
    suite("81", "Unit 1", 6500, "On Market", "Industrial", 61750),
    suite("82", "Unit 2", 4000, "LOI - In Progress", "Industrial", 38000),
  ]),
];
const towns = knownTowns(PROPERTIES);
const search = (q: string) => searchProperties(PROPERTIES, readQuery(q, towns));
const names = (q: string) => search(q).map((h) => [h.property.name.split(" - ")[0], h.suites.map((s) => s.name).join(", ")].filter(Boolean).join(": "));

describe("reading a property question", () => {
  it("reads type and an approximate size", () => {
    const q = readQuery("Can you summarize the retail properties we have in the 2,000 sq. ft. size?");
    expect(q.types).toEqual(["Retail"]);
    expect(q.size).toEqual({ min: 1500, max: 2500, unit: "sf", around: 2000 });
    expect(describeQuery(q)).toBe("Retail · about 2,000 sf (1,500 to 2,500)");
  });

  it.each([
    ["industrial 15 to 20k sf", { min: 15000, max: 20000 }],
    ["warehouse between 10,000 and 15,000 square feet", { min: 10000, max: 15000 }],
    ["office under 20k sf", { min: null, max: 20000 }],
    ["anything over 5,000 sf", { min: 5000, max: null }],
    ["1,500-2,500 sf retail", { min: 1500, max: 2500 }],
  ])("reads the size in %s", (text, size) => expect(readQuery(text).size).toMatchObject({ ...size, unit: "sf" }));

  it("doesn't read a route number as a size", () => {
    expect(readQuery("industrial near Route 73 to 295").size).toBeNull();
  });

  it("reads acres, towns, sale or lease, and available", () => {
    const q = readQuery("Any land for sale in Marlton around 4 acres that's available?", towns);
    expect(q).toMatchObject({ types: ["Land"], deal: "Sale", availableOnly: true, towns: ["Marlton"] });
    expect(q.size).toMatchObject({ unit: "acres", around: 4 });
  });

  it("knows the towns on the boards", () => {
    expect(towns).toEqual(expect.arrayContaining(["Mount Laurel", "Haddonfield", "Pennsauken", "Marlton", "Moorestown"]));
  });
});

describe("searching properties and suites", () => {
  it("answers John's question: retail around 2,000 sf", () => {
    // Suite 101 (1,400 sf) is outside 1,500 to 2,500, so only Suite 102 shows.
    expect(names("retail properties in the 2,000 sq ft size")).toEqual(["45 Kings Hwy E", "Kings Crossing Retail Plaza: Suite 102"]);
  });

  it("lists available industrial suites in a size range, nearest first", () => {
    expect(names("available industrial 15 to 20k sf")).toEqual(["1200 Commerce Pkwy", "Garrison Business Center: Suite A, Suite C"]);
  });

  it("filters by town and shows every suite when no suite detail is asked", () => {
    const hits = search("What properties do we have in Haddonfield?");
    expect(hits.map((h) => h.property.name)).toEqual(["45 Kings Hwy E - Haddonfield", "Kings Crossing Retail Plaza - Haddonfield"]);
    expect(hits[1].suites.map((s) => s.name)).toEqual(["Suite 101", "Suite 102"]);
  });

  it("filters sale from lease; 'Sale or Lease' counts as both", () => {
    expect(search("industrial for sale").map((h) => h.property.name.split(" - ")[0])).toEqual(["Route 38 Flex Center", "7 Industrial Ave"]);
  });

  it("never guesses a size Monday doesn't hold", () => {
    // The land parcel has acres only, so a search in sf leaves it out.
    expect(names("land around 4,000 sf")).toEqual([]);
    expect(names("land around 4 acres")).toEqual(["Route 73 Parcel"]);
  });

  it("finds nothing rather than something close", () => {
    expect(search("office around 50,000 sf")).toEqual([]);
  });
});
