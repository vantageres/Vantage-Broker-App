import { describe, expect, it } from "vitest";
import { TEST_PROPERTY_LEADS as B, findLeads, leadColumnValue, leadView, savePropertyLead, toLeadRecord } from "./board";
import type { MondayClient } from "../monday/client";

const people = (...ids: number[]) => JSON.stringify({ personsAndTeams: ids.map((id) => ({ id, kind: "person" })) });
const JOHN = { id: "44432289", name: "John Smyth" };

// 22 Elm St as Monday returns it (John is Broker).
function elmItem(overrides: Record<string, { text: string | null; value?: string | null }> = {}) {
  const cols: Record<string, { text: string | null; value?: string | null }> = {
    person: { text: "John Smyth", value: people(44432289) },
    status: { text: "New Lead" },
    color_mkns3611: { text: "Lease" },
    color_mm6vsvqf: { text: "Industrial/Flex" },
    text_mm6vgmah: { text: "$12/sf NNN" },
    text_mm6v7x34: { text: "Code 7781 side door" },
    text_mm6v4ft7: { text: "$480,000" },
    boolean_mm6v34ps: { text: "v" },
    text_mm6v4b1z: { text: "Example Bank" },
    location_mkns33qb: { text: "Cherry Hill, NJ, USA" },
    ...overrides,
  };
  return {
    id: "1", name: "22 Elm St Warehouse - Cherry Hill", updated_at: "2026-10-13T21:15:04Z", board: { id: B.boardId },
    column_values: Object.entries(cols).map(([id, c]) => ({ id, text: c.text, value: c.value ?? null })),
  };
}

// A stand-in Monday that returns one item and records the write.
function fakeMonday(item: ReturnType<typeof elmItem>) {
  const writes: Record<string, unknown>[] = [];
  const monday: MondayClient = {
    async query<T>(query: string, variables: Record<string, unknown> = {}) {
      if (query.trim().startsWith("mutation")) {
        writes.push(JSON.parse(String(variables.values)));
        return {} as T;
      }
      return { items: [item] } as T;
    },
  };
  return { monday, writes };
}

describe("Property Leads", () => {
  const elm = toLeadRecord(B, elmItem(), "acct");

  it("reads a record, with a ticked checkbox as Yes", () => {
    expect(elm.values).toMatchObject({ status: "New Lead", listingType: "Lease", currentOnLoans: "Yes", keyForBroker: "Code 7781 side door" });
    expect(elm.ownerIds).toEqual(["44432289"]);
  });

  it("finds a lead by name or street address, not by a loose word", () => {
    expect(findLeads("What's the status of 22 Elm St?", [elm])).toHaveLength(1);
    expect(findLeads("22 Elm St Warehouse", [elm])).toHaveLength(1);
    expect(findLeads("anything on Elm Street", [elm])).toHaveLength(0);
  });

  it("hides key, loan and lender details from brokers who aren't assigned", () => {
    expect(leadView(elm, JOHN)).toMatchObject({ canEdit: true, values: { keyForBroker: "Code 7781 side door" } });
    const other = leadView(elm, { id: "25374507", name: "Emily Stein" });
    expect(other.canEdit).toBe(false);
    expect(Object.keys(other.values)).not.toEqual(expect.arrayContaining(["keyForBroker"]));
    expect(JSON.stringify(other)).not.toMatch(/7781|480,000|Example Bank/);
  });

  it("allows the statuses brokers set, and refuses the ones Monday sets", () => {
    expect(leadColumnValue(B, { field: "status", from: "New Lead", to: "LA Signed" }, elm.values)).toEqual(["status", { label: "LA Signed" }]);
    expect(() => leadColumnValue(B, { field: "status", from: "New Lead", to: "On Market" }, elm.values)).toThrow("set in Monday only");
    expect(() => leadColumnValue(B, { field: "status", from: "On Market", to: "New Lead" }, { ...elm.values, status: "On Market" })).toThrow("managed in Monday");
    expect(() => leadColumnValue(B, { field: "listingType", from: "Lease", to: "Rent" }, elm.values)).toThrow("not a Listing Type option");
    expect(() => leadColumnValue(B, { field: "laSigned", from: "", to: "next week" }, elm.values)).toThrow("needs a date");
    expect(leadColumnValue(B, { field: "currentOnLoans", from: "Yes", to: "" }, elm.values)).toEqual(["boolean_mm6v34ps", null]);
  });

  it("saves approved changes in one write", async () => {
    const { monday, writes } = fakeMonday(elmItem());
    await savePropertyLead(monday, B, JOHN, "1", [
      { field: "status", from: "New Lead", to: "LA Signed" },
      { field: "laSigned", from: "", to: "2026-10-14" },
    ], "acct");
    expect(writes).toEqual([{ status: { label: "LA Signed" }, date_mkqetpd: { date: "2026-10-14" } }]);
  });

  it("refuses another broker's lead, and a value changed in Monday meanwhile, without writing", async () => {
    const { monday, writes } = fakeMonday(elmItem({ person: { text: "Emily Stein", value: people(25374507) } }));
    await expect(savePropertyLead(monday, B, JOHN, "1", [{ field: "listingPrice", from: "$12/sf NNN", to: "$1" }], "acct")).rejects.toThrow("belongs to Emily Stein");
    const mine = fakeMonday(elmItem({ text_mm6vgmah: { text: "$14/sf NNN" } }));
    await expect(savePropertyLead(mine.monday, B, JOHN, "1", [{ field: "listingPrice", from: "$12/sf NNN", to: "$13/sf NNN" }], "acct")).rejects.toThrow('now "$14/sf NNN"');
    expect([...writes, ...mine.writes]).toEqual([]);
  });
});
