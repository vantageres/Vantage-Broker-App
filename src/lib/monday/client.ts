// Minimal Monday GraphQL client. In the app each request carries the signed-in
// broker's OAuth token. In development the token may be omitted: the cloud
// environment's network proxy adds one, or on a PC MONDAY_DEV_TOKEN (a
// personal Monday token in .env.local) is used, and then writes are allowed
// only in the Broker App Test workspace.

const API_URL = "https://api.monday.com/v2";
const FILE_URL = "https://api.monday.com/v2/file";
const API_VERSION = "2025-04";

export class MondayError extends Error {
  constructor(message: string, readonly details?: unknown) {
    super(message);
  }
}

export interface UploadFile {
  name: string;
  type: string;
  data: Uint8Array<ArrayBuffer>;
}

export interface MondayClient {
  query<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
  // Adds a file to an item's file column (e.g. a business card photo).
  uploadFile?(itemId: string, columnId: string, file: UploadFile): Promise<void>;
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
    async uploadFile(itemId, columnId, file) {
      if (!(await inTestWorkspace("item", itemId))) throw new MondayError("Development token: writes are allowed only in the Broker App Test workspace.");
      return client.uploadFile!(itemId, columnId, file);
    },
  };
}

function plainClient(token?: string): MondayClient {
  const authHeaders = (): Record<string, string> => ({ "API-Version": API_VERSION, ...(token ? { Authorization: token } : {}) });
  return {
    async uploadFile(itemId: string, columnId: string, file: UploadFile): Promise<void> {
      if (!/^\d+$/.test(itemId) || !/^[a-z0-9_]+$/.test(columnId)) throw new MondayError("Not a Monday item or column.");
      const form = new FormData();
      form.append("query", `mutation ($file: File!) { add_file_to_column(item_id: ${itemId}, column_id: "${columnId}", file: $file) { id } }`);
      form.append("variables[file]", new Blob([file.data], { type: file.type }), file.name);
      const res = await fetch(FILE_URL, { method: "POST", headers: authHeaders(), body: form }).catch((error: unknown) => {
        throw new MondayError(`Monday couldn't be reached (${error instanceof Error ? error.message : "network error"})`);
      });
      if (!res.ok) throw new MondayError(`Monday returned HTTP ${res.status} for the file`);
      const body = (await res.json()) as { errors?: unknown[]; error_message?: string };
      if (body.errors?.length || body.error_message) throw new MondayError("Monday rejected the file", body.errors ?? [{ message: body.error_message }]);
    },
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
