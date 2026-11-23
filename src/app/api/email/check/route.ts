import { NextResponse } from "next/server";
import { withBroker } from "@/lib/api";
import { emailMonitorAllowed } from "@/lib/email/access";
import { checkNow, latestRun, NotConnected, resetMonitor, tryScheduledRun } from "@/lib/email/monitor-server";
import { ReconnectNeeded } from "@/lib/email/connection";
import { GraphError } from "@/lib/email/graph";
import { ClassifyProblem } from "@/lib/email/classify";
import { devMailboxFile } from "@/lib/email/source";

// GET: the latest run. POST: Check now. POST with {"reset": true} in
// development: forget earlier runs first. Logs carry error types and codes
// only, never anything from the mail.
export async function GET() {
  return withBroker(async (ctx) => {
    if (!emailMonitorAllowed(ctx.me.id)) return NextResponse.json({ error: "Not available." }, { status: 403 });
    return NextResponse.json({ run: await latestRun(ctx.me.id) });
  });
}

export async function POST(req: Request) {
  return withBroker(async (ctx) => {
    if (!emailMonitorAllowed(ctx.me.id)) return NextResponse.json({ error: "Not available." }, { status: 403 });
    const body = (await req.json().catch(() => ({}))) as { reset?: boolean; as?: string };
    if (body.reset && devMailboxFile()) await resetMonitor(ctx.me.id);
    try {
      // Development only: run as the 7am or 11am schedule would.
      if (devMailboxFile() && (body.as === "full" || body.as === "changes")) return NextResponse.json({ run: await tryScheduledRun(ctx.me.id, ctx.me.name, body.as) });
      return NextResponse.json({ run: await checkNow(ctx) });
    } catch (error) {
      if (error instanceof NotConnected || error instanceof ReconnectNeeded) return NextResponse.json({ error: error.message, reconnect: true }, { status: 409 });
      const what = error instanceof GraphError ? `graph ${error.status} ${error.code ?? ""}`
        : error instanceof ClassifyProblem ? "classify"
        : error instanceof Error ? error.constructor.name : "unknown";
      console.error(`[email] check failed: ${what}`);
      const message = error instanceof ClassifyProblem ? "Claude couldn't sort this mail. Try again in a minute."
        : error instanceof GraphError ? "Outlook didn't respond. Try again in a minute."
        : error instanceof Error && /not set up/.test(error.message) ? error.message
        : "The check didn't finish. Try again in a minute.";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  });
}
