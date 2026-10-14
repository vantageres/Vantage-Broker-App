import { pageBroker } from "@/lib/page-broker";
import { ACTIONS, isOperationsManager, readApprovals, type ApprovalSettings } from "@/lib/approvals";
import { getStore } from "@/lib/store";
import { BackBar } from "@/components/TopBar";
import { ApprovalToggles } from "@/components/ApprovalToggles";

export default async function ApprovalSettingsPage() {
  const { session } = await pageBroker("/admin/approvals");

  if (!isOperationsManager(session.userId)) {
    return (
      <div className="shell">
        <BackBar title="Approval settings" />
        <main className="thread">
          <p className="empty">Only the Operations Manager can change approval settings.</p>
        </main>
      </div>
    );
  }

  let settings: ApprovalSettings | null = null;
  try {
    settings = await readApprovals(getStore());
  } catch (error) {
    console.error(`[admin] ${error instanceof Error ? error.message : "store unavailable"}`);
  }

  return (
    <div className="shell">
      <BackBar title="Approval settings" />
      <main className="admin">
        <div className="admin-intro">
          <p>Choose which changes brokers confirm before they&apos;re saved to Monday. Every type starts at Always confirm, and a setting applies to every broker.</p>
        </div>
        <p className="admin-phase">
          Not in effect yet: until Save without asking is built, brokers confirm every change whatever is set here.
        </p>
        {settings ? (
          <ApprovalToggles actions={ACTIONS.map((a) => ({ ...a }))} initial={settings} />
        ) : (
          <p className="alert" role="alert">The settings couldn&apos;t be loaded. Try again in a moment.</p>
        )}
      </main>
    </div>
  );
}
