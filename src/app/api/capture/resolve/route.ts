import { NextResponse } from "next/server";
import { resolve } from "@/lib/capture/service";
import { ExtractedPerson } from "@/lib/capture/extract";
import { fail, withBroker } from "@/lib/api";

export async function POST(req: Request) {
  return withBroker(async (ctx) => {
    const body = (await req.json()) as { person: unknown; noteText: string; choice: { board: "leads" | "contacts"; id: string } | "new" };
    const person = ExtractedPerson.safeParse(body.person);
    if (!person.success) return NextResponse.json({ error: "That proposal can't be rebuilt. Please send the note again." }, { status: 400 });
    try {
      return NextResponse.json({ proposal: await resolve(ctx, person.data, String(body.noteText ?? ""), body.choice) });
    } catch (error) {
      return fail(error);
    }
  });
}
