import type { MondayClient } from "../monday/client";
import { SaveRefused, type Me } from "../monday/write";
import { LEAD_PROPERTY_TYPES, LISTING_TYPES } from "./fields";
import { readOwnedLead, type LeadBoard, type PropertyLeadRecord } from "./board";

// Creating a Property Lead: any broker can, and becomes its Broker. Nothing
// is created until the broker approves the card; every value is checked here,
// on the server, before Monday is asked.

// A Contact that could be the person to call about the property. Property
// Contacts links to the Contacts board only: someone reaches this stage once
// qualified, so the app never creates a Contact or a Lead here. When no
// Contact fits, the broker links one in Monday later.
export interface ContactOption {
  id: string;
  name: string;
  url: string;
  owner: string; // the Contact's Contact Broker
  matchedOn: string[];
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
    candidates: ContactOption[]; // the closest Contacts
    recommended?: string; // a Contact that clearly matches
  };
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
  contactsBoardId: string,
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
    const id = String(request.linkContact);
    if (!/^\d+$/.test(id)) throw new SaveRefused("That contact can't be linked.");
    const found = await monday.query<{ items: { board: { id: string } }[] }>(`query ($id: [ID!]) { items(ids: $id) { board { id } } }`, { id: [id] });
    if (String(found.items[0]?.board.id) !== contactsBoardId) throw new SaveRefused("Only a record on the Contacts board can be linked to a Property Lead.");
    columnValues[board.info.contact] = { item_ids: [Number(id)] };
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
