// Monday OAuth: each broker signs in with their own Monday account.
// Needs MONDAY_CLIENT_ID, MONDAY_CLIENT_SECRET and APP_URL.

function config() {
  const clientId = process.env.MONDAY_CLIENT_ID;
  const clientSecret = process.env.MONDAY_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;
  if (!clientId || !clientSecret || !appUrl) throw new Error("Monday sign-in is not configured.");
  return { clientId, clientSecret, redirectUri: `${appUrl}/api/auth/callback` };
}

export function authorizeUrl(state: string): string {
  const { clientId, redirectUri } = config();
  const url = new URL("https://auth.monday.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCode(code: string): Promise<string> {
  const { clientId, clientSecret, redirectUri } = config();
  const res = await fetch("https://auth.monday.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  });
  if (!res.ok) throw new Error(`Monday sign-in failed (HTTP ${res.status}).`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("Monday sign-in returned no token.");
  return body.access_token;
}
