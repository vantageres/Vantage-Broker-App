import { NextResponse } from "next/server";
import { withBroker } from "@/lib/api";
import { emailMonitorAllowed } from "@/lib/email/access";
import { BINS, type DirTap, type ScanBin } from "@/lib/email/scan";
import { tapDirectory } from "@/lib/email/scan-server";

// One review tap on the directory: keep, remove, change the type, or keep a
// whole page. The model never changes the directory; only these taps do.
export async function POST(req: Request) {
  return withBroker(async (ctx) => {
    if (!emailMonitorAllowed(ctx.me.id)) return NextResponse.json({ error: "Not available." }, { status: 403 });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 200) : []);
    const action = str(body.action);
    let tap: DirTap | null = null;
    if (body.kind === "keep-all") tap = { kind: "keep-all", emails: strings(body.emails), ids: strings(body.ids) };
    else if (body.kind === "property" && ["keep", "remove", "review"].includes(action)) tap = { kind: "property", id: str(body.id), action: action as "keep" };
    else if (body.kind === "contact" && action === "bin" && (BINS as readonly string[]).includes(str(body.bin))) tap = { kind: "contact", email: str(body.email), action: "bin", bin: str(body.bin) as ScanBin };
    else if (body.kind === "contact" && ["keep", "remove", "review"].includes(action)) tap = { kind: "contact", email: str(body.email), action: action as "keep" };
    if (!tap) return NextResponse.json({ error: "Could not save. Try again." }, { status: 400 });
    try {
      return NextResponse.json({ directory: await tapDirectory(ctx.me.id, tap) });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save. Try again." }, { status: 422 });
    }
  });
}
