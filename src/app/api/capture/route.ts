import { NextResponse } from "next/server";
import { capture } from "@/lib/capture/service";
import { fail, withBroker } from "@/lib/api";

export async function POST(req: Request) {
  return withBroker(async (ctx) => {
    const { note } = (await req.json()) as { note?: string };
    if (!note?.trim()) return NextResponse.json({ error: "The note is empty." }, { status: 400 });
    try {
      return NextResponse.json({ proposals: await capture(ctx, note.trim()) });
    } catch (error) {
      return fail(error);
    }
  });
}
