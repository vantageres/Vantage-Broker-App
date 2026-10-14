// Minimal Monday GraphQL client. In the app each request carries the signed-in
// broker's OAuth token. In development the token may be omitted: the cloud
// environment's network proxy adds one, or on a PC MONDAY_DEV_TOKEN (a
// personal Monday token in .env.local) is used, and then writes are allowed
// only in the Broker App Test workspace.

const API_URL = "https://api.monday.com/v2";
const API_VERSION = "2025-04";

export class MondayError extends Error {
  constructor(message: string, readonly details?: unknown) {
    super(message);
  }
}

export interface MondayClient {
  query<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

export const TEST_WORKSPACE_ID = "18004807";

// A personal token in .env.local, for development on a PC. Never in production.
function devToken(): string | undefined {
  return process.env.NODE_ENV === "production" ? undefined : process.env.MONDAY_DEV_TOKEN || undefined;
}

export function mondayClient(token?: string): MondayClient {
  const dev = token ? undefined : devToken();
  const client = plainClient(token ?? dev);
  return dev ? testWorkspaceOnly(client) : client;
}

// A personal token can change anything its owner can, including the live
// boards. While one is in use, every write must name a board or an item in
// the test workspace, and anything else is refused before it reaches Monday.
export function testWorkspaceOnly(client: MondayClient): MondayClient {
  const checked = new Map<string, Promise<boolean>>();
  const inTestWorkspace = (kind: "board" | "item", id: string) => {
    const key = `${kind}:${id}`;
    if (!checked.has(key)) {
      checked.set(key, (kind === "board"
        ? client.query<{ boards: { workspace: { id: string } | null }[] }>("query ($id: [ID!]) { boards(ids: $id) { workspace { id } } }", { id: [id] })
            .then((d) => d.boards[0]?.workspace?.id)
        : client.query<{ items: { board: { workspace: { id: string } | null } }[] }>("query ($id: [ID!]) { items(ids: $id) { board { workspace { id } } } }", { id: [id] })
            .then((d) => d.items[0]?.board.workspace?.id)
      ).then((ws) => String(ws) === TEST_WORKSPACE_ID));
    }
    return checked.get(key)!;
  };
  return {
    async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
      if (/^\s*mutation\b/.test(query)) {
        const { board, item } = variables as { board?: unknown; item?: unknown };
        const allowed = (board !== undefined || item !== undefined)
          && (board === undefined || await inTestWorkspace("board", String(board)))
          && (item === undefined || await inTestWorkspace("item", String(item)));
        if (!allowed) throw new MondayError("Development token: writes are allowed only in the Broker App Test workspace.");
      }
      return client.query<T>(query, variables);
    },
  };
}

function plainClient(token?: string): MondayClient {
  return {
    async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "API-Version": API_VERSION,
      };
      if (token) headers.Authorization = token;
      const res = await fetch(API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
      }).catch((error: unknown) => {
        throw new MondayError(`Monday couldn't be reached (${error instanceof Error ? error.message : "network error"})`);
      });
      if (!res.ok) throw new MondayError(`Monday returned HTTP ${res.status}`);
      const body = (await res.json()) as { data?: T; errors?: unknown[] };
      if (body.errors?.length) throw new MondayError("Monday rejected the request", body.errors);
      return body.data as T;
    },
  };
}

// A short, safe reason for the screen: Monday's own message, never anything
// that mentions a token.
export function mondayReason(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const details = error instanceof MondayError && Array.isArray(error.details)
    ? (error.details as { message?: string }[]).map((d) => d.message).filter(Boolean).join("; ")
    : "";
  const reason = details || error.message;
  return /token/i.test(reason) ? error.message : reason.slice(0, 200);
}
