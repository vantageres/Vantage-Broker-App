import { NextResponse } from "next/server";
import { newPropertyLead } from "@/lib/capture/service";
import { fail, withBroker } from "@/lib/api";
import { lookupFailure } from "@/lib/lookup/failure";

// Reads a note asking for a new Property Lead and proposes it. Nothing is saved.
export async function POST(req: Request) {
  return withBroker(async (ctx) => {
    const { note } = (await req.json()) as { note?: string };
    if (!note?.trim()) return NextResponse.json({ error: "The note is empty." }, { status: 400 });
    try {
      return NextResponse.json({ proposal: await newPropertyLead(ctx, note.trim()) });
    } catch (error) {
      console.error("[property-lead/new]", error instanceof Error ? error.message : error);
      const { message, status } = lookupFailure(error);
      return fail(new Error(message.replace("I couldn't answer that", "I couldn't read that note")), status);
    }
  });
}
