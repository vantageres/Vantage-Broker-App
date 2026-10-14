"use client";

import { useState } from "react";
import type { FieldChange, Proposal } from "@/lib/capture/proposal";
import { CONTACT_TYPES, PROPERTY_TYPES, SOURCES } from "@/lib/monday/boards";
import type { SaveChange, SaveField, SaveRequest, SaveResult } from "@/lib/monday/write";
import { Alert, Bolt, Check, Chevron, Lock, Note, Out, Pencil, Plus, UserPlus } from "./icons";

type Point = { lat: number; lng: number; address: string };
type Edit = { value: string; location?: Point };
type Status =
  | { kind: "review" }
  | { kind: "working"; what: string }
  | { kind: "saved"; result: SaveResult; url: string }
  | { kind: "failed"; message: string; partial?: SaveResult; url?: string }
  | { kind: "cancelled" };

const SAVE_FIELDS: SaveField[] = [
  "name", "businessName", "contactType", "propertyType", "budget", "size", "desiredLocation", "notes", "followUp", "source", "phone", "email",
];
const LABELS: Record<string, string> = {
  name: "Name", businessName: "Business Name", contactType: "Contact Type", propertyType: "Property Type", budget: "Budget",
  size: "Sq Ft/Acres", desiredLocation: "Desired Location", notes: "Notes", followUp: "Follow Up Date", source: "Source",
  phone: "Phone", email: "Email",
};

const DATE_FMT = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
function showDate(iso: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? DATE_FMT.format(new Date(`${iso}T00:00:00Z`)) : iso;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(data.error ?? "Something went wrong."), { data, status: res.status });
  return data;
}

export function ProposalCard({ proposal, onReplace }: { proposal: Proposal; onReplace: (p: Proposal) => void }) {
  const [status, setStatus] = useState<Status>({ kind: "review" });
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [answered, setAnswered] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const t = proposal.target;
  const working = status.kind === "working";

  async function resolve(choice: { board: "leads" | "contacts"; id: string } | "new") {
    setError(null);
    setStatus({ kind: "working", what: "Loading…" });
    try {
      const { proposal: next } = await post<{ proposal: Proposal }>("/api/capture/resolve", {
        person: proposal.person, noteText: proposal.noteText, choice,
      });
      onReplace(next);
    } catch (e) {
      setError((e as Error).message);
      setStatus({ kind: "review" });
    }
  }

  async function claim() {
    if (t.kind !== "existing") return;
    setError(null);
    setStatus({ kind: "working", what: "Claiming…" });
    try {
      await post("/api/claim", { board: t.record.board, id: t.record.id });
      await resolve({ board: t.record.board, id: t.record.id });
    } catch (e) {
      setError((e as Error).message);
      setStatus({ kind: "review" });
    }
  }

  if (status.kind === "cancelled") {
    return <div className="bubble app">Cancelled. Nothing was saved for {proposal.subject}.</div>;
  }

  // Pick a match -------------------------------------------------------------
  if (t.kind === "pick") {
    return (
      <article className="card" aria-label={`Pick a match for ${proposal.subject}`}>
        <div className="card-head">
          <div>
            <div className="kicker">Which record?</div>
            <div className="title">{proposal.questions[0]?.question}</div>
          </div>
        </div>
        <div className="candidates">
          {t.candidates.map((c) => (
            <button key={`${c.board}:${c.id}`} className={`candidate${c.id === t.recommended ? " recommended" : ""}`} disabled={working} onClick={() => resolve({ board: c.board, id: c.id })}>
              <span className="c-text">
                <span className="c-name">{c.name}</span>
                <span className="c-detail">{c.boardLabel}{c.owner ? ` · ${c.owner}` : " · No Contact Broker"}</span>
                <span className="c-why">Matched on: {c.matchedOn.join(", ")}</span>
                {c.id === t.recommended && <span className="c-rec">Recommended: Contacts record</span>}
              </span>
              <span className="pencil"><Chevron /></span>
            </button>
          ))}
          <button className="candidate new" disabled={working} onClick={() => resolve("new")}>
            <span className="notice-icon" style={{ display: "flex" }}><Plus /></span>
            <span className="c-text">
              <span className="c-name">Someone else, create a new Lead</span>
              <span className="c-detail">You&apos;ll be the Contact Broker</span>
            </span>
          </button>
          {error && <p className="inline-msg bad" role="alert">{error}</p>}
        </div>
      </article>
    );
  }

  // Someone else's record, or unassigned ------------------------------------
  if (t.kind === "existing" && proposal.blocked) {
    const mine = proposal.blocked.reason === "unassigned";
    return (
      <article className="card">
        <div className="notice" style={{ borderBottom: "1px solid var(--line-soft)" }}>
          <span className={`icon${mine ? " navy" : ""}`}>{mine ? <UserPlus /> : <Lock />}</span>
          <div>
            {proposal.blocked.reason === "not-owner" ? (
              <>
                <h3>{t.record.name} belongs to {proposal.blocked.owner}</h3>
                <p>Only the Contact Broker or a Co-Broker can change this {t.record.boardLabel}, so I haven&apos;t proposed any changes. Nothing was saved.</p>
              </>
            ) : (
              <>
                <h3>{t.record.name} has no Contact Broker</h3>
                <p>Unassigned records can&apos;t be changed until a broker claims them. Claim it to become the Contact Broker, then I&apos;ll show the changes from your note.</p>
              </>
            )}
          </div>
        </div>
        <div className="open-link">
          <a href={t.record.url} target="_blank" rel="noreferrer">Open in Monday <Out /></a>
        </div>
        {error && <p className="inline-msg bad" role="alert" style={{ padding: "0 16px" }}>{error}</p>}
        {mine && (
          <div className="card-foot">
            <button className="approve" disabled={working} onClick={claim}>{working ? status.what : `Claim ${t.record.name}`}</button>
            <button className="secondary" disabled={working} onClick={() => setStatus({ kind: "cancelled" })}>Not now</button>
          </div>
        )}
      </article>
    );
  }

  // Review ------------------------------------------------------------------
  const isNew = t.kind === "new-lead";
  const byField = new Map<string, FieldChange>(proposal.changes.map((c) => [c.field, c]));
  const notesChange = byField.get("notes");
  const notesKept = notesChange?.current ?? "";
  const proposedAdded = notesChange
    ? notesKept && notesChange.proposed.startsWith(notesKept)
      ? notesChange.proposed.slice(notesKept.length).replace(/^[.\s]+/, "")
      : notesChange.proposed
    : "";
  const notesAdded = edits.notes?.value ?? proposedAdded;

  // Rows: proposed changes plus fields set by answering a question.
  const rowFields = [
    ...proposal.changes.map((c) => c.field).filter((f) => f !== "notes" && f !== "contactBroker" && f !== "status"),
    ...Object.keys(edits).filter((f) => f !== "notes" && !byField.has(f)),
  ] as string[];

  function valueOf(field: string): Edit | undefined {
    if (edits[field]) return edits[field];
    const c = byField.get(field);
    return c ? { value: c.proposed, location: c.location } : undefined;
  }

  const openQuestions = proposal.questions
    .map((q, i) => ({ ...q, i }))
    .filter((q) => q.field !== "match" && !answered.includes(q.i));
  const question = openQuestions[0];
  const totalQuestions = proposal.questions.filter((q) => q.field !== "match").length;
  const missingMap = rowFields.includes("desiredLocation") && !valueOf("desiredLocation")?.location;
  const changeCount = rowFields.length + (notesAdded ? 1 : 0);

  function setEdit(field: string, edit: Edit) {
    setEdits((e) => ({ ...e, [field]: edit }));
  }

  function answer(i: number, field?: string, edit?: Edit) {
    if (field && edit) {
      if (field === "other") setEdit("notes", { value: [notesAdded, edit.value].filter(Boolean).join(". ") });
      else setEdit(field, edit);
    }
    setAnswered((a) => [...a, i]);
  }

  function saveRequest(): SaveRequest {
    const changes: SaveChange[] = [];
    for (const field of rowFields) {
      const v = valueOf(field);
      if (v && SAVE_FIELDS.includes(field as SaveField)) changes.push({ field: field as SaveField, value: v.value, location: v.location });
    }
    if (notesAdded.trim()) changes.push({ field: "notes", value: notesKept ? `${notesKept.replace(/[.;\s]+$/, "")}. ${notesAdded.trim()}` : notesAdded.trim() });
    const target: SaveRequest["target"] = t.kind === "existing" ? { kind: "existing", board: t.record.board, id: t.record.id } : { kind: "new-lead" };
    return { target, changes, noteText: proposal.noteText };
  }

  async function save(request: SaveRequest) {
    setStatus({ kind: "working", what: "Saving…" });
    try {
      const { result, url } = await post<{ result: SaveResult; url: string }>("/api/save", request);
      setStatus({ kind: "saved", result, url });
    } catch (e) {
      const data = (e as { data?: { partial?: SaveResult; url?: string } }).data;
      setStatus({ kind: "failed", message: (e as Error).message, partial: data?.partial, url: data?.url });
    }
  }

  function retry() {
    if (status.kind !== "failed") return;
    if (status.partial) {
      // Fields are already saved; only the note is retried.
      save({ target: { kind: "existing", board: status.partial.board, id: status.partial.itemId }, changes: [], noteText: proposal.noteText });
    } else save(saveRequest());
  }

  const kicker = isNew ? "New Lead · You'll be Contact Broker" : `Update ${t.kind === "existing" ? t.record.boardLabel : ""}`;
  const business = valueOf("businessName")?.value;

  if (status.kind === "saved") {
    const r = status.result;
    const parts = [r.fieldsChanged ? `${r.fieldsChanged} field${r.fieldsChanged === 1 ? "" : "s"} updated` : "", r.noteAdded ? "a note added" : ""].filter(Boolean);
    return (
      <>
        <div className="card" style={{ padding: "12px 16px", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div className="kicker">{isNew ? "New Lead" : kicker}</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{r.name}</div>
          </div>
          <span className="chip ok">Saved</span>
        </div>
        <div className="bubble app saved-bubble" role="status">
          <span className="tick"><Check /></span>
          <div>
            <div><strong>Saved to {r.name}.</strong> {parts.length ? `${parts.join(" and ")}.` : ""}</div>
            <a className="open" href={status.url} target="_blank" rel="noreferrer">Open in Monday <Out /></a>
          </div>
        </div>
      </>
    );
  }

  return (
    <article className="card" aria-label={`Proposed changes for ${proposal.subject}`}>
      <div className="card-head">
        <div>
          <div className="kicker">{kicker}</div>
          <div className="title">{t.kind === "existing" ? t.record.name : valueOf("name")?.value}{business && !isNew ? ` · ${business}` : ""}</div>
        </div>
        {changeCount > 0 && <span className="chip">{changeCount} change{changeCount === 1 ? "" : "s"}</span>}
      </div>

      <div className="rows">
        {rowFields.map((field) => {
          const c = byField.get(field);
          const v = valueOf(field)!;
          return (
            <div className="row" key={field}>
              {editing === field ? (
                <FieldEditor
                  field={field}
                  initial={v}
                  onCancel={() => setEditing(null)}
                  onDone={(edit) => { setEdit(field, edit); setEditing(null); }}
                />
              ) : (
                <button className="row-btn" aria-label={`Change ${(LABELS[field] ?? field).toLowerCase()}`} disabled={working || status.kind === "failed"} onClick={() => setEditing(field)}>
                  <span className="row-label">{LABELS[field] ?? c?.label ?? field}</span>
                  <span className="row-value">
                    <span className="stack">
                      <span>
                        {c?.current && <span className="was">{c.currentDisplay ?? c.current}</span>}
                        <strong>{field === "followUp" ? showDate(v.value) : v.value}</strong>
                      </span>
                      {field === "desiredLocation" && v.location && <span className="sub">On the map: {v.location.address}</span>}
                      {field === "desiredLocation" && !v.location && <span className="warn">Not found on the map yet</span>}
                    </span>
                    <span className="pencil"><Pencil /></span>
                  </span>
                </button>
              )}
            </div>
          );
        })}

        {(notesAdded || notesKept) && (notesChange || edits.notes) && (
          <div className="row">
            {editing === "notes" ? (
              <FieldEditor field="notes" initial={{ value: notesAdded }} onCancel={() => setEditing(null)} onDone={(edit) => { setEdit("notes", edit); setEditing(null); }} />
            ) : (
              <button className="row-btn" style={{ flexDirection: "column", alignItems: "stretch" }} aria-label="Change notes" disabled={working} onClick={() => setEditing("notes")}>
                <span style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="row-label">Notes</span>
                  <span className="pencil"><Pencil /></span>
                </span>
                <span className="notes-block" style={{ padding: 0 }}>
                  <span>
                    {notesKept && <span className="kept">{notesKept} </span>}
                    {notesAdded && <span className="added">+ {notesAdded}</span>}
                  </span>
                  {notesKept && <span className="row-value sub" style={{ fontSize: 12, color: "var(--muted)" }}>Added to what&apos;s there. Nothing is removed.</span>}
                </span>
              </button>
            )}
          </div>
        )}

        {isNew && <p className="inline-msg" style={{ padding: "8px 0" }}>Contact Broker: you. Status: New Lead.</p>}
      </div>

      {question && (
        <Question
          key={question.i}
          number={totalQuestions - openQuestions.length + 1}
          total={totalQuestions}
          field={question.field}
          text={question.question}
          onAnswer={(edit) => answer(question.i, question.field, edit)}
          onSkip={() => answer(question.i)}
        />
      )}

      {proposal.placedInNotes.map((n, i) => (
        <div className="callout notes" key={i}><strong>Put in Notes:</strong> “{n.text}” {n.why}</div>
      ))}
      {proposal.automations.map((a, i) => (
        <div className="callout auto" key={i}><Bolt /><span>{a}</span></div>
      ))}
      <div className="note-line"><Note /> Full note added to Emails &amp; Activities</div>

      {status.kind === "failed" && (
        <div className="alert" role="alert" style={{ margin: "0 12px 12px" }}>
          <Alert />
          <div>
            <strong>{status.partial ? "Changes saved. The note wasn't added." : "Not saved."}</strong>{" "}
            {status.partial ? <>Retry adds only the note. <a href={status.url} target="_blank" rel="noreferrer">Open in Monday</a></> : status.message}
          </div>
        </div>
      )}

      <div className="card-foot">
        {status.kind === "failed" ? (
          <button className="approve" onClick={retry}>{status.partial ? "Retry the note" : "Retry save"}</button>
        ) : (
          <button className="approve" disabled={working || !!question || !!editing || missingMap} onClick={() => save(saveRequest())}>
            {working
              ? status.what
              : question
                ? `Answer ${openQuestions.length} question${openQuestions.length === 1 ? "" : "s"} to approve`
                : missingMap
                  ? "Find Desired Location on the map first"
                  : "Approve & save"}
          </button>
        )}
        <button className="secondary" disabled={working} onClick={() => setStatus({ kind: "cancelled" })}>Cancel</button>
      </div>
    </article>
  );
}

// One field being edited in place.
function FieldEditor({ field, initial, onDone, onCancel }: { field: string; initial: Edit; onDone: (e: Edit) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial.value);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = LABELS[field] ?? field;

  async function done() {
    const v = value.trim();
    if (!v) return setMsg("Enter a value, or Cancel to keep it.");
    if (field === "desiredLocation") {
      if (initial.location && v === initial.value) return onDone(initial);
      setBusy(true);
      const found = await findOnMap(v);
      setBusy(false);
      if (found.kind !== "ok") return setMsg(found.message);
      return onDone({ value: v, location: found.point });
    }
    onDone({ value: v });
  }

  return (
    <div className="row-edit">
      <label>
        {label}
        <FieldInput field={field} value={value} onChange={setValue} />
      </label>
      {msg && <p className="inline-msg bad" role="alert">{msg}</p>}
      <div className="edit-actions">
        <button className="small-btn" onClick={onCancel}>Cancel</button>
        <button className="small-btn solid" disabled={busy} onClick={done}>{busy ? "Finding…" : "Done"}</button>
      </div>
    </div>
  );
}

function FieldInput({ field, value, onChange }: { field: string; value: string; onChange: (v: string) => void }) {
  const options = field === "contactType" ? CONTACT_TYPES : field === "source" ? SOURCES : null;
  if (options) {
    return (
      <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    );
  }
  if (field === "followUp") return <input className="field" type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
  if (field === "notes") return <textarea className="field" value={value} onChange={(e) => onChange(e.target.value)} />;
  const type = field === "email" ? "email" : field === "phone" ? "tel" : "text";
  const mode = field === "budget" ? "decimal" : undefined;
  const hint = field === "propertyType" ? PROPERTY_TYPES.join(", ") : undefined;
  return <input className="field" type={type} inputMode={mode} value={value} title={hint} onChange={(e) => onChange(e.target.value)} />;
}

type MapAnswer = { kind: "ok"; point: Point } | { kind: "no"; message: string };

async function findOnMap(place: string): Promise<MapAnswer> {
  try {
    const res = await post<{ available: boolean; point: (Point & { partial?: boolean }) | null }>("/api/place", { place });
    if (!res.available) return { kind: "no", message: "Map lookup isn't set up, so Desired Location can't be saved yet." };
    if (!res.point) return { kind: "no", message: `I couldn't find "${place}" on the map. Try a town or address.` };
    if (res.point.partial) return { kind: "no", message: `The map only partly matched ${res.point.address}. Try a town or address.` };
    return { kind: "ok", point: { lat: res.point.lat, lng: res.point.lng, address: res.point.address } };
  } catch (e) {
    return { kind: "no", message: (e as Error).message };
  }
}

// The current question, asked one at a time.
function Question({ number, total, field, text, onAnswer, onSkip }: {
  number: number; total: number; field: string; text: string; onAnswer: (e: Edit) => void; onSkip: () => void;
}) {
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const choices = field === "contactType" ? CONTACT_TYPES : field === "source" ? SOURCES : null;

  async function submit() {
    const v = value.trim();
    if (!v) return setMsg("Enter an answer, or skip to leave it empty.");
    if (field === "desiredLocation") {
      setBusy(true);
      const found = await findOnMap(v);
      setBusy(false);
      if (found.kind !== "ok") return setMsg(found.message);
      return onAnswer({ value: v, location: found.point });
    }
    if (field === "followUp" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return setMsg("Pick a date.");
    onAnswer({ value: v });
  }

  return (
    <fieldset className="question">
      <legend className="sr-only">Question {number} of {total}</legend>
      <div>
        <div className="q-kicker">QUESTION {number} OF {total}</div>
        <div className="q-text">{text}</div>
      </div>
      {choices ? (
        <div className="choices">
          {choices.map((c) => <button key={c} className="choice" onClick={() => onAnswer({ value: c })}>{c}</button>)}
        </div>
      ) : (
        <>
          <label className="sr-only" htmlFor={`q-${number}`}>Answer</label>
          {field === "followUp" ? (
            <input id={`q-${number}`} className="field" type="date" value={value} onChange={(e) => setValue(e.target.value)} />
          ) : (
            <input id={`q-${number}`} className="field" type="text" value={value} onChange={(e) => setValue(e.target.value)}
              placeholder={field === "other" ? "Your answer is added to Notes" : "Your answer"} />
          )}
          {msg && <p className="inline-msg bad" role="alert">{msg}</p>}
          <button className="small-btn solid" style={{ alignSelf: "flex-end" }} disabled={busy} onClick={submit}>{busy ? "Finding…" : "Use this"}</button>
        </>
      )}
      <button className="skip" onClick={onSkip}>Skip, leave it empty</button>
    </fieldset>
  );
}
