import { createHash, randomBytes } from "node:crypto";

// Microsoft sign-in for the email monitor (docs/email-monitor-plan.md).
// Brokers still sign in to the app with Monday; this is a separate, one-time
// "Connect Outlook" step. The server runs the authorization-code flow as a
// confidential (Web) client with PKCE, so it gets a refresh token it can use
// later without the broker. Read-only scopes only: nothing here can send,
// move, flag or delete mail.
// Needs MS_CLIENT_ID, MS_CLIENT_SECRET, MS_TENANT_ID and APP_URL.

export const SCOPES = ["openid", "offline_access", "User.Read", "Mail.Read"];

export interface MicrosoftTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // ms since 1970
  scope?: string;
}

interface Config {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  redirectUri: string;
}

export function microsoftConfigured(env = process.env): boolean {
  return !!(env.MS_CLIENT_ID && env.MS_CLIENT_SECRET && env.MS_TENANT_ID && env.APP_URL);
}

function config(env = process.env): Config {
  const { MS_CLIENT_ID: clientId, MS_CLIENT_SECRET: clientSecret, MS_TENANT_ID: tenantId, APP_URL: appUrl } = env;
  if (!clientId || !clientSecret || !tenantId || !appUrl) throw new Error("Outlook connection is not set up yet.");
  return { clientId, clientSecret, tenantId, redirectUri: `${appUrl}/api/email/callback` };
}

const base = (tenantId: string) => `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0`;

export function newPkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizeUrl(state: string, challenge: string, env = process.env): string {
  const { clientId, tenantId, redirectUri } = config(env);
  const url = new URL(`${base(tenantId)}/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

// Microsoft's error codes worth telling apart; anything else is a plain failure.
export class MicrosoftAuthError extends Error {
  constructor(message: string, readonly code: string | undefined, readonly needsReconnect: boolean) {
    super(message);
  }
}

async function tokenRequest(params: Record<string, string>, fetchImpl: typeof fetch, env = process.env): Promise<MicrosoftTokens> {
  const { clientId, clientSecret, tenantId } = config(env);
  const res = await fetchImpl(`${base(tenantId)}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret, scope: SCOPES.join(" ") }),
  });
  let body: { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_codes?: number[] } = {};
  try {
    body = await res.json();
  } catch {
    // Not JSON.
  }
  if (!res.ok || !body.access_token) {
    // Only Microsoft's error code and HTTP status: never the reply body, which
    // can carry tokens or the broker's details.
    const code = body.error;
    // invalid_grant: the refresh token expired, was revoked, or consent was withdrawn.
    const needsReconnect = code === "invalid_grant" || code === "interaction_required" || code === "consent_required";
    throw new MicrosoftAuthError(`Microsoft sign-in failed (HTTP ${res.status}${code ? `: ${code}` : ""}).`, code, needsReconnect);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    scope: body.scope,
  };
}

export function exchangeCode(code: string, verifier: string, fetchImpl: typeof fetch = fetch, env = process.env) {
  return tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: config(env).redirectUri }, fetchImpl, env);
}

// Microsoft may send a new refresh token with each renewal; keep the newest.
export function refreshMicrosoft(refreshToken: string, fetchImpl: typeof fetch = fetch, env = process.env) {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl, env);
}

// The scopes granted must include Mail.Read; a broker who unticked it can't be monitored.
export function hasMailRead(scope: string | undefined): boolean {
  return !!scope && scope.split(" ").some((s) => s.toLowerCase().endsWith("mail.read"));
}
