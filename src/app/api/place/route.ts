import { NextResponse } from "next/server";
import { findPlace } from "@/lib/capture/service";
import { fail, withBroker } from "@/lib/api";

// Look up a Desired Location the broker typed while editing a proposal.
export async function POST(req: Request) {
  return withBroker(async () => {
    const { place } = (await req.json()) as { place?: string };
    if (!place?.trim()) return NextResponse.json({ error: "Type a town or address." }, { status: 400 });
    try {
      return NextResponse.json(await findPlace(place.trim()));
    } catch (error) {
      return fail(error);
    }
  });
}
