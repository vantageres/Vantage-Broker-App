import { NextResponse } from "next/server";
import { requireBroker, type SignedIn } from "./session";
import type { Context } from "./capture/service";

// Shared route plumbing: every API route needs a signed-in broker.
export async function withBroker(handler: (ctx: Context, signedIn: SignedIn) => Promise<Response>): Promise<Response> {
  const signedIn = await requireBroker();
  if (!signedIn) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { session, monday } = signedIn;
  const ctx: Context = { monday, sid: session.sid, accountSlug: session.accountSlug, me: { id: session.userId, name: session.name } };
  return handler(ctx, signedIn);
}

export function fail(error: unknown, status = 502) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  console.error(`[api] ${status} ${message}`, error instanceof Error && "details" in error ? JSON.stringify((error as { details?: unknown }).details) : "");
  return NextResponse.json({ error: message }, { status });
}
