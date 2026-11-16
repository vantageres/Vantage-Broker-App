import { NextResponse } from "next/server";
import { withBroker } from "@/lib/api";
import { emailMonitorAllowed } from "@/lib/email/access";
import { connectionDeps } from "@/lib/email/server";
import { disconnect } from "@/lib/email/connection";

// Deletes the broker's stored Outlook access. Revoking the app's consent in
// Microsoft is a separate step (myapps.microsoft.com, or an admin in Entra).
export async function POST() {
  return withBroker(async (ctx) => {
    if (!emailMonitorAllowed(ctx.me.id)) return NextResponse.json({ error: "Not available." }, { status: 403 });
    await disconnect(connectionDeps(), ctx.me.id);
    return NextResponse.json({ ok: true });
  });
}
