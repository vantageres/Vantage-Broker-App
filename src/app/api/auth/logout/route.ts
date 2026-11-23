import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { forgetMonday } from "@/lib/email/monday-link-server";

export async function POST(req: Request) {
  const session = await getSession();
  await forgetMonday(session.userId); // the copy scheduled email runs use, if any
  session.destroy();
  return NextResponse.redirect(new URL("/signin", req.url), 303);
}
