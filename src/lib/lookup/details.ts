import { mondayReason, type MondayClient } from "../monday/client";
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
  notesIncomplete: boolean; // Monday refused updates or the timeline
  propertiesUnknown: boolean;
  problems: string[];
  properties: { name: string; url: string }[];
}

// Three separate reads, so one Monday refusal (for example a missing
// updates:read permission) doesn't hide the rest of the record.
const LINKS_QUERY = `
  query ($ids: [ID!], $columns: [String!]) {
    items(ids: $ids) {
      column_values(ids: $columns) { id text ... on BoardRelationValue { linked_items { id name board { id } } } }
    }
  }`;
const UPDATES_QUERY = `
  query ($ids: [ID!]) { items(ids: $ids) { updates(limit: 5) { text_body created_at creator { name } } } }`;
const TIMELINE_QUERY = `
  query ($item: ID!) {
    timeline(id: $item) { timeline_items_page(limit: 10) { timeline_items { title content created_at user { name } } } }
  }`;

type Links = { items: { column_values: { id: string; text: string | null; linked_items?: { id: string; name: string; board: { id: string } }[] }[] }[] };
type Updates = { items: { updates: { text_body: string | null; created_at: string; creator: { name: string } | null }[] }[] };
type Timeline = { timeline: { timeline_items_page: { timeline_items: { title: string | null; content: string | null; created_at: string; user: { name: string } | null }[] } } | null };

const LATEST_NOTES = 3;

// US numbers as (856) 555-0123; anything else as Monday has it.
export function showPhone(raw: string): string {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
}

const stripHtml = (s: string) => s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();

export async function lookupAnswer(monday: MondayClient, record: PersonRecord, accountSlug: string): Promise<LookupAnswer> {
  const links = record.board.propertyLinks;
  const [linkRes, updateRes, timelineRes] = await Promise.allSettled([
    monday.query<Links>(LINKS_QUERY, { ids: [record.id], columns: [record.board.columns.coBrokers, ...links] }),
    monday.query<Updates>(UPDATES_QUERY, { ids: [record.id] }),
    monday.query<Timeline>(TIMELINE_QUERY, { item: record.id }),
  ]);
  const problems: string[] = [];
  const got = <T,>(r: PromiseSettledResult<T>, what: string): T | null => {
    if (r.status === "fulfilled") return r.value;
    const reason = mondayReason(r.reason);
    console.error(`[lookup] ${what} for item ${record.id}: ${reason}`);
    problems.push(`${what}: ${reason}`);
    return null;
  };
  const linkData = got(linkRes, "links");
  const updates = got(updateRes, "updates");
  const timeline = got(timelineRes, "timeline");
  const col = (id: string) => linkData?.items[0]?.column_values.find((c) => c.id === id);

  const notes: LookupNote[] = [
    ...(timeline?.timeline?.timeline_items_page.timeline_items ?? [])
      .filter((t) => t.content?.trim())
      .map((t) => ({ at: t.created_at, by: t.user?.name ?? "", text: stripHtml(t.content ?? ""), kind: t.title ?? "Note" })),
    ...(updates?.items[0]?.updates ?? [])
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
    notesIncomplete: !updates || !timeline,
    properties,
    propertiesUnknown: !linkData,
    problems,
  };
}
