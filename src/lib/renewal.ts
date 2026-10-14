import { createHash } from "node:crypto";
import type { Tokens } from "./monday/oauth";
import type { Store } from "./store";

// A Monday refresh token works only once, so when two requests (or two server
// copies on Vercel) notice an expiring sign-in together, only one may renew it.
// The winner takes a short lock in the shared store, renews, and leaves the new
// tokens there (sealed) for two minutes; the others wait for them.

export interface RenewalDeps {
  store: Store;
  refresh: (refreshToken: string) => Promise<Tokens>;
  seal: (tokens: Tokens) => Promise<string>;
  unseal: (sealed: string) => Promise<Tokens>;
  sleep?: (ms: number) => Promise<void>;
}

const LOCK_MS = 30_000;
const HANDOFF_MS = 120_000;
const WAIT_MS = 15_000;
const POLL_MS = 250;

const keyFor = (refreshToken: string) => createHash("sha256").update(refreshToken).digest("hex");

// Same-process callers share one promise, so they don't each poll the store.
const inProcess = new Map<string, Promise<Tokens>>();

export function renewShared(refreshToken: string, deps: RenewalDeps): Promise<Tokens> {
  const key = keyFor(refreshToken);
  let pending = inProcess.get(key);
  if (!pending) {
    pending = renewOnce(key, refreshToken, deps).finally(() => inProcess.delete(key));
    inProcess.set(key, pending);
  }
  return pending;
}

async function renewOnce(key: string, refreshToken: string, deps: RenewalDeps): Promise<Tokens> {
  const { store, refresh, seal, unseal } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const lockKey = `renew:lock:${key}`;
  const handoffKey = `renew:done:${key}`;

  const handedOff = async () => {
    const sealed = await store.get<string>(handoffKey);
    if (!sealed) return null;
    const tokens = await unseal(sealed);
    return tokens?.accessToken ? tokens : null; // an expired seal opens empty

  };

  const done = await handedOff();
  if (done) return done;

  if (await store.set(lockKey, 1, { nx: true, px: LOCK_MS })) {
    try {
      const tokens = await refresh(refreshToken);
      await store.set(handoffKey, await seal(tokens), { px: HANDOFF_MS });
      return tokens;
    } finally {
      await store.del(lockKey);
    }
  }

  for (let waited = 0; waited < WAIT_MS; waited += POLL_MS) {
    await sleep(POLL_MS);
    const tokens = await handedOff();
    if (tokens) return tokens;
    // The other renewal failed and let go of the lock: nothing will be handed off.
    if (!(await store.get(lockKey))) break;
  }
  throw new Error("The sign-in couldn't be renewed.");
}
