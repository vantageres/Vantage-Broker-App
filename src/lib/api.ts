import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { requireBroker, type SignedIn } from "./session";
import { APP_VERSION, UPDATED_MESSAGE, VERSION_HEADER } from "./version";
import type { Context } from "./capture/service";

// Shared route plumbing: every API route needs a signed-in broker, and a page
// running the same version of the app as the server. A page from before a
// deploy (no version, or another one) is refused before anything is read or
// saved, and asked to reload.
export async function withBroker(handler: (ctx: Context, signedIn: SignedIn) => Promise<Response>): Promise<Response> {
  if ((await headers()).get(VERSION_HEADER) !== APP_VERSION) {
    return NextResponse.json({ error: UPDATED_MESSAGE, reload: true }, { status: 409, headers: { [VERSION_HEADER]: APP_VERSION } });
  }
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
