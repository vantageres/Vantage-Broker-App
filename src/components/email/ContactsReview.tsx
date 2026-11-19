"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BINS, type DirContact, type Directory, type DirProperty, type ScanBin } from "@/lib/email/scan";
import { ADDABLE_BINS } from "@/lib/email/add-to-monday";
import type { ScanStatus } from "@/lib/email/scan-server";
import { AddToMonday } from "./AddToMonday";
import { NewPropertyLeadFromEmail } from "./NewPropertyLeadFromEmail";
import { emailFetch } from "./api";

// The first-time scan and the broker's directory (plan step 6): who the
// broker emails that Monday doesn't know, with a suggested type, and the
// properties the mail names that aren't in Monday. The broker keeps,
// changes or removes each; kept ones guide every later check.

const PAGE = 20;
const PHASE_TEXT: Record<string, string> = {
  reading: "Reading 90 days of your mail…",
  monday: "Checking who is already in Monday…",
  sorting: "Suggesting a type for each contact…",
  properties: "Checking properties against Monday…",
};

type View = "review" | "kept" | "removed";

const day = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(new Date(iso));

export function ContactsReview() {
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("review");
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const stepping = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const call = useCallback(async (method: "GET" | "POST", body?: object) => {
    const res = await emailFetch("/api/email/scan", method === "POST"
      ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {});
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
    return data as ScanStatus;
  }, []);

  // Step the scan until it is done, while this screen is open.
  const run = useCallback(async (first?: ScanStatus) => {
    if (stepping.current) return;
    stepping.current = true;
    setError(null);
    try {
      let s = first ?? (await call("POST", { action: "step" }));
      setStatus(s);
      while (s.running && alive.current) {
        s = await call("POST", { action: "step" });
        if (alive.current) setStatus(s);
      }
      if (!s.running) setPage(0);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "The scan stopped.");
    } finally {
      stepping.current = false;
    }
  }, [call]);

  useEffect(() => {
    call("GET").then((s) => {
      setStatus(s);
      if (s.running) run(s);
    }).catch((e) => setError(e instanceof Error ? e.message : "Something went wrong."));
  }, [call, run]);

  async function start() {
    try {
      run(await call("POST", { action: "start" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  }

  async function stop() {
    try {
      setStatus(await call("POST", { action: "cancel" }));
    } catch {
      // the next step finds no scan and stops by itself
    }
  }

  async function tap(key: string, body: object) {
    setSaving(key);
    setError(null);
    try {
      const res = await emailFetch("/api/email/directory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save. Try again.");
      setStatus((s) => (s ? { ...s, directory: data.directory as Directory } : s));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Try again.");
    } finally {
      setSaving(null);
    }
  }

  if (!status) return error ? <p className="alert" role="alert">{error}</p> : <p className="empty">Loading your contacts…</p>;

  const dir = status.directory;

  if (status.running) {
    const pct = status.phase === "sorting" && status.total ? Math.round((status.done / status.total) * 100) : status.phase === "properties" ? 95 : status.phase === "monday" ? 15 : 5;
    return (
      <section className="email-run" aria-label="Scan">
        <div className="card scan-progress" role="status">
          <strong>{PHASE_TEXT[status.phase]}</strong>
          {status.phase === "sorting" && <span className="inline-msg">{status.done} of {status.total} contacts</span>}
          <div className="scan-bar"><span style={{ width: `${pct}%` }} /></div>
          <span className="inline-msg">You can leave this screen. The scan picks up where it left off when you come back.</span>
        </div>
        {error && (
          <>
            <p className="alert" role="alert">{error}</p>
            <button className="approve" type="button" onClick={() => run()}>Continue</button>
          </>
        )}
        <button className="link-btn" type="button" onClick={stop}>Stop the scan</button>
      </section>
    );
  }

  if (!dir.scannedAt) {
    return (
      <section className="email-run" aria-label="Scan">
        {error && <p className="alert" role="alert">{error}</p>}
        <div className="card">
          <div className="card-head"><span className="title">Find who isn&apos;t in Monday</span></div>
          <div className="email-body">
            <p>The app looks at who you&apos;ve emailed in the last 90 days, up to 1,000 emails each way. It skips newsletters, notices and people already in Monday, and suggests a type for everyone else. It also lists properties your email names that aren&apos;t in Monday.</p>
            <p>You review the list. Nothing goes to Monday unless you add it.</p>
          </div>
          <div className="card-foot"><button className="approve" type="button" onClick={start}>Start scan</button></div>
        </div>
      </section>
    );
  }

  const counts = {
    review: dir.contacts.filter((c) => c.status === "review").length + dir.properties.filter((p) => p.status === "review").length,
    kept: dir.contacts.filter((c) => c.status === "kept").length + dir.properties.filter((p) => p.status === "kept").length,
    removed: dir.contacts.filter((c) => c.status === "removed").length + dir.properties.filter((p) => p.status === "removed").length,
  };
  const status_ = view === "review" ? "review" : view === "kept" ? "kept" : "removed";
  const contacts = dir.contacts.filter((c) => c.status === status_);
  const pageContacts = contacts.slice(page * PAGE, page * PAGE + PAGE);
  const properties = dir.properties.filter((p) => p.status === status_);
  const pages = Math.max(1, Math.ceil(contacts.length / PAGE));
  const groups = BINS.map((bin) => ({ bin, list: pageContacts.filter((c) => c.bin === bin) })).filter((g) => g.list.length);
  const s = dir.summary;

  return (
    <section className="email-run" aria-label="Contacts">
      {s && (
        <p className="inline-msg" style={{ margin: 0 }}>
          Scanned {day(dir.scannedAt)}: {s.inbox.toLocaleString("en-US")} received and {s.sent.toLocaleString("en-US")} sent emails
          {s.capped ? " (the latest 1,000 each way)" : ""}. {s.noise} newsletters and notices skipped. {s.inMonday} {s.inMonday === 1 ? "person" : "people"} already in Monday.
        </p>
      )}
      {error && <p className="alert" role="alert">{error}</p>}

      <div className="oi-filters scan-filters" role="group" aria-label="Show">
        {(["review", "kept", "removed"] as View[]).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} className="oi-filter" onClick={() => { setView(v); setPage(0); }}>
            <strong>{counts[v]}</strong>{v === "review" ? "To review" : v === "kept" ? "Kept" : "Removed"}
          </button>
        ))}
      </div>

      {view === "review" && counts.review === 0 && <p className="oi-calm">All reviewed. Kept contacts and properties now guide every check.</p>}
      {view === "review" && (pageContacts.length > 0 || properties.length > 0) && (
        <button className="secondary" type="button" disabled={!!saving} onClick={() => tap("all", { kind: "keep-all", emails: pageContacts.map((c) => c.email), ids: properties.map((p) => p.id) })}>
          Keep all {pageContacts.length + properties.length} shown
        </button>
      )}

      {groups.map((g) => (
        <div key={g.bin} className="email-section">
          <h2 className="email-group">{g.bin} <span className="oi-count">{g.list.length}</span></h2>
          {g.list.map((c) => <ContactRow key={c.email} c={c} busy={saving === c.email} tap={(body) => tap(c.email, { kind: "contact", email: c.email, ...body })} />)}
        </div>
      ))}

      {pages > 1 && (
        <div className="scan-pages">
          <button className="link-btn" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="inline-msg">Page {page + 1} of {pages}</span>
          <button className="link-btn" type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}

      {properties.length > 0 && (
        <div className="email-section">
          <h2 className="email-group">Properties not in Monday <span className="oi-count">{properties.length}</span></h2>
          {properties.map((p) => <PropertyRow key={p.id} p={p} dir={dir} busy={saving === p.id} tap={(body) => tap(p.id, { kind: "property", id: p.id, ...body })} />)}
        </div>
      )}

      {view !== "review" && contacts.length === 0 && properties.length === 0 && <p className="empty">Nothing here.</p>}

      <button className="link-btn" type="button" onClick={start}>Scan again</button>
    </section>
  );
}

function ContactRow({ c, busy, tap }: { c: DirContact; busy: boolean; tap: (body: object) => void }) {
  return (
    <article className="card scan-row">
      <div className="scan-main">
        <span className="oi-title">{c.name ?? c.email}{c.company ? `, ${c.company}` : ""}</span>
        <span className="oi-sub">{c.email}</span>
        <span className="oi-sub">{c.why}{c.relatedDeal ? ` · ${c.relatedDeal}` : ""}</span>
        <span className="oi-sub">{c.received} received · {c.sentTo} sent · last {day(c.last)}</span>
      </div>
      <div className="scan-controls">
        <label className="scan-bin">
          <span className="sr-only">Type for {c.name ?? c.email}</span>
          <select value={c.bin} disabled={busy} onChange={(e) => tap({ action: "bin", bin: e.target.value as ScanBin })}>
            {BINS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          {c.confidence === "low" && <span className="chip importance-high">Not sure</span>}
        </label>
        <div className="scan-actions">
          {c.status !== "kept" && <button className="secondary" type="button" disabled={busy} onClick={() => tap({ action: "keep" })}>Keep</button>}
          {c.status !== "removed" && <button className="secondary" type="button" disabled={busy} onClick={() => tap({ action: "remove" })}>Remove</button>}
          {c.status !== "review" && <button className="secondary" type="button" disabled={busy} onClick={() => tap({ action: "review" })}>Back to review</button>}
        </div>
        {c.status !== "removed" && (ADDABLE_BINS as readonly string[]).includes(c.bin) && <AddToMonday target={{ email: c.email }} />}
      </div>
    </article>
  );
}

function PropertyRow({ p, dir, busy, tap }: { p: DirProperty; dir: Directory; busy: boolean; tap: (body: object) => void }) {
  const names = p.contacts.map((e) => dir.contacts.find((c) => c.email === e)?.name ?? e);
  return (
    <article className="card scan-row">
      <div className="scan-main">
        <span className="oi-title">{p.name}</span>
        {names.length > 0 && <span className="oi-sub">In mail with {names.join(", ")}</span>}
        <span className="oi-sub">Kept properties group your email by deal.</span>
      </div>
      <div className="scan-actions">
        {p.status !== "kept" && <button className="secondary" type="button" disabled={busy} onClick={() => tap({ action: "keep" })}>Keep</button>}
        {p.status !== "removed" && <button className="secondary" type="button" disabled={busy} onClick={() => tap({ action: "remove" })}>Remove</button>}
        {p.status !== "review" && <button className="secondary" type="button" disabled={busy} onClick={() => tap({ action: "review" })}>Back to review</button>}
      </div>
      {p.status !== "removed" && <NewPropertyLeadFromEmail id={p.id} />}
    </article>
  );
}
