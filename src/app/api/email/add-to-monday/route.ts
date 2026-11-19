import { NextResponse } from "next/server";
import { fail, withBroker } from "@/lib/api";
import { emailMonitorAllowed } from "@/lib/email/access";
import { proposeFromEmail } from "@/lib/email/add-server";
import { NotAddable, type AddRef } from "@/lib/email/add-to-monday";

// POST {conversationId} or {email}, optionally {asNew: true}: the new-Lead
// card for a lead or contact from the latest check, or who already has them
// in Monday. Read only: saving goes through /api/save after approval.
export async function POST(req: Request) {
  return withBroker(async (ctx) => {
    if (!emailMonitorAllowed(ctx.me.id)) return NextResponse.json({ error: "Not available." }, { status: 403 });
    const body = (await req.json().catch(() => ({}))) as { conversationId?: unknown; email?: unknown; asNew?: unknown; typed?: { email?: unknown; phone?: unknown } };
    const ref: AddRef | null = typeof body.conversationId === "string" ? { conversationId: body.conversationId }
      : typeof body.email === "string" ? { email: body.email }
      : null;
    if (!ref) return NextResponse.json({ error: "Nothing to add." }, { status: 400 });
    try {
      const typed = {
        email: typeof body.typed?.email === "string" ? body.typed.email.slice(0, 200) : undefined,
        phone: typeof body.typed?.phone === "string" ? body.typed.phone.slice(0, 40) : undefined,
      };
      return NextResponse.json(await proposeFromEmail(ctx, ref, body.asNew === true, typed));
    } catch (error) {
      if (error instanceof NotAddable) return NextResponse.json({ error: error.message }, { status: 422 });
      console.error(`[email] add to Monday failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
      return fail(new Error("Monday didn't respond. Try again in a minute."));
    }
  });
}
