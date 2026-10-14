import { redirect } from "next/navigation";
import { requireBroker } from "@/lib/session";
import { TopBar } from "@/components/TopBar";
import { Conversation } from "@/components/Conversation";

export default async function Home() {
  const signedIn = await requireBroker();
  if (!signedIn) redirect("/signin");
  return (
    <div className="shell">
      <TopBar />
      <Conversation firstName={signedIn.session.name.split(" ")[0]} />
    </div>
  );
}
