import { Redis } from "@upstash/redis";

// The app's own small store: approval settings, and a short-lived lock and
// handoff while a Monday sign-in renews. Never copies of Monday records.
// Upstash Redis (KV_REST_API_URL / KV_REST_API_TOKEN, from Vercel's
// Marketplace) in production; an in-memory stand-in for development and tests.

export interface Store {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { px?: number; nx?: boolean }): Promise<boolean>;
  del(key: string): Promise<void>;
  shared: boolean; // true when every server copy sees the same data
}

export function memoryStore(now: () => number = Date.now): Store {
  const data = new Map<string, { value: unknown; until?: number }>();
  const live = (key: string) => {
    const e = data.get(key);
    if (e?.until && e.until <= now()) data.delete(key);
    return data.get(key);
  };
  return {
    shared: false,
    async get<T>(key: string) {
      return (live(key)?.value as T) ?? null;
    },
    async set(key, value, opts = {}) {
      if (opts.nx && live(key)) return false;
      data.set(key, { value, until: opts.px ? now() + opts.px : undefined });
      return true;
    },
    async del(key) {
      data.delete(key);
    },
  };
}

function redisStore(url: string, token: string): Store {
  const redis = new Redis({ url, token });
  return {
    shared: true,
    get: <T>(key: string) => redis.get<T>(key),
    async set(key, value, opts = {}) {
      const res = opts.nx
        ? opts.px ? await redis.set(key, value, { nx: true, px: opts.px }) : await redis.set(key, value, { nx: true })
        : opts.px ? await redis.set(key, value, { px: opts.px }) : await redis.set(key, value);
      return res === "OK";
    },
    async del(key) {
      await redis.del(key);
    },
  };
}

// Pages and routes load separate copies of this module in development, so the
// in-memory stand-in is kept on globalThis to let them see the same data.
const holder = globalThis as { brokerAppStore?: Store };

export function getStore(): Store {
  let store = holder.brokerAppStore;
  if (!store) {
    const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
    if (url && token) store = redisStore(url, token);
    else if (process.env.NODE_ENV === "production") throw new Error("The app's store (Upstash Redis) is not configured.");
    else store = memoryStore();
    holder.brokerAppStore = store;
  }
  return store;
}
