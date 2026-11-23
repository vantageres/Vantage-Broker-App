import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runDueSlot } from "@/lib/email/monitor-server";

// Scheduled runs (plan step 7). Vercel Cron calls this every 15 minutes
// (vercel.json) with "Authorization: Bearer <CRON_SECRET>". The slot is
// worked out in America/New_York; outside a slot, or for a broker whose slot
// already ran, nothing happens. The answer carries counts only: no names,
// addresses or anything from the mail.

export const maxDuration = 300;

function authorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header);
  return want.length === got.length && timingSafeEqual(want, got);
}

export async function GET(req: Request) {
  if (!authorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  const { slot, results } = await runDueSlot();
  const count = (o: string) => results.filter((r) => r.outcome === o).length;
  const summary = { slot, ran: count("ran"), alreadyRan: count("already ran"), notConnected: count("not connected"), reconnect: count("reconnect needed"), failed: count("failed") };
  console.log(`[email] cron ${JSON.stringify(summary)}`);
  return NextResponse.json(summary);
}
