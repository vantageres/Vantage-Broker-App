import { NextResponse } from "next/server";
import { withBroker } from "@/lib/api";
import { emailMonitorAllowed } from "@/lib/email/access";
import { connectionDeps } from "@/lib/email/server";
import { accessToken, getConnection, ReconnectNeeded } from "@/lib/email/connection";
import { microsoftConfigured } from "@/lib/email/microsoft";
import { countInboxSince, GraphError } from "@/lib/email/graph";
import type { EmailStatus } from "@/lib/email/status";

// The connection check: who is connected, and how many emails reached the
// inbox in the last 24 hours (ids only; nothing else is read or kept).
export async function GET() {
  return withBroker(async (ctx) => {
    if (!emailMonitorAllowed(ctx.me.id)) return NextResponse.json({ error: "Not available." }, { status: 403 });
    if (!microsoftConfigured()) return NextResponse.json({ state: "not-set-up" } satisfies EmailStatus);
    const deps = connectionDeps();
    const conn = await getConnection(deps, ctx.me.id);
    if (!conn) return NextResponse.json({ state: "not-connected" } satisfies EmailStatus);
    if (conn.reconnectNeeded) return NextResponse.json({ state: "reconnect", address: conn.address } satisfies EmailStatus);

    const base = { state: "connected" as const, name: conn.name, address: conn.address, connectedAt: conn.connectedAt };
    try {
      const token = await accessToken(deps, ctx.me.id);
      const last24h = await countInboxSince(token, new Date(Date.now() - 24 * 60 * 60 * 1000));
      return NextResponse.json({ ...base, last24h } satisfies EmailStatus);
    } catch (error) {
      if (error instanceof ReconnectNeeded) return NextResponse.json({ state: "reconnect", address: conn.address } satisfies EmailStatus);
      console.error(`[email] status: ${error instanceof GraphError ? `graph ${error.status} ${error.code ?? ""}` : error instanceof Error ? error.message : "unknown"}`);
      return NextResponse.json({ ...base, last24h: null, problem: "Outlook didn't respond. Try again in a minute." } satisfies EmailStatus);
    }
  });
}
