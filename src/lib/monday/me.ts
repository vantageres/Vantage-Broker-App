import type { MondayClient } from "./client";

export async function whoAmI(monday: MondayClient) {
  const data = await monday.query<{ me: { id: string; name: string }; account: { slug: string } }>("{ me { id name } account { slug } }");
  return { userId: String(data.me.id), name: data.me.name, accountSlug: data.account.slug };
}
