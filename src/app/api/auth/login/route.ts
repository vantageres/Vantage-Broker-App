import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getSession, safePath } from "@/lib/session";
import { authorizeUrl, newPkce } from "@/lib/monday/oauth";

export async function GET(req: Request) {
  const session = await getSession();
  const { verifier, challenge } = newPkce();
  session.oauthState = randomBytes(16).toString("hex");
  session.pkceVerifier = verifier;
  session.returnTo = safePath(new URL(req.url).searchParams.get("next"));
  session.linkPairing = undefined;
  await session.save();
  return NextResponse.redirect(authorizeUrl(session.oauthState, challenge));
}
