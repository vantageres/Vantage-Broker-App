"use client";

import { useState } from "react";
import type { AddRef, AddResult } from "@/lib/email/add-to-monday";
import type { Proposal } from "@/lib/capture/proposal";
import { ProposalCard } from "../ProposalCard";
import { Out } from "../icons";
import { emailFetch } from "./api";

// "Add to Monday" on a lead or a new contact (plan step 5). Opens the app's
// own approval card for a new Lead; nothing is saved until the broker
// approves there. Someone already in Monday is shown with their owner.
export function AddToMonday({ target, label = "Add to Monday" }: { target: AddRef; label?: string }) {
  const [typed, setTyped] = useState({ email: "", phone: "" });
  const [state, setState] = useState<{ kind: "idle" } | { kind: "loading" } | { kind: "error"; text: string } | AddResult>({ kind: "idle" });

  async function open(asNew = false, withTyped = typed) {
    setState({ kind: "loading" });
    try {
      const res = await emailFetch("/api/email/add-to-monday", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...target, asNew, typed: withTyped }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Something went wrong.");
      setState(body as AddResult);
    } catch (e) {
      setState({ kind: "error", text: e instanceof Error ? e.message : "Something went wrong." });
    }
  }

  if (state.kind === "idle" || state.kind === "loading" || state.kind === "error") {
    return (
      <div className="add-monday">
        {state.kind === "error" && <p className="alert" role="alert">{state.text}</p>}
        <button className="secondary" type="button" disabled={state.kind === "loading"} onClick={() => open()}>
          {state.kind === "loading" ? "Checking Monday…" : label}
        </button>
      </div>
    );
  }

  if (state.kind === "in-monday") {
    const r = state.records[0];
    return (
      <div className="add-monday add-monday-known" role="status">
        <p>
          <strong>{r.name}</strong> is already in Monday ({r.boardLabel}), matched on {r.matchedOn.join(" and ")}.{" "}
          {r.yours ? "You're the Contact Broker." : r.owner ? `Contact Broker: ${r.owner}. Coordinate with them before reaching out.` : "No Contact Broker yet."}{" "}
          Nothing was added.
        </p>
        <a className="open-link" href={r.url} target="_blank" rel="noreferrer">Open in Monday <Out /></a>
      </div>
    );
  }

  if (state.kind === "needs-contact") {
    return (
      <form className="add-monday add-monday-known" onSubmit={(e) => { e.preventDefault(); open(); }}>
        <p>The email doesn&apos;t give an email address or phone for {state.name}. A new Lead needs one.</p>
        <label className="add-monday-field">Email<input type="email" value={typed.email} onChange={(e) => setTyped({ ...typed, email: e.target.value })} /></label>
        <label className="add-monday-field">Phone<input type="tel" value={typed.phone} onChange={(e) => setTyped({ ...typed, phone: e.target.value })} /></label>
        <button className="secondary" type="submit" disabled={!typed.email.trim() && !typed.phone.trim()}>Continue</button>
      </form>
    );
  }

  if (state.kind === "maybe") {
    return (
      <div className="add-monday add-monday-known">
        <p><strong>Same person?</strong> Monday has {state.records.length === 1 ? "someone" : "people"} with a similar name. Check before adding a new Lead.</p>
        <ul>
          {state.records.map((r) => (
            <li key={r.url}>
              <a href={r.url} target="_blank" rel="noreferrer">{r.name}</a> · {r.boardLabel} · {r.owner || "no Contact Broker"} · matched on {r.matchedOn.join(", ")}
            </li>
          ))}
        </ul>
        <button className="secondary" type="button" onClick={() => open(true)}>Someone else, add a new Lead</button>
      </div>
    );
  }

  return (
    <div className="add-monday add-monday-card">
      {state.leftOut > 0 && (
        <p className="inline-msg">A line about money or commission was left out of the note. Monday notes never carry those.</p>
      )}
      <ProposalCard proposal={state.proposal} onReplace={(p: Proposal) => setState({ kind: "card", proposal: p, leftOut: state.leftOut })} />
    </div>
  );
}
