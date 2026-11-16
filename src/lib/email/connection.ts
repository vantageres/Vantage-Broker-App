import type { Store } from "../store";
import { MicrosoftAuthError, refreshMicrosoft, type MicrosoftTokens } from "./microsoft";

// A broker's Outlook connection, kept in the app's store under their Monday
// user id. Microsoft's tokens are too large for the sign-in cookie, so the
// refresh token lives here, sealed with the session secret (never in the
// clear), replaced on every renewal, and deleted on Disconnect. A short-lived
// access token is cached, sealed, until just before it expires.

export interface Connection {
  sealedRefresh: string;
  name: string;
  address: string;
  connectedAt: string; // ISO
  reconnectNeeded?: boolean;
}

export interface Sealer {
  seal(value: object): Promise<string>;
  unseal<T>(sealed: string): Promise<T | null>;
}

export interface ConnectionDeps {
  store: Store;
  sealer: Sealer;
  refresh?: (refreshToken: string) => Promise<MicrosoftTokens>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const connKey = (userId: string) => `email:conn:${userId}`;
const accessKey = (userId: string) => `email:access:${userId}`;
const lockKey = (userId: string) => `email:renew:${userId}`;
const EARLY_MS = 5 * 60 * 1000;

export async function saveConnection(deps: ConnectionDeps, userId: string, tokens: MicrosoftTokens, mailbox: { name: string; address: string }) {
  if (!tokens.refreshToken) throw new Error("Microsoft did not allow offline access, so the monitor can't run.");
  const conn: Connection = {
    sealedRefresh: await deps.sealer.seal({ refreshToken: tokens.refreshToken }),
    name: mailbox.name,
    address: mailbox.address,
    connectedAt: new Date((deps.now ?? Date.now)()).toISOString(),
  };
  await deps.store.set(connKey(userId), conn);
  await cacheAccess(deps, userId, tokens);
}

export function getConnection(deps: Pick<ConnectionDeps, "store">, userId: string) {
  return deps.store.get<Connection>(connKey(userId));
}

export async function disconnect(deps: Pick<ConnectionDeps, "store">, userId: string) {
  await deps.store.del(accessKey(userId));
  await deps.store.del(connKey(userId));
}

async function cacheAccess(deps: ConnectionDeps, userId: string, tokens: MicrosoftTokens) {
  const ttl = tokens.expiresAt - (deps.now ?? Date.now)() - EARLY_MS;
  if (ttl > 0) await deps.store.set(accessKey(userId), await deps.sealer.seal({ accessToken: tokens.accessToken }), { px: ttl });
}

async function cachedAccess(deps: ConnectionDeps, userId: string): Promise<string | null> {
  const sealed = await deps.store.get<string>(accessKey(userId));
  if (!sealed) return null;
  return (await deps.sealer.unseal<{ accessToken: string }>(sealed))?.accessToken ?? null;
}

export class ReconnectNeeded extends Error {
  constructor() {
    super("The app lost access to your Outlook. Connect it again.");
  }
}

// An access token for the broker's mailbox: the cached one, or a renewal.
// One renewal at a time per broker across server copies; the others wait for
// the cached token it leaves.
export async function accessToken(deps: ConnectionDeps, userId: string): Promise<string> {
  const cached = await cachedAccess(deps, userId);
  if (cached) return cached;

  const conn = await getConnection(deps, userId);
  if (!conn) throw new Error("Outlook is not connected.");
  if (conn.reconnectNeeded) throw new ReconnectNeeded();

  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  if (!(await deps.store.set(lockKey(userId), 1, { px: 30_000, nx: true }))) {
    for (let i = 0; i < 20; i++) {
      await sleep(250);
      const t = await cachedAccess(deps, userId);
      if (t) return t;
    }
    throw new Error("Outlook is busy. Try again in a minute.");
  }

  try {
    const stored = await deps.sealer.unseal<{ refreshToken: string }>(conn.sealedRefresh);
    if (!stored?.refreshToken) throw new ReconnectNeeded();
    let tokens: MicrosoftTokens;
    try {
      tokens = await (deps.refresh ?? refreshMicrosoft)(stored.refreshToken);
    } catch (error) {
      if (error instanceof MicrosoftAuthError && error.needsReconnect) {
        await deps.store.set(connKey(userId), { ...conn, reconnectNeeded: true });
        throw new ReconnectNeeded();
      }
      throw error;
    }
    if (tokens.refreshToken) {
      await deps.store.set(connKey(userId), { ...conn, sealedRefresh: await deps.sealer.seal({ refreshToken: tokens.refreshToken }) });
    }
    await cacheAccess(deps, userId, tokens);
    return tokens.accessToken;
  } finally {
    await deps.store.del(lockKey(userId));
  }
}
