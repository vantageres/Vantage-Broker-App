import { NextResponse } from "next/server";
import { BOARDS, PROPERTY_BOARDS, forgetRecords, itemUrl } from "@/lib/capture/service";
import { NoteNotSaved, saveProposal, SaveRefused, type SaveRequest } from "@/lib/monday/write";
import { fail, withBroker } from "@/lib/api";

// Nothing is reported as saved unless Monday confirmed the write.
export async function POST(req: Request) {
  return withBroker(async (ctx) => {
    const request = (await req.json()) as SaveRequest;
    try {
      const result = await saveProposal(ctx.monday, BOARDS, ctx.me, request, { linkableBoardId: PROPERTY_BOARDS.propertiesOld.boardId });
      forgetRecords(ctx.sid);
      return NextResponse.json({ result, url: itemUrl(ctx.accountSlug, result.board, result.itemId) });
    } catch (error) {
      forgetRecords(ctx.sid);
      if (error instanceof SaveRefused) return NextResponse.json({ error: error.message, owner: error.owner }, { status: 409 });
      if (error instanceof NoteNotSaved) {
        return NextResponse.json(
          { error: error.message, partial: error.result, url: itemUrl(ctx.accountSlug, error.result.board, error.result.itemId) },
          { status: 502 },
        );
      }
      console.error("[save] failed:", error instanceof Error ? error.message : error, (error as { details?: unknown })?.details ?? "");
      return fail(new Error("Monday didn't respond, so nothing was saved. Your changes are kept here."));
    }
  });
}
