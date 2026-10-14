import type { MondayClient } from "./monday/client";
import type { PersonBoard } from "./monday/boards";
import type { PersonRecord } from "./monday/records";
import { SaveRefused, photoFile, readOwners, type Me } from "./monday/write";
import type { Photo } from "./capture/extract";
import { findMentioned } from "./lookup/search";
import { findLeads, leadOwners, readOwnedLead, type LeadBoard, type PropertyLeadRecord } from "./property-leads/board";

// Attaching a photo (a building, a site plan, a document) to a record's Files.
// The broker names the record; only its assigned brokers can attach, and the
// server checks again just before uploading. No Broker Note is added: on a
// Lead a note starts the follow-up automation, which a picture shouldn't.

export type AttachTarget =
  | { kind: "person"; board: "leads" | "contacts"; id: string }
  | { kind: "propertyLead"; id: string };

export interface AttachCandidate {
  target: AttachTarget;
  label: string; // "Lead", "Contact", "Property Lead"
  name: string;
  url: string;
  owner: string; // who it belongs to, as Monday names them
  canAttach: boolean;
  why?: string; // when it can't: whose it is, or that it needs claiming
}

const MAX = 5;

export function findAttachTargets(question: string, people: PersonRecord[], leads: PropertyLeadRecord[], me: Me): AttachCandidate[] {
  const hits = findMentioned(question, people);
  const strong = hits.filter((h) => h.strength === "strong");
  const personHits = (strong.length ? strong : hits).map(({ record: r }): AttachCandidate => {
    const mine = r.contactBrokerIds.includes(me.id) || r.coBrokerIds.includes(me.id);
    return {
      target: { kind: "person", board: r.board.key, id: r.id },
      label: r.board.label, name: r.name, url: r.url, owner: r.contactBrokerNames,
      canAttach: mine,
      ...(mine ? {} : { why: r.contactBrokerIds.length ? `This record belongs to ${r.contactBrokerNames}.` : `${r.name} has no Contact Broker. Claim it first.` }),
    };
  });
  const leadHits = findLeads(question, leads).map((l): AttachCandidate => {
    const owners = leadOwners(l);
    const mine = l.ownerIds.includes(me.id);
    return {
      target: { kind: "propertyLead", id: l.id },
      label: "Property Lead", name: l.name, url: l.url, owner: owners,
      canAttach: mine,
      ...(mine ? {} : { why: `This Property Lead belongs to ${owners || "no one"}.` }),
    };
  });
  // A street address names a Property Lead more surely than a loose name word.
  const strongPeople = strong.length > 0;
  return (strongPeople ? [...personHits, ...leadHits] : [...leadHits, ...personHits]).slice(0, MAX);
}

export interface AttachResult {
  name: string;
  attached: number;
}

// Thrown when some photos made it and one didn't: a retry sends the rest.
export class AttachIncomplete extends Error {
  constructor(readonly attached: number) {
    super(attached ? "Some photos were attached, but not all." : "The photo wasn't attached.");
  }
}

export async function attachPhotos(
  monday: MondayClient,
  boards: { people: Record<"leads" | "contacts", PersonBoard>; leads: LeadBoard },
  me: Me,
  target: AttachTarget,
  photos: Photo[],
  accountSlug: string,
): Promise<AttachResult> {
  if (!photos.length) throw new SaveRefused("There's no photo to attach.");
  if (!monday.uploadFile) throw new SaveRefused("Photos can't be attached here.");

  // Ownership, read fresh just before the upload.
  let name: string;
  let column: string;
  if (target.kind === "person") {
    const board = boards.people[target.board];
    if (!board) throw new SaveRefused("That record isn't on a board the app knows.");
    const owners = await readOwners(monday, board, target.id);
    if (!owners.contactBroker.includes(me.id) && !owners.coBrokers.includes(me.id)) {
      if (owners.contactBroker.length === 0) throw new SaveRefused(`${owners.name} has no Contact Broker. Claim it first.`);
      throw new SaveRefused(`${owners.name} belongs to ${owners.contactBrokerNames}.`, owners.contactBrokerNames);
    }
    name = owners.name;
    column = board.columns.files;
  } else {
    const lead = await readOwnedLead(monday, boards.leads, me, target.id, accountSlug);
    name = lead.name;
    column = boards.leads.files;
  }

  let attached = 0;
  for (const [i, photo] of photos.entries()) {
    try {
      await monday.uploadFile(target.id, column, photoFile(photo, i));
    } catch {
      throw new AttachIncomplete(attached);
    }
    attached++;
  }
  return { name, attached };
}
