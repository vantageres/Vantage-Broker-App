import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { mondayClient, type MondayClient } from "./monday/client";
import { refreshTokens, type Tokens } from "./monday/oauth";

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

// In this development environment the Monday token is added to requests by
// the network proxy, so a dev session carries none. Never allowed in production.
export function devProxyAuth(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.MONDAY_DEV_PROXY_AUTH === "1";
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

// One renewal at a time per sign-in: a refresh token works only once, so two
// requests renewing together would sign the broker out.
const renewing = new Map<string, Promise<Tokens>>();

async function renew(session: IronSession<BrokerSession>): Promise<boolean> {
  if (!session.refreshToken || !session.sid) return false;
  const key = session.sid;
  let pending = renewing.get(key);
  if (!pending) {
    pending = refreshTokens(session.refreshToken).finally(() => setTimeout(() => renewing.delete(key), 30_000));
    renewing.set(key, pending);
  }
  try {
    applyTokens(session, await pending);
    await session.save();
    return true;
  } catch {
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
