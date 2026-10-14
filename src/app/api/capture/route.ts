import { NextResponse } from "next/server";
import { capture } from "@/lib/capture/service";
import { checkPhotos, SaveRefused } from "@/lib/monday/write";
import { fail, withBroker } from "@/lib/api";

// A note, photos (a business card, front and back), or both.
export async function POST(req: Request) {
  return withBroker(async (ctx) => {
    const { note, photos } = (await req.json()) as { note?: string; photos?: unknown };
    let checked;
    try {
      checked = checkPhotos(photos);
    } catch (error) {
      if (error instanceof SaveRefused) return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
    if (!note?.trim() && checked.length === 0) return NextResponse.json({ error: "The note is empty." }, { status: 400 });
    try {
      return NextResponse.json(await capture(ctx, note?.trim() ?? "", checked));
    } catch (error) {
      return fail(error);
    }
  });
}
