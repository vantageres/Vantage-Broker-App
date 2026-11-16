// Microsoft Graph, read only. Every call is a GET; this module has no way to
// send, move, flag or delete mail. Errors carry the HTTP status and Graph's
// error code only, never a reply body (which can hold mail content).

const GRAPH = "https://graph.microsoft.com/v1.0";

export class GraphError extends Error {
  constructor(readonly status: number, readonly code: string | undefined) {
    super(`Outlook didn't respond as expected (HTTP ${status}${code ? `: ${code}` : ""}).`);
  }
}

export interface GraphDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Only paths on Graph itself: a nextLink from Graph is followed, nothing else.
function graphUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("/")) return `${GRAPH}${pathOrUrl}`;
  const url = new URL(pathOrUrl);
  if (url.origin !== "https://graph.microsoft.com") throw new Error("Not a Graph address.");
  return url.toString();
}

export async function graphGet<T>(token: string, pathOrUrl: string, deps: GraphDeps = {}, headers: Record<string, string> = {}): Promise<T> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? wait;
  const url = graphUrl(pathOrUrl);
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...headers } });
    if (res.ok) return (await res.json()) as T;
    // Throttled or briefly unavailable: wait as Graph asks, up to three tries.
    if ((res.status === 429 || res.status === 503) && attempt < 2) {
      const after = Number(res.headers.get("Retry-After"));
      await sleep(Math.min(Number.isFinite(after) && after > 0 ? after * 1000 : 2000 * (attempt + 1), 10_000));
      continue;
    }
    let code: string | undefined;
    try {
      code = ((await res.json()) as { error?: { code?: string } }).error?.code;
    } catch {
      // Not JSON.
    }
    throw new GraphError(res.status, code);
  }
}

export interface Mailbox {
  name: string;
  address: string;
}

export async function whoseMailbox(token: string, deps: GraphDeps = {}): Promise<Mailbox> {
  const me = await graphGet<{ displayName?: string; mail?: string | null; userPrincipalName?: string }>(
    token, "/me?$select=displayName,mail,userPrincipalName", deps,
  );
  const address = (me.mail || me.userPrincipalName || "").toLowerCase();
  return { name: me.displayName || address, address };
}

export const COUNT_CAP = 1000;

// How many messages reached the inbox since a time: the connection check.
// Reads message ids only, and stops at COUNT_CAP.
export async function countInboxSince(token: string, since: Date, deps: GraphDeps = {}): Promise<{ count: number; capped: boolean }> {
  const filter = encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`);
  let next: string | undefined = `/me/mailFolders/inbox/messages?$filter=${filter}&$select=id&$top=100`;
  let count = 0;
  while (next) {
    const page: { value: unknown[]; "@odata.nextLink"?: string } = await graphGet(token, next, deps);
    count += page.value.length;
    if (count >= COUNT_CAP) return { count: COUNT_CAP, capped: true };
    next = page["@odata.nextLink"];
  }
  return { count, capped: false };
}
