import { describe, expect, it } from "vitest";
import { MAX_TRIES, LINK_TTL_MS, checkCode, collectPairing, completePairing, endPairing, normalizeCode, startPairing } from "./link";
import { memoryStore } from "./store";

const done = { sealedTokens: "sealed", userId: "44432289", name: "John Smyth" };

describe("phone sign-in codes", () => {
  it("reads a typed code in any case or spacing", () => {
    expect(normalizeCode("k7q4 md2x")).toBe("K7Q4-MD2X");
    expect(normalizeCode("K7Q4-MD2X")).toBe("K7Q4-MD2X");
    expect(normalizeCode("K7Q4MD2")).toBeNull(); // too short
    expect(normalizeCode("K7Q4-MD2O")).toBeNull(); // O is never used
  });

  it("links a phone once, from code to collected tokens", async () => {
    const store = memoryStore();
    const { id, code } = await startPairing(store);
    expect(await collectPairing(store, id)).toMatchObject({ status: "waiting", code });

    const check = await checkCode(store, "computer", code.toLowerCase());
    expect(check).toEqual({ ok: true, id });
    expect(await completePairing(store, id, done)).toBe(true);

    // The code stops working as soon as the phone is signed in.
    expect(await checkCode(store, "computer", code)).toEqual({ ok: false, reason: "invalid" });
    expect(await collectPairing(store, id)).toEqual({ status: "ready", ...done });
    expect(await collectPairing(store, id)).toEqual({ status: "expired" });
  });

  it("can't be completed twice", async () => {
    const store = memoryStore();
    const { id } = await startPairing(store);
    expect(await completePairing(store, id, done)).toBe(true);
    expect(await completePairing(store, id, { ...done, userId: "25374507" })).toBe(false);
    expect(await collectPairing(store, id)).toMatchObject({ status: "ready", userId: "44432289" });
  });

  it("expires after 10 minutes", async () => {
    let now = 1_000_000;
    const store = memoryStore(() => now);
    const { id, code } = await startPairing(store, now);
    now += LINK_TTL_MS;
    expect(await checkCode(store, "computer", code)).toEqual({ ok: false, reason: "invalid" });
    expect(await completePairing(store, id, done, now)).toBe(false);
    expect(await collectPairing(store, id)).toEqual({ status: "expired" });
  });

  it("stops checking codes after too many wrong tries", async () => {
    const store = memoryStore();
    const { code } = await startPairing(store);
    for (let i = 0; i < MAX_TRIES; i++) {
      expect(await checkCode(store, "computer", "AAAA-AAAA")).toEqual({ ok: false, reason: "invalid" });
    }
    expect(await checkCode(store, "computer", code)).toEqual({ ok: false, reason: "too-many" });
    // Another broker's computer isn't affected.
    expect((await checkCode(store, "other", code)).ok).toBe(true);
  });

  it("forgets a pairing the phone gives up on", async () => {
    const store = memoryStore();
    const { id, code } = await startPairing(store);
    await endPairing(store, id);
    expect(await checkCode(store, "computer", code)).toEqual({ ok: false, reason: "invalid" });
    expect(await collectPairing(store, id)).toEqual({ status: "expired" });
  });
});
