import { describe, expect, it } from "vitest";
import { cite, recordLine } from "./summary";
import { TEST_BOARDS } from "../monday/boards";
import type { PersonRecord } from "../monday/records";

const record = (id: string, name: string, current: Partial<PersonRecord["current"]> = {}): PersonRecord => ({
  board: TEST_BOARDS.leads, id, name, businessName: "", updatedAt: "2026-10-12T15:00:00Z", url: `u${id}`,
  phones: ["8565550101"], emails: ["a@b.example"], contactBrokerIds: [], coBrokerIds: [], contactBrokerNames: "John Smyth",
  current: { contactType: "", propertyType: "", budget: "", size: "", desiredLocation: "", notes: "", followUp: "", source: "", businessName: "", phone: "8565550101", email: "a@b.example", status: "", contactAddress: "", ...current },
});

const refs = new Map([["R1", record("1", "Ray Fulton")], ["R2", record("2", "Grace Kim")]]);

describe("summary citations", () => {
  it("keeps points that cite real records, and drops the rest", () => {
    const points = cite({
      nothing_found: false,
      points: [
        { text: "Ray Fulton needs 12,000 sf industrial.", sources: ["R1"] },
        { text: "Grace and Ray both want Mount Laurel.", sources: ["r2", "R1", "R1"] },
        { text: "An uncited claim.", sources: [] },
        { text: "A made-up record.", sources: ["R9"] },
      ],
    }, refs);
    expect(points.map((p) => [p.text, p.sources.map((s) => s.name)])).toEqual([
      ["Ray Fulton needs 12,000 sf industrial.", ["Ray Fulton"]],
      ["Grace and Ray both want Mount Laurel.", ["Grace Kim", "Ray Fulton"]],
    ]);
  });

  it("shows nothing when Claude finds nothing", () => {
    expect(cite({ nothing_found: true, points: [{ text: "x", sources: ["R1"] }] }, refs)).toEqual([]);
  });

  it("never sends phone numbers or emails to Claude", () => {
    const line = recordLine(record("1", "Ray Fulton", { propertyType: "Industrial", size: "12,000 sf" }), "R1");
    expect(line).toBe("R1 | Lead | Ray Fulton | Property Type: Industrial | Size: 12,000 sf | Contact Broker: John Smyth | Updated: 2026-10-12");
    expect(line).not.toMatch(/555|@/);
  });
});
