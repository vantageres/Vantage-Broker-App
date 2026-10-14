import { redirect } from "next/navigation";
import { brokerForPage, type SignedIn } from "./session";

// For pages: signed in and current, or redirected to sign in or to renew.
export async function pageBroker(path: string): Promise<SignedIn> {
  const b = await brokerForPage();
  if (b.kind === "signed-out") redirect("/signin");
  if (b.kind === "renew") redirect(`/api/auth/refresh?next=${encodeURIComponent(path)}`);
  return b.signedIn;
}
