import { pageBroker } from "@/lib/page-broker";
import { TopBar } from "@/components/TopBar";
import { Conversation } from "@/components/Conversation";

export default async function Home() {
  const signedIn = await pageBroker("/");
  return (
    <div className="shell">
      <TopBar />
      <Conversation firstName={signedIn.session.name.split(" ")[0]} />
    </div>
  );
}
