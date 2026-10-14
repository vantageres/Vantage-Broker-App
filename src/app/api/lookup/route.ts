import { NextResponse } from "next/server";
import { lookup } from "@/lib/capture/service";
import { fail, withBroker } from "@/lib/api";
import { mondayReason } from "@/lib/monday/client";

// Read only: lookups never change Monday, so they need no approval.
export async function POST(req: Request) {
  return withBroker(async (ctx) => {
    const { question } = (await req.json()) as { question?: string };
    if (!question?.trim()) return NextResponse.json({ error: "The question is empty." }, { status: 400 });
    try {
      return NextResponse.json(await lookup(ctx, question.trim()));
    } catch (error) {
      const reason = mondayReason(error);
      console.error(`[lookup] ${reason}`);
      return fail(new Error(`Monday didn't answer the lookup, so I couldn't look that up. (${reason})`));
    }
  });
}
