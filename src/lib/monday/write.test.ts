import { describe, expect, it } from "vitest";
import { TEST_BOARDS } from "./boards";
import type { MondayClient } from "./client";
import { claimRecord, columnValue, saveProposal, SaveRefused } from "./write";

const ME = { id: "1", name: "John Smyth" };

// A stand-in Monday that answers owner reads and records every mutation.
function fakeMonday(owners: { contactBroker?: number[]; coBrokers?: number[]; names?: string }[]) {
  const mutations: { query: string; vars: Record<string, unknown> }[] = [];
  let reads = 0;
  const client: MondayClient = {
    async query<T>(query: string, vars: Record<string, unknown> = {}) {
      if (query.trim().startsWith("mutation")) {
        mutations.push({ query, vars });
        return { create_item: { id: "new1" } } as T;
      }
      const o = owners[Math.min(reads++, owners.length - 1)];
      const people = (list?: number[]) =>
        list?.length ? JSON.stringify({ personsAndTeams: list.map((id) => ({ id, kind: "person" })) }) : null;
      return {
        items: [{
          name: "Linda Park",
          board: { id: TEST_BOARDS.leads.boardId },
          column_values: [
            { id: "person", text: o.names ?? "", value: people(o.contactBroker) },
            { id: "people", text: "", value: people(o.coBrokers) },
          ],
        }],
      } as T;
    },
  };
  return { client, mutations };
}

const existing = { kind: "existing" as const, board: "leads" as const, id: "42" };

describe("saveProposal", () => {
  it("writes changes and the Broker Note for the Contact Broker", async () => {
    const { client, mutations } = fakeMonday([{ contactBroker: [1], names: "John Smyth" }]);
    const result = await saveProposal(client, TEST_BOARDS, ME, {
      target: existing,
      changes: [{ field: "followUp", value: "2026-10-28" }, { field: "notes", value: "ADA access. Needs parking" }],
      noteText: "Linda called.",
    });
    expect(result).toMatchObject({ fieldsChanged: 2, noteAdded: true });
    expect(JSON.parse(mutations[0].vars.values as string)).toEqual({
      date_mkqpryjm: { date: "2026-10-28" },
      text: "ADA access. Needs parking",
    });
    expect(mutations[1].query).toContain("create_timeline_item");
  });

  it("lets a Co-Broker save", async () => {
    const { client } = fakeMonday([{ contactBroker: [2], coBrokers: [1], names: "Emily Stein" }]);
    await expect(saveProposal(client, TEST_BOARDS, ME, { target: existing, changes: [], noteText: "x" })).resolves.toBeTruthy();
  });

  it("refuses and names the owner when the record became someone else's", async () => {
    const { client, mutations } = fakeMonday([{ contactBroker: [2], names: "Emily Stein" }]);
    await expect(saveProposal(client, TEST_BOARDS, ME, { target: existing, changes: [], noteText: "x" }))
      .rejects.toMatchObject({ owner: "Emily Stein" });
    expect(mutations).toEqual([]);
  });

  it("creates a new Lead with the broker as Contact Broker and status New Lead", async () => {
    const { client, mutations } = fakeMonday([{}]);
    await saveProposal(client, TEST_BOARDS, ME, {
      target: { kind: "new-lead" },
      changes: [{ field: "name", value: "Pat Lee" }, { field: "contactType", value: "Buyer" }],
      noteText: "Met Pat.",
    });
    const values = JSON.parse(mutations[0].vars.values as string);
    expect(mutations[0].vars.name).toBe("Pat Lee");
    expect(values.person).toEqual({ personsAndTeams: [{ id: 1, kind: "person" }] });
    expect(values.color_mkpme1c1).toEqual({ label: "New Lead" });
    expect(values.contact_type9).toEqual({ label: "Buyer" });
  });
});

describe("columnValue", () => {
  const leads = TEST_BOARDS.leads;
  it("refuses values that don't fit the column", () => {
    expect(() => columnValue(leads, { field: "followUp", value: "March" })).toThrow(SaveRefused);
    expect(() => columnValue(leads, { field: "budget", value: "$9/sf" })).toThrow(SaveRefused);
    expect(() => columnValue(leads, { field: "contactType", value: "Tenant" })).toThrow(SaveRefused);
    expect(() => columnValue(leads, { field: "desiredLocation", value: "Marlton, NJ" })).toThrow(SaveRefused);
    expect(() => columnValue(leads, { field: "phone", value: "555-01" })).toThrow(SaveRefused);
  });

  it("formats values Monday's way", () => {
    expect(columnValue(leads, { field: "budget", value: "$650,000" })).toEqual(["numeric_mm7yt73y", "650000"]);
    expect(columnValue(leads, { field: "propertyType", value: "Industrial, Office" })).toEqual(["dropdown_mkqsh3rg", { labels: ["Industrial", "Office"] }]);
    expect(columnValue(leads, { field: "phone", value: "(856) 555-0142" })).toEqual(["phone", { phone: "8565550142", countryShortName: "US" }]);
  });
});

describe("claimRecord", () => {
  it("claims an unassigned record", async () => {
    const { client, mutations } = fakeMonday([{}, { contactBroker: [1], names: "John Smyth" }]);
    await expect(claimRecord(client, TEST_BOARDS.leads, "42", ME)).resolves.toEqual({ name: "Linda Park" });
    expect(mutations).toHaveLength(1);
  });

  it("names the broker who claimed it first", async () => {
    const { client, mutations } = fakeMonday([{ contactBroker: [2], names: "Emily Stein" }]);
    await expect(claimRecord(client, TEST_BOARDS.leads, "42", ME)).rejects.toMatchObject({ owner: "Emily Stein" });
    expect(mutations).toEqual([]);
  });

  it("reports a claim lost in the moment between read and write", async () => {
    const { client } = fakeMonday([{}, { contactBroker: [2], names: "Emily Stein" }]);
    await expect(claimRecord(client, TEST_BOARDS.leads, "42", ME)).rejects.toMatchObject({ owner: "Emily Stein" });
  });
});
