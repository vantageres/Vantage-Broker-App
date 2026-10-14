import { describe, expect, it } from "vitest";
import { NEAR_METRES, findSignProperty, metresBetween } from "./near";
import type { PropertyRecord } from "../monday/properties";
import type { PropertyLeadRecord } from "../property-leads/board";

// Points as the test boards hold them: several are a town's centre.
const MARLTON = { lat: 39.8915, lng: -74.9218 };
const HADDONFIELD = { lat: 39.8915, lng: -75.0377 };
const CHERRY_HILL = { lat: 39.9348, lng: -75.0307 };

const prop = (board: "propertiesNew" | "propertiesOld", id: string, name: string, address: string, point: { lat: number; lng: number } | null) =>
  ({ board, boardLabel: board === "propertiesOld" ? "Properties (old)" : "Properties New", id, name, url: `u${id}`, address, point }) as unknown as PropertyRecord;
const lead = (id: string, name: string, location: string, point: { lat: number; lng: number } | null) =>
  ({ id, name, url: `u${id}`, info: { location }, point }) as unknown as PropertyLeadRecord;

const properties = [
  prop("propertiesOld", "5", "Route 73 Parcel - Marlton", "Marlton, NJ, USA", MARLTON),
  prop("propertiesOld", "2", "45 Kings Hwy E - Haddonfield", "Haddonfield, NJ, USA", HADDONFIELD),
  prop("propertiesNew", "7", "Kings Crossing Retail Plaza - Haddonfield", "Haddonfield, NJ, USA", HADDONFIELD),
  prop("propertiesOld", "1", "1200 Commerce Pkwy - Mount Laurel", "Mount Laurel, NJ, USA", null),
];
const leads = [lead("9", "22 Elm St Warehouse - Cherry Hill", "Cherry Hill, NJ, USA", CHERRY_HILL)];

describe("the property a sign stands at", () => {
  it("measures distance", () => {
    expect(Math.round(metresBetween(MARLTON, HADDONFIELD) / 1000)).toBe(10);
  });

  it("finds the property near the phone, and only the old board's can be linked", () => {
    const near = { lat: MARLTON.lat + 0.0005, lng: MARLTON.lng };
    expect(findSignProperty(properties, leads, { location: near })).toMatchObject({ id: "5", how: "location", metres: 56, linkable: true });
    expect(findSignProperty(properties, leads, { location: CHERRY_HILL })).toMatchObject({ id: "9", board: "propertyLeads", linkable: false });
  });

  it("finds nothing when the phone is too far from every property", () => {
    expect(findSignProperty(properties, leads, { location: { lat: MARLTON.lat + 0.01, lng: MARLTON.lng } })).toBeNull();
    expect(NEAR_METRES).toBe(200);
  });

  it("won't choose between two properties on the same spot, but the sign's address can", () => {
    expect(findSignProperty(properties, leads, { location: HADDONFIELD })).toBeNull();
    expect(findSignProperty(properties, leads, { location: HADDONFIELD, address: "45 Kings Highway East, Haddonfield" })).toMatchObject({ id: "2", how: "address" });
  });

  it("matches a street address printed on the sign", () => {
    expect(findSignProperty(properties, leads, { address: "1200 Commerce Parkway" })).toMatchObject({ id: "1", how: "address", linkable: true });
    expect(findSignProperty(properties, leads, { address: "22 Elm Street, Cherry Hill" })).toMatchObject({ id: "9" });
    expect(findSignProperty(properties, leads, { address: "99 Nowhere Rd" })).toBeNull();
  });
});
