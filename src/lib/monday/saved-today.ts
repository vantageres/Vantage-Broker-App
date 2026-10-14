import type { MondayClient } from "./client";
import type { PersonBoard } from "./boards";

export interface SavedItem {
  board: "leads" | "contacts";
  boardLabel: string;
  itemId: string;
  name: string;
  at: string; // ISO time of the latest change
  changes: string[]; // column titles changed
  created: boolean;
}

// Saved today comes from Monday's own activity log for this broker, so the
// app keeps no list of its own.
export async function savedToday(
  monday: MondayClient,
  boards: Record<"leads" | "contacts", PersonBoard>,
  userId: string,
  since: Date,
): Promise<SavedItem[]> {
  const list = Object.values(boards);
  const data = await monday.query<{ boards: { id: string; activity_logs: { event: string; data: string; created_at: string }[] }[] }>(
    `query ($boards: [ID!], $users: [ID!], $from: ISO8601DateTime) {
       boards(ids: $boards) { id activity_logs(user_ids: $users, from: $from, limit: 200) { event data created_at } }
     }`,
    { boards: list.map((b) => b.boardId), users: [userId], from: since.toISOString() },
  );
  const items = new Map<string, SavedItem>();
  for (const b of data.boards) {
    const board = list.find((x) => x.boardId === String(b.id));
    if (!board) continue;
    for (const log of b.activity_logs) {
      const d = JSON.parse(log.data) as { pulse_id?: number; pulse_name?: string; column_title?: string };
      if (!d.pulse_id) continue;
      // created_at counts 100-nanosecond steps since 1970.
      const at = new Date(Number(log.created_at) / 10_000).toISOString();
      const key = `${board.key}:${d.pulse_id}`;
      const item = items.get(key) ?? {
        board: board.key, boardLabel: board.label, itemId: String(d.pulse_id), name: d.pulse_name ?? "", at, changes: [], created: false,
      };
      if (at > item.at) item.at = at;
      if (!item.name && d.pulse_name) item.name = d.pulse_name;
      if (log.event === "create_pulse") item.created = true;
      if (d.column_title && !item.changes.includes(d.column_title)) item.changes.push(d.column_title);
      items.set(key, item);
    }
  }
  // Change entries don't carry the item's name; look up any still missing.
  const unnamed = [...items.values()].filter((i) => !i.name);
  if (unnamed.length) {
    const named = await monday.query<{ items: { id: string; name: string }[] }>(
      "query ($ids: [ID!]) { items(ids: $ids) { id name } }",
      { ids: unnamed.map((i) => i.itemId) },
    );
    for (const i of unnamed) i.name = named.items.find((n) => String(n.id) === i.itemId)?.name ?? "(deleted record)";
  }
  return [...items.values()].sort((a, b) => b.at.localeCompare(a.at));
}
