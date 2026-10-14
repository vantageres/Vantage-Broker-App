import { pageBroker } from "@/lib/page-broker";
import { BOARDS, itemUrl } from "@/lib/capture/service";
import { savedToday } from "@/lib/monday/saved-today";
import { startOfTodayInNewJersey, timeInNewJersey } from "@/lib/time";
import { BackBar } from "@/components/TopBar";
import { Out } from "@/components/icons";
import { isOperationsManager } from "@/lib/approvals";
import Link from "next/link";

export default async function SavedToday() {
  const signedIn = await pageBroker("/saved");
  const { session, monday } = signedIn;

  let items: Awaited<ReturnType<typeof savedToday>> = [];
  let failed = false;
  try {
    items = await savedToday(monday, BOARDS, session.userId, startOfTodayInNewJersey());
  } catch {
    failed = true;
  }

  return (
    <div className="shell">
      <BackBar title="Saved today" />
      <main className="thread">
        {failed ? (
          <p className="alert" role="alert">Monday didn&apos;t respond, so today&apos;s list can&apos;t be shown. Try again in a moment.</p>
        ) : items.length === 0 ? (
          <p className="empty">Nothing saved yet today.</p>
        ) : (
          <>
            <p className="inline-msg" style={{ margin: "0 0 4px" }}>Each one opens its Monday record.</p>
            <div className="saved-list">
              {items.map((i) => (
                <a key={`${i.board}:${i.itemId}`} className="saved-item" href={itemUrl(session.accountSlug, i.board, i.itemId)} target="_blank" rel="noreferrer">
                  <span className="time">{timeInNewJersey(i.at)}</span>
                  <span className="body">
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="name">{i.name}</span>
                      <span className="chip" style={{ fontSize: 11, padding: "2px 8px" }}>{i.boardLabel.toUpperCase()}</span>
                    </span>
                    <span className="what">{i.created ? "Created" : i.changes.length ? i.changes.join(", ") : "Updated"}</span>
                  </span>
                  <span className="pencil"><Out /></span>
                </a>
              ))}
            </div>
          </>
        )}
        {isOperationsManager(session.userId) && (
          <p style={{ marginTop: 24, textAlign: "center" }}>
            <Link className="open" href="/admin/approvals">Approval settings</Link>
          </p>
        )}
        <form method="post" action="/api/auth/logout" style={{ marginTop: 24, display: "flex", justifyContent: "center" }}>
          <button className="secondary" type="submit" style={{ padding: "0 18px" }}>Sign out</button>
        </form>
      </main>
    </div>
  );
}
