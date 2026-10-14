import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { devProxyAuth, getSession } from "@/lib/session";
import { mondayClient } from "@/lib/monday/client";
import { whoAmI } from "@/lib/monday/me";

// Development only: sign in as whoever the environment's Monday token belongs to.
export async function POST(req: Request) {
  if (!devProxyAuth()) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const session = await getSession();
  Object.assign(session, await whoAmI(mondayClient()), { sid: randomBytes(16).toString("hex") });
  await session.save();
  return NextResponse.redirect(new URL("/", req.url), 303);
}
