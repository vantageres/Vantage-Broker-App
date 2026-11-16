import { describe, expect, it } from "vitest";
import { memoryStore } from "../store";
import { emailMonitorAllowed } from "./access";
import { authorizeUrl, exchangeCode, hasMailRead, MicrosoftAuthError, refreshMicrosoft, SCOPES } from "./microsoft";
import { countInboxSince, COUNT_CAP, graphGet, GraphError, whoseMailbox } from "./graph";
import { accessToken, disconnect, getConnection, ReconnectNeeded, saveConnection, type Sealer } from "./connection";
import { outlookProblem } from "./problems";

const env = { MS_CLIENT_ID: "client", MS_CLIENT_SECRET: "secret", MS_TENANT_ID: "tenant-1", APP_URL: "https://brokers.example.com" } as unknown as NodeJS.ProcessEnv;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

// A stand-in sealer that still hides the value, so tests catch anything stored in the clear.
const sealer: Sealer = {
  async seal(v) {
    return `sealed:${Buffer.from(JSON.stringify(v)).toString("base64")}`;
  },
  async unseal<T>(s: string) {
    return s.startsWith("sealed:") ? (JSON.parse(Buffer.from(s.slice(7), "base64").toString()) as T) : null;
  },
};

describe("who sees the Email tab", () => {
  it("only Monday user ids in the list", () => {
    expect(emailMonitorAllowed("44432289", "44432289, 25374507")).toBe(true);
    expect(emailMonitorAllowed("25374507", "44432289, 25374507")).toBe(true);
    expect(emailMonitorAllowed("1", "44432289")).toBe(false);
    expect(emailMonitorAllowed("44432289", undefined)).toBe(false);
    expect(emailMonitorAllowed(undefined, "44432289")).toBe(false);
  });
});

describe("Microsoft sign-in", () => {
  it("asks for read-only scopes, with PKCE, on the tenant's own sign-in page", () => {
    const url = new URL(authorizeUrl("state-1", "challenge-1", env));
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/tenant-1/oauth2/v2.0/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe("https://brokers.example.com/api/email/callback");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("openid offline_access User.Read Mail.Read");
    // Nothing that could change or send mail.
    expect(SCOPES.some((s) => /send|readwrite|write/i.test(s))).toBe(false);
  });

  it("exchanges the code and keeps the refresh token", async () => {
    let sent: URLSearchParams | undefined;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      sent = init.body as URLSearchParams;
      return json(200, { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "Mail.Read User.Read" });
    }) as unknown as typeof fetch;
    const tokens = await exchangeCode("code-1", "verifier-1", fetchImpl, env);
    expect(tokens.refreshToken).toBe("rt");
    expect(sent?.get("code_verifier")).toBe("verifier-1");
    expect(sent?.get("client_secret")).toBe("secret");
  });

  it("an expired or revoked refresh token means reconnect, and the error never echoes the reply", async () => {
    const fetchImpl = (async () => json(400, { error: "invalid_grant", error_description: "AADSTS70008 refresh_token=abc" })) as unknown as typeof fetch;
    const err = (await refreshMicrosoft("rt", fetchImpl, env).catch((e) => e)) as MicrosoftAuthError;
    expect(err).toBeInstanceOf(MicrosoftAuthError);
    expect(err.needsReconnect).toBe(true);
    expect(err.message).not.toMatch(/abc|AADSTS/);
  });

  it("checks Mail.Read was granted", () => {
    expect(hasMailRead("openid profile https://graph.microsoft.com/Mail.Read User.Read")).toBe(true);
    expect(hasMailRead("openid User.Read")).toBe(false);
    expect(hasMailRead(undefined)).toBe(false);
  });

  it("tells admin approval apart from a broker saying no", () => {
    expect(outlookProblem("access_denied", "AADSTS65001: The user or administrator has not consented")).toBe("admin-approval");
    expect(outlookProblem("access_denied", "AADSTS90094: admin consent required")).toBe("admin-approval");
    expect(outlookProblem("access_denied", "The user canceled")).toBe("declined");
    expect(outlookProblem("server_error", null)).toBe("failed");
  });
});

describe("Graph, read only", () => {
  it("waits when throttled, then succeeds", async () => {
    const waits: number[] = [];
    let calls = 0;
    const fetchImpl = (async () => (++calls === 1 ? json(429, {}, { "Retry-After": "3" }) : json(200, { ok: true }))) as unknown as typeof fetch;
    const out = await graphGet<{ ok: boolean }>("t", "/me", { fetchImpl, sleep: async (ms) => void waits.push(ms) });
    expect(out.ok).toBe(true);
    expect(waits).toEqual([3000]);
  });

  it("errors carry the status and code only", async () => {
    const fetchImpl = (async () => json(403, { error: { code: "ErrorAccessDenied", message: "Subject: Secret deal" } })) as unknown as typeof fetch;
    const err = (await graphGet("t", "/me", { fetchImpl }).catch((e) => e)) as GraphError;
    expect(err).toBeInstanceOf(GraphError);
    expect(err.message).toContain("403");
    expect(err.message).not.toContain("Secret");
  });

  it("follows Graph's next links but no other site", async () => {
    await expect(graphGet("t", "https://evil.example.com/x", { fetchImpl: (async () => json(200, {})) as unknown as typeof fetch })).rejects.toThrow();
  });

  it("counts inbox messages across pages, reading ids only", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (u: string) => {
      urls.push(u);
      return urls.length === 1
        ? json(200, { value: [{ id: "1" }, { id: "2" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/next" })
        : json(200, { value: [{ id: "3" }] });
    }) as unknown as typeof fetch;
    const out = await countInboxSince("t", new Date("2026-11-16T12:00:00Z"), { fetchImpl });
    expect(out).toEqual({ count: 3, capped: false });
    expect(decodeURIComponent(urls[0])).toContain("$select=id");
    expect(decodeURIComponent(urls[0])).toContain("receivedDateTime ge 2026-11-16T12:00:00.000Z");
  });

  it("stops counting at the cap", async () => {
    const page = { value: Array.from({ length: 100 }, (_, i) => ({ id: String(i) })), "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/next" };
    const out = await countInboxSince("t", new Date(), { fetchImpl: (async () => json(200, page)) as unknown as typeof fetch });
    expect(out).toEqual({ count: COUNT_CAP, capped: true });
  });

  it("reads the mailbox address", async () => {
    const fetchImpl = (async () => json(200, { displayName: "John Smyth", mail: null, userPrincipalName: "JSmyth@Example.com" })) as unknown as typeof fetch;
    expect(await whoseMailbox("t", { fetchImpl })).toEqual({ name: "John Smyth", address: "jsmyth@example.com" });
  });
});

describe("the stored connection", () => {
  const mailbox = { name: "John Smyth", address: "john@example.com" };

  it("never stores tokens in the clear, and uses the cached access token", async () => {
    let now = 1_000_000;
    const store = memoryStore(() => now);
    const deps = { store, sealer, now: () => now, refresh: async () => { throw new Error("should not refresh"); } };
    await saveConnection(deps, "u1", { accessToken: "at-1", refreshToken: "rt-1", expiresAt: now + 3600_000 }, mailbox);
    const conn = await getConnection(deps, "u1");
    expect(JSON.stringify(conn)).not.toContain("rt-1");
    expect(JSON.stringify(await store.get("email:access:u1"))).not.toContain("at-1");
    expect(await accessToken(deps, "u1")).toBe("at-1");
    now += 10_000;
    expect(await accessToken(deps, "u1")).toBe("at-1");
  });

  it("renews when the access token is near expiry, keeping the newest refresh token", async () => {
    let now = 1_000_000;
    const store = memoryStore(() => now);
    const used: string[] = [];
    const deps = {
      store, sealer, now: () => now,
      refresh: async (rt: string) => {
        used.push(rt);
        return { accessToken: `at-${used.length + 1}`, refreshToken: `rt-${used.length + 1}`, expiresAt: now + 3600_000 };
      },
    };
    await saveConnection(deps, "u1", { accessToken: "at-1", refreshToken: "rt-1", expiresAt: now + 3600_000 }, mailbox);
    now += 3600_000; // expired
    expect(await accessToken(deps, "u1")).toBe("at-2");
    now += 3600_000;
    expect(await accessToken(deps, "u1")).toBe("at-3");
    expect(used).toEqual(["rt-1", "rt-2"]);
  });

  it("marks Reconnect needed when Microsoft refuses the refresh token", async () => {
    let now = 1_000_000;
    const store = memoryStore(() => now);
    const deps = {
      store, sealer, now: () => now,
      refresh: async () => { throw new MicrosoftAuthError("x", "invalid_grant", true); },
    };
    await saveConnection(deps, "u1", { accessToken: "at", refreshToken: "rt", expiresAt: now + 1000 }, mailbox);
    await expect(accessToken(deps, "u1")).rejects.toBeInstanceOf(ReconnectNeeded);
    expect((await getConnection(deps, "u1"))?.reconnectNeeded).toBe(true);
    // Later calls stop at once, without trying Microsoft again.
    await expect(accessToken(deps, "u1")).rejects.toBeInstanceOf(ReconnectNeeded);
    expect(await store.get("email:renew:u1")).toBeNull();
  });

  it("refuses a sign-in without offline access", async () => {
    const deps = { store: memoryStore(), sealer };
    await expect(saveConnection(deps, "u1", { accessToken: "at", expiresAt: Date.now() + 1000 }, mailbox)).rejects.toThrow(/offline/);
  });

  it("Disconnect deletes everything stored", async () => {
    const store = memoryStore();
    const deps = { store, sealer };
    await saveConnection(deps, "u1", { accessToken: "at", refreshToken: "rt", expiresAt: Date.now() + 3600_000 }, mailbox);
    await disconnect(deps, "u1");
    expect(await store.get("email:conn:u1")).toBeNull();
    expect(await store.get("email:access:u1")).toBeNull();
  });
});
