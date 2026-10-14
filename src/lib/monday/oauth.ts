import { createHash, randomBytes } from "node:crypto";

// Monday OAuth 2.1 (required for tokens since Oct 1, 2026): each broker signs
// in with their own Monday account. The authorize step carries a PKCE
// challenge (S256 only), the token step proves it with the verifier, and
// access tokens expire, so a single-use refresh token renews them.
// Needs MONDAY_CLIENT_ID, MONDAY_CLIENT_SECRET and APP_URL, and the app's
// "New OAuth Flow" setting turned on in Monday's Developer Center.

const AUTHORIZE_URL = "https://auth.monday.com/oauth2/authorize";
const TOKEN_URL = "https://auth.monday.com/oauth_ms/oauth/token";

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // ms since 1970; absent when Monday gives no expiry
}

function config() {
  const clientId = process.env.MONDAY_CLIENT_ID;
  const clientSecret = process.env.MONDAY_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;
  if (!clientId || !clientSecret || !appUrl) throw new Error("Monday sign-in is not configured.");
  return { clientId, clientSecret, redirectUri: `${appUrl}/api/auth/callback` };
}

const base64url = (b: Buffer) => b.toString("base64url");

export function newPkce() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function authorizeUrl(state: string, challenge: string): string {
  const { clientId, redirectUri } = config();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function tokenRequest(params: Record<string, string>, fetchImpl: typeof fetch): Promise<Tokens> {
  const { clientId, clientSecret } = config();
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret }),
  });
  const text = await res.text();
  let body: { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string } = {};
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON: report the start of what came back.
  }
  if (!res.ok || !body.access_token) {
    // Never echo a reply that carries a token.
    const raw = /token/i.test(text) ? "unexpected reply" : text.slice(0, 120) || "no body";
    const why = body.error ? [body.error, body.error_description].filter(Boolean).join(" - ") : raw;
    throw new Error(`Monday sign-in failed (HTTP ${res.status}: ${why}).`);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: body.expires_in ? Date.now() + body.expires_in * 1000 : undefined,
  };
}

export function exchangeCode(code: string, verifier: string, fetchImpl: typeof fetch = fetch): Promise<Tokens> {
  return tokenRequest(
    { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: config().redirectUri },
    fetchImpl,
  );
}

// Refresh tokens are single-use: the response carries the next one.
export function refreshTokens(refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<Tokens> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl);
}
