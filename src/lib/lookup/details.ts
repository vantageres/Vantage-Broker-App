import type { MondayClient } from "../monday/client";
import type { PersonRecord } from "../monday/records";
import { formatDate } from "../capture/proposal";

// What a lookup answer shows for one record, read from Monday when asked.

export interface LookupNote {
  at: string;
  by: string;
  text: string;
  kind: "Broker Note" | "Update" | string;
}

export interface LookupAnswer {
  board: "leads" | "contacts";
  boardLabel: string;
  id: string;
  name: string;
  url: string;
  updatedAt: string;
  contactBroker: string;
  coBrokers: string;
  fields: { label: string; value: string }[];
  notes: LookupNote[];
  properties: { name: string; url: string }[];
}

const DETAIL_QUERY = `
  query ($ids: [ID!], $item: ID!, $columns: [String!]) {
    items(ids: $ids) {
      updates(limit: 5) { text_body created_at creator { name } }
      column_values(ids: $columns) { id text ... on BoardRelationValue { linked_items { id name board { id } } } }
    }
    timeline(id: $item) {
      timeline_items_page(limit: 10) { timeline_items { title content created_at user { name } } }
    }
  }`;

type Detail = {
  items: {
    updates: { text_body: string | null; created_at: string; creator: { name: string } | null }[];
    column_values: { id: string; text: string | null; linked_items?: { id: string; name: string; board: { id: string } }[] }[];
  }[];
  timeline: { timeline_items_page: { timeline_items: { title: string | null; content: string | null; created_at: string; user: { name: string } | null }[] } } | null;
};

const LATEST_NOTES = 3;

// US numbers as (856) 555-0123; anything else as Monday has it.
export function showPhone(raw: string): string {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
}

const stripHtml = (s: string) => s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();

export async function lookupAnswer(monday: MondayClient, record: PersonRecord, accountSlug: string): Promise<LookupAnswer> {
  const links = record.board.propertyLinks;
  const data = await monday.query<Detail>(DETAIL_QUERY, {
    ids: [record.id],
    item: record.id,
    columns: [record.board.columns.coBrokers, ...links],
  });
  const item = data.items[0];
  const col = (id: string) => item?.column_values.find((c) => c.id === id);

  const notes: LookupNote[] = [
    ...(data.timeline?.timeline_items_page.timeline_items ?? [])
      .filter((t) => t.content?.trim())
      .map((t) => ({ at: t.created_at, by: t.user?.name ?? "", text: stripHtml(t.content ?? ""), kind: t.title ?? "Note" })),
    ...(item?.updates ?? [])
      .filter((u) => u.text_body?.trim())
      .map((u) => ({ at: u.created_at, by: u.creator?.name ?? "", text: u.text_body!.trim(), kind: "Update" })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, LATEST_NOTES);

  const seen = new Set<string>();
  const properties = links
    .flatMap((id) => col(id)?.linked_items ?? [])
    .filter((p) => !seen.has(p.id) && seen.add(p.id))
    .map((p) => ({ name: p.name, url: `https://${accountSlug}.monday.com/boards/${p.board.id}/pulses/${p.id}` }));

  const c = record.current;
  const fields = [
    { label: "Business Name", value: record.businessName },
    { label: "Status", value: c.status },
    { label: "Contact Type", value: c.contactType },
    { label: "Property Type", value: c.propertyType },
    { label: "Sq Ft/Acres", value: c.size },
    { label: "Budget", value: c.budget ? `$${Number(c.budget).toLocaleString("en-US")}` : "" },
    { label: "Desired Location", value: c.desiredLocation },
    { label: "Notes", value: c.notes },
    { label: "Follow Up Date", value: c.followUp ? formatDate(c.followUp) : "" },
    { label: "Phone", value: c.phone ? showPhone(c.phone) : "" },
    { label: "Email", value: c.email },
    { label: "Source", value: c.source },
  ].filter((f) => f.value && f.value.trim());

  return {
    board: record.board.key,
    boardLabel: record.board.label,
    id: record.id,
    name: record.name,
    url: record.url,
    updatedAt: record.updatedAt,
    contactBroker: record.contactBrokerNames,
    coBrokers: col(record.board.columns.coBrokers)?.text ?? "",
    fields,
    notes,
    properties,
  };
}
