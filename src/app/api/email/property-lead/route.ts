import { NextResponse } from "next/server";
import { fail, withBroker } from "@/lib/api";
import { emailMonitorAllowed } from "@/lib/email/access";
import { proposePropertyLead } from "@/lib/email/scan-server";

// POST {id}: the New Property Lead card for a property from the scan, or the
// property Monday already has. Read only: the card's Approve saves it through
// the existing /api/property-lead/create.
export async function POST(req: Request) {
  return withBroker(async (ctx) => {
    if (!emailMonitorAllowed(ctx.me.id)) return NextResponse.json({ error: "Not available." }, { status: 403 });
    const { id } = (await req.json().catch(() => ({}))) as { id?: unknown };
    if (typeof id !== "string" || !id) return NextResponse.json({ error: "Nothing to add." }, { status: 400 });
    try {
      return NextResponse.json(await proposePropertyLead(ctx, id));
    } catch (error) {
      if (error instanceof Error && /no longer in your list/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 422 });
      console.error(`[email] property lead failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
      return fail(new Error("Monday didn't respond. Try again in a minute."));
    }
  });
}
