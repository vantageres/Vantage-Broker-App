import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { applyTokens, getSession, unsealTokens } from "@/lib/session";
import { collectPairing } from "@/lib/link";
import { getStore } from "@/lib/store";
import { MONDAY_ACCOUNT_SLUG } from "@/lib/monday/boards";
import { fail } from "@/lib/api";

// Phone: asked every few seconds while a code is showing. Once the computer
// has signed the phone in, the phone's own Monday sign-in moves into its cookie.
export async function GET() {
  try {
    const session = await getSession();
    if (!session.linkId) return NextResponse.json({ status: "none" });
    const result = await collectPairing(getStore(), session.linkId);
    if (result.status === "waiting") return NextResponse.json(result);

    session.linkId = undefined;
    const tokens = result.status === "ready" ? await unsealTokens(result.sealedTokens) : null;
    if (result.status === "expired" || !tokens) {
      await session.save();
      return NextResponse.json({ status: "expired" });
    }
    applyTokens(session, tokens);
    Object.assign(session, {
      userId: result.userId,
      name: result.name,
      accountSlug: MONDAY_ACCOUNT_SLUG,
      sid: randomBytes(16).toString("hex"),
    });
    await session.save();
    return NextResponse.json({ status: "signed-in", name: result.name });
  } catch (error) {
    return fail(error, 500);
  }
}
