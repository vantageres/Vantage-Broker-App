import type { Tokens } from "../monday/oauth";
import { getStore } from "../store";
import { emailMonitorAllowed } from "./access";
import { browserPlan, forgetMondayLink, readMondayLink, saveMondayLink } from "./monday-link";
import { sealer } from "./server";

// The Monday sign-in copy (monday-link.ts), wired to the real store, for the
// app's sign-in code. Only brokers on the email monitor list are affected,
// and nothing here ever stops a sign-in: a failure is logged (type only) and
// sign-in carries on exactly as before.

interface Who {
  userId?: string;
  name?: string;
  accountSlug?: string;
  token?: string;
  refreshToken?: string;
  expiresAt?: number;
}

const tokensOf = (s: Who): Tokens | null => (s.token ? { accessToken: s.token, refreshToken: s.refreshToken, expiresAt: s.expiresAt } : null);

export async function rememberMonday(session: Who): Promise<void> {
  const tokens = tokensOf(session);
  if (!tokens || !session.userId || !session.name || !session.accountSlug || !emailMonitorAllowed(session.userId)) return;
  try {
    await saveMondayLink({ store: getStore(), sealer }, { userId: session.userId, name: session.name, accountSlug: session.accountSlug }, tokens);
  } catch (error) {
    console.error(`[email] Monday sign-in not kept for scheduled runs: ${error instanceof Error ? error.constructor.name : "unknown"}`);
  }
}

// Before the browser renews: adopt newer tokens a scheduled run saved, or
// renew from the newest refresh token. "own" means renew as before.
export async function planBrowserRenewal(session: Who): Promise<ReturnType<typeof browserPlan>> {
  const cookie = tokensOf(session);
  if (!cookie || !session.userId || !emailMonitorAllowed(session.userId)) return { kind: "own" };
  try {
    const stored = await readMondayLink({ store: getStore(), sealer }, session.userId);
    return browserPlan(cookie, stored?.tokens ?? null);
  } catch (error) {
    console.error(`[email] Monday sign-in copy not read: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    return { kind: "own" };
  }
}

export async function forgetMonday(userId: string | undefined): Promise<void> {
  if (!userId) return;
  try {
    await forgetMondayLink(getStore(), userId);
  } catch (error) {
    console.error(`[email] Monday sign-in copy not deleted: ${error instanceof Error ? error.constructor.name : "unknown"}`);
  }
}
