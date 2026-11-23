import type { Tokens } from "../monday/oauth";
import { renewShared } from "../renewal";
import type { Store } from "../store";
import type { Sealer } from "./connection";

// Scheduled runs read Monday as the broker (John, Nov 23). A broker's Monday
// sign-in normally lives only in their browser cookie, so for brokers on the
// email monitor list the newest Monday tokens are also kept here, sealed
// with the session secret, under their Monday user id.
//
// A Monday refresh token works only once, so this copy and the cookie must
// never renew separately: whoever renews first (the browser or a scheduled
// run) saves the new tokens here, and the other renews from or adopts these.
// Deleted on sign-out and on Disconnect.

export interface MondayLink {
  userId: string;
  name: string;
  accountSlug: string;
  sealedTokens: string;
  savedAt: string;
}

export interface LinkDeps {
  store: Store;
  sealer: Sealer;
  refresh: (refreshToken: string) => Promise<Tokens>;
  now?: () => number;
}

const RENEW_EARLY_MS = 5 * 60 * 1000;
const keyFor = (userId: string) => `email:monday:${userId}`;

export async function saveMondayLink(deps: Pick<LinkDeps, "store" | "sealer">, who: { userId: string; name: string; accountSlug: string }, tokens: Tokens, now = Date.now()) {
  const link: MondayLink = { ...who, sealedTokens: await deps.sealer.seal({ ...tokens }), savedAt: new Date(now).toISOString() };
  await deps.store.set(keyFor(who.userId), link);
}

export async function readMondayLink(deps: Pick<LinkDeps, "store" | "sealer">, userId: string): Promise<{ link: MondayLink; tokens: Tokens } | null> {
  const link = await deps.store.get<MondayLink>(keyFor(userId));
  if (!link) return null;
  const tokens = await deps.sealer.unseal<Tokens>(link.sealedTokens);
  return tokens?.accessToken ? { link, tokens } : null;
}

export async function forgetMondayLink(store: Store, userId: string) {
  await store.del(keyFor(userId));
}

const fresh = (t: Tokens, now: number) => !t.expiresAt || t.expiresAt - RENEW_EARLY_MS > now;

// Tokens a scheduled run can use: the stored ones while they last, else one
// shared renewal (renewal.ts), saved back here. Null when there is no link
// or Monday refuses: the run then goes ahead without Monday.
export async function mondayTokensFor(deps: LinkDeps, userId: string): Promise<{ tokens: Tokens; name: string; accountSlug: string } | null> {
  const now = (deps.now ?? Date.now)();
  const found = await readMondayLink(deps, userId);
  if (!found) return null;
  const { link, tokens } = found;
  if (fresh(tokens, now)) return { tokens, name: link.name, accountSlug: link.accountSlug };
  if (!tokens.refreshToken) return null;
  const renewed = await renewShared(tokens.refreshToken, {
    store: deps.store,
    refresh: deps.refresh,
    seal: (t) => deps.sealer.seal({ ...t }),
    unseal: async (s) => (await deps.sealer.unseal<Tokens>(s)) ?? { accessToken: "" },
  });
  const next = { ...renewed, refreshToken: renewed.refreshToken ?? tokens.refreshToken };
  await saveMondayLink(deps, link, next, now);
  return { tokens: next, name: link.name, accountSlug: link.accountSlug };
}

// For the browser's own renewal: what it should do given the stored copy.
// "adopt": the stored tokens are newer and still fresh, use them as they are.
// "renew-from": renew with the stored (newest) refresh token, not the cookie's.
// "own": no stored copy, or the same chain: renew as before.
export function browserPlan(cookie: Tokens, stored: Tokens | null, now = Date.now()): { kind: "adopt"; tokens: Tokens } | { kind: "renew-from"; refreshToken: string } | { kind: "own" } {
  if (!stored || !stored.refreshToken || stored.refreshToken === cookie.refreshToken) return { kind: "own" };
  if (fresh(stored, now)) return { kind: "adopt", tokens: stored };
  return { kind: "renew-from", refreshToken: stored.refreshToken };
}
