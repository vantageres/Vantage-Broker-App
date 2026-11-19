"use client";

import { useState } from "react";
import type { PropertyLeadResult } from "@/lib/email/scan-server";
import { NewPropertyLeadCard } from "../NewPropertyLeadCard";
import { Out } from "../icons";
import { emailFetch } from "./api";

// "New Property Lead" on a property from the scan that isn't in Monday.
// Opens the app's own Property Lead card; nothing is created until the
// broker approves there.
export function NewPropertyLeadFromEmail({ id }: { id: string }) {
  const [state, setState] = useState<{ kind: "idle" } | { kind: "loading" } | { kind: "error"; text: string } | PropertyLeadResult>({ kind: "idle" });

  async function open() {
    setState({ kind: "loading" });
    try {
      const res = await emailFetch("/api/email/property-lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Something went wrong.");
      setState(body as PropertyLeadResult);
    } catch (e) {
      setState({ kind: "error", text: e instanceof Error ? e.message : "Something went wrong." });
    }
  }

  if (state.kind === "in-monday") {
    return (
      <div className="add-monday add-monday-known" role="status">
        <p><strong>{state.name}</strong> is already in Monday ({state.boardLabel}). Nothing was added.</p>
        <a className="open-link" href={state.url} target="_blank" rel="noreferrer">Open in Monday <Out /></a>
      </div>
    );
  }
  if (state.kind === "card") return <div className="add-monday add-monday-card"><NewPropertyLeadCard proposal={state.proposal} /></div>;
  return (
    <div className="add-monday">
      {state.kind === "error" && <p className="alert" role="alert">{state.text}</p>}
      <button className="secondary" type="button" disabled={state.kind === "loading"} onClick={open}>
        {state.kind === "loading" ? "Checking Monday…" : "New Property Lead"}
      </button>
    </div>
  );
}
