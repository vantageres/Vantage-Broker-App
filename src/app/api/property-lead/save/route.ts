import { NextResponse } from "next/server";
import { PROPERTY_LEADS_BOARD } from "@/lib/capture/service";
import { leadView, savePropertyLead } from "@/lib/property-leads/board";
import type { LeadChange } from "@/lib/property-leads/fields";
import { SaveRefused } from "@/lib/monday/write";
import { fail, withBroker } from "@/lib/api";

// Saves approved changes to one Property Lead. Nothing is reported as saved
// unless Monday confirmed the write; the answer is read back from Monday.
export async function POST(req: Request) {
  return withBroker(async (ctx) => {
    const { itemId, changes } = (await req.json()) as { itemId?: string; changes?: LeadChange[] };
    if (!itemId || !Array.isArray(changes)) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
    try {
      const { record, changed } = await savePropertyLead(ctx.monday, PROPERTY_LEADS_BOARD, ctx.me, itemId, changes, ctx.accountSlug);
      return NextResponse.json({ lead: leadView(record, ctx.me), changed });
    } catch (error) {
      if (error instanceof SaveRefused) return NextResponse.json({ error: error.message, owner: error.owner }, { status: 409 });
      console.error("[property-lead] save failed:", error instanceof Error ? error.message : error);
      return fail(new Error("Monday didn't respond, so nothing was saved. Your changes are kept here."));
    }
  });
}
