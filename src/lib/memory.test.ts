import { describe, expect, it } from "vitest";
import { IdleCache } from "./memory";

describe("IdleCache", () => {
  it("forgets an entry after 10 idle minutes", () => {
    let now = 0;
    const cache = new IdleCache<string>(10 * 60 * 1000, () => now);
    cache.set("s1", "records");
    now = 9 * 60 * 1000;
    expect(cache.get("s1")).toBe("records");
    now += 10 * 60 * 1000 + 1;
    expect(cache.get("s1")).toBeUndefined();
  });

  it("each use restarts the 10 minutes", () => {
    let now = 0;
    const cache = new IdleCache<string>(10 * 60 * 1000, () => now);
    cache.set("s1", "records");
    for (let i = 0; i < 5; i++) {
      now += 9 * 60 * 1000;
      expect(cache.get("s1")).toBe("records");
    }
  });
});
