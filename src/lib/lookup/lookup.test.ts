import { describe, expect, it } from "vitest";
import { askKind, isQuestion } from "./question";
import { findMentioned } from "./search";
import { TEST_BOARDS } from "../monday/boards";
import type { PersonRecord } from "../monday/records";

describe("isQuestion", () => {
  it.each([
    "What do we have on Garrison Foods?",
    "what do we have on garrison foods",
    "Who is Linda Park",
    "Any notes on Tom Alvarez?",
    "Look up Ray Fulton",
    "Show me Dave Reyes",
    "Linda Park?",
    "Is Linda still looking?",
    "Summarize open industrial requirements under 20k sf.",
    "List retail space in Haddonfield",
  ])("asks: %s", (t) => expect(isQuestion(t)).toBe(true));

  it.each([
    "Met Linda Park, needs 20 parking spaces, follow up Oct 28.",
    "Did a tour with Linda Park today. She wants 5,000 sf near 295.",
    "Had coffee with Ray Fulton",
    "Talked to Dave, he asked whether the landlord would cover fit-out, and whether the space has a loading dock and three-phase power?",
    "",
  ])("notes: %s", (t) => expect(isQuestion(t)).toBe(false));
});

function rec(key: "leads" | "contacts", id: string, name: string, businessName = "", updatedAt = "2026-10-01T00:00:00Z"): PersonRecord {
  return {
    board: TEST_BOARDS[key], id, name, businessName, updatedAt, url: "", phones: [], emails: [],
    contactBrokerIds: [], coBrokerIds: [], contactBrokerNames: "",
    current: { contactType: "", propertyType: "", budget: "", size: "", desiredLocation: "", notes: "", followUp: "", source: "", businessName, phone: "", email: "", status: "" },
  };
}

const records = [
  rec("leads", "1", "Linda Park", "Park Pediatrics"),
  rec("contacts", "2", "Greg Hollis", "Garrison Foods LLC"),
  rec("leads", "3", "Dave Reyes"),
  rec("contacts", "4", "Dave Moran", "Moran Logistics"),
  rec("leads", "5", "Greg Hollis", "Garrison Foods LLC"),
];

describe("findMentioned", () => {
  it("finds a business by its full name, Contacts first", () => {
    const hits = findMentioned("What do we have on Garrison Foods LLC?", records);
    expect(hits.map((h) => h.record.id)).toEqual(["2", "5"]);
    expect(hits[0].strength).toBe("strong");
  });

  it("a distinctive business word is a weak hit", () => {
    const hits = findMentioned("What do we have on Garrison Foods?", records);
    expect(hits.map((h) => h.record.id)).toEqual(["2", "5"]);
    expect(hits[0].strength).toBe("weak");
  });

  it("a full name beats first-name hits", () => {
    expect(findMentioned("Who is Dave Reyes?", records).map((h) => h.record.id)).toEqual(["3"]);
  });

  it("a first name alone lists everyone with it", () => {
    expect(findMentioned("Anything on Dave?", records).map((h) => h.record.id).sort()).toEqual(["3", "4"]);
  });

  it("handles possessives", () => {
    expect(findMentioned("What's Linda Park's requirement?", records).map((h) => h.record.id)).toEqual(["1"]);
  });

  it("finds nothing rather than guessing", () => {
    expect(findMentioned("What do we have on Acme Holdings?", records)).toEqual([]);
  });
});

describe("showPhone", () => {
  it("formats US numbers and leaves others alone", async () => {
    const { showPhone } = await import("./details");
    expect(showPhone("8565550123")).toBe("(856) 555-0123");
    expect(showPhone("+1 856 555 0123")).toBe("(856) 555-0123");
    expect(showPhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
  });
});

describe("askKind", () => {
  it.each([
    ["Can you summarize the retail properties we have in the 2,000 sq. ft. size?", "property"],
    ["Any listings for lease in Mount Laurel?", "property"],
    ["What industrial space is available around 15k sf?", "property"],
    ["Summarize open industrial requirements under 20k sf.", "summary"],
    ["Who is looking near Mount Laurel?", "summary"],
    ["Which clients need warehouse space?", "summary"],
    ["How many leads want retail?", "summary"],
    ["What do we have on Garrison Foods?", "record"],
    ["Linda Park?", "record"],
  ])("%s → %s", (q, kind) => expect(askKind(q)).toBe(kind));
});
