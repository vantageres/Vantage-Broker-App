import { readFile } from "node:fs/promises";
import { graphGet, type GraphDeps } from "./graph";

// Where the monitor's email comes from. In production: the broker's Outlook,
// through Graph. In development: a file of emails (DEV_MAILBOX_FILE), made up
// or a short-lived snapshot, so the whole pipeline and the screens can be
// tried before the Entra registration exists. Either way the rest of the
// monitor sees the same shape, which follows Graph's own fields.

export interface Person {
  name: string;
  address: string; // lowercase
}

export interface MailMessage {
  id: string;
  conversationId: string;
  folder: "inbox" | "sent"; // received mail from any folder except Sent, Drafts, Deleted and Junk is "inbox"
  subject: string;
  from: Person;
  to: Person[];
  cc: Person[];
  at: string; // ISO: received for inbox, sent for sent
  preview: string;
  body?: string; // the new text of the message (Graph uniqueBody, as text); only fetched for threads that survive the noise filter
  webLink?: string;
  listUnsubscribe?: boolean;
  autoSubmitted?: string;
}

export interface MailSource {
  kind: "outlook" | "file";
  owner: Person;
  // Received and sent mail at or after `since`, newest last. No bodies.
  messagesSince(since: Date): Promise<MailMessage[]>;
  // The new text of each message, by id. Messages it can't read are left out.
  bodies(ids: string[]): Promise<Record<string, string>>;
  // For the first-time scan: like messagesSince, reaching further back. Up to
  // 1,000 messages per folder in Outlook. The file adds its older "history".
  scanSince?(since: Date): Promise<MailMessage[]>;
  // Earlier messages in one conversation (received and sent), oldest first,
  // with previews only: for the history line (spec 02 step 5).
  conversation?(conversationId: string, since: Date): Promise<MailMessage[]>;
}

// ---- File (development) ----

interface FileMessage extends Omit<MailMessage, "at" | "from" | "to" | "cc"> {
  at?: string;
  minutesAgo?: number; // made-up mail stays recent: its time is worked out from now
  from: Person | string;
  to?: (Person | string)[];
  cc?: (Person | string)[];
}

interface MailboxFile {
  owner: Person;
  messages: FileMessage[];
  history?: FileMessage[]; // older made-up mail, for the first-time scan only
}

const person = (p: Person | string): Person =>
  typeof p === "string" ? { name: p, address: p.toLowerCase() } : { name: p.name, address: p.address.toLowerCase() };

export function parseMailbox(text: string, now = Date.now()): { owner: Person; messages: MailMessage[]; history: MailMessage[] } {
  const file = JSON.parse(text) as MailboxFile;
  const read = (list: FileMessage[]) => list.map((m): MailMessage => ({
    ...m,
    from: person(m.from),
    to: (m.to ?? []).map(person),
    cc: (m.cc ?? []).map(person),
    at: m.at ?? new Date(now - (m.minutesAgo ?? 0) * 60_000).toISOString(),
  })).sort((a, b) => a.at.localeCompare(b.at));
  return { owner: person(file.owner), messages: read(file.messages), history: read(file.history ?? []) };
}

export function devMailboxFile(env = process.env): string | null {
  return env.NODE_ENV !== "production" && env.DEV_MAILBOX_FILE ? env.DEV_MAILBOX_FILE : null;
}

// The file is read on each call, so edits show on the next Check now.
export function fileSource(path: string, now: () => number = Date.now): MailSource & { load(): Promise<{ owner: Person; messages: MailMessage[] }> } {
  const load = async () => parseMailbox(await readFile(path, "utf8"), now());
  let owner: Person = { name: "Development mailbox", address: "" };
  return {
    kind: "file",
    get owner() {
      return owner;
    },
    load,
    async messagesSince(since) {
      const box = await load();
      owner = box.owner;
      return box.messages.filter((m) => m.at >= since.toISOString()).map(({ body: _body, ...rest }) => rest);
    },
    async conversation(conversationId, since) {
      const box = await load();
      return [...box.history, ...box.messages]
        .filter((m) => m.conversationId === conversationId && m.at >= since.toISOString())
        .map(({ body: _body, ...rest }) => rest)
        .sort((a, b) => a.at.localeCompare(b.at));
    },
    async scanSince(since) {
      const box = await load();
      owner = box.owner;
      return [...box.history, ...box.messages].filter((m) => m.at >= since.toISOString()).map(({ body: _body, ...rest }) => rest);
    },
    async bodies(ids) {
      const box = await load();
      const wanted = new Set(ids);
      return Object.fromEntries(box.messages.filter((m) => wanted.has(m.id)).map((m) => [m.id, m.body ?? m.preview]));
    },
  };
}

// ---- Outlook (Graph) ----

interface GraphMessage {
  id: string;
  conversationId: string;
  parentFolderId?: string;
  subject?: string | null;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: { emailAddress?: { name?: string; address?: string } }[];
  ccRecipients?: { emailAddress?: { name?: string; address?: string } }[];
  receivedDateTime?: string;
  sentDateTime?: string;
  bodyPreview?: string;
  webLink?: string;
  internetMessageHeaders?: { name: string; value: string }[];
}

const graphPerson = (r?: { emailAddress?: { name?: string; address?: string } }): Person => ({
  name: r?.emailAddress?.name || r?.emailAddress?.address || "",
  address: (r?.emailAddress?.address || "").toLowerCase(),
});

const header = (m: GraphMessage, name: string) => m.internetMessageHeaders?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;

async function allPages<T>(token: string, first: string, deps: GraphDeps, cap = 1000): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = first;
  while (next && out.length < cap) {
    const page: { value: T[]; "@odata.nextLink"?: string } = await graphGet(token, next, deps);
    out.push(...page.value);
    next = page["@odata.nextLink"];
  }
  return out.slice(0, cap);
}

export function outlookSource(token: string, owner: Person, deps: GraphDeps = {}): MailSource {
  let skipFolders: Set<string> | null = null;
  const folderIds = async () => {
    if (!skipFolders) {
      const names = ["sentitems", "drafts", "deleteditems", "junkemail"];
      const ids = await Promise.all(names.map((n) => graphGet<{ id: string }>(token, `/me/mailFolders/${n}?$select=id`, deps).then((f) => f.id)));
      skipFolders = new Set(ids);
    }
    return skipFolders;
  };

  return {
    kind: "outlook",
    owner,
    async messagesSince(since) {
      const iso = since.toISOString();
      const received = allPages<GraphMessage>(token,
        `/me/messages?$filter=${encodeURIComponent(`receivedDateTime ge ${iso}`)}&$top=50&$select=id,conversationId,parentFolderId,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,webLink,internetMessageHeaders`,
        deps);
      const sent = allPages<GraphMessage>(token,
        `/me/mailFolders/sentitems/messages?$filter=${encodeURIComponent(`sentDateTime ge ${iso}`)}&$top=50&$select=id,conversationId,subject,from,toRecipients,ccRecipients,sentDateTime,webLink`,
        deps);
      const skip = await folderIds();
      const inbox = (await received).filter((m) => !m.parentFolderId || !skip.has(m.parentFolderId)).map((m): MailMessage => ({
        id: m.id, conversationId: m.conversationId, folder: "inbox", subject: m.subject ?? "",
        from: graphPerson(m.from), to: (m.toRecipients ?? []).map(graphPerson), cc: (m.ccRecipients ?? []).map(graphPerson),
        at: m.receivedDateTime ?? iso, preview: m.bodyPreview ?? "", webLink: m.webLink,
        listUnsubscribe: !!header(m, "List-Unsubscribe"), autoSubmitted: header(m, "Auto-Submitted")?.toLowerCase(),
      }));
      const out = (await sent).map((m): MailMessage => ({
        id: m.id, conversationId: m.conversationId, folder: "sent", subject: m.subject ?? "",
        from: owner, to: (m.toRecipients ?? []).map(graphPerson), cc: (m.ccRecipients ?? []).map(graphPerson),
        at: m.sentDateTime ?? iso, preview: "", webLink: m.webLink,
      }));
      return [...inbox, ...out].sort((a, b) => a.at.localeCompare(b.at));
    },
    async conversation(conversationId, since) {
      const skip = await folderIds();
      const sentId = [...skip][0]; // folderIds() looks up Sent Items first
      const filter = `conversationId eq '${conversationId.replace(/'/g, "''")}'`;
      const list = await allPages<GraphMessage>(token,
        `/me/messages?$filter=${encodeURIComponent(filter)}&$top=25&$select=id,conversationId,parentFolderId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,bodyPreview,webLink`,
        deps, 25);
      return list
        .filter((m) => !m.parentFolderId || m.parentFolderId === sentId || !skip.has(m.parentFolderId)) // no drafts, deleted or junk
        .map((m): MailMessage => {
          const sent = m.parentFolderId === sentId || graphPerson(m.from).address === owner.address;
          return {
            id: m.id, conversationId: m.conversationId, folder: sent ? "sent" : "inbox", subject: m.subject ?? "",
            from: sent ? owner : graphPerson(m.from), to: (m.toRecipients ?? []).map(graphPerson), cc: (m.ccRecipients ?? []).map(graphPerson),
            at: (sent ? m.sentDateTime : m.receivedDateTime) ?? m.receivedDateTime ?? "", preview: m.bodyPreview ?? "", webLink: m.webLink,
          };
        })
        .filter((m) => m.at >= since.toISOString())
        .sort((a, b) => a.at.localeCompare(b.at));
    },
    async bodies(ids) {
      const entries = await Promise.all(ids.map(async (id) => {
        try {
          const m = await graphGet<{ uniqueBody?: { content?: string } }>(token, `/me/messages/${encodeURIComponent(id)}?$select=uniqueBody`, deps,
            { Prefer: 'outlook.body-content-type="text"' });
          return [id, m.uniqueBody?.content ?? ""] as const;
        } catch {
          return null;
        }
      }));
      return Object.fromEntries(entries.filter((e): e is readonly [string, string] => !!e));
    },
  };
}
