import type { MondayClient } from "../monday/client";
import { pointOf, type MapPoint } from "../monday/properties";
import { SaveRefused, type Me } from "../monday/write";
import {
  FIELDS, LEAD_PROPERTY_TYPES, LISTING_TYPES, MONDAY_ONLY_STATUSES, SETTABLE_STATUSES, fieldDef, sameValue,
  type LeadChange, type LeadField,
} from "./fields";

// Property Leads on Monday: read, matched by name, and saved after approval.
// Ownership, status rules, value formats and "has it changed since you looked"
// are all checked here, on the server, just before the write.

export interface LeadBoard {
  boardId: string;
  files: string; // the Files column, for photos
  columns: Record<LeadField, string>;
  info: {
    broker: string; coBroker: string; coBroker2: string;
    location: string; county: string; zip: string; contact: string; created: string;
    inMarketing: string; onMarket: string; genFolder: string; folder: string;
  };
}

// Column ids read from Property Leads Test on Oct 14, 2026.
export const TEST_PROPERTY_LEADS: LeadBoard = {
  boardId: "18435327149",
  files: "file_mm83h46z",
  columns: {
    status: "status",
    listingType: "color_mkns3611",
    propertyType: "color_mm6vsvqf",
    listingPrice: "text_mm6vgmah",
    sizeAvailable: "text_mm6vfgyq",
    dateListed: "date_mm6vrwaj",
    listingExpiration: "date_mm6vnm21",
    laSigned: "date_mkqetpd",
    keyForBroker: "text_mm6v7x34",
    loans: "text_mm6v4ft7",
    currentOnLoans: "boolean_mm6v34ps",
    lender: "text_mm6v4b1z",
  },
  info: {
    broker: "person", coBroker: "multiple_person_mkpf12z8", coBroker2: "multiple_person_mm6vg1j1",
    location: "location_mkns33qb", county: "text_mkpfsz8c", zip: "text_mkpf5568", contact: "board_relation_mknsc95n",
    created: "date4", inMarketing: "date_mkqskhzq", onMarket: "date_mkqsb4aq", genFolder: "color_mknspbt0", folder: "link_mknsgzrv",
  },
};

export interface PropertyLeadRecord {
  id: string;
  name: string;
  url: string;
  updatedAt: string;
  ownerIds: string[];
  point: MapPoint | null;
  brokers: { broker: string; coBroker: string; coBroker2: string };
  values: Record<LeadField, string>;
  info: { location: string; county: string; zip: string; created: string; inMarketing: string; onMarket: string; genFolder: string; folderUrl: string };
  contacts: { name: string; url: string }[];
}

// What the broker's screen gets: sensitive values only for the people assigned.
export interface PropertyLeadView extends Omit<PropertyLeadRecord, "ownerIds" | "values" | "point"> {
  canEdit: boolean;
  values: Partial<Record<LeadField, string>>;
}

interface RawColumn {
  id: string;
  text: string | null;
  value: string | null;
  linked_items?: { id: string; name: string; board: { id: string } }[];
}
interface RawItem { id: string; name: string; updated_at: string; board?: { id: string }; column_values: RawColumn[] }

const COLUMN_FIELDS = `id text value ... on BoardRelationValue { linked_items { id name board { id } } }`;

function personIds(value: string | null): string[] {
  if (!value) return [];
  const parsed = JSON.parse(value) as { personsAndTeams?: { id: number; kind: string }[] };
  return (parsed.personsAndTeams ?? []).filter((p) => p.kind === "person").map((p) => String(p.id));
}

function allColumns(board: LeadBoard) {
  return [...Object.values(board.columns), ...Object.values(board.info)];
}

export function toLeadRecord(board: LeadBoard, item: RawItem, accountSlug: string): PropertyLeadRecord {
  const col = (id: string) => item.column_values.find((c) => c.id === id);
  const text = (id: string) => col(id)?.text ?? "";
  const i = board.info;
  const values = Object.fromEntries(
    FIELDS.map(({ field, kind }) => {
      const raw = text(board.columns[field]);
      // Monday shows a ticked checkbox as "v".
      return [field, kind === "checkbox" ? (raw ? "Yes" : "") : raw];
    }),
  ) as Record<LeadField, string>;
  let folderUrl = "";
  try {
    folderUrl = (JSON.parse(col(i.folder)?.value ?? "null") as { url?: string } | null)?.url ?? "";
  } catch {
    folderUrl = "";
  }
  return {
    id: item.id,
    name: item.name,
    url: `https://${accountSlug}.monday.com/boards/${board.boardId}/pulses/${item.id}`,
    updatedAt: item.updated_at,
    point: pointOf(col(i.location)?.value),
    ownerIds: [...new Set([i.broker, i.coBroker, i.coBroker2].flatMap((id) => personIds(col(id)?.value ?? null)))],
    brokers: { broker: text(i.broker), coBroker: text(i.coBroker), coBroker2: text(i.coBroker2) },
    values,
    info: {
      location: text(i.location), county: text(i.county), zip: text(i.zip), created: text(i.created),
      inMarketing: text(i.inMarketing), onMarket: text(i.onMarket), genFolder: text(i.genFolder), folderUrl,
    },
    contacts: (col(i.contact)?.linked_items ?? []).map((l) => ({ name: l.name, url: `https://${accountSlug}.monday.com/boards/${l.board.id}/pulses/${l.id}` })),
  };
}

export function leadView(record: PropertyLeadRecord, me: Me): PropertyLeadView {
  const canEdit = record.ownerIds.includes(me.id);
  const values = Object.fromEntries(
    FIELDS.filter((f) => canEdit || !f.sensitive).map((f) => [f.field, record.values[f.field]]),
  ) as Partial<Record<LeadField, string>>;
  const { ownerIds: _owners, values: _all, point: _point, ...rest } = record;
  void _owners;
  void _all;
  void _point;
  return { ...rest, canEdit, values };
}

export async function loadPropertyLeads(monday: MondayClient, board: LeadBoard, accountSlug: string): Promise<PropertyLeadRecord[]> {
  type Page = { cursor: string | null; items: RawItem[] };
  const columns = allColumns(board);
  const first = await monday.query<{ boards: { items_page: Page }[] }>(
    `query ($board: ID!, $columns: [String!]) { boards(ids: [$board]) { items_page(limit: 200) { cursor items { id name updated_at column_values(ids: $columns) { ${COLUMN_FIELDS} } } } } }`,
    { board: board.boardId, columns },
  );
  let page = first.boards[0]?.items_page ?? { cursor: null, items: [] };
  const items = [...page.items];
  while (page.cursor) {
    page = (await monday.query<{ next_items_page: Page }>(
      `query ($cursor: String!, $columns: [String!]) { next_items_page(limit: 200, cursor: $cursor) { cursor items { id name updated_at column_values(ids: $columns) { ${COLUMN_FIELDS} } } } }`,
      { cursor: page.cursor, columns },
    )).next_items_page;
    items.push(...page.items);
  }
  return items.map((item) => toLeadRecord(board, item, accountSlug));
}

const clean = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

// Which Property Leads the question names: the full name, the part before
// " - " ("22 Elm St Warehouse"), or a street address ("22 Elm St").
export function findLeads(question: string, leads: PropertyLeadRecord[]): PropertyLeadRecord[] {
  const q = clean(question);
  return leads.filter((lead) => {
    const full = clean(lead.name);
    const title = clean(lead.name.split(/\s+[-–]\s+/)[0]);
    const words = title.trim().split(" ");
    const address = /^\d/.test(words[0] ?? "") && words.length >= 3 ? ` ${words.slice(0, 3).join(" ")} ` : null;
    return [full, title, address].some((p) => p && p.trim().split(" ").length >= 2 && q.includes(p));
  });
}

// One approved change as Monday's column value. Anything that doesn't fit is refused.
export function leadColumnValue(board: LeadBoard, change: LeadChange, current: Record<LeadField, string>): [string, unknown] {
  const def = fieldDef(change.field);
  const v = change.to.trim();
  const col = board.columns[change.field];
  switch (change.field) {
    case "status": {
      if (MONDAY_ONLY_STATUSES[current.status]) throw new SaveRefused(`Status is "${current.status}", which is managed in Monday. Change it there.`);
      if (MONDAY_ONLY_STATUSES[v]) throw new SaveRefused(`"${v}" is set in Monday only. ${MONDAY_ONLY_STATUSES[v]}`);
      if (!(SETTABLE_STATUSES as readonly string[]).includes(v)) throw new SaveRefused(`"${v}" is not a Status option.`);
      return [col, { label: v }];
    }
    case "listingType":
      if (!(LISTING_TYPES as readonly string[]).includes(v)) throw new SaveRefused(`"${v}" is not a Listing Type option.`);
      return [col, { label: v }];
    case "propertyType":
      if (!(LEAD_PROPERTY_TYPES as readonly string[]).includes(v)) throw new SaveRefused(`"${v}" is not a Property Type option.`);
      return [col, { label: v }];
    case "currentOnLoans":
      if (v !== "Yes" && v !== "") throw new SaveRefused("Current On Loan Payments is Yes or No.");
      return [col, v === "Yes" ? { checked: "true" } : null];
    default:
      if (def.kind === "date") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new SaveRefused(`${def.label} needs a date. To clear it, use Monday.`);
        return [col, { date: v }];
      }
      return [col, v];
  }
}

// One Property Lead, read fresh just before a write, and only if the broker
// is its Broker, Co-Broker or Co-Broker2.
export async function readOwnedLead(monday: MondayClient, board: LeadBoard, me: Me, itemId: string, accountSlug: string): Promise<PropertyLeadRecord> {
  const data = await monday.query<{ items: RawItem[] }>(
    `query ($id: [ID!], $columns: [String!]) { items(ids: $id) { id name updated_at board { id } column_values(ids: $columns) { ${COLUMN_FIELDS} } } }`,
    { id: [itemId], columns: allColumns(board) },
  );
  const item = data.items[0];
  if (!item || item.board?.id !== board.boardId) throw new SaveRefused("That Property Lead no longer exists.");
  const record = toLeadRecord(board, item, accountSlug);
  if (!record.ownerIds.includes(me.id)) {
    const owners = leadOwners(record) || "no one";
    throw new SaveRefused(`This Property Lead belongs to ${owners}. Only its Broker, Co-Broker or Co-Broker2 can change it.`, owners);
  }
  return record;
}

export const leadOwners = (record: Pick<PropertyLeadRecord, "brokers">) =>
  [record.brokers.broker, record.brokers.coBroker, record.brokers.coBroker2].filter(Boolean).join(", ");

export interface LeadSaveResult {
  record: PropertyLeadRecord;
  changed: number;
}

export async function savePropertyLead(
  monday: MondayClient,
  board: LeadBoard,
  me: Me,
  itemId: string,
  changes: LeadChange[],
  accountSlug: string,
): Promise<LeadSaveResult> {
  if (!changes.length) throw new SaveRefused("There are no changes to save.");
  const known = new Set(FIELDS.map((f) => f.field));
  if (changes.some((c) => !known.has(c.field))) throw new SaveRefused("That field can't be changed from the app.");

  const record = await readOwnedLead(monday, board, me, itemId, accountSlug);
  for (const c of changes) {
    if (!sameValue(record.values[c.field], c.from)) {
      throw new SaveRefused(`${fieldDef(c.field).label} was changed in Monday since you opened this (it's now "${record.values[c.field] || "empty"}"). Look it up again before changing it.`);
    }
  }
  const values = Object.fromEntries(changes.map((c) => leadColumnValue(board, c, record.values)));

  await monday.query(
    `mutation ($board: ID!, $item: ID!, $values: JSON!) {
       change_multiple_column_values(board_id: $board, item_id: $item, column_values: $values, create_labels_if_missing: false) { id }
     }`,
    { board: board.boardId, item: itemId, values: JSON.stringify(values) },
  );

  // Read back what Monday holds now, so the screen shows what was written.
  const after = await monday.query<{ items: RawItem[] }>(
    `query ($id: [ID!], $columns: [String!]) { items(ids: $id) { id name updated_at column_values(ids: $columns) { ${COLUMN_FIELDS} } } }`,
    { id: [itemId], columns: allColumns(board) },
  );
  return { record: toLeadRecord(board, after.items[0], accountSlug), changed: changes.length };
}
