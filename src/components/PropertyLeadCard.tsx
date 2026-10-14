"use client";

import { useState } from "react";
import type { PropertyLeadView } from "@/lib/property-leads/board";
import {
  FIELDS, MONDAY_ONLY_STATUSES, SETTABLE_STATUSES, fieldDef, statusNote,
  type FieldDef, type LeadChange, type LeadField,
} from "@/lib/property-leads/fields";
import { Bolt, Out, Pencil } from "./icons";

const WHEN = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", year: "numeric" });
const when = (iso: string) => WHEN.format(new Date(iso));
const day = (date: string) => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? WHEN.format(new Date(`${date}T12:00:00`)) : date);
const todayInNewJersey = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

function show(def: FieldDef, value: string): string {
  if (def.kind === "checkbox") return value ? "Yes" : "No";
  if (!value) return "";
  return def.kind === "date" ? day(value) : value;
}

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; changed: number; automations: boolean }
  | { kind: "failed"; message: string; refused: boolean };

// A Property Lead, read from Monday. Its Broker, Co-Broker and Co-Broker2 can
// tap a value to change it; nothing is saved until they approve the changes.
export function PropertyLeadCard({ lead: initial }: { lead: PropertyLeadView }) {
  const [lead, setLead] = useState(initial);
  const [edits, setEdits] = useState<Partial<Record<LeadField, string>>>({});
  const [editing, setEditing] = useState<LeadField | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const owners = [lead.brokers.broker, lead.brokers.coBroker, lead.brokers.coBroker2].filter(Boolean).join(", ");
  const shown = FIELDS.filter((f) => f.field in lead.values);
  const current = (f: LeadField) => lead.values[f] ?? "";
  const changes: LeadChange[] = shown
    .filter((f) => edits[f.field] !== undefined && edits[f.field] !== current(f.field))
    .map((f) => ({ field: f.field, from: current(f.field), to: edits[f.field]! }));
  const statusLocked = !!MONDAY_ONLY_STATUSES[current("status")];
  const working = status.kind === "saving";

  function setEdit(field: LeadField, value: string) {
    const next = { ...edits, [field]: value };
    // In Marketing needs an LA Signed date, so propose today's with the status.
    if (field === "status" && value === "LA Signed" && !current("laSigned") && next.laSigned === undefined) next.laSigned = todayInNewJersey();
    setEdits(next);
    setEditing(null);
    if (status.kind !== "saving") setStatus({ kind: "idle" });
  }

  function undo(field: LeadField) {
    const next = { ...edits };
    delete next[field];
    setEdits(next);
  }

  async function approve() {
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/property-lead/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: lead.id, changes }),
      });
      if (res.status === 401) {
        window.location.href = "/signin";
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { lead?: PropertyLeadView; changed?: number; error?: string };
      if (!res.ok || !data.lead) {
        setStatus({ kind: "failed", message: data.error ?? "Something went wrong. Nothing was saved.", refused: res.status === 409 });
        return;
      }
      setLead(data.lead);
      setEdits({});
      setStatus({ kind: "saved", changed: data.changed ?? changes.length, automations: changes.some((c) => c.field === "status") });
    } catch {
      setStatus({ kind: "failed", message: "Monday couldn't be reached, so nothing was saved. Your changes are kept here.", refused: false });
    }
  }

  const info = [
    { label: "Location", value: lead.info.location },
    { label: "County", value: lead.info.county },
    { label: "Zip Code", value: lead.info.zip },
    { label: "Date Created", value: day(lead.info.created) },
    { label: "In Marketing Date", value: day(lead.info.inMarketing) },
    { label: "On Market Date", value: day(lead.info.onMarket) },
    { label: "GEN FOLDER LA", value: lead.info.genFolder },
  ].filter((r) => r.value);

  return (
    <article className="card lookup" aria-label={`Property Lead ${lead.name}`}>
      <div className="card-head">
        <div>
          <div className="title">{lead.name}</div>
          <div className="inline-msg">
            {[lead.brokers.broker ? `Broker: ${lead.brokers.broker}` : "No Broker", lead.brokers.coBroker && `Co-Broker: ${lead.brokers.coBroker}`, lead.brokers.coBroker2 && `Co-Broker2: ${lead.brokers.coBroker2}`].filter(Boolean).join(" · ")}
          </div>
        </div>
        <span className="chip">{changes.length ? `${changes.length} change${changes.length === 1 ? "" : "s"}` : "PROPERTY LEAD"}</span>
      </div>

      {!lead.canEdit && (
        <p className="inline-msg" style={{ padding: "0 16px" }}>
          Only {owners || "its assigned brokers"} can change this Property Lead. Its key, loan and lender details are hidden.
        </p>
      )}

      <div className="rows">
        {shown.map((def) => {
          const edited = edits[def.field] !== undefined && edits[def.field] !== current(def.field);
          const value = edited ? edits[def.field]! : current(def.field);
          const locked = def.field === "status" && statusLocked;
          if (editing === def.field) {
            return (
              <div className="row" key={def.field}>
                <FieldEditor def={def} initial={value} onCancel={() => setEditing(null)} onDone={(v) => setEdit(def.field, v)} />
              </div>
            );
          }
          const body = (
            <>
              <span className="row-label">{def.label}</span>
              <span className="row-value">
                <span className="stack">
                  <span>
                    {edited && current(def.field) && <span className="was">{show(def, current(def.field))}</span>}
                    {edited ? <strong>{show(def, value) || "Empty"}</strong> : show(def, value) || <span className="sub">Empty</span>}
                  </span>
                  {locked && <span className="sub">Set in Monday: {MONDAY_ONLY_STATUSES[current("status")]}</span>}
                </span>
                {lead.canEdit && !locked && <span className="pencil"><Pencil /></span>}
              </span>
            </>
          );
          return (
            <div className="row" key={def.field}>
              {lead.canEdit && !locked ? (
                <button className="row-btn" aria-label={`Change ${def.label.toLowerCase()}`} disabled={working} onClick={() => setEditing(def.field)}>{body}</button>
              ) : (
                <div className="row-btn lookup-row" style={{ cursor: "default" }}>{body}</div>
              )}
            </div>
          );
        })}
        {info.map((r) => (
          <div className="row lookup-row" key={r.label}>
            <div className="row-btn" style={{ cursor: "default" }}>
              <span className="row-label">{r.label}</span>
              <span className="row-value">{r.value}</span>
            </div>
          </div>
        ))}
      </div>

      {(lead.contacts.length > 0 || lead.info.folderUrl) && (
        <section className="lookup-section">
          <h3>Linked</h3>
          <ul className="lookup-props">
            {lead.contacts.map((c) => <li key={c.url}><a href={c.url} target="_blank" rel="noreferrer">{c.name} (Vantage Contact) <Out /></a></li>)}
            {lead.info.folderUrl && <li><a href={lead.info.folderUrl} target="_blank" rel="noreferrer">Property Folder <Out /></a></li>}
          </ul>
        </section>
      )}

      {changes.length > 0 && (
        <section className="lookup-section">
          <h3>Changes to approve</h3>
          <ul className="lookup-notes">
            {changes.map((c) => {
              const def = fieldDef(c.field);
              return (
                <li key={c.field} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span className="text">{def.label}: {show(def, c.from) || "empty"} → <strong>{show(def, c.to) || "empty"}</strong></span>
                  <button className="link-btn" disabled={working} onClick={() => undo(c.field)}>Undo</button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {changes.map((c) => (c.field === "status" ? statusNote(c.to) : null)).filter(Boolean).map((note) => (
        <div className="callout auto" key={note}><Bolt /><span>{note}</span></div>
      ))}

      {status.kind === "failed" && <div className="alert" role="alert" style={{ margin: "0 12px 12px" }}>{status.message}</div>}
      {status.kind === "saved" && <p className="inline-msg" role="status" style={{ padding: "0 16px" }}>Saved {status.changed} change{status.changed === 1 ? "" : "s"} to Monday. The values above are what Monday holds now.{status.automations ? " Monday may update it further in the next minute." : ""}</p>}

      {changes.length > 0 ? (
        <div className="card-foot">
          <button className="approve" disabled={working || !!editing} onClick={approve}>
            {working ? "Saving…" : status.kind === "failed" && !status.refused ? "Retry save" : `Approve ${changes.length} change${changes.length === 1 ? "" : "s"}`}
          </button>
          <button className="secondary" disabled={working} onClick={() => { setEdits({}); setStatus({ kind: "idle" }); }}>Cancel</button>
        </div>
      ) : (
        <div className="lookup-foot">
          <span>Updated {when(lead.updatedAt)}</span>
          <a className="open" href={lead.url} target="_blank" rel="noreferrer">Open in Monday <Out /></a>
        </div>
      )}
    </article>
  );
}

function FieldEditor({ def, initial, onDone, onCancel }: { def: FieldDef; initial: string; onDone: (v: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);

  function done() {
    const v = value.trim();
    if (def.kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return setMsg("Pick a date. To clear a date, use Monday.");
    if (def.kind === "status" && !v) return setMsg("Choose one, or Cancel to keep it.");
    onDone(v);
  }

  let input;
  if (def.field === "status") {
    input = (
      <select className="field" value={value} onChange={(e) => setValue(e.target.value)}>
        {SETTABLE_STATUSES.map((o) => <option key={o}>{o}</option>)}
        {Object.keys(MONDAY_ONLY_STATUSES).map((o) => <option key={o} disabled>{o} (set in Monday)</option>)}
      </select>
    );
  } else if (def.kind === "status") {
    input = (
      <select className="field" value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="">Choose…</option>
        {def.options!.map((o) => <option key={o}>{o}</option>)}
      </select>
    );
  } else if (def.kind === "checkbox") {
    input = (
      <select className="field" value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="Yes">Yes</option>
        <option value="">No</option>
      </select>
    );
  } else if (def.kind === "date") {
    input = <input className="field" type="date" value={value} onChange={(e) => setValue(e.target.value)} />;
  } else {
    input = <input className="field" type="text" value={value} onChange={(e) => setValue(e.target.value)} />;
  }

  return (
    <div className="row-edit">
      <label>
        {def.label}
        {input}
      </label>
      {def.field === "status" && <p className="inline-msg">Generate Property Folder and LA, In Marketing and On Market start Monday automations, so they&apos;re set in Monday.</p>}
      {msg && <p className="inline-msg bad" role="alert">{msg}</p>}
      <div className="edit-actions">
        <button className="small-btn" onClick={onCancel}>Cancel</button>
        <button className="small-btn solid" onClick={done}>Done</button>
      </div>
    </div>
  );
}
