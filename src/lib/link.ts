import { randomBytes, randomInt } from "node:crypto";
import type { Store } from "./store";

// Signing in a phone from a computer. Monday's sign-in page doesn't work in a
// phone browser, so the installed app shows a short code, the broker enters it
// on a computer where they're signed in, and the computer runs a fresh Monday
// sign-in made for the phone. The phone then collects it, once.
//
// The phone holds the pairing id in its (encrypted) sign-in cookie; the code is
// what the broker types. Both expire after 10 minutes. The phone's Monday
// tokens wait here sealed, never in the clear, until the phone collects them.

export const LINK_TTL_MS = 10 * 60 * 1000;
export const MAX_TRIES = 5; // wrong codes per computer sign-in, per 10 minutes

// No 0/O, 1/I/L: easy to read off a phone and type.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export interface Pairing {
  code: string;
  expiresAt: number;
  // Set once the computer has signed the phone in.
  sealedTokens?: string;
  userId?: string;
  name?: string;
}

const pairingKey = (id: string) => `link:pair:${id}`;
const codeKey = (code: string) => `link:code:${code}`;
const triesKey = (sid: string) => `link:tries:${sid}`;

export function newCode(): string {
  const chars = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

// What the broker typed, in the stored form: "k7q4 md2x" → "K7Q4-MD2X".
export function normalizeCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== 8 || [...raw].some((c) => !ALPHABET.includes(c))) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export async function startPairing(store: Store, now = Date.now()): Promise<{ id: string; code: string; expiresAt: number }> {
  const id = randomBytes(24).toString("hex");
  const expiresAt = now + LINK_TTL_MS;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    if (await store.set(codeKey(code), id, { nx: true, px: LINK_TTL_MS })) {
      await store.set(pairingKey(id), { code, expiresAt } satisfies Pairing, { px: LINK_TTL_MS });
      return { id, code, expiresAt };
    }
  }
  throw new Error("Couldn't make a sign-in code. Please try again.");
}

export async function endPairing(store: Store, id: string): Promise<void> {
  const pairing = await store.get<Pairing>(pairingKey(id));
  if (pairing) await store.del(codeKey(pairing.code));
  await store.del(pairingKey(id));
}

export type CodeCheck = { ok: true; id: string } | { ok: false; reason: "invalid" | "too-many" };

// The computer side: finds a waiting pairing by its code, counting wrong tries.
export async function checkCode(store: Store, sid: string, input: string): Promise<CodeCheck> {
  const tries = (await store.get<number>(triesKey(sid))) ?? 0;
  if (tries >= MAX_TRIES) return { ok: false, reason: "too-many" };
  const code = normalizeCode(input);
  const id = code ? await store.get<string>(codeKey(code)) : null;
  const pairing = id ? await store.get<Pairing>(pairingKey(id)) : null;
  if (!id || !pairing || pairing.sealedTokens) {
    await store.set(triesKey(sid), tries + 1, { px: LINK_TTL_MS });
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, id };
}

// After the computer's Monday sign-in for the phone: leave the sealed tokens
// for the phone. The code stops working at once.
export async function completePairing(store: Store, id: string, done: { sealedTokens: string; userId: string; name: string }, now = Date.now()): Promise<boolean> {
  const pairing = await store.get<Pairing>(pairingKey(id));
  if (!pairing || pairing.sealedTokens || pairing.expiresAt <= now) return false;
  await store.del(codeKey(pairing.code));
  await store.set(pairingKey(id), { ...pairing, ...done } satisfies Pairing, { px: pairing.expiresAt - now });
  return true;
}

export type Collected =
  | { status: "waiting"; code: string; expiresAt: number }
  | { status: "expired" }
  | { status: "ready"; sealedTokens: string; userId: string; name: string };

// The phone side: once ready, hands over the tokens and forgets the pairing.
export async function collectPairing(store: Store, id: string): Promise<Collected> {
  const pairing = await store.get<Pairing>(pairingKey(id));
  if (!pairing) return { status: "expired" };
  if (!pairing.sealedTokens || !pairing.userId || !pairing.name) {
    return { status: "waiting", code: pairing.code, expiresAt: pairing.expiresAt };
  }
  // Only one collection wins, even if two polls arrive together.
  if (!(await store.set(`link:claim:${id}`, 1, { nx: true, px: LINK_TTL_MS }))) return { status: "expired" };
  await store.del(pairingKey(id));
  return { status: "ready", sealedTokens: pairing.sealedTokens, userId: pairing.userId, name: pairing.name };
}
