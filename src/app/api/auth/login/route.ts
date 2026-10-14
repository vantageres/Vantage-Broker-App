import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/session";
import { authorizeUrl, newPkce } from "@/lib/monday/oauth";

export async function GET() {
  const session = await getSession();
  const { verifier, challenge } = newPkce();
  session.oauthState = randomBytes(16).toString("hex");
  session.pkceVerifier = verifier;
  await session.save();
  return NextResponse.redirect(authorizeUrl(session.oauthState, challenge));
}
