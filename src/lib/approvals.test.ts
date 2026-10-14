import { afterEach, describe, expect, it } from "vitest";
import { isOperationsManager, readApprovals, setApproval } from "./approvals";
import { memoryStore } from "./store";

describe("approval settings", () => {
  it("every action type starts at confirm", async () => {
    const s = await readApprovals(memoryStore());
    expect(Object.values(s.modes).every((m) => m === "confirm")).toBe(true);
  });

  it("saves one action type and records who changed it", async () => {
    const store = memoryStore();
    await setApproval(store, "note", "auto", "John Smyth");
    const s = await readApprovals(store);
    expect(s.modes.note).toBe("auto");
    expect(s.modes.create).toBe("confirm");
    expect(s.changedBy).toBe("John Smyth");
  });

  it("refuses unknown action types and settings", async () => {
    await expect(setApproval(memoryStore(), "delete", "auto", "x")).rejects.toThrow();
    await expect(setApproval(memoryStore(), "note", "always", "x")).rejects.toThrow();
  });

  it("ignores anything unexpected in the stored value", async () => {
    const store = memoryStore();
    await store.set("settings:approvals", { modes: { note: "yes", claim: "auto", bogus: "auto" } });
    const s = await readApprovals(store);
    expect(s.modes.note).toBe("confirm");
    expect(s.modes.claim).toBe("auto");
    expect("bogus" in s.modes).toBe(false);
  });
});

describe("isOperationsManager", () => {
  afterEach(() => {
    delete process.env.OPERATIONS_MANAGER_IDS;
  });
  it("reads the comma-separated Monday user ids", () => {
    process.env.OPERATIONS_MANAGER_IDS = " 44432289 , 123";
    expect(isOperationsManager("44432289")).toBe(true);
    expect(isOperationsManager("25374507")).toBe(false);
  });
  it("nobody when unset", () => {
    expect(isOperationsManager("44432289")).toBe(false);
  });
});

describe("memoryStore", () => {
  it("nx refuses a live key and px expires it", async () => {
    let now = 0;
    const store = memoryStore(() => now);
    expect(await store.set("k", 1, { nx: true, px: 100 })).toBe(true);
    expect(await store.set("k", 2, { nx: true })).toBe(false);
    now = 101;
    expect(await store.get("k")).toBeNull();
    expect(await store.set("k", 3, { nx: true })).toBe(true);
  });
});
