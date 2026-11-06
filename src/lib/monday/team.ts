import type { MondayClient } from "./client";
import type { PersonBoard } from "./boards";

// Who can be given a new Lead, and who may give it. An owner of the Leads
// board (John, and Andrea, who takes calls and passes Leads to brokers) can
// choose the Contact Broker and Co-Brokers of a new Lead; everyone else
// becomes the Contact Broker of the Leads they add. The people offered are the
// members of the "Brokers" team in Monday who are also on the Leads board.
// Read from Monday, so changing an owner or the team there changes the app.
//
// Reading teams needs the Monday app's teams:read scope. Without it, the
// choice is withheld and the reason given; it never falls back to everyone.

export interface Person {
  id: string;
  name: string;
}

export interface Team {
  owners: string[];
  people: Person[]; // brokers who can be given a Lead, by name
  problem?: string; // why the brokers couldn't be read
}

export const BROKERS_TEAM = /^brokers?( team)?$/i;

export async function readTeam(monday: MondayClient, board: PersonBoard): Promise<Team> {
  const data = await monday.query<{ boards: { owners: { id: string }[]; subscribers: { id: string }[] }[] }>(
    `query ($board: [ID!]) { boards(ids: $board) { owners { id } subscribers { id } } }`,
    { board: [board.boardId] },
  );
  const b = data.boards?.[0];
  if (!b) return { owners: [], people: [] };
  const owners = b.owners.map((o) => String(o.id));
  const onBoard = new Set(b.subscribers.map((s) => String(s.id)));

  let teams: { name: string; users: { id: string; name: string; enabled: boolean; is_guest: boolean }[] }[];
  try {
    teams = (await monday.query<{ teams: typeof teams }>(`{ teams { name users { id name enabled is_guest } } }`)).teams ?? [];
  } catch {
    return { owners, people: [], problem: "I can't read the Brokers team in Monday yet. The Monday app needs the teams:read permission, then sign in again." };
  }
  const brokers = teams.find((t) => BROKERS_TEAM.test(t.name.trim()));
  if (!brokers) return { owners, people: [], problem: "There's no team named Brokers in Monday." };
  return {
    owners,
    people: brokers.users
      .filter((u) => u.enabled && !u.is_guest && onBoard.has(String(u.id)))
      .map((u) => ({ id: String(u.id), name: u.name }))
      .sort((x, y) => x.name.localeCompare(y.name)),
  };
}

// The team changes rarely, so the list shown on a proposal is kept for a few
// minutes. The save always checks again with a fresh read.
const TEAM_TTL_MS = 5 * 60 * 1000;
const cached = new Map<string, { team: Team; at: number }>();

export async function teamFor(monday: MondayClient, board: PersonBoard, now = Date.now()): Promise<Team> {
  const hit = cached.get(board.boardId);
  if (hit && now - hit.at < TEAM_TTL_MS) return hit.team;
  const team = await readTeam(monday, board);
  // A missing permission is fixed by signing in again, so don't keep that answer.
  if (!team.problem) cached.set(board.boardId, { team, at: now });
  return team;
}
