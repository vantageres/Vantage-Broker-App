import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { applyTokens, getSession, safePath, sealTokens } from "@/lib/session";
import { exchangeCode } from "@/lib/monday/oauth";
import { MondayError, mondayClient } from "@/lib/monday/client";
import { whoAmI } from "@/lib/monday/me";
import { completePairing } from "@/lib/link";
import { getStore } from "@/lib/store";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const session = await getSession();
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const verifier = session.pkceVerifier;
  // A computer signing in a phone (see /link): the new sign-in is for the
  // phone, and this computer's own sign-in is left as it is.
  const pairing = session.linkPairing;
  const failPage = pairing ? "/link" : "/signin";
  if (!code || !state || !verifier || state !== session.oauthState) {
    return NextResponse.redirect(new URL(`${failPage}?error=state`, url));
  }
  const clear = { oauthState: undefined, pkceVerifier: undefined, linkPairing: undefined };
  // Which step failed goes to the server log and the sign-in page, so a
  // failure can be diagnosed. Tokens are never included.
  let step = "token";
  try {
    const tokens = await exchangeCode(code, verifier);
    step = "profile";
    const who = await whoAmI(mondayClient(tokens.accessToken));

    if (pairing) {
      step = "phone";
      Object.assign(session, clear);
      await session.save();
      if (who.userId !== session.userId) return NextResponse.redirect(new URL("/link?error=other-account", url));
      const linked = await completePairing(getStore(), pairing, { sealedTokens: await sealTokens(tokens), userId: who.userId, name: who.name });
      return NextResponse.redirect(new URL(linked ? "/link?done=1" : "/link?error=expired", url));
    }

    step = "session";
    const returnTo = safePath(session.returnTo);
    applyTokens(session, tokens);
    Object.assign(session, who, clear, { sid: randomBytes(16).toString("hex"), returnTo: undefined });
    await session.save();
    return NextResponse.redirect(new URL(returnTo, url));
  } catch (error) {
    const details = error instanceof MondayError && error.details ? ` ${JSON.stringify(error.details)}` : "";
    const reason = `${step}: ${error instanceof Error ? error.message : String(error)}${details}`;
    console.error(`[sign-in] ${reason}`);
    const back = new URL(failPage, url);
    back.searchParams.set("error", "monday");
    back.searchParams.set("detail", reason.slice(0, 300));
    return NextResponse.redirect(back);
  }
}
