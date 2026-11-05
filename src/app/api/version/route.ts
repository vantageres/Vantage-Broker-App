import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/version";

// The server's version, so an open page can tell when a new one is deployed.
export function GET() {
  return NextResponse.json({ version: APP_VERSION }, { headers: { "Cache-Control": "no-store" } });
}
