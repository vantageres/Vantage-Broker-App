"use client";

import { useEffect, useRef, useState } from "react";
import type { Proposal } from "@/lib/capture/proposal";
import { ProposalCard } from "./ProposalCard";
import { Send } from "./icons";

type Entry =
  | { id: number; kind: "me"; text: string }
  | { id: number; kind: "app"; text: string; retry?: string }
  | { id: number; kind: "pending" }
  | { id: number; kind: "proposal"; proposal: Proposal };

let nextId = 1;

export function Conversation({ firstName }: { firstName: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  // Block body on purpose: newer Chrome returns a promise from scrollIntoView,
  // and React would treat a returned value as the effect's cleanup function.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries]);

  async function send(note: string, echo = true) {
    if (!note.trim() || busy) return;
    setBusy(true);
    const pendingId = nextId++;
    setEntries((e) => [...e, ...(echo ? [{ id: nextId++, kind: "me" as const, text: note }] : []), { id: pendingId, kind: "pending" }]);
    setText("");
    try {
      const res = await fetch("/api/capture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) });
      const data = (await res.json().catch(() => ({}))) as { proposals?: Proposal[]; error?: string };
      if (res.status === 401) {
        window.location.href = "/signin";
        return;
      }
      if (!res.ok || !data.proposals) throw new Error(data.error ?? "Something went wrong.");
      const proposals = data.proposals;
      setEntries((e) => [
        ...e.filter((x) => x.id !== pendingId),
        proposals.length
          ? { id: nextId++, kind: "app", text: proposals.length > 1 ? `${proposals.length} people in this note. Each has its own changes.` : "Here's what I'll save. Tap a value to change it." }
          : { id: nextId++, kind: "app", text: "I didn't find a person in that note, so there's nothing to save." },
        ...proposals.map((proposal) => ({ id: nextId++, kind: "proposal" as const, proposal })),
      ]);
    } catch (err) {
      setEntries((e) => [
        ...e.filter((x) => x.id !== pendingId),
        { id: nextId++, kind: "app", text: `${(err as Error).message} Nothing was saved.`, retry: note },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function replace(id: number, proposal: Proposal) {
    setEntries((e) => e.map((x) => (x.id === id ? { id: nextId++, kind: "proposal", proposal } : x)));
  }

  return (
    <>
      <main className="thread" aria-live="polite">
        {entries.length === 0 && (
          <p className="empty">Hi {firstName}. Type what happened, and I&apos;ll propose the changes for Monday. Nothing is saved until you approve.</p>
        )}
        {entries.map((entry) => {
          switch (entry.kind) {
            case "me":
              return <div key={entry.id} className="bubble me">{entry.text}</div>;
            case "pending":
              return <div key={entry.id} className="bubble app pending">Reading your note…</div>;
            case "app":
              return (
                <div key={entry.id} className="bubble app">
                  {entry.text}
                  {entry.retry && (
                    <div><button className="small-btn" style={{ marginTop: 8 }} onClick={() => send(entry.retry!, false)}>Try again</button></div>
                  )}
                </div>
              );
            case "proposal":
              return <ProposalCard key={entry.id} proposal={entry.proposal} onReplace={(p) => replace(entry.id, p)} />;
          }
        })}
        <div ref={end} />
      </main>
      <div className="composer-wrap">
        <form className="composer" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <label>
            <span className="sr-only">Message</span>
            <textarea
              rows={1}
              value={text}
              placeholder="Notes or a question…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(min-width: 900px)").matches) {
                  e.preventDefault();
                  send(text);
                }
              }}
            />
          </label>
          <button className="round-btn send" type="submit" aria-label="Send" disabled={!text.trim() || busy}><Send /></button>
        </form>
        <p className="composer-hint">Enter to send · Shift + Enter for a new line</p>
      </div>
    </>
  );
}
