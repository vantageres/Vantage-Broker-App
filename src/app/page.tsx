import { pageBroker } from "@/lib/page-broker";
import { TopBar } from "@/components/TopBar";
import { Conversation } from "@/components/Conversation";
import { HomeTabs } from "@/components/email/HomeTabs";
import { emailMonitorAllowed } from "@/lib/email/access";

export default async function Home({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const signedIn = await pageBroker("/");
  const firstName = signedIn.session.name.split(" ")[0];
  // The Email tab shows only for brokers in EMAIL_MONITOR_USERS while it is built.
  if (!emailMonitorAllowed(signedIn.session.userId)) {
    return (
      <div className="shell">
        <TopBar />
        <Conversation firstName={firstName} />
      </div>
    );
  }
  const params = await searchParams;
  const outcome = typeof params.outlook === "string" ? params.outlook : undefined;
  return (
    <div className="shell">
      <TopBar />
      <HomeTabs firstName={firstName} startOn={params.tab === "email" ? "email" : "assistant"} outcome={outcome} />
    </div>
  );
}
