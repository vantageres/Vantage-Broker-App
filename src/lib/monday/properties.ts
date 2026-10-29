import type { MondayClient } from "./client";

// The two property boards, read only: Properties New (suites in subitems) and
// the old Properties board, looked up together until the migration finishes.
// Column ids are the test boards' (read back from Monday on Oct 14, 2026). The sensitive columns (Key for Broker, loans,
// lender) are never requested, so they can't reach a search or a summary.

export type PropertyBoardKey = "propertiesNew" | "propertiesOld";

export interface PropertyBoard {
  key: PropertyBoardKey;
  label: string;
  boardId: string;
  columns: {
    status: string;
    location: string;
    broker: string;
    coBroker?: string;
    coBroker2?: string;
    deal: string; // Sale, Lease, Sale or Lease (Monday calls it "Property Type")
    // "Property Description" on these boards holds the type (Retail, Industrial…).
    type?: string;
    sqft?: string;
    acres?: string;
    price?: string;
    leaseType?: string;
  };
  suiteColumns?: {
    sqft: string;
    status: string;
    type: string;
    deal: string;
    leaseValue: string;
    expires: string;
  };
}

export const TEST_PROPERTY_BOARDS: Record<PropertyBoardKey, PropertyBoard> = {
  propertiesNew: {
    key: "propertiesNew",
    label: "Properties New",
    boardId: "18435327265",
    columns: { status: "status", location: "location", broker: "person", coBroker: "people", coBroker2: "multiple_person_mm6dtf87", deal: "status_15", leaseType: "text5" },
    suiteColumns: {
      sqft: "numbers15",
      status: "status6",
      type: "dropdown_mkp4t33a",
      deal: "color_mkqy6pz4",
      leaseValue: "numbers",
      expires: "date_mknyafwd",
    },
  },
  propertiesOld: {
    key: "propertiesOld",
    label: "Properties (old)",
    boardId: "18435327033",
    columns: {
      status: "status",
      location: "location",
      broker: "person",
      coBroker: "people",
      deal: "status_15",
      type: "dropdown97",
      sqft: "numbers7",
      acres: "numbers8",
      price: "numbers",
      leaseType: "text5",
    },
  },
};

// Live: Properties New (Brokerage workspace) and the old Properties board
// (Main workspace). Same columns as the test boards.
export const LIVE_PROPERTY_BOARDS: Record<PropertyBoardKey, PropertyBoard> = {
  propertiesNew: { ...TEST_PROPERTY_BOARDS.propertiesNew, boardId: "18420767182" },
  propertiesOld: { ...TEST_PROPERTY_BOARDS.propertiesOld, boardId: "5076736644" },
};

export interface Suite {
  id: string;
  name: string;
  sqft: number | null;
  status: string;
  type: string;
  deal: string;
  leaseValue: number | null;
  expires: string;
}

export interface MapPoint {
  lat: number;
  lng: number;
}

// A Monday location column's value: {"lat":"39.93","lng":"-74.89","address":"..."}.
export function pointOf(value: string | null | undefined): MapPoint | null {
  if (!value) return null;
  try {
    const v = JSON.parse(value) as { lat?: string | number; lng?: string | number };
    const lat = Number(v.lat), lng = Number(v.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? { lat, lng } : null;
  } catch {
    return null;
  }
}

export interface PropertyRecord {
  board: PropertyBoardKey;
  boardLabel: string;
  id: string;
  name: string;
  url: string;
  updatedAt: string;
  address: string;
  point: MapPoint | null; // where Monday's Location column puts it
  status: string;
  deal: string;
  types: string[]; // the property's own type, or its suites' types
  sqft: number | null;
  acres: number | null;
  price: number | null;
  leaseType: string;
  brokers: string;
  suites: Suite[];
}

interface RawColumn { id: string; text: string | null; value?: string | null }
interface RawItem {
  id: string;
  name: string;
  updated_at: string;
  column_values: RawColumn[];
  subitems?: { id: string; name: string; column_values: RawColumn[] }[] | null;
}

export function toNumber(text: string | null | undefined): number | null {
  if (!text) return null;
  const n = Number(text.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && text.trim() !== "" ? n : null;
}

const splitList = (text: string) => text.split(",").map((s) => s.trim()).filter(Boolean);

export function toPropertyRecord(board: PropertyBoard, item: RawItem, accountSlug: string): PropertyRecord {
  const text = (cols: RawColumn[], id: string | undefined) => (id ? cols.find((c) => c.id === id)?.text ?? "" : "");
  const c = board.columns;
  const t = (id: string | undefined) => text(item.column_values, id);
  const s = board.suiteColumns;
  const suites: Suite[] = s
    ? (item.subitems ?? []).map((sub) => ({
        id: sub.id,
        name: sub.name,
        sqft: toNumber(text(sub.column_values, s.sqft)),
        status: text(sub.column_values, s.status),
        type: text(sub.column_values, s.type),
        deal: text(sub.column_values, s.deal),
        leaseValue: toNumber(text(sub.column_values, s.leaseValue)),
        expires: text(sub.column_values, s.expires),
      }))
    : [];
  const types = c.type ? splitList(t(c.type)) : [...new Set(suites.flatMap((x) => splitList(x.type)))];
  return {
    board: board.key,
    boardLabel: board.label,
    id: item.id,
    name: item.name,
    url: `https://${accountSlug}.monday.com/boards/${board.boardId}/pulses/${item.id}`,
    updatedAt: item.updated_at,
    address: t(c.location),
    point: pointOf(item.column_values.find((x) => x.id === c.location)?.value),
    status: t(c.status),
    deal: t(c.deal),
    types,
    sqft: toNumber(t(c.sqft)),
    acres: toNumber(t(c.acres)),
    price: toNumber(t(c.price)),
    leaseType: t(c.leaseType),
    brokers: [t(c.broker), t(c.coBroker), t(c.coBroker2)].filter(Boolean).join(", "),
    suites,
  };
}

const ITEM_FIELDS = (withSuites: boolean) => `
  id name updated_at
  column_values(ids: $columns) { id text value }
  ${withSuites ? "subitems { id name column_values(ids: $suiteColumns) { id text } }" : ""}`;

export async function loadProperties(monday: MondayClient, board: PropertyBoard, accountSlug: string): Promise<PropertyRecord[]> {
  const withSuites = !!board.suiteColumns;
  const vars = `$columns: [String!]${withSuites ? ", $suiteColumns: [String!]" : ""}`;
  const firstQuery = `query ($board: ID!, ${vars}) {
    boards(ids: [$board]) { items_page(limit: 200) { cursor items { ${ITEM_FIELDS(withSuites)} } } }
  }`;
  const nextQuery = `query ($cursor: String!, ${vars}) {
    next_items_page(limit: 200, cursor: $cursor) { cursor items { ${ITEM_FIELDS(withSuites)} } }
  }`;
  const columns = Object.values(board.columns).filter(Boolean);
  const suiteColumns = board.suiteColumns ? Object.values(board.suiteColumns) : undefined;
  type Page = { cursor: string | null; items: RawItem[] };
  const first = await monday.query<{ boards: { items_page: Page }[] }>(firstQuery, { board: board.boardId, columns, ...(suiteColumns && { suiteColumns }) });
  let page = first.boards[0].items_page;
  const items = [...page.items];
  while (page.cursor) {
    page = (await monday.query<{ next_items_page: Page }>(nextQuery, { cursor: page.cursor, columns, ...(suiteColumns && { suiteColumns }) })).next_items_page;
    items.push(...page.items);
  }
  return items.map((item) => toPropertyRecord(board, item, accountSlug));
}
