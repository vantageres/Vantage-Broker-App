import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { authorizeUrl, exchangeCode, newPkce, refreshTokens } from "./oauth";

beforeEach(() => {
  process.env.MONDAY_CLIENT_ID = "client";
  process.env.MONDAY_CLIENT_SECRET = "secret";
  process.env.APP_URL = "https://broker.example";
});

function capture(response: unknown, status = 200) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: new URLSearchParams(String(init.body)) });
    return new Response(JSON.stringify(response), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("Monday OAuth 2.1", () => {
  it("makes an S256 PKCE challenge from the verifier", () => {
    const { verifier, challenge } = newPkce();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });

  it("sends the challenge on the authorize step", () => {
    const url = new URL(authorizeUrl("state1", "chal"));
    expect(url.origin + url.pathname).toBe("https://auth.monday.com/oauth2/authorize");
    expect(url.searchParams.get("code_challenge")).toBe("chal");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe("https://broker.example/api/auth/callback");
    expect(url.searchParams.get("state")).toBe("state1");
  });

  it("proves the verifier at the new token address and keeps the refresh token", async () => {
    const { calls, fetchImpl } = capture({ access_token: "a1", refresh_token: "r1", expires_in: 86400 });
    const tokens = await exchangeCode("code1", "verifier1", fetchImpl);
    expect(calls[0].url).toBe("https://auth.monday.com/oauth_ms/oauth/token");
    expect(Object.fromEntries(calls[0].body)).toMatchObject({
      grant_type: "authorization_code", code: "code1", code_verifier: "verifier1", client_id: "client", client_secret: "secret",
    });
    expect(tokens).toMatchObject({ accessToken: "a1", refreshToken: "r1" });
    expect(tokens.expiresAt! - Date.now()).toBeGreaterThan(86000 * 1000);
  });

  it("renews with the refresh token and returns the next one", async () => {
    const { calls, fetchImpl } = capture({ access_token: "a2", refresh_token: "r2", expires_in: 86400 });
    const tokens = await refreshTokens("r1", fetchImpl);
    expect(Object.fromEntries(calls[0].body)).toMatchObject({ grant_type: "refresh_token", refresh_token: "r1" });
    expect(tokens.refreshToken).toBe("r2");
  });

  it("reports Monday's error instead of signing in", async () => {
    const { fetchImpl } = capture({ error: "invalid_grant" }, 400);
    await expect(refreshTokens("used", fetchImpl)).rejects.toThrow("HTTP 400: invalid_grant");
  });
});
