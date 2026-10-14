import { redirect } from "next/navigation";
import { brokerForPage, devProxyAuth } from "@/lib/session";
import { SignInChoices } from "@/components/SignInChoices";

const ERRORS: Record<string, string> = {
  state: "That sign-in link expired. Please try again.",
  monday: "Monday didn't complete the sign-in. Please try again.",
};

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string; detail?: string }> }) {
  if ((await brokerForPage()).kind !== "signed-out") redirect("/");
  const { error, detail } = await searchParams;
  return (
    <main className="signin">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/vantage-logo.png" alt="Vantage Commercial" />
      <p>Sign in with your Monday account. Changes you approve are saved to Monday as you.</p>
      {error && <p className="inline-msg bad" role="alert">{ERRORS[error] ?? "Sign-in failed. Please try again."}</p>}
      {detail && <p className="inline-msg" style={{ maxWidth: 320, overflowWrap: "anywhere" }}>Details: {detail}</p>}
      <SignInChoices />
      {devProxyAuth() && (
        <form method="post" action="/api/auth/dev" style={{ width: "100%", display: "flex", justifyContent: "center" }}>
          <button className="secondary" type="submit">Development sign-in</button>
        </form>
      )}
    </main>
  );
}
