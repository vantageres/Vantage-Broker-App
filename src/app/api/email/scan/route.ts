import { NextResponse } from "next/server";
import { withBroker } from "@/lib/api";
import { emailMonitorAllowed } from "@/lib/email/access";
import { ReconnectNeeded } from "@/lib/email/connection";
import { GraphError } from "@/lib/email/graph";
import { NotConnected } from "@/lib/email/monitor-server";
import { ScanProblem } from "@/lib/email/scan";
import { cancelScan, scanStatus, startScan, stepScan } from "@/lib/email/scan-server";

// The first-time scan (plan step 6). GET: where it stands, and the directory.
// POST {action: "start" | "step" | "cancel"}: the screen calls "step" until
// the scan is done. Logs carry error types only, never anything from the mail.
export async function GET() {
  return withBroker(async (ctx) => {
    if (!emailMonitorAllowed(ctx.me.id)) return NextResponse.json({ error: "Not available." }, { status: 403 });
    return NextResponse.json(await scanStatus(ctx.me.id));
  });
}

export async function POST(req: Request) {
  return withBroker(async (ctx) => {
    if (!emailMonitorAllowed(ctx.me.id)) return NextResponse.json({ error: "Not available." }, { status: 403 });
    const { action } = (await req.json().catch(() => ({}))) as { action?: string };
    try {
      if (action === "start") return NextResponse.json(await startScan(ctx.me.id));
      if (action === "cancel") {
        await cancelScan(ctx.me.id);
        return NextResponse.json(await scanStatus(ctx.me.id));
      }
      if (action === "step") return NextResponse.json(await stepScan(ctx));
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    } catch (error) {
      if (error instanceof NotConnected || error instanceof ReconnectNeeded) return NextResponse.json({ error: error.message, reconnect: true }, { status: 409 });
      const what = error instanceof GraphError ? `graph ${error.status} ${error.code ?? ""}` : error instanceof Error ? error.constructor.name : "unknown";
      console.error(`[email] scan step failed: ${what}`);
      const message = error instanceof ScanProblem ? "Claude couldn't sort these contacts. Tap Continue to try again."
        : error instanceof GraphError ? "Outlook didn't respond. Tap Continue to try again."
        : error instanceof Error && /not set up|Monday didn't respond/.test(error.message) ? error.message
        : "The scan stopped. Tap Continue to pick up where it left off.";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  });
}
