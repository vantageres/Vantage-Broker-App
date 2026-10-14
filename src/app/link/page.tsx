import { redirect } from "next/navigation";
import { brokerForPage } from "@/lib/session";

// On a computer: signs in the broker's phone. Monday's sign-in page doesn't
// work in a phone browser, so the phone shows a code and the broker enters it here.
const ERRORS: Record<string, string> = {
  invalid: "That code didn't work. Check it on your phone, or get a new one there.",
  "too-many": "Too many codes that didn't work. Wait 10 minutes, then get a new code on your phone.",
  expired: "That code expired before the sign-in finished. Get a new code on your phone.",
  "other-account": "Monday signed in a different account from the one on this computer. Your phone wasn't signed in.",
  state: "That sign-in took too long. Please try again.",
  monday: "Monday didn't complete the sign-in. Your phone wasn't signed in.",
};

export default async function LinkPhone({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const broker = await brokerForPage();
  if (broker.kind === "renew") redirect("/api/auth/refresh?next=/link");
  const { error, done } = await searchParams;

  return (
    <main className="signin">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/vantage-logo.png" alt="Vantage Commercial" />
      {broker.kind === "signed-out" ? (
        <>
          <p><strong>Sign in your phone</strong></p>
          <p>First sign in here with your Monday account. Then enter the code shown on your phone.</p>
          <a className="approve" href="/api/auth/login?next=/link">Sign in with Monday</a>
        </>
      ) : done ? (
        <>
          <p><strong>Your phone is signed in.</strong></p>
          <p>It opens the Broker Assistant in a few seconds. You can close this page.</p>
          <a className="secondary link-btn" href="/">Back to the Broker Assistant</a>
        </>
      ) : (
        <>
          <p><strong>Sign in your phone as {broker.signedIn.session.name}?</strong></p>
          <p>Enter the code shown on your phone. Only enter a code from your own phone: it signs that phone in as you.</p>
          {error && <p className="inline-msg bad" role="alert">{ERRORS[error] ?? "Something went wrong. Please try again."}</p>}
          <form method="post" action="/api/link/authorize" className="link-form">
            <label className="sr-only" htmlFor="code">Code from your phone</label>
            <input id="code" name="code" className="link-code" placeholder="ABCD-2345" autoComplete="off" autoCapitalize="characters" spellCheck={false} required maxLength={12} autoFocus />
            <button className="approve" type="submit">Sign in my phone</button>
          </form>
          <p className="inline-msg">Monday may ask you to allow the Broker Assistant again. That sign-in goes to your phone.</p>
        </>
      )}
    </main>
  );
}
