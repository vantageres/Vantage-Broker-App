import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { mondayClient, type MondayClient } from "./monday/client";

// The broker's sign-in lives in an encrypted, http-only cookie so it persists
// on the phone. It holds the broker's own Monday token: every Monday call is
// made as them, so Monday's history shows who changed what.
export interface BrokerSession {
  sid?: string;
  userId?: string;
  name?: string;
  accountSlug?: string;
  token?: string;
  oauthState?: string;
}

const THIRTY_DAYS = 60 * 60 * 24 * 30;

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

export async function requireBroker(): Promise<SignedIn | null> {
  const session = await getSession();
  if (!session.sid || !session.userId || !session.name || !session.accountSlug) return null;
  if (!session.token && !devProxyAuth()) return null;
  return { session: session as SignedIn["session"], monday: mondayClient(session.token) };
}
