import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renewShared, type RenewalDeps } from "./renewal";
import { memoryStore, type Store } from "./store";
import type { Tokens } from "./monday/oauth";

function deps(store: Store, refresh: RenewalDeps["refresh"]): RenewalDeps {
  return {
    store,
    refresh,
    seal: async (t) => JSON.stringify(t),
    unseal: async (s) => JSON.parse(s) as Tokens,
    sleep: () => new Promise((r) => setTimeout(r, 1)),
  };
}

describe("renewShared", () => {
  it("renews once when several requests need it together", async () => {
    let calls = 0;
    const refresh = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return { accessToken: "new", refreshToken: "r2" };
    };
    const store = memoryStore();
    const results = await Promise.all([1, 2, 3].map(() => renewShared("r1", deps(store, refresh))));
    expect(calls).toBe(1);
    expect(results.every((t) => t.accessToken === "new")).toBe(true);
  });

  it("waits for another server copy's renewal instead of renewing again", async () => {
    const store = memoryStore();
    const key = createHash("sha256").update("r1").digest("hex");
    await store.set(`renew:lock:${key}`, 1, { px: 30_000 }); // another copy is renewing
    let calls = 0;
    const waiting = renewShared("r1", deps(store, async () => (calls++, { accessToken: "mine" })));
    await new Promise((r) => setTimeout(r, 10));
    await store.set(`renew:done:${key}`, JSON.stringify({ accessToken: "theirs", refreshToken: "r2" }));
    expect((await waiting).accessToken).toBe("theirs");
    expect(calls).toBe(0);
    // Later callers with the old refresh token get the same tokens.
    expect((await renewShared("r1", deps(store, async () => (calls++, { accessToken: "x" })))).accessToken).toBe("theirs");
    expect(calls).toBe(0);
  });

  it("stops waiting when the other copy's renewal fails", async () => {
    const store = memoryStore();
    const key = createHash("sha256").update("r1").digest("hex");
    await store.set(`renew:lock:${key}`, 1);
    const waiting = renewShared("r1", deps(store, async () => ({ accessToken: "mine" })));
    await new Promise((r) => setTimeout(r, 10));
    await store.del(`renew:lock:${key}`);
    await expect(waiting).rejects.toThrow("couldn't be renewed");
  });

  it("waiters give up when the renewal fails", async () => {
    const store = memoryStore();
    const a = renewShared("r1", deps(store, async () => {
      await new Promise((r) => setTimeout(r, 5));
      throw new Error("refused");
    }));
    await expect(a).rejects.toThrow("refused");
    // The lock is gone, so a new attempt can try again.
    const b = await renewShared("r1", deps(store, async () => ({ accessToken: "ok" })));
    expect(b.accessToken).toBe("ok");
  });
});
