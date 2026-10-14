import type { MondayClient } from "./client";
import type { Photo } from "../capture/extract";
import { BROKER_NOTE_ACTIVITY_ID, CONTACT_TYPES, PROPERTY_TYPES, SOURCES, type PersonBoard } from "./boards";

// Writes an approved proposal to Monday. Every check that protects a record
// (ownership, a claim race, value formats) happens here, on the server, just
// before the write, whatever the browser sent.

export type SaveField =
  | "name" | "businessName" | "contactType" | "propertyType" | "budget" | "size"
  | "desiredLocation" | "notes" | "followUp" | "source" | "phone" | "email" | "contactAddress";

export interface SaveChange {
  field: SaveField;
  value: string;
  location?: { lat: number; lng: number; address: string };
}

export interface SaveRequest {
  target: { kind: "existing"; board: "leads" | "contacts"; id: string } | { kind: "new-lead" };
  changes: SaveChange[];
  noteText: string;
  // Approved photos for the record's Files column (a business card, front and back).
  photos?: Photo[];
  // A property on the old Properties board to add to Associated Properties
  // (the property a sign stands at).
  linkProperty?: string;
}

export interface SaveOptions {
  // Associated Properties on Leads and Contacts links to this board only.
  linkableBoardId?: string;
}

// The property must be on the board Associated Properties links to.
async function checkLinkable(monday: MondayClient, itemId: string | undefined, options: SaveOptions): Promise<string | null> {
  if (!itemId) return null;
  if (!/^\d+$/.test(itemId) || !options.linkableBoardId) throw new SaveRefused("That property can't be linked.");
  const data = await monday.query<{ items: { board: { id: string } }[] }>(`query ($id: [ID!]) { items(ids: $id) { board { id } } }`, { id: [itemId] });
  if (data.items[0]?.board.id !== options.linkableBoardId) throw new SaveRefused("Only properties on the old Properties board can be linked to a Lead or Contact.");
  return itemId;
}

// Adds to the record's links; never replaces the ones already there.
async function linkedIds(monday: MondayClient, itemId: string, column: string): Promise<string[]> {
  const data = await monday.query<{ items: { column_values: { linked_item_ids?: string[] }[] }[] }>(
    `query ($id: [ID!], $col: [String!]) { items(ids: $id) { column_values(ids: $col) { ... on BoardRelationValue { linked_item_ids } } } }`,
    { id: [itemId], col: [column] },
  );
  return data.items[0]?.column_values[0]?.linked_item_ids ?? [];
}

export interface Me {
  id: string;
  name: string;
}

// The fields were saved but a photo or the Broker Note was not. Retrying sends
// only what's missing (`result.photosAttached` says how many photos made it),
// to the record in `result`.
export class NoteNotSaved extends Error {
  constructor(readonly result: SaveResult, what: "note" | "photo") {
    super(what === "photo" ? "The changes were saved, but the photo wasn't attached." : "The changes were saved, but the note wasn't added.");
  }
}

const MAX_PHOTOS = 2;
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const EXTENSION: Record<Photo["mediaType"], string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// Photos arrive from the browser: check them before anything is saved.
export function checkPhotos(photos: unknown): Photo[] {
  if (photos === undefined) return [];
  if (!Array.isArray(photos) || photos.length > MAX_PHOTOS) throw new SaveRefused(`Send at most ${MAX_PHOTOS} photos.`);
  return photos.map((p) => {
    const photo = p as Photo;
    if (!photo || typeof photo.data !== "string" || !(photo.mediaType in EXTENSION)) throw new SaveRefused("That photo couldn't be read.");
    if ((photo.data.length * 3) / 4 > MAX_PHOTO_BYTES) throw new SaveRefused("That photo is too large.");
    return { data: photo.data, mediaType: photo.mediaType };
  });
}

export class SaveRefused extends Error {
  constructor(message: string, readonly owner?: string) {
    super(message);
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Turn one approved change into Monday's column value format. Anything that
// doesn't fit is refused rather than saved in a broken shape.
export function columnValue(board: PersonBoard, change: SaveChange): [string, unknown] | null {
  const c = board.columns;
  const v = change.value.trim();
  switch (change.field) {
    case "name":
      return null; // set through item_name on create
    case "businessName":
      return [c.businessName, v];
    case "size":
      return [c.size, v];
    case "notes":
      return [c.notes, v];
    case "contactType":
      if (!(CONTACT_TYPES as readonly string[]).includes(v)) throw new SaveRefused(`"${v}" is not a Contact Type option.`);
      return [c.contactType, { label: v }];
    case "source":
      if (!(SOURCES as readonly string[]).includes(v)) throw new SaveRefused(`"${v}" is not a Source option.`);
      return [c.source, { label: v }];
    case "propertyType": {
      const labels = v.split(",").map((x) => x.trim()).filter(Boolean);
      const bad = labels.find((l) => !(PROPERTY_TYPES as readonly string[]).includes(l));
      if (bad) throw new SaveRefused(`"${bad}" is not a Property Type option.`);
      return [c.propertyType, { labels }];
    }
    case "budget": {
      const n = Number(v.replace(/[$,\s]/g, ""));
      if (!Number.isFinite(n) || n <= 0) throw new SaveRefused("Budget must be a single dollar amount.");
      return [c.budget, String(n)];
    }
    case "followUp":
      if (!DATE.test(v)) throw new SaveRefused("Follow up needs a specific date.");
      return [c.followUp, { date: v }];
    case "desiredLocation":
      if (!change.location) throw new SaveRefused("Desired Location needs a place found on the map.");
      return [c.desiredLocation, { lat: String(change.location.lat), lng: String(change.location.lng), address: change.location.address }];
    case "contactAddress":
      if (!c.contactAddress) throw new SaveRefused("Leads have no address field. Put the address in Notes.");
      if (!change.location) throw new SaveRefused("Contact Address needs an address found on the map.");
      return [c.contactAddress, { lat: String(change.location.lat), lng: String(change.location.lng), address: change.location.address }];
    case "phone": {
      const digits = v.replace(/\D/g, "");
      if (digits.length < 10) throw new SaveRefused("That phone number looks incomplete.");
      return [c.phone, { phone: digits, countryShortName: "US" }];
    }
    case "email":
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new SaveRefused("That email address doesn't look right.");
      return [c.email, { email: v, text: v }];
  }
}

interface Owners {
  name: string;
  contactBroker: string[];
  coBrokers: string[];
  contactBrokerNames: string;
}

function ids(value: string | null): string[] {
  if (!value) return [];
  const parsed = JSON.parse(value) as { personsAndTeams?: { id: number; kind: string }[] };
  return (parsed.personsAndTeams ?? []).filter((p) => p.kind === "person").map((p) => String(p.id));
}

export async function readOwners(monday: MondayClient, board: PersonBoard, itemId: string): Promise<Owners> {
  const data = await monday.query<{ items: { name: string; board: { id: string }; column_values: { id: string; text: string | null; value: string | null }[] }[] }>(
    `query ($id: [ID!], $cols: [String!]) { items(ids: $id) { name board { id } column_values(ids: $cols) { id text value } } }`,
    { id: [itemId], cols: [board.columns.contactBroker, board.columns.coBrokers] },
  );
  const item = data.items[0];
  if (!item || item.board.id !== board.boardId) throw new SaveRefused("That record no longer exists on this board.");
  const col = (id: string) => item.column_values.find((c) => c.id === id);
  return {
    name: item.name,
    contactBroker: ids(col(board.columns.contactBroker)?.value ?? null),
    coBrokers: ids(col(board.columns.coBrokers)?.value ?? null),
    contactBrokerNames: col(board.columns.contactBroker)?.text ?? "",
  };
}

async function addBrokerNote(monday: MondayClient, itemId: string, text: string) {
  await monday.query(
    `mutation ($item: ID!, $activity: String!, $content: String, $at: ISO8601DateTime!) {
       create_timeline_item(item_id: $item, custom_activity_id: $activity, title: "Broker Note", content: $content, timestamp: $at) { id }
     }`,
    { item: itemId, activity: BROKER_NOTE_ACTIVITY_ID, content: text, at: new Date().toISOString() },
  );
}

export interface SaveResult {
  board: "leads" | "contacts";
  itemId: string;
  name: string;
  fieldsChanged: number;
  noteAdded: boolean;
  photosAttached: number;
}

export async function saveProposal(
  monday: MondayClient,
  boards: Record<"leads" | "contacts", PersonBoard>,
  me: Me,
  request: SaveRequest,
  options: SaveOptions = {},
): Promise<SaveResult> {
  const note = request.noteText.trim();
  const photos = checkPhotos(request.photos);
  const link = await checkLinkable(monday, request.linkProperty, options);

  if (request.target.kind === "new-lead") {
    const board = boards.leads;
    const name = request.changes.find((c) => c.field === "name")?.value.trim();
    if (!name) throw new SaveRefused("A new Lead needs a name.");
    const values: Record<string, unknown> = {
      [board.columns.contactBroker]: { personsAndTeams: [{ id: Number(me.id), kind: "person" }] },
    };
    if (board.columns.status) values[board.columns.status] = { label: "New Lead" };
    for (const change of request.changes) {
      const cv = columnValue(board, change);
      if (cv) values[cv[0]] = cv[1];
    }
    if (link) values[board.propertyLinks[0]] = { item_ids: [Number(link)] };
    const created = await monday.query<{ create_item: { id: string } }>(
      `mutation ($board: ID!, $name: String!, $values: JSON!) {
         create_item(board_id: $board, item_name: $name, column_values: $values, create_labels_if_missing: false) { id }
       }`,
      { board: board.boardId, name, values: JSON.stringify(values) },
    );
    const result: SaveResult = { board: "leads", itemId: created.create_item.id, name, fieldsChanged: request.changes.length + (link ? 1 : 0), noteAdded: false, photosAttached: 0 };
    return afterFields(monday, board, result, photos, note);
  }

  const board = boards[request.target.board];
  const itemId = request.target.id;

  // Ownership is checked again here, just before the write.
  const owners = await readOwners(monday, board, itemId);
  if (!owners.contactBroker.includes(me.id) && !owners.coBrokers.includes(me.id)) {
    if (owners.contactBroker.length === 0) throw new SaveRefused(`${owners.name} has no Contact Broker. Claim it first.`);
    throw new SaveRefused(`${owners.name} belongs to ${owners.contactBrokerNames}.`, owners.contactBrokerNames);
  }

  const values: Record<string, unknown> = {};
  for (const change of request.changes) {
    const cv = columnValue(board, change);
    if (cv) values[cv[0]] = cv[1];
  }
  if (link) {
    const column = board.propertyLinks[0];
    const current = await linkedIds(monday, itemId, column);
    if (!current.includes(link)) values[column] = { item_ids: [...current, link].map(Number) };
  }
  if (Object.keys(values).length) {
    await monday.query(
      `mutation ($board: ID!, $item: ID!, $values: JSON!) {
         change_multiple_column_values(board_id: $board, item_id: $item, column_values: $values, create_labels_if_missing: false) { id }
       }`,
      { board: board.boardId, item: itemId, values: JSON.stringify(values) },
    );
  }
  const result: SaveResult = { board: board.key, itemId, name: owners.name, fieldsChanged: Object.keys(values).length, noteAdded: false, photosAttached: 0 };
  return afterFields(monday, board, result, photos, note);
}

// After the fields: the photos to Files, then the Broker Note.
async function afterFields(monday: MondayClient, board: PersonBoard, result: SaveResult, photos: Photo[], note: string): Promise<SaveResult> {
  let done = result;
  for (const [i, photo] of photos.entries()) {
    try {
      if (!monday.uploadFile) throw new Error("No file upload");
      const name = `photo-${new Date().toISOString().slice(0, 10)}-${i + 1}.${EXTENSION[photo.mediaType]}`;
      await monday.uploadFile(result.itemId, board.columns.files, { name, type: photo.mediaType, data: Uint8Array.from(Buffer.from(photo.data, "base64")) });
    } catch {
      throw new NoteNotSaved(done, "photo");
    }
    done = { ...done, photosAttached: done.photosAttached + 1 };
  }
  if (!note) return done;
  try {
    await addBrokerNote(monday, result.itemId, note);
  } catch {
    throw new NoteNotSaved(done, "note");
  }
  return { ...done, noteAdded: true };
}

// Claiming sets the broker as Contact Broker on an unassigned record. Monday
// has no conditional write, so the owner is re-read right before the write
// and once after: if someone else got there first, they are named.
export async function claimRecord(monday: MondayClient, board: PersonBoard, itemId: string, me: Me): Promise<{ name: string }> {
  const before = await readOwners(monday, board, itemId);
  if (before.contactBroker.length) {
    if (before.contactBroker.includes(me.id)) return { name: before.name };
    throw new SaveRefused(`${before.name} was just claimed by ${before.contactBrokerNames}.`, before.contactBrokerNames);
  }
  await monday.query(
    `mutation ($board: ID!, $item: ID!, $values: JSON!) {
       change_multiple_column_values(board_id: $board, item_id: $item, column_values: $values) { id }
     }`,
    {
      board: board.boardId,
      item: itemId,
      values: JSON.stringify({ [board.columns.contactBroker]: { personsAndTeams: [{ id: Number(me.id), kind: "person" }] } }),
    },
  );
  const after = await readOwners(monday, board, itemId);
  if (!after.contactBroker.includes(me.id)) {
    throw new SaveRefused(`${after.name} was just claimed by ${after.contactBrokerNames}.`, after.contactBrokerNames);
  }
  return { name: after.name };
}
