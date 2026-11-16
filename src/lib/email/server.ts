import { sealData, unsealData } from "iron-session";
import { getStore } from "../store";
import type { ConnectionDeps, Sealer } from "./connection";

// The real store and sealer for routes. Sealed values never expire on their
// own (ttl 0); the connection is removed on Disconnect.
function secret(): string {
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters.");
  return password;
}

export const sealer: Sealer = {
  seal: (value) => sealData(value, { password: secret(), ttl: 0 }),
  async unseal<T>(sealed: string) {
    const v = await unsealData<T>(sealed, { password: secret(), ttl: 0 });
    return v && Object.keys(v as object).length ? v : null;
  },
};

export function connectionDeps(): ConnectionDeps {
  return { store: getStore(), sealer };
}
