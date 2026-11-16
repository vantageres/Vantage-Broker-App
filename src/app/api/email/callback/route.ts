import { NextResponse } from "next/server";
import { requireBroker } from "@/lib/session";
import { emailMonitorAllowed } from "@/lib/email/access";
import { connectionDeps } from "@/lib/email/server";
import { saveConnection } from "@/lib/email/connection";
import { exchangeCode, hasMailRead } from "@/lib/email/microsoft";
import { whoseMailbox } from "@/lib/email/graph";
import { outlookProblem } from "@/lib/email/problems";

// Microsoft returns here after "Connect Outlook". Only error codes are
// logged: never tokens, addresses or anything from the mailbox.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (outcome: string) => {
    const to = new URL("/?tab=email", url);
    to.searchParams.set("outlook", outcome);
    return NextResponse.redirect(to);
  };

  const signedIn = await requireBroker();
  if (!signedIn) return NextResponse.redirect(new URL("/signin", url));
  if (!emailMonitorAllowed(signedIn.session.userId)) return NextResponse.redirect(new URL("/", url));

  const deps = connectionDeps();
  const state = url.searchParams.get("state");
  const pending = state ? await deps.store.get<{ userId: string; verifier: string }>(`email:oauth:${state}`) : null;
  if (state) await deps.store.del(`email:oauth:${state}`);
  if (!pending || pending.userId !== signedIn.session.userId) return back("expired");

  const msError = url.searchParams.get("error");
  if (msError) {
    const outcome = outlookProblem(msError, url.searchParams.get("error_description"));
    console.error(`[email] connect declined: ${msError}`);
    return back(outcome);
  }
  const code = url.searchParams.get("code");
  if (!code) return back("failed");

  try {
    const tokens = await exchangeCode(code, pending.verifier);
    if (!hasMailRead(tokens.scope)) return back("no-mail-read");
    const mailbox = await whoseMailbox(tokens.accessToken);
    await saveConnection(deps, signedIn.session.userId, tokens, mailbox);
    return back("connected");
  } catch (error) {
    console.error(`[email] connect failed: ${error instanceof Error ? error.message : "unknown"}`);
    return back("failed");
  }
}
