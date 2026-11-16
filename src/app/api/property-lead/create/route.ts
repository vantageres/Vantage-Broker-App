import { NextResponse } from "next/server";
import { saveNewPropertyLead } from "@/lib/capture/service";
import { leadView } from "@/lib/property-leads/board";
import type { CreatePropertyLeadRequest } from "@/lib/property-leads/create";
import { BoardHidden } from "@/lib/monday/client";
import { SaveRefused } from "@/lib/monday/write";
import { fail, withBroker } from "@/lib/api";

// Creates an approved Property Lead, with the broker as its Broker. Nothing is
// reported as created unless Monday confirmed it; the answer is read back.
export async function POST(req: Request) {
  return withBroker(async (ctx) => {
    const request = (await req.json()) as CreatePropertyLeadRequest;
    try {
      const record = await saveNewPropertyLead(ctx, request);
      return NextResponse.json({ lead: leadView(record, ctx.me) });
    } catch (error) {
      if (error instanceof SaveRefused) return NextResponse.json({ error: error.message }, { status: 409 });
      if (error instanceof BoardHidden) return fail(error, 403);
      console.error("[property-lead/create] failed:", error instanceof Error ? error.message : error);
      return fail(new Error("Monday didn't respond, so the Property Lead wasn't created. Your details are kept here."));
    }
  });
}
