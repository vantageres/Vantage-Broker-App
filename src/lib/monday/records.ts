import { BoardHidden, type MondayClient } from "./client";
import type { PersonBoard } from "./boards";
import { pointOf, type MapPoint } from "./properties";

// A Lead or Contact as the app sees it: identity fields for matching, owners
// for permission checks, and current values for the approval screen.
export interface PersonRecord {
  board: PersonBoard;
  id: string;
  name: string;
  url: string;
  updatedAt: string;
  businessName: string;
  phones: string[];
  emails: string[];
  contactBrokerIds: string[];
  coBrokerIds: string[];
  contactBrokerNames: string;
  current: Record<RequirementField, string>;
  desiredPoint?: MapPoint | null; // Desired Location on the map, when Monday has it
}

export type RequirementField =
  | "contactType" | "propertyType" | "budget" | "size" | "desiredLocation"
  | "notes" | "followUp" | "source" | "businessName" | "phone" | "email" | "status" | "contactAddress";

interface RawColumn {
  id: string;
  text: string | null;
  value: string | null;
}

interface RawItem {
  id: string;
  name: string;
  updated_at: string;
  column_values: RawColumn[];
}

// Phone numbers compare as digits only, without a leading US country code.
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

// A field can hold more than one address ("a@x.com, b@y.com").
export function splitEmails(raw: string): string[] {
  return (raw.match(/[^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+/g) ?? []).map((e) => e.toLowerCase());
}

function personIds(value: string | null): string[] {
  if (!value) return [];
  const parsed = JSON.parse(value) as { personsAndTeams?: { id: number; kind: string }[] };
  return (parsed.personsAndTeams ?? []).filter((p) => p.kind === "person").map((p) => String(p.id));
}

export function toPersonRecord(board: PersonBoard, item: RawItem, accountSlug: string): PersonRecord {
  const col = (id: string | undefined) => item.column_values.find((c) => c.id === id);
  const text = (id: string | undefined) => col(id)?.text ?? "";
  const c = board.columns;

  const phones: string[] = [];
  const phoneValue = col(c.phone)?.value;
  if (phoneValue) phones.push(normalizePhone((JSON.parse(phoneValue) as { phone?: string }).phone ?? ""));

  const emails = new Set<string>();
  const emailValue = col(c.email)?.value;
  if (emailValue) {
    const parsed = JSON.parse(emailValue) as { email?: string; text?: string };
    for (const e of splitEmails(`${parsed.email ?? ""} ${parsed.text ?? ""}`)) emails.add(e);
  }

  return {
    board,
    id: item.id,
    name: item.name,
    url: `https://${accountSlug}.monday.com/boards/${board.boardId}/pulses/${item.id}`,
    updatedAt: item.updated_at,
    businessName: text(c.businessName),
    phones: phones.filter(Boolean),
    emails: [...emails],
    contactBrokerIds: personIds(col(c.contactBroker)?.value ?? null),
    coBrokerIds: personIds(col(c.coBrokers)?.value ?? null),
    contactBrokerNames: text(c.contactBroker),
    desiredPoint: pointOf(col(c.desiredLocation)?.value),
    current: {
      contactType: text(c.contactType),
      propertyType: text(c.propertyType),
      budget: text(c.budget),
      size: text(c.size),
      desiredLocation: text(c.desiredLocation),
      notes: text(c.notes),
      followUp: text(c.followUp),
      source: text(c.source),
      businessName: text(c.businessName),
      phone: text(c.phone),
      email: text(c.email),
      status: text(c.status),
      contactAddress: text(c.contactAddress),
    },
  };
}

const ITEMS_QUERY = `
  query ($board: ID!, $columns: [String!], $query: ItemsQuery) {
    boards(ids: [$board]) {
      items_page(limit: 500, query_params: $query) {
        cursor
        items { id name updated_at column_values(ids: $columns) { id text value } }
      }
    }
  }`;

const NEXT_QUERY = `
  query ($cursor: String!, $columns: [String!]) {
    next_items_page(limit: 500, cursor: $cursor) {
      cursor
      items { id name updated_at column_values(ids: $columns) { id text value } }
    }
  }`;

const BY_ID_QUERY = `
  query ($ids: [ID!], $columns: [String!]) {
    items(ids: $ids) { id name updated_at board { id } column_values(ids: $columns) { id text value } }
  }`;

const boardName = (board: PersonBoard) => (board.key === "leads" ? "the Leads board" : "the Contacts board");

interface ItemsQuery {
  operator: "or";
  rules: { column_id: string; compare_value: string[]; operator: "contains_text" }[];
}

async function readItems(monday: MondayClient, board: PersonBoard, accountSlug: string, query?: ItemsQuery): Promise<PersonRecord[]> {
  const columns = Object.values(board.columns);
  type Page = { cursor: string | null; items: RawItem[] };
  const first = await monday.query<{ boards: { items_page: Page }[] }>(ITEMS_QUERY, {
    board: board.boardId,
    columns,
    query,
  });
  if (!first.boards[0]) throw new BoardHidden(boardName(board));
  let page = first.boards[0].items_page;
  const items = [...page.items];
  while (page.cursor) {
    const next = await monday.query<{ next_items_page: Page }>(NEXT_QUERY, { cursor: page.cursor, columns });
    page = next.next_items_page;
    items.push(...page.items);
  }
  return items.map((item) => toPersonRecord(board, item, accountSlug));
}

const IDS_QUERY = `
  query ($board: ID!) { boards(ids: [$board]) { items_page(limit: 500) { cursor items { id } } } }`;
const NEXT_IDS_QUERY = `
  query ($cursor: String!) { next_items_page(limit: 500, cursor: $cursor) { cursor items { id } } }`;
const ITEMS_BY_IDS = `
  query ($ids: [ID!], $columns: [String!]) {
    items(ids: $ids, limit: 100) { id name updated_at column_values(ids: $columns) { id text value } }
  }`;
const BATCH = 100;
const PARALLEL = 15;

// Every record on the board. Monday pages through a board 500 items at a
// time, one page after another, which took 13 seconds for live Leads. Ids
// alone page quickly, and the records are then read 100 at a time in
// parallel (up to 15 requests at once): about 5 seconds. Only summaries
// read whole boards.
export async function loadPersonRecords(monday: MondayClient, board: PersonBoard, accountSlug: string): Promise<PersonRecord[]> {
  type IdPage = { cursor: string | null; items: { id: string }[] };
  const visible = (await monday.query<{ boards: { items_page: IdPage }[] }>(IDS_QUERY, { board: board.boardId })).boards[0];
  if (!visible) throw new BoardHidden(boardName(board));
  let page = visible.items_page;
  const ids = page.items.map((i) => i.id);
  while (page.cursor) {
    page = (await monday.query<{ next_items_page: IdPage }>(NEXT_IDS_QUERY, { cursor: page.cursor })).next_items_page;
    ids.push(...page.items.map((i) => i.id));
  }
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH));
  const columns = Object.values(board.columns);
  const items: RawItem[] = [];
  for (let i = 0; i < batches.length; i += PARALLEL) {
    const read = await Promise.all(batches.slice(i, i + PARALLEL).map((chunk) =>
      monday.query<{ items: RawItem[] }>(ITEMS_BY_IDS, { ids: chunk, columns })));
    for (const r of read) items.push(...r.items);
  }
  return items.map((item) => toPersonRecord(board, item, accountSlug));
}

// What to ask Monday for: words found in a name or business name, phone
// numbers (digits only) and email addresses.
export interface SearchTerms {
  words: string[];
  phones: string[];
  emails: string[];
}

// Monday narrows the board to records whose name, business name, phone or
// email contains one of the terms (any case, any part of a word). It returns
// candidates only: the app's own matching rules then decide what counts, so
// the terms must cover everything those rules could match.
export function searchPersonRecords(monday: MondayClient, board: PersonBoard, accountSlug: string, terms: SearchTerms): Promise<PersonRecord[]> {
  return recordsContaining(monday, board, accountSlug, [
    { column: "name", values: terms.words },
    { column: board.columns.businessName, values: terms.words },
    { column: board.columns.phone, values: terms.phones },
    { column: board.columns.email, values: terms.emails },
  ]);
}

// Records where any of the columns contains any of its values (any case, any
// part of a word). Columns with no values are left out of the search.
export function recordsContaining(
  monday: MondayClient,
  board: PersonBoard,
  accountSlug: string,
  wanted: { column: string; values: string[] }[],
): Promise<PersonRecord[]> {
  const rules = wanted.filter((w) => w.values.length)
    .map((w) => ({ column_id: w.column, compare_value: w.values, operator: "contains_text" as const }));
  // No rules would mean the whole board.
  if (!rules.length) return Promise.resolve([]);
  return readItems(monday, board, accountSlug, { operator: "or", rules });
}

// One record, read fresh (after the broker picks it from a list).
export async function loadPersonRecord(monday: MondayClient, board: PersonBoard, id: string, accountSlug: string): Promise<PersonRecord | null> {
  const data = await monday.query<{ items: (RawItem & { board: { id: string } })[] }>(BY_ID_QUERY, {
    ids: [id],
    columns: Object.values(board.columns),
  });
  const item = data.items[0];
  return item && String(item.board.id) === board.boardId ? toPersonRecord(board, item, accountSlug) : null;
}
