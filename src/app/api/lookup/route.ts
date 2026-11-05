import { NextResponse } from "next/server";
import { lookup } from "@/lib/capture/service";
import { withBroker } from "@/lib/api";
import { mondayReason } from "@/lib/monday/client";
import { lookupFailure } from "@/lib/lookup/failure";

// Read only: lookups never change Monday, so they need no approval.
export async function POST(req: Request) {
  return withBroker(async (ctx) => {
    const { question } = (await req.json()) as { question?: string };
    if (!question?.trim()) return NextResponse.json({ error: "The question is empty." }, { status: 400 });
    try {
      return NextResponse.json(await lookup(ctx, question.trim()));
    } catch (error) {
      // The detail goes to the log; the broker gets a plain sentence.
      console.error(`[lookup] ${error instanceof Error ? error.constructor.name : "error"}: ${mondayReason(error)}`);
      const { message, status } = lookupFailure(error);
      return NextResponse.json({ error: message }, { status });
    }
  });
}
