import { NextResponse } from "next/server";
import { BOARDS } from "@/lib/capture/service";
import { claimRecord, SaveRefused } from "@/lib/monday/write";
import { fail, withBroker } from "@/lib/api";

export async function POST(req: Request) {
  return withBroker(async (ctx) => {
    const { board, id } = (await req.json()) as { board: "leads" | "contacts"; id: string };
    if (!(board in BOARDS)) return NextResponse.json({ error: "Unknown board." }, { status: 400 });
    try {
      const result = await claimRecord(ctx.monday, BOARDS[board], id, ctx.me);
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof SaveRefused) return NextResponse.json({ error: error.message, owner: error.owner }, { status: 409 });
      return fail(new Error("Monday didn't respond, so the record wasn't claimed."));
    }
  });
}
