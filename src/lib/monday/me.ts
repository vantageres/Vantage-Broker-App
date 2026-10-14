import type { MondayClient } from "./client";
import { MONDAY_ACCOUNT_SLUG } from "./boards";

// Who signed in. Needs only the me:read scope.
export async function whoAmI(monday: MondayClient) {
  const data = await monday.query<{ me: { id: string; name: string } }>("{ me { id name } }");
  return { userId: String(data.me.id), name: data.me.name, accountSlug: MONDAY_ACCOUNT_SLUG };
}
