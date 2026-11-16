import type { MondayClient } from "../monday/client";
import type { PersonBoard } from "../monday/boards";
import { SaveRefused, type Me } from "../monday/write";
import type { Proposal } from "../capture/proposal";
import { LEAD_PROPERTY_TYPES, LISTING_TYPES } from "./fields";
import { readOwnedLead, type LeadBoard, type PropertyLeadRecord } from "./board";

// Creating a Property Lead: any broker can, and becomes its Broker. Nothing
// is created until the broker approves the card; every value is checked here,
// on the server, before Monday is asked.

export interface ContactOption {
  board: "leads" | "contacts";
  boardLabel: string;
  id: string;
  name: string;
  url: string;
  owner: string;
  matchedOn: string[];
  // Property Contacts links only to the boards its Monday settings connect
  // (today, Contacts only): a record on another board can't be linked yet.
  linkable: boolean;
}

export interface NewPropertyLeadProposal {
  noteText: string;
  name: string; // the address, as the Property Lead's name
  location: { lat: number; lng: number; address: string } | null;
  locationProblem?: string; // why the address wasn't placed on the map
  values: { listingType?: string; propertyType?: string; listingPrice?: string; sizeAvailable?: string };
  questions: { field: string; question: string }[];
  // The person the note names to contact about the property.
  contact: null | {
    name: string;
    candidates: ContactOption[]; // closest matches, Contacts first
    recommended?: string; // a Contact that clearly matches
    newLead: Proposal; // to add them as a new Lead instead
    newLeadLinkable: boolean; // a new Lead can be linked once saved (Property Contacts connects to Leads)
  };
}

// Which boards the Property Contacts column connects to, from its settings
// in Monday. Read fresh before every link.
export async function linkableBoards(monday: MondayClient, board: LeadBoard): Promise<string[]> {
  const data = await monday.query<{ boards: { columns: { settings_str: string }[] }[] }>(
    `query ($board: [ID!], $col: [String!]) { boards(ids: $board) { columns(ids: $col) { settings_str } } }`,
    { board: [board.boardId], col: [board.info.contact] },
  );
  try {
    const settings = JSON.parse(data.boards?.[0]?.columns?.[0]?.settings_str ?? "{}") as { boardIds?: (number | string)[] };
    return (settings.boardIds ?? []).map(String);
  } catch {
    return [];
  }
}

// Says why a record can't be linked, naming the board it's on.
export function notLinkableReason(board: Pick<PersonBoard, "key">): string {
  return `Property Contacts in Monday doesn't connect to the ${board.key === "leads" ? "Leads" : "Contacts"} board, so this record can't be linked yet.`;
}

// The record must be on a board Property Contacts connects to. Returns its id.
async function checkLinkable(monday: MondayClient, board: LeadBoard, id: string): Promise<string> {
  if (!/^\d+$/.test(id)) throw new SaveRefused("That contact can't be linked.");
  const [found, boards] = await Promise.all([
    monday.query<{ items: { board: { id: string } }[] }>(`query ($id: [ID!]) { items(ids: $id) { board { id } } }`, { id: [id] }),
    linkableBoards(monday, board),
  ]);
  if (!boards.includes(String(found.items[0]?.board.id))) throw new SaveRefused("Property Contacts in Monday doesn't connect to that record's board, so it can't be linked.");
  return id;
}

// Adds a record to a Property Lead's Property Contacts (a new owner Lead,
// once saved). Only the Property Lead's brokers can; links already there stay.
export async function linkPropertyContact(monday: MondayClient, board: LeadBoard, me: Me, itemId: string, contactId: string, accountSlug: string): Promise<PropertyLeadRecord> {
  await readOwnedLead(monday, board, me, itemId, accountSlug);
  const id = await checkLinkable(monday, board, String(contactId));
  const current = await monday.query<{ items: { column_values: { linked_item_ids?: string[] }[] }[] }>(
    `query ($id: [ID!], $col: [String!]) { items(ids: $id) { column_values(ids: $col) { ... on BoardRelationValue { linked_item_ids } } } }`,
    { id: [itemId], col: [board.info.contact] },
  );
  const ids = current.items[0]?.column_values[0]?.linked_item_ids ?? [];
  if (!ids.includes(id)) {
    await monday.query(
      `mutation ($board: ID!, $item: ID!, $values: JSON!) { change_multiple_column_values(board_id: $board, item_id: $item, column_values: $values) { id } }`,
      { board: board.boardId, item: itemId, values: JSON.stringify({ [board.info.contact]: { item_ids: [...ids, id].map(Number) } }) },
    );
  }
  return readOwnedLead(monday, board, me, itemId, accountSlug);
}

export interface CreatePropertyLeadRequest {
  name: string;
  location?: { lat: number; lng: number; address: string } | null;
  values: NewPropertyLeadProposal["values"];
  linkContact?: string; // an item on the Contacts board
}

const TEXT_MAX = 200;

export async function createPropertyLead(
  monday: MondayClient,
  board: LeadBoard,
  me: Me,
  request: CreatePropertyLeadRequest,
  accountSlug: string,
): Promise<PropertyLeadRecord> {
  const name = String(request.name ?? "").trim();
  if (!name) throw new SaveRefused("A Property Lead needs an address.");
  if (name.length > TEXT_MAX) throw new SaveRefused("That address is too long.");
  const v = request.values ?? {};
  const columnValues: Record<string, unknown> = {
    [board.info.broker]: { personsAndTeams: [{ id: Number(me.id), kind: "person" }] },
  };
  if (v.listingType) {
    if (!(LISTING_TYPES as readonly string[]).includes(v.listingType)) throw new SaveRefused(`"${v.listingType}" is not a Listing Type option.`);
    columnValues[board.columns.listingType] = { label: v.listingType };
  }
  if (v.propertyType) {
    if (!(LEAD_PROPERTY_TYPES as readonly string[]).includes(v.propertyType)) throw new SaveRefused(`"${v.propertyType}" is not a Property Type option.`);
    columnValues[board.columns.propertyType] = { label: v.propertyType };
  }
  for (const [field, column] of [["listingPrice", board.columns.listingPrice], ["sizeAvailable", board.columns.sizeAvailable]] as const) {
    const text = String(v[field] ?? "").trim();
    if (text.length > TEXT_MAX) throw new SaveRefused("That value is too long.");
    if (text) columnValues[column] = text;
  }
  const loc = request.location;
  if (loc) {
    if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng) || typeof loc.address !== "string") throw new SaveRefused("The location couldn't be read.");
    columnValues[board.info.location] = { lat: String(loc.lat), lng: String(loc.lng), address: loc.address };
  }
  if (request.linkContact) {
    columnValues[board.info.contact] = { item_ids: [Number(await checkLinkable(monday, board, String(request.linkContact)))] };
  }

  const created = await monday.query<{ create_item: { id: string } }>(
    `mutation ($board: ID!, $name: String!, $values: JSON!) {
       create_item(board_id: $board, item_name: $name, column_values: $values, create_labels_if_missing: false) { id }
     }`,
    { board: board.boardId, name, values: JSON.stringify(columnValues) },
  );
  // Read back what Monday holds, so the card shows what was written.
  return readOwnedLead(monday, board, me, created.create_item.id, accountSlug);
}
