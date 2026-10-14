import { getIronSession, sealData, unsealData, type IronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { mondayClient, type MondayClient } from "./monday/client";
import { refreshTokens, type Tokens } from "./monday/oauth";
import { renewShared } from "./renewal";
import { getStore } from "./store";

// The broker's sign-in lives in an encrypted, http-only cookie so it persists
// on the phone. It holds the broker's own Monday tokens: every Monday call is
// made as them, so Monday's history shows who changed what.
export interface BrokerSession {
  sid?: string;
  userId?: string;
  name?: string;
  accountSlug?: string;
  token?: string;
  refreshToken?: string;
  expiresAt?: number;
  oauthState?: string;
  pkceVerifier?: string;
  returnTo?: string; // where to go after signing in (a path in this app)
  linkId?: string; // phone: the pairing it is waiting on (see link.ts)
  linkPairing?: string; // computer: the pairing its Monday sign-in is for
}

const THIRTY_DAYS = 60 * 60 * 24 * 30;
// Renew a little before Monday's expiry so a request never starts with a dead token.
const RENEW_EARLY_MS = 5 * 60 * 1000;

function sessionOptions(): SessionOptions {
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters.");
  }
  return {
    password,
    cookieName: "broker_session",
    ttl: THIRTY_DAYS,
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" },
  };
}

export async function getSession() {
  return getIronSession<BrokerSession>(await cookies(), sessionOptions());
}

// In development the Monday token comes from the environment (the cloud
// network proxy, or MONDAY_DEV_TOKEN on a PC), so a dev session carries none.
// Never allowed in production.
export function devProxyAuth(): boolean {
  return process.env.NODE_ENV !== "production" && (process.env.MONDAY_DEV_PROXY_AUTH === "1" || !!process.env.MONDAY_DEV_TOKEN);
}

export interface SignedIn {
  session: BrokerSession & { sid: string; userId: string; name: string; accountSlug: string };
  monday: MondayClient;
}

function signedIn(session: BrokerSession): session is SignedIn["session"] {
  return !!(session.sid && session.userId && session.name && session.accountSlug && (session.token || devProxyAuth()));
}

function needsRenewal(session: BrokerSession, now = Date.now()) {
  return !!session.token && !!session.expiresAt && session.expiresAt - RENEW_EARLY_MS <= now;
}

export function applyTokens(session: BrokerSession, tokens: Tokens) {
  session.token = tokens.accessToken;
  session.refreshToken = tokens.refreshToken ?? session.refreshToken;
  session.expiresAt = tokens.expiresAt;
}

// Monday tokens waiting in the store for a phone (see link.ts) are sealed with
// the session secret, so the store never holds them in the clear.
export function sealTokens(tokens: Tokens): Promise<string> {
  return sealData(tokens, { password: sessionOptions().password as string, ttl: 15 * 60 });
}

export async function unsealTokens(sealed: string): Promise<Tokens | null> {
  const tokens = await unsealData<Tokens>(sealed, { password: sessionOptions().password as string, ttl: 15 * 60 });
  return tokens?.accessToken ? tokens : null; // an expired seal opens empty
}

// A path in this app, never another site.
export function safePath(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

// One renewal at a time per sign-in, across every server copy (see renewal.ts).
async function renew(session: IronSession<BrokerSession>): Promise<boolean> {
  if (!session.refreshToken) return false;
  const password = sessionOptions().password as string;
  try {
    const tokens = await renewShared(session.refreshToken, {
      store: getStore(),
      refresh: refreshTokens,
      seal: (t) => sealData(t, { password, ttl: 300 }),
      unseal: (s) => unsealData<Tokens>(s, { password, ttl: 300 }),
    });
    applyTokens(session, tokens);
    await session.save();
    return true;
  } catch (error) {
    console.error(`[sign-in] renewal failed: ${error instanceof Error ? error.message : "unknown"}`);
    return false;
  }
}

// For route handlers, which can update the cookie: renews an expiring token.
export async function requireBroker(): Promise<SignedIn | null> {
  const session = await getSession();
  if (!signedIn(session)) return null;
  if (needsRenewal(session) && !(await renew(session))) return null;
  return { session, monday: mondayClient(session.token) };
}

// For pages, which can read the cookie but not change it: an expiring token
// sends the browser through /api/auth/refresh and back.
export type PageBroker = { kind: "ok"; signedIn: SignedIn } | { kind: "renew" } | { kind: "signed-out" };

export async function brokerForPage(): Promise<PageBroker> {
  const session = await getSession();
  if (!signedIn(session)) return { kind: "signed-out" };
  if (needsRenewal(session)) return { kind: "renew" };
  return { kind: "ok", signedIn: { session, monday: mondayClient(session.token) } };
}
