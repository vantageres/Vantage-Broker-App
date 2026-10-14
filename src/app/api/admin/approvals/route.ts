import { NextResponse } from "next/server";
import { isOperationsManager, setApproval } from "@/lib/approvals";
import { getStore } from "@/lib/store";
import { fail, withBroker } from "@/lib/api";

// Only the Operations Manager changes approval settings.
export async function POST(req: Request) {
  return withBroker(async (ctx) => {
    if (!isOperationsManager(ctx.me.id)) {
      return NextResponse.json({ error: "Only the Operations Manager can change approval settings." }, { status: 403 });
    }
    const { action, mode } = (await req.json()) as { action?: string; mode?: string };
    let settings;
    try {
      settings = await setApproval(getStore(), String(action), String(mode), ctx.me.name);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Unknown")) return NextResponse.json({ error: error.message }, { status: 400 });
      return fail(new Error("The setting couldn't be saved. Try again in a moment."));
    }
    return NextResponse.json(settings);
  });
}
