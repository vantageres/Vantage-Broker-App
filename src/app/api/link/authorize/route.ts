import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import type { IronSession } from "iron-session";
import { requireBroker, type BrokerSession } from "@/lib/session";
import { authorizeUrl, newPkce } from "@/lib/monday/oauth";
import { checkCode } from "@/lib/link";
import { getStore } from "@/lib/store";

// Computer: the broker entered the code from their phone. A fresh Monday
// sign-in follows, and the callback hands it to the phone, not this computer.
// A form post, never a link, so another site can't start it for a signed-in broker.
export async function POST(req: Request) {
  const url = new URL(req.url);
  const origin = req.headers.get("origin");
  if (origin && origin !== url.origin) return NextResponse.json({ error: "Not allowed." }, { status: 403 });

  const signedIn = await requireBroker();
  if (!signedIn) return NextResponse.redirect(new URL("/link", url), 303);
  // requireBroker hands back the cookie session itself, so it can be saved.
  const session = signedIn.session as IronSession<BrokerSession> & typeof signedIn.session;

  const form = await req.formData();
  const check = await checkCode(getStore(), session.sid, String(form.get("code") ?? ""));
  if (!check.ok) return NextResponse.redirect(new URL(`/link?error=${check.reason}`, url), 303);

  const { verifier, challenge } = newPkce();
  session.oauthState = randomBytes(16).toString("hex");
  session.pkceVerifier = verifier;
  session.linkPairing = check.id;
  await session.save();
  return NextResponse.redirect(authorizeUrl(session.oauthState, challenge), 303);
}
