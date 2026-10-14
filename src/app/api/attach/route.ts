import { NextResponse } from "next/server";
import { BOARDS, PROPERTY_LEADS_BOARD } from "@/lib/capture/service";
import { AttachIncomplete, attachPhotos, type AttachTarget } from "@/lib/attach";
import { checkPhotos, SaveRefused } from "@/lib/monday/write";
import { fail, withBroker } from "@/lib/api";

function checkTarget(raw: unknown): AttachTarget | null {
  const t = raw as Record<string, unknown> | null;
  if (!t || typeof t.id !== "string" || !/^\d+$/.test(t.id)) return null;
  if (t.kind === "propertyLead") return { kind: "propertyLead", id: t.id };
  if (t.kind === "person" && (t.board === "leads" || t.board === "contacts")) return { kind: "person", board: t.board, id: t.id };
  return null;
}

// Attaches approved photos to a record's Files. Nothing is reported as
// attached unless Monday confirmed it.
export async function POST(req: Request) {
  return withBroker(async (ctx) => {
    const body = (await req.json()) as { target?: unknown; photos?: unknown };
    const target = checkTarget(body.target);
    if (!target) return NextResponse.json({ error: "That record can't be found." }, { status: 400 });
    try {
      const photos = checkPhotos(body.photos);
      const result = await attachPhotos(ctx.monday, { people: BOARDS, leads: PROPERTY_LEADS_BOARD }, ctx.me, target, photos, ctx.accountSlug);
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof SaveRefused) return NextResponse.json({ error: error.message, owner: error.owner }, { status: 409 });
      if (error instanceof AttachIncomplete) return NextResponse.json({ error: error.message, attached: error.attached }, { status: 502 });
      console.error("[attach] failed:", error instanceof Error ? error.message : error);
      return fail(new Error("Monday didn't respond, so the photo wasn't attached. It's kept here."));
    }
  });
}
