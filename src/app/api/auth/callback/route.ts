import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { applyTokens, getSession } from "@/lib/session";
import { exchangeCode } from "@/lib/monday/oauth";
import { MondayError, mondayClient } from "@/lib/monday/client";
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
  // Which step failed goes to the server log and the sign-in page, so a
  // failure can be diagnosed. Tokens are never included.
  let step = "token";
  try {
    const tokens = await exchangeCode(code, verifier);
    step = "profile";
    const who = await whoAmI(mondayClient(tokens.accessToken));
    step = "session";
    applyTokens(session, tokens);
    Object.assign(session, who, { sid: randomBytes(16).toString("hex"), oauthState: undefined, pkceVerifier: undefined });
    await session.save();
    return NextResponse.redirect(new URL("/", url));
  } catch (error) {
    const details = error instanceof MondayError && error.details ? ` ${JSON.stringify(error.details)}` : "";
    const reason = `${step}: ${error instanceof Error ? error.message : String(error)}${details}`;
    console.error(`[sign-in] ${reason}`);
    const back = new URL("/signin", url);
    back.searchParams.set("error", "monday");
    back.searchParams.set("detail", reason.slice(0, 300));
    return NextResponse.redirect(back);
  }
}
