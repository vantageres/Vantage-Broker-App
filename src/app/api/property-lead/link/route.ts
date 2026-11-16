import { NextResponse } from "next/server";
import { linkContactToPropertyLead } from "@/lib/capture/service";
import { leadView } from "@/lib/property-leads/board";
import { SaveRefused } from "@/lib/monday/write";
import { fail, withBroker } from "@/lib/api";

// Adds a record (a new owner Lead, once saved) to a Property Lead's Property
// Contacts. Only the Property Lead's brokers can.
export async function POST(req: Request) {
  return withBroker(async (ctx) => {
    const { itemId, contactId } = (await req.json()) as { itemId?: string; contactId?: string };
    if (!itemId || !contactId) return NextResponse.json({ error: "Nothing to link." }, { status: 400 });
    try {
      const record = await linkContactToPropertyLead(ctx, String(itemId), String(contactId));
      return NextResponse.json({ lead: leadView(record, ctx.me) });
    } catch (error) {
      if (error instanceof SaveRefused) return NextResponse.json({ error: error.message }, { status: 409 });
      console.error("[property-lead/link] failed:", error instanceof Error ? error.message : error);
      return fail(new Error("Monday didn't respond, so the contact wasn't linked."));
    }
  });
}
