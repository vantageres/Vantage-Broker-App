"use client";

import { useState } from "react";
import type { NewPropertyLeadProposal } from "@/lib/property-leads/create";
import type { PropertyLeadView } from "@/lib/property-leads/board";
import type { Proposal } from "@/lib/capture/proposal";
import { LEAD_PROPERTY_TYPES, LISTING_TYPES } from "@/lib/property-leads/fields";
import { PropertyLeadCard } from "./PropertyLeadCard";
import { ProposalCard } from "./ProposalCard";
import { Alert, Bolt, Check, Out, Plus } from "./icons";

type Point = { lat: number; lng: number; address: string };
// Which contact goes with the Property Lead: a match, a new Lead, or no one.
type ContactChoice = { kind: "match"; id: string } | { kind: "new" } | { kind: "none" } | null;
type Status =
  | { kind: "review" }
  | { kind: "working" }
  | { kind: "created"; lead: PropertyLeadView }
  | { kind: "failed"; message: string }
  | { kind: "cancelled" };

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

// A Property Lead to create, from a broker's note. The broker is its Broker.
// Nothing is created until they approve.
export function NewPropertyLeadCard({ proposal }: { proposal: NewPropertyLeadProposal }) {
  const [name, setName] = useState(proposal.name);
  const [location, setLocation] = useState<Point | null>(proposal.location);
  const [locationMsg, setLocationMsg] = useState<string | null>(proposal.locationProblem ?? null);
  const [finding, setFinding] = useState(false);
  const [values, setValues] = useState(proposal.values);
  const c = proposal.contact;
  const [choice, setChoice] = useState<ContactChoice>(c ? (c.recommended ? { kind: "match", id: c.recommended } : null) : { kind: "none" });
  const [status, setStatus] = useState<Status>({ kind: "review" });
  const [owner, setOwner] = useState<Proposal | null>(c?.newLead ?? null);

  const working = status.kind === "working";
  const picked = choice?.kind === "match" ? c?.candidates.find((x) => x.id === choice.id) : undefined;
  const set = (field: keyof NewPropertyLeadProposal["values"], value: string) => setValues((v) => ({ ...v, [field]: value || undefined }));

  async function findOnMap() {
    if (!name.trim()) return;
    setFinding(true);
    setLocationMsg(null);
    try {
      const res = await post<{ available: boolean; point: (Point & { partial?: boolean }) | null }>("/api/place", { place: name.trim() });
      if (!res.available) setLocationMsg("Map lookup isn't set up, so Location is left empty.");
      else if (!res.point) setLocationMsg(`"${name.trim()}" wasn't found on the map. Try adding the town.`);
      else if (res.point.partial) setLocationMsg(`The map only partly matched ${res.point.address}. Try the full address with the town.`);
      else setLocation({ lat: res.point.lat, lng: res.point.lng, address: res.point.address });
    } catch (e) {
      setLocationMsg((e as Error).message);
    } finally {
      setFinding(false);
    }
  }

  async function create() {
    setStatus({ kind: "working" });
    try {
      const { lead } = await post<{ lead: PropertyLeadView }>("/api/property-lead/create", {
        name: name.trim(), location, values, ...(picked?.linkable ? { linkContact: picked.id } : {}),
      });
      setStatus({ kind: "created", lead });
    } catch (e) {
      setStatus({ kind: "failed", message: (e as Error).message });
    }
  }

  if (status.kind === "cancelled") return <div className="bubble app">Cancelled. No Property Lead was created.</div>;

  if (status.kind === "created") {
    const lead = status.lead;
    return (
      <>
        <div className="bubble app saved-bubble" role="status">
          <span className="tick"><Check /></span>
          <div>
            <div><strong>Created {lead.name}.</strong> You&apos;re its Broker.{picked?.linkable ? ` Linked to ${picked.name}.` : ""}</div>
            {picked && !picked.linkable && <div>{picked.name} is a Lead, so they weren&apos;t linked. Property Contacts links only to Contacts: link them in Monday once they&apos;re qualified.</div>}
            {choice?.kind === "new" && c && <div>Now add {c.name} as a new Lead below. Once they&apos;re qualified to Contacts, link them in Monday.</div>}
            <a className="open" href={lead.url} target="_blank" rel="noreferrer">Open in Monday <Out /></a>
          </div>
        </div>
        <PropertyLeadCard lead={lead} />
        {choice?.kind === "new" && owner && <ProposalCard proposal={owner} onReplace={setOwner} />}
      </>
    );
  }

  return (
    <article className="card" aria-label="New Property Lead">
      <div className="card-head">
        <div>
          <div className="kicker">New Property Lead · You&apos;ll be Broker</div>
          <div className="title">{name || "No address yet"}</div>
        </div>
      </div>

      <div className="rows">
        <div className="row">
          <label className="row-edit" style={{ gap: 6 }}>
            <span className="row-label">Address</span>
            <input className="field" value={name} disabled={working} onChange={(e) => { setName(e.target.value); setLocation(null); setLocationMsg(null); }} />
            {location ? (
              <span className="inline-msg">On the map: {location.address}</span>
            ) : (
              <span style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                {locationMsg && <span className="inline-msg bad">{locationMsg}</span>}
                <button className="small-btn" disabled={working || finding || !name.trim()} onClick={findOnMap}>{finding ? "Finding…" : "Find on the map"}</button>
              </span>
            )}
          </label>
        </div>
        <div className="row">
          <label className="row-edit" style={{ gap: 6 }}>
            <span className="row-label">Listing Type</span>
            <select className="field" value={values.listingType ?? ""} disabled={working} onChange={(e) => set("listingType", e.target.value)}>
              <option value="">Not set</option>
              {LISTING_TYPES.filter((t) => t !== "Not Set").map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
        </div>
        <div className="row">
          <label className="row-edit" style={{ gap: 6 }}>
            <span className="row-label">Property Type</span>
            <select className="field" value={values.propertyType ?? ""} disabled={working} onChange={(e) => set("propertyType", e.target.value)}>
              <option value="">Not set</option>
              {LEAD_PROPERTY_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
        </div>
        <div className="row">
          <label className="row-edit" style={{ gap: 6 }}>
            <span className="row-label">Listing Price</span>
            <input className="field" value={values.listingPrice ?? ""} placeholder="Optional" disabled={working} onChange={(e) => set("listingPrice", e.target.value)} />
          </label>
        </div>
        <div className="row">
          <label className="row-edit" style={{ gap: 6 }}>
            <span className="row-label">Size Available</span>
            <input className="field" value={values.sizeAvailable ?? ""} placeholder="Optional" disabled={working} onChange={(e) => set("sizeAvailable", e.target.value)} />
          </label>
        </div>
        {proposal.questions.map((q, i) => <p key={i} className="inline-msg bad" style={{ padding: "4px 0" }}>{q.question}</p>)}
      </div>

      {c ? (
        <div className="candidates" role="radiogroup" aria-label="Contact">
          <div className="row-label" style={{ padding: "0 4px" }}>Contact: {c.name}</div>
          {c.candidates.map((x) => (
            <button key={`${x.board}:${x.id}`} role="radio" aria-checked={choice?.kind === "match" && choice.id === x.id}
              className={`candidate${choice?.kind === "match" && choice.id === x.id ? " recommended" : ""}`} disabled={working}
              onClick={() => setChoice({ kind: "match", id: x.id })}>
              <span className="c-text">
                <span className="c-name">{x.name}</span>
                <span className="c-detail">{x.boardLabel}{x.owner ? ` · ${x.owner}` : ""}</span>
                <span className="c-why">Matched on: {x.matchedOn.join(", ")}</span>
                {!x.linkable && <span className="c-why">A Lead: Property Contacts links only to Contacts, so they won&apos;t be linked yet.</span>}
                {x.id === c.recommended && <span className="c-rec">Recommended</span>}
              </span>
            </button>
          ))}
          <button role="radio" aria-checked={choice?.kind === "new"} className={`candidate new${choice?.kind === "new" ? " recommended" : ""}`} disabled={working} onClick={() => setChoice({ kind: "new" })}>
            <span className="notice-icon" style={{ display: "flex" }}><Plus /></span>
            <span className="c-text">
              <span className="c-name">Create a new Lead for {c.name}</span>
              <span className="c-detail">You&apos;ll approve the Lead after the Property Lead is created</span>
            </span>
          </button>
          <button role="radio" aria-checked={choice?.kind === "none"} className={`candidate new${choice?.kind === "none" ? " recommended" : ""}`} disabled={working} onClick={() => setChoice({ kind: "none" })}>
            <span className="c-text"><span className="c-name">Don&apos;t link anyone</span></span>
          </button>
        </div>
      ) : (
        <p className="inline-msg" style={{ padding: "0 16px 8px" }}>No contact is named in the note. You can link one in Monday later.</p>
      )}

      <div className="callout auto"><Bolt /><span>After it&apos;s created, Monday fills in Status (New Lead), the folder status, Date Created, County and Zip Code.</span></div>

      {status.kind === "failed" && (
        <div className="alert" role="alert" style={{ margin: "0 12px 12px" }}>
          <Alert />
          <div><strong>Not created.</strong> {status.message}</div>
        </div>
      )}

      <div className="card-foot">
        <button className="approve" disabled={working || !name.trim() || !choice} onClick={create}>
          {working ? "Creating…" : !name.trim() ? "Add the address first" : !choice ? "Choose a contact option first" : "Approve & create"}
        </button>
        <button className="secondary" disabled={working} onClick={() => setStatus({ kind: "cancelled" })}>Cancel</button>
      </div>
    </article>
  );
}
