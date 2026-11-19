"use client";

import { useCallback, useEffect, useState } from "react";
import type { EmailStatus } from "@/lib/email/status";
import { isOutcome, OUTCOME_TEXT } from "@/lib/email/problems";
import type { Run } from "@/lib/email/run";
import { OpenItems } from "./OpenItems";
import { ContactsReview } from "./ContactsReview";
import { RunSummary } from "./RunSummary";
import { emailFetch } from "./api";
import { timeInNewJersey } from "@/lib/time";

// The Email tab (docs/email-monitor-plan.md): connect Outlook, then Check now
// sorts new mail and shows the latest run. In development a file of made-up
// mail stands in for Outlook.
export function EmailTab({ outcome }: { outcome?: string }) {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [checking, setChecking] = useState(false);
  const [view, setView] = useState<"items" | "check" | "contacts">("items");
  const [checks, setChecks] = useState(0);
  const message = isOutcome(outcome) && outcome !== "connected" ? OUTCOME_TEXT[outcome] : null;

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await emailFetch("/api/email/status", { cache: "no-store" });
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

  const connected = status?.state === "connected";
  useEffect(() => {
    if (!connected) return;
    emailFetch("/api/email/check", { cache: "no-store" })
      .then((r) => r.json())
      .then((b: { run?: Run | null }) => setRun(b.run ?? null))
      .catch(() => {});
  }, [connected]);

  async function checkNow(reset = false) {
    setChecking(true);
    setError(null);
    try {
      const res = await emailFetch("/api/email/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reset }) });
      const body = await res.json();
      if (!res.ok) {
        if (body.reconnect) await load();
        throw new Error(body.error ?? "The check didn't finish. Try again in a minute.");
      }
      setRun(body.run as Run);
      setChecks((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The check didn't finish. Try again in a minute.");
    } finally {
      setChecking(false);
    }
  }

  async function disconnectOutlook() {
    setBusy(true);
    try {
      const res = await emailFetch("/api/email/disconnect", { method: "POST" });
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
        <>
          <section className="email-connection">
            <span className="inline-msg" style={{ margin: 0 }}>
              {status.dev ? "Development mailbox (made-up emails)" : `Outlook: ${status.address}`}
              {status.last24h && ` · ${status.last24h.capped ? "1,000 or more" : status.last24h.count.toLocaleString("en-US")} in the inbox in 24 hours`}
            </span>
            {status.dev ? (
              <button className="link-btn" type="button" onClick={() => checkNow(true)} disabled={checking} style={{ marginTop: 0 }}>Start over</button>
            ) : (
              <button className="link-btn" type="button" onClick={disconnectOutlook} disabled={busy} style={{ marginTop: 0 }}>Disconnect</button>
            )}
          </section>
          {status.problem && <p className="alert" role="alert">{status.problem}</p>}
          <button className="approve" type="button" onClick={() => checkNow()} disabled={checking}>
            {checking ? "Checking your email…" : "Check now"}
          </button>
          <div className="oi-switch" role="tablist" aria-label="Email">
            <button type="button" role="tab" aria-selected={view === "items"} onClick={() => setView("items")}>Open items</button>
            <button type="button" role="tab" aria-selected={view === "check"} onClick={() => setView("check")}>New email</button>
            <button type="button" role="tab" aria-selected={view === "contacts"} onClick={() => setView("contacts")}>Contacts</button>
          </div>
          {view === "contacts" ? <ContactsReview /> : view === "items" ? (
            <OpenItems refreshKey={checks} lastLine={run?.openItems ? `Last check ${timeInNewJersey(run.at)}. ${run.openItems.line}.` : null} />
          ) : run ? <RunSummary run={run} /> : !checking && <p className="empty">Tap Check now to sort your new email.</p>}
        </>
      )}
    </main>
  );
}
