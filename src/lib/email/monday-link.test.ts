import { describe, expect, it } from "vitest";
import { sealData, unsealData } from "iron-session";
import { memoryStore } from "../store";
import type { Tokens } from "../monday/oauth";
import { browserPlan, forgetMondayLink, mondayTokensFor, readMondayLink, saveMondayLink } from "./monday-link";
import type { Sealer } from "./connection";

// The Monday sign-in kept for scheduled runs (John, Nov 23): sealed, renewed
// once and shared, and kept in step with the browser's own cookie.

const password = "test-secret-0123456789abcdefghijklmnopqrstuvwxyz";
const sealer: Sealer = {
  seal: (v) => sealData(v, { password, ttl: 0 }),
  async unseal<T>(s: string) {
    const v = await unsealData<T>(s, { password, ttl: 0 });
    return v && Object.keys(v as object).length ? v : null;
  },
};
const who = { userId: "44432289", name: "John Smyth", accountSlug: "vantage" };
const NOW = Date.UTC(2026, 10, 23, 12);
const tokens = (n: number, expiresInMin = 60): Tokens => ({ accessToken: `access-${n}`, refreshToken: `refresh-${n}`, expiresAt: NOW + expiresInMin * 60_000 });

describe("the kept Monday sign-in", () => {
  it("is sealed in the store, never in the clear, and deleted on request", async () => {
    const store = memoryStore(() => NOW);
    await saveMondayLink({ store, sealer }, who, tokens(1), NOW);
    expect(JSON.stringify(await store.get("email:monday:44432289"))).not.toContain("refresh-1");
    expect((await readMondayLink({ store, sealer }, who.userId))?.tokens).toEqual(tokens(1));
    await forgetMondayLink(store, who.userId);
    expect(await readMondayLink({ store, sealer }, who.userId)).toBeNull();
  });

  it("a scheduled run uses fresh tokens as they are", async () => {
    const store = memoryStore(() => NOW);
    await saveMondayLink({ store, sealer }, who, tokens(1), NOW);
    const got = await mondayTokensFor({ store, sealer, refresh: async () => { throw new Error("should not renew"); }, now: () => NOW }, who.userId);
    expect(got).toEqual({ tokens: tokens(1), name: "John Smyth", accountSlug: "vantage" });
  });

  it("an expiring copy is renewed once and saved back, so the browser can adopt it", async () => {
    const store = memoryStore(() => NOW);
    await saveMondayLink({ store, sealer }, who, tokens(1, 2), NOW);
    const used: string[] = [];
    const refresh = async (r: string) => { used.push(r); return tokens(2); };
    const got = await mondayTokensFor({ store, sealer, refresh, now: () => NOW }, who.userId);
    expect(got?.tokens).toEqual(tokens(2));
    expect(used).toEqual(["refresh-1"]);
    expect((await readMondayLink({ store, sealer }, who.userId))?.tokens).toEqual(tokens(2));
  });

  it("no copy, or Monday refusing, means no Monday for that run", async () => {
    const store = memoryStore(() => NOW);
    expect(await mondayTokensFor({ store, sealer, refresh: async () => tokens(2), now: () => NOW }, who.userId)).toBeNull();
    await saveMondayLink({ store, sealer }, who, tokens(1, 2), NOW);
    await expect(mondayTokensFor({ store, sealer, refresh: async () => { throw new Error("invalid_grant"); }, now: () => NOW }, who.userId)).rejects.toThrow();
  });
});

describe("the browser's renewal, in step with the kept copy", () => {
  it("renews as before when there is no copy or it is the same sign-in", () => {
    expect(browserPlan(tokens(1), null, NOW)).toEqual({ kind: "own" });
    expect(browserPlan(tokens(1), tokens(1), NOW)).toEqual({ kind: "own" });
  });

  it("adopts newer tokens a scheduled run saved, while they are fresh", () => {
    expect(browserPlan(tokens(1, 1), tokens(2), NOW)).toEqual({ kind: "adopt", tokens: tokens(2) });
  });

  it("renews from the newest refresh token, never a used one", () => {
    expect(browserPlan(tokens(1, 1), tokens(2, 1), NOW)).toEqual({ kind: "renew-from", refreshToken: "refresh-2" });
  });
});
