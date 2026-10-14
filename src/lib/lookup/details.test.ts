import { describe, expect, it } from "vitest";
import { lookupAnswer } from "./details";
import { MondayError, type MondayClient } from "../monday/client";
import { TEST_BOARDS } from "../monday/boards";
import type { PersonRecord } from "../monday/records";

const record: PersonRecord = {
  board: TEST_BOARDS.leads, id: "1", name: "Maria Chen", businessName: "Harbor Coffee Co.", updatedAt: "2026-10-13T00:00:00Z", url: "u",
  phones: [], emails: [], contactBrokerIds: [], coBrokerIds: [], contactBrokerNames: "John Smyth",
  current: { contactType: "Leasee", propertyType: "", budget: "", size: "", desiredLocation: "", notes: "", followUp: "", source: "", businessName: "", phone: "", email: "", status: "", contactAddress: "" },
};

describe("lookupAnswer", () => {
  it("still answers when Monday refuses the updates", async () => {
    const monday: MondayClient = {
      async query<T>(q: string): Promise<T> {
        if (q.includes("updates(")) throw new MondayError("Monday rejected the request", [{ message: "missing required scopes: updates:read" }]);
        if (q.includes("timeline(")) return { timeline: { timeline_items_page: { timeline_items: [{ title: "Broker Note", content: "Wants a corner unit", created_at: "2026-10-14T00:00:00Z", user: { name: "John Smyth" } }] } } } as T;
        return { items: [{ column_values: [] }] } as T;
      },
    };
    const a = await lookupAnswer(monday, record, "acct");
    expect(a.fields.map((f) => f.label)).toContain("Contact Type");
    expect(a.notes.map((n) => n.text)).toEqual(["Wants a corner unit"]);
    expect(a.notesIncomplete).toBe(true);
    expect(a.problems[0]).toContain("updates:read");
    expect(a.propertiesUnknown).toBe(false);
  });
});
