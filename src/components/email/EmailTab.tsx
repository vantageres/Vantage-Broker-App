"use client";

import { useCallback, useEffect, useState } from "react";
import type { EmailStatus } from "@/lib/email/status";
import { isOutcome, OUTCOME_TEXT } from "@/lib/email/problems";

// The Email tab. Step 2 of docs/email-monitor-plan.md: connect Outlook and
// prove the app can read the inbox. Nothing from the mailbox is shown or kept
// beyond a count.
export function EmailTab({ outcome }: { outcome?: string }) {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const message = isOutcome(outcome) && outcome !== "connected" ? OUTCOME_TEXT[outcome] : null;

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/email/status", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Something went wrong.");
      setStatus(body as EmailStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function disconnectOutlook() {
    setBusy(true);
    try {
      const res = await fetch("/api/email/disconnect", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not disconnect. Try again.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not disconnect. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="thread">
      {message && <p className="alert" role="alert">{message}</p>}
      {error && <p className="alert" role="alert">{error}</p>}
      {!status && !error && <p className="empty">Checking your Outlook connection…</p>}

      {status?.state === "not-set-up" && (
        <p className="empty">The email monitor is not set up yet. John is finishing the Outlook connection.</p>
      )}

      {(status?.state === "not-connected" || status?.state === "reconnect") && (
        <section className="card">
          <div className="card-head">
            <span className="title">{status.state === "reconnect" ? "Reconnect Outlook" : "Connect Outlook"}</span>
          </div>
          <div className="notice">
            <p className="inline-msg" style={{ margin: 0, fontSize: 15, color: "var(--ink)" }}>
              {status.state === "reconnect"
                ? `The app lost access to ${status.address}. Connect it again to keep your email list up to date.`
                : "The email monitor reads your inbox to find emails that need you. It only reads. It never sends, moves or deletes email."}
            </p>
          </div>
          <div className="card-foot">
            <a className="approve" href="/api/email/connect" style={{ display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
              {status.state === "reconnect" ? "Reconnect Outlook" : "Connect Outlook"}
            </a>
          </div>
        </section>
      )}

      {status?.state === "connected" && (
        <section className="card">
          <div className="card-head">
            <span className="title">Outlook connected</span>
            <span className="chip">READ ONLY</span>
          </div>
          <div className="rows">
            <div className="lookup-row"><span className="row-label">Mailbox</span><span>{status.address}</span></div>
            <div className="lookup-row">
              <span className="row-label">Last 24 hours</span>
              <span>
                {status.last24h
                  ? `${status.last24h.capped ? "1,000 or more" : status.last24h.count.toLocaleString("en-US")} ${status.last24h.count === 1 ? "email" : "emails"} in your inbox`
                  : "Not checked"}
              </span>
            </div>
          </div>
          {status.problem && <p className="callout" style={{ background: "var(--bad-bg)", color: "var(--bad)" }}>{status.problem}</p>}
          <div className="card-foot">
            <button className="secondary" type="button" onClick={load} disabled={busy}>Check again</button>
            <button className="link-btn" type="button" onClick={disconnectOutlook} disabled={busy} style={{ alignSelf: "center" }}>
              Disconnect Outlook
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
