import { NextResponse } from "next/server";
import { resolve } from "@/lib/capture/service";
import { ExtractedPerson } from "@/lib/capture/extract";
import type { ProposalExtra } from "@/lib/capture/proposal";
import { fail, withBroker } from "@/lib/api";

// What a photo added to the proposal, as the browser sent it back. Only the
// expected shape is kept; a property link is checked again when saving.
function checkExtra(raw: unknown): ProposalExtra | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const e = raw as Record<string, unknown>;
  const extra: ProposalExtra = {};
  if (Array.isArray(e.notes)) {
    extra.notes = e.notes
      .filter((n): n is { text: string; why: string } => !!n && typeof n.text === "string" && typeof n.why === "string")
      .slice(0, 3)
      .map((n) => ({ text: n.text.slice(0, 300), why: n.why.slice(0, 300) }));
  }
  if (e.sourceForNew === "Sign") extra.sourceForNew = "Sign";
  const p = e.signProperty as Record<string, unknown> | undefined;
  if (p && typeof p.id === "string" && /^\d+$/.test(p.id) && typeof p.name === "string" && typeof p.url === "string"
    && (p.board === "propertiesNew" || p.board === "propertiesOld" || p.board === "propertyLeads")) {
    extra.signProperty = {
      board: p.board, boardLabel: String(p.boardLabel ?? ""), id: p.id, name: p.name.slice(0, 200), url: p.url,
      how: p.how === "address" ? "address" : "location",
      ...(typeof p.metres === "number" ? { metres: p.metres } : {}),
      linkable: p.board === "propertiesOld",
    };
  }
  return Object.keys(extra).length ? extra : undefined;
}

export async function POST(req: Request) {
  return withBroker(async (ctx) => {
    const body = (await req.json()) as { person: unknown; noteText: string; choice: { board: "leads" | "contacts"; id: string } | "new"; extra?: unknown };
    const person = ExtractedPerson.safeParse(body.person);
    if (!person.success) return NextResponse.json({ error: "That proposal can't be rebuilt. Please send the note again." }, { status: 400 });
    try {
      return NextResponse.json({ proposal: await resolve(ctx, person.data, String(body.noteText ?? ""), body.choice, checkExtra(body.extra)) });
    } catch (error) {
      return fail(error);
    }
  });
}
