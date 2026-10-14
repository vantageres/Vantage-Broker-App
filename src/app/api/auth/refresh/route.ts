import { NextResponse } from "next/server";
import { requireBroker, safePath } from "@/lib/session";

// Pages can't update the sign-in cookie, so an expiring Monday token is
// renewed here and the browser goes back where it was.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const safeNext = safePath(url.searchParams.get("next"));
  const signedIn = await requireBroker();
  return NextResponse.redirect(new URL(signedIn ? safeNext : "/signin", url));
}
