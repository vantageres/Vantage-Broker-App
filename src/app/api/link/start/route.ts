import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { endPairing, startPairing } from "@/lib/link";
import { getStore } from "@/lib/store";
import { fail } from "@/lib/api";

// Phone: a new code to enter on a computer (see lib/link.ts).
export async function POST() {
  try {
    const session = await getSession();
    const store = getStore();
    if (session.linkId) await endPairing(store, session.linkId);
    const { id, code, expiresAt } = await startPairing(store);
    session.linkId = id;
    await session.save();
    return NextResponse.json({ status: "waiting", code, expiresAt });
  } catch (error) {
    return fail(error, 500);
  }
}
