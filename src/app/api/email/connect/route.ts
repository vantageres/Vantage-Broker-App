import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireBroker } from "@/lib/session";
import { getStore } from "@/lib/store";
import { emailMonitorAllowed } from "@/lib/email/access";
import { authorizeUrl, microsoftConfigured, newPkce } from "@/lib/email/microsoft";

// Starts "Connect Outlook". The state names the Monday user who started it,
// so the callback only saves a mailbox for that same signed-in broker.
export async function GET(req: Request) {
  const signedIn = await requireBroker();
  if (!signedIn) return NextResponse.redirect(new URL("/signin", req.url));
  const back = new URL("/?tab=email", req.url);
  if (!emailMonitorAllowed(signedIn.session.userId)) return NextResponse.redirect(new URL("/", req.url));
  if (!microsoftConfigured()) {
    back.searchParams.set("outlook", "not-set-up");
    return NextResponse.redirect(back);
  }
  const { verifier, challenge } = newPkce();
  const state = randomBytes(24).toString("base64url");
  await getStore().set(`email:oauth:${state}`, { userId: signedIn.session.userId, verifier }, { px: 10 * 60 * 1000 });
  return NextResponse.redirect(authorizeUrl(state, challenge));
}
