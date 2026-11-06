import type { MondayClient } from "./client";
import type { PersonBoard } from "./boards";

// Who can be given a new Lead, and who may give it. A board owner on Leads
// (John and Andrea, who takes calls and passes Leads to brokers) can choose the
// Contact Broker and Co-Brokers of a new Lead; everyone else becomes the
// Contact Broker of the Leads they add. The people offered are the board's
// members. Read from Monday, so changing an owner there changes the app too.

export interface Person {
  id: string;
  name: string;
}

export interface Team {
  owners: string[];
  people: Person[]; // members of the board, by name
}

const TEAM_QUERY = `query ($board: [ID!]) { boards(ids: $board) { owners { id } subscribers { id name enabled is_guest is_view_only } } }`;

export async function readTeam(monday: MondayClient, board: PersonBoard): Promise<Team> {
  const data = await monday.query<{
    boards: { owners: { id: string }[]; subscribers: { id: string; name: string; enabled: boolean; is_guest: boolean; is_view_only: boolean }[] }[];
  }>(TEAM_QUERY, { board: [board.boardId] });
  const b = data.boards?.[0];
  if (!b) return { owners: [], people: [] };
  return {
    owners: b.owners.map((o) => String(o.id)),
    people: b.subscribers
      .filter((s) => s.enabled && !s.is_guest && !s.is_view_only)
      .map((s) => ({ id: String(s.id), name: s.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// Membership changes rarely, so the list shown on a proposal is kept for a few
// minutes. The save always checks again with a fresh read.
const TEAM_TTL_MS = 5 * 60 * 1000;
const cached = new Map<string, { team: Team; at: number }>();

export async function teamFor(monday: MondayClient, board: PersonBoard, now = Date.now()): Promise<Team> {
  const hit = cached.get(board.boardId);
  if (hit && now - hit.at < TEAM_TTL_MS) return hit.team;
  const team = await readTeam(monday, board);
  cached.set(board.boardId, { team, at: now });
  return team;
}
