import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/session";
import { authorizeUrl } from "@/lib/monday/oauth";

export async function GET() {
  const session = await getSession();
  session.oauthState = randomBytes(16).toString("hex");
  await session.save();
  return NextResponse.redirect(authorizeUrl(session.oauthState));
}
