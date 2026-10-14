import { NextResponse } from "next/server";
import { capture } from "@/lib/capture/service";
import { checkPhotos, SaveRefused } from "@/lib/monday/write";
import { fail, withBroker } from "@/lib/api";

// A note, photos (a business card, front and back), or both.
export async function POST(req: Request) {
  return withBroker(async (ctx) => {
    const { note, photos, location } = (await req.json()) as { note?: string; photos?: unknown; location?: { lat?: unknown; lng?: unknown } };
    // The phone's location, sent only with a photo, to find the property a sign stands at.
    const lat = Number(location?.lat), lng = Number(location?.lng);
    const point = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
    let checked;
    try {
      checked = checkPhotos(photos);
    } catch (error) {
      if (error instanceof SaveRefused) return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
    if (!note?.trim() && checked.length === 0) return NextResponse.json({ error: "The note is empty." }, { status: 400 });
    try {
      return NextResponse.json(await capture(ctx, note?.trim() ?? "", checked, checked.length ? point : null));
    } catch (error) {
      return fail(error);
    }
  });
}
