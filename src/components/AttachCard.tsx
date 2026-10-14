"use client";

import { useState } from "react";
import type { AttachCandidate } from "@/lib/attach";
import type { ShrunkPhoto } from "@/lib/photo-client";
import { Check, Chevron, Lock, Out } from "./icons";

type Status =
  | { kind: "review" }
  | { kind: "working" }
  | { kind: "done"; attached: number }
  | { kind: "failed"; message: string; attached: number }
  | { kind: "cancelled" };

// Attaching photos to a record's Files: pick the record when several match,
// then approve. Only the record's assigned brokers can attach.
export function AttachCard({ photos, candidates }: { photos: ShrunkPhoto[]; candidates: AttachCandidate[] }) {
  const [picked, setPicked] = useState<AttachCandidate | null>(candidates.length === 1 ? candidates[0] : null);
  const [status, setStatus] = useState<Status>({ kind: "review" });
  const what = photos.length === 1 ? "the photo" : `${photos.length} photos`;

  async function attach(from: number) {
    if (!picked) return;
    setStatus({ kind: "working" });
    try {
      const res = await fetch("/api/attach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: picked.target, photos: photos.slice(from).map(({ data, mediaType }) => ({ data, mediaType })) }),
      });
      if (res.status === 401) {
        window.location.href = "/signin";
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { attached?: number; error?: string };
      if (!res.ok) {
        setStatus({ kind: "failed", message: data.error ?? "Something went wrong. Nothing was attached.", attached: from + (data.attached ?? 0) });
        return;
      }
      setStatus({ kind: "done", attached: from + (data.attached ?? 0) });
    } catch {
      setStatus({ kind: "failed", message: "Monday couldn't be reached, so nothing more was attached.", attached: from });
    }
  }

  if (status.kind === "cancelled") return <div className="bubble app">Cancelled. Nothing was attached.</div>;
  if (status.kind === "done" && picked) {
    return (
      <div className="bubble app saved-bubble" role="status">
        <span className="tick"><Check /></span>
        <span>
          Attached {status.attached === 1 ? "the photo" : `${status.attached} photos`} to {picked.name}&apos;s Files.{" "}
          <a className="open" href={picked.url} target="_blank" rel="noreferrer">Open in Monday <Out /></a>
        </span>
      </div>
    );
  }

  const working = status.kind === "working";
  return (
    <article className="card" aria-label="Attach a photo">
      <div className="card-head">
        <div>
          <div className="kicker">Attach to a record</div>
          <div className="title">{picked ? `${picked.name} · ${picked.label}` : "Which record?"}</div>
        </div>
      </div>
      <div className="attach-photos" style={{ paddingTop: 4 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {photos.map((p, i) => <img key={i} src={p.preview} alt={`Photo ${i + 1}`} />)}
      </div>

      {!picked && (
        <div className="candidates">
          {candidates.map((c) => (
            <button key={`${c.target.kind}:${c.target.id}`} className="candidate" onClick={() => setPicked(c)}>
              <span className="c-text">
                <span className="c-name">{c.name}</span>
                <span className="c-detail">{c.label}{c.owner ? ` · ${c.owner}` : ""}</span>
              </span>
              <span className="pencil"><Chevron /></span>
            </button>
          ))}
        </div>
      )}

      {picked && !picked.canAttach && (
        <div className="notice" style={{ borderTop: "1px solid var(--line-soft)" }}>
          <span className="icon"><Lock /></span>
          <span>{picked.why} Only its assigned brokers can attach photos.</span>
        </div>
      )}

      {status.kind === "failed" && (
        <div className="alert" role="alert" style={{ margin: "0 12px 12px" }}>
          {status.message}{status.attached ? ` ${status.attached} of ${photos.length} attached; retry sends the rest.` : ""}
        </div>
      )}

      <div className="card-foot">
        {picked?.canAttach && (
          <button className="approve" disabled={working} onClick={() => attach(status.kind === "failed" ? status.attached : 0)}>
            {working ? "Attaching…" : status.kind === "failed" ? "Retry" : `Attach ${what} to Files`}
          </button>
        )}
        {picked && candidates.length > 1 && !working && <button className="secondary" onClick={() => { setPicked(null); setStatus({ kind: "review" }); }}>Pick another record</button>}
        <button className="secondary" disabled={working} onClick={() => setStatus({ kind: "cancelled" })}>Cancel</button>
      </div>
    </article>
  );
}
