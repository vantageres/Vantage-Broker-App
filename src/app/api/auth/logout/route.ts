import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { forgetRecords } from "@/lib/capture/service";

export async function POST(req: Request) {
  const session = await getSession();
  if (session.sid) forgetRecords(session.sid);
  session.destroy();
  return NextResponse.redirect(new URL("/signin", req.url), 303);
}
