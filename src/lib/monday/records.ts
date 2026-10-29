import type { MondayClient } from "./client";
import type { PersonBoard } from "./boards";

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
  let page = first.boards[0].items_page;
  const items = [...page.items];
  while (page.cursor) {
    const next = await monday.query<{ next_items_page: Page }>(NEXT_QUERY, { cursor: page.cursor, columns });
    page = next.next_items_page;
    items.push(...page.items);
  }
  return items.map((item) => toPersonRecord(board, item, accountSlug));
}

// Every record on the board. Slow on the live boards (about 10 seconds for
// Leads and Contacts together), so only summaries use it.
export function loadPersonRecords(monday: MondayClient, board: PersonBoard, accountSlug: string): Promise<PersonRecord[]> {
  return readItems(monday, board, accountSlug);
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
  const rule = (column_id: string, values: string[]) => ({ column_id, compare_value: values, operator: "contains_text" as const });
  const rules = [
    ...(terms.words.length ? [rule("name", terms.words), rule(board.columns.businessName, terms.words)] : []),
    ...(terms.phones.length ? [rule(board.columns.phone, terms.phones)] : []),
    ...(terms.emails.length ? [rule(board.columns.email, terms.emails)] : []),
  ];
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
