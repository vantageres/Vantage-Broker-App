import { NextResponse } from "next/server";

// Screen crashes reported by the browser, written to the server log.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);
  console.error(`[screen-error] ${clip(body.path, 100)} ${clip(body.message, 500)} ${clip(body.digest, 40)}\n${clip(body.stack, 1500)}`);
  return NextResponse.json({ ok: true });
}
