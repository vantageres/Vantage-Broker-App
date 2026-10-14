import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { applyTokens, getSession } from "@/lib/session";
import { exchangeCode } from "@/lib/monday/oauth";
import { mondayClient } from "@/lib/monday/client";
import { whoAmI } from "@/lib/monday/me";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const session = await getSession();
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const verifier = session.pkceVerifier;
  if (!code || !state || !verifier || state !== session.oauthState) {
    return NextResponse.redirect(new URL("/signin?error=state", url));
  }
  try {
    const tokens = await exchangeCode(code, verifier);
    const who = await whoAmI(mondayClient(tokens.accessToken));
    applyTokens(session, tokens);
    Object.assign(session, who, { sid: randomBytes(16).toString("hex"), oauthState: undefined, pkceVerifier: undefined });
    await session.save();
    return NextResponse.redirect(new URL("/", url));
  } catch {
    return NextResponse.redirect(new URL("/signin?error=monday", url));
  }
}
