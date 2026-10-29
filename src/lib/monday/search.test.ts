import { describe, expect, it } from "vitest";
import type { MondayClient } from "./client";
import { TEST_BOARDS, type PersonBoard } from "./boards";
import { loadPersonRecords, searchPersonRecords, type PersonRecord } from "./records";
import { findMatches, matchTerms, type MatchQuery } from "../matching";
import { findMentioned, questionTerms } from "../lookup/search";

// A stand-in for Monday's items_page search: each rule keeps items whose
// column text contains one of its values, ignoring case; rules are OR'd.
interface FakeItem {
  name: string;
  business?: string;
  phone?: string;
  email?: string;
}

function fakeMonday(board: PersonBoard, items: FakeItem[], log: unknown[] = []): MondayClient {
  const c = board.columns;
  const raw = items.map((it, i) => ({
    id: String(i + 1),
    name: it.name,
    updated_at: "2026-10-01T00:00:00Z",
    column_values: [
      { id: c.businessName, text: it.business ?? "", value: null },
      { id: c.phone, text: it.phone ?? "", value: it.phone ? JSON.stringify({ phone: it.phone }) : null },
      { id: c.email, text: it.email ?? "", value: it.email ? JSON.stringify({ email: it.email, text: it.email }) : null },
    ],
  }));
  const textOf = (item: (typeof raw)[number], column: string) =>
    column === "name" ? item.name : item.column_values.find((v) => v.id === column)?.text ?? "";
  return {
    async query<T>(_q: string, variables: Record<string, unknown> = {}): Promise<T> {
      const query = variables.query as { rules: { column_id: string; compare_value: string[] }[] } | undefined;
      log.push(query);
      const kept = query
        ? raw.filter((item) => query.rules.some((r) => r.compare_value.some((v) => textOf(item, r.column_id).toLowerCase().includes(v.toLowerCase()))))
        : raw;
      return { boards: [{ items_page: { cursor: null, items: kept } }] } as T;
    },
  };
}

const PEOPLE: FakeItem[] = [
  { name: "Dave Reyes", business: "Garrison Foods", phone: "18565550142", email: "dave.reyes@garrisonfoods.example" },
  { name: "Dave Morales", business: "Brightline Dental", phone: "6095550187" },
  { name: "David Reyes" },
  { name: "Linda Park", business: "Park Medical Group", phone: "8565550175", email: "linda@parkmedical.example" },
  { name: "Kevin O'Brien", business: "O'Brien & Sons" },
  { name: "Al Ng" },
  { name: "Maria Chen", business: "Harbor Coffee Co." },
  { name: "Greg Hollis", business: "Garrison Foods LLC" },
];

const board = TEST_BOARDS.leads;
const all = () => loadPersonRecords(fakeMonday(board, PEOPLE), board, "x");
const ids = (rs: PersonRecord[]) => rs.map((r) => r.id).sort();

describe("searchPersonRecords", () => {
  it("asks for nothing when there is nothing to search for", async () => {
    const log: unknown[] = [];
    const found = await searchPersonRecords(fakeMonday(board, PEOPLE, log), board, "x", { words: [], phones: [], emails: [] });
    expect(found).toEqual([]);
    expect(log).toEqual([]); // the whole board was never read
  });

  it("searches name and business for words, and the phone and email columns", async () => {
    const log: unknown[] = [];
    await searchPersonRecords(fakeMonday(board, PEOPLE, log), board, "x", { words: ["reyes"], phones: ["8565550142"], emails: ["a@b.example"] });
    expect(log[0]).toEqual({
      operator: "or",
      rules: [
        { column_id: "name", compare_value: ["reyes"], operator: "contains_text" },
        { column_id: board.columns.businessName, compare_value: ["reyes"], operator: "contains_text" },
        { column_id: board.columns.phone, compare_value: ["8565550142"], operator: "contains_text" },
        { column_id: board.columns.email, compare_value: ["a@b.example"], operator: "contains_text" },
      ],
    });
  });
});

describe("matchTerms", () => {
  it("uses the name's words, digits-only phones and lower-case emails", () => {
    expect(matchTerms([{ name: "Dave Reyes", businessName: "Garrison Foods", phones: ["+1 (856) 555-0142", "12"], emails: ["Dave@X.example"] }]))
      .toEqual({ words: ["dave", "reyes"], phones: ["8565550142"], emails: ["dave@x.example"] });
  });

  it("keeps a short last name and a one-word name", () => {
    expect(matchTerms([{ name: "Al Ng", businessName: null, phones: [], emails: [] }]).words).toEqual(["ng"]);
    expect(matchTerms([{ name: "Al", businessName: null, phones: [], emails: [] }]).words).toEqual(["al"]);
  });

  // Whatever the full-board matching accepts, the search must bring back.
  it.each<MatchQuery>([
    { name: "Dave Reyes", businessName: "Garrison Foods", phones: [], emails: [] },
    { name: "Dave", businessName: null, phones: [], emails: [] },
    { name: "Dave R", businessName: null, phones: [], emails: [] },
    { name: "D. Reyes", businessName: null, phones: [], emails: [] },
    { name: "Kevin O'Brien", businessName: null, phones: [], emails: [] },
    { name: "Al Ng", businessName: null, phones: [], emails: [] },
    { name: null, businessName: "Garrison Foods", phones: ["(856) 555-0142"], emails: [] },
    { name: "Someone Else", businessName: null, phones: [], emails: ["LINDA@parkmedical.example"] },
  ])("finds what full matching finds: %o", async (query) => {
    const everyone = await all();
    const candidates = await searchPersonRecords(fakeMonday(board, PEOPLE), board, "x", matchTerms([query]));
    const full = findMatches(query, everyone);
    const narrowed = findMatches(query, candidates);
    expect(narrowed).toEqual(full);
  });
});

describe("questionTerms", () => {
  it("leaves out question words", () => {
    expect(questionTerms("What do we have on Garrison Foods?").words).toEqual(["garrison", "foods"]);
    expect(questionTerms("Who is Linda Park's broker").words).toEqual(["linda", "park", "broker"]);
  });

  it.each([
    "What do we have on Garrison Foods LLC?",
    "Who is Linda Park",
    "Any notes on Reyes?",
    "Look up Kevin O'Brien",
    "What about Harbor Coffee?",
    "Who is Dave?",
    "Linda Park?",
  ])("finds what a full read finds: %s", async (question) => {
    const everyone = await all();
    const candidates = await searchPersonRecords(fakeMonday(board, PEOPLE), board, "x", questionTerms(question));
    const full = findMentioned(question, everyone);
    expect(full.length).toBeGreaterThan(0);
    expect(findMentioned(question, candidates)).toEqual(full);
  });

  it("finds nothing when the question names no one", async () => {
    const candidates = await searchPersonRecords(fakeMonday(board, PEOPLE), board, "x", questionTerms("Who is Zelda Quinn at Acme?"));
    expect(ids(candidates)).toEqual([]);
  });
});
