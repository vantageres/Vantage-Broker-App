import { NextResponse } from "next/server";
import { forgetRecords, propertyLeadsFor, recordsFor } from "@/lib/capture/service";
import { findAttachTargets } from "@/lib/attach";
import { fail, withBroker } from "@/lib/api";

// Which record a photo is for ("Linda Park", "22 Elm St"). Read only.
export async function POST(req: Request) {
  return withBroker(async (ctx) => {
    const { question } = (await req.json()) as { question?: string };
    if (!question?.trim()) return NextResponse.json({ error: "Say which record the photo is for." }, { status: 400 });
    try {
      forgetRecords(ctx.sid); // read fresh: ownership matters here
      const [people, leads] = await Promise.all([recordsFor(ctx.monday, ctx.sid, ctx.accountSlug), propertyLeadsFor(ctx)]);
      return NextResponse.json({ candidates: findAttachTargets(question.trim(), people, leads, ctx.me) });
    } catch (error) {
      return fail(error);
    }
  });
}
