import { NextResponse } from "next/server";
import { withBroker } from "@/lib/api";
import { emailMonitorAllowed } from "@/lib/email/access";
import { ItemsBusy, openItems, tapItem } from "@/lib/email/monitor-server";
import { nyDate, type TapAction } from "@/lib/email/open-items";

// GET: the broker's open items (and closed ones from the last 5 business
// days), with today's date so ages match the server. POST {num, action,
// version}: one tap (Done, Keep, Snooze...). A tap on an item a run changed
// since the screen loaded comes back as a conflict with the fresh item.

const ACTIONS: TapAction[] = ["done", "finished", "keep", "high", "snooze", "unsnooze", "reopen"];

export async function GET() {
  return withBroker(async (ctx) => {
    if (!emailMonitorAllowed(ctx.me.id)) return NextResponse.json({ error: "Not available." }, { status: 403 });
    const state = await openItems(ctx.me.id);
    return NextResponse.json({ items: state.items, today: nyDate(new Date()) });
  });
}

export async function POST(req: Request) {
  return withBroker(async (ctx) => {
    if (!emailMonitorAllowed(ctx.me.id)) return NextResponse.json({ error: "Not available." }, { status: 403 });
    const body = (await req.json().catch(() => ({}))) as { num?: unknown; action?: unknown; version?: unknown };
    if (typeof body.num !== "number" || typeof body.version !== "number" || !ACTIONS.includes(body.action as TapAction)) {
      return NextResponse.json({ error: "Could not save. Try again." }, { status: 400 });
    }
    try {
      const result = await tapItem(ctx.me.id, body.num, body.action as TapAction, body.version);
      if (result.ok) return NextResponse.json({ item: result.item, today: nyDate(new Date()) });
      if (result.conflict) return NextResponse.json({ conflict: true, item: result.item, error: "This item just changed. Check it and tap again." }, { status: 409 });
      return NextResponse.json({ error: result.error }, { status: 422 });
    } catch (error) {
      if (error instanceof ItemsBusy) return NextResponse.json({ error: error.message }, { status: 503 });
      console.error(`[email] tap failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
      return NextResponse.json({ error: "Could not save. Try again." }, { status: 500 });
    }
  });
}
