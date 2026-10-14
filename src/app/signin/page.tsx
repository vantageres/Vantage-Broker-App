import { redirect } from "next/navigation";
import { brokerForPage, devProxyAuth } from "@/lib/session";

const ERRORS: Record<string, string> = {
  state: "That sign-in link expired. Please try again.",
  monday: "Monday didn't complete the sign-in. Please try again.",
};

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if ((await brokerForPage()).kind !== "signed-out") redirect("/");
  const { error } = await searchParams;
  return (
    <main className="signin">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/vantage-logo.png" alt="Vantage Commercial" />
      <p>Sign in with your Monday account. Changes you approve are saved to Monday as you.</p>
      {error && <p className="inline-msg bad" role="alert">{ERRORS[error] ?? "Sign-in failed. Please try again."}</p>}
      <a className="approve" href="/api/auth/login">Sign in with Monday</a>
      {devProxyAuth() && (
        <form method="post" action="/api/auth/dev" style={{ width: "100%", display: "flex", justifyContent: "center" }}>
          <button className="secondary" type="submit">Development sign-in</button>
        </form>
      )}
    </main>
  );
}
