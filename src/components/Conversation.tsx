"use client";

import { useEffect, useRef, useState } from "react";
import { shrinkPhoto, type ShrunkPhoto } from "@/lib/photo-client";
import type { PhotoReport } from "@/lib/capture/extract";
import type { Proposal } from "@/lib/capture/proposal";
import type { LookupResult } from "@/lib/capture/service";
import type { LookupAnswer } from "@/lib/lookup/details";
import type { SummaryPoint } from "@/lib/lookup/summary";
import type { PropertyHit } from "@/lib/property/search";
import type { PropertyLeadView } from "@/lib/property-leads/board";
import { isQuestion } from "@/lib/lookup/question";
import { propertyIntro } from "@/lib/property/intro";
import { ProposalCard } from "./ProposalCard";
import { LookupCard } from "./LookupCard";
import { PropertyCard } from "./PropertyCard";
import { PropertyLeadCard } from "./PropertyLeadCard";
import { SummaryCard } from "./SummaryCard";
import { Camera, Close, Out, Send } from "./icons";

type Entry =
  | { id: number; kind: "me"; text: string; photos?: ShrunkPhoto[] }
  | { id: number; kind: "app"; text: string; retry?: string; retryPhotos?: ShrunkPhoto[]; asNote?: string; more?: Listed[] }
  | { id: number; kind: "pending"; text: string }
  | { id: number; kind: "proposal"; proposal: Proposal; photos?: ShrunkPhoto[]; attachByDefault?: boolean }
  | { id: number; kind: "answer"; answer: LookupAnswer }
  | { id: number; kind: "property"; hit: PropertyHit }
  | { id: number; kind: "lead"; lead: PropertyLeadView }
  | { id: number; kind: "summary"; points: SummaryPoint[]; recordsRead: number };

type Listed = { name: string; url: string; boardLabel: string };

const NOTHING_FOUND = "I didn't find a Lead or Contact in Monday that matches. You can ask about a person or business by name, about properties (“retail around 2,000 sf in Haddonfield”), or across requirements (“Who is looking near Mount Laurel?”).";

type Mode = "auto" | "note";

let nextId = 1;

export function Conversation({ firstName }: { firstName: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // Photos waiting to be sent: a business card's front, and optionally its back.
  const [photos, setPhotos] = useState<ShrunkPhoto[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  // On a phone, the keyboard's microphone is how to talk instead of type.
  const [onPhone, setOnPhone] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent;
    setOnPhone(/iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1));
  }, []);
  const end = useRef<HTMLDivElement>(null);

  // Block body on purpose: newer Chrome returns a promise from scrollIntoView,
  // and React would treat a returned value as the effect's cleanup function.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries]);

  async function addPhotos(files: FileList | null) {
    setPhotoError(null);
    const chosen = [...(files ?? [])].slice(0, 2 - photos.length);
    try {
      const shrunk = await Promise.all(chosen.map(shrinkPhoto));
      setPhotos((p) => [...p, ...shrunk].slice(0, 2));
    } catch (err) {
      setPhotoError((err as Error).message);
    }
    if (picker.current) picker.current.value = "";
  }

  async function send(note: string, echo = true, mode: Mode = "auto", withPhotos: ShrunkPhoto[] = []) {
    if ((!note.trim() && !withPhotos.length) || busy) return;
    // A message with a photo is always read as a note, never as a question.
    const asking = mode === "auto" && !withPhotos.length && isQuestion(note);
    setBusy(true);
    const pendingId = nextId++;
    setEntries((e) => [
      ...e,
      ...(echo ? [{ id: nextId++, kind: "me" as const, text: note, photos: withPhotos.length ? withPhotos : undefined }] : []),
      { id: pendingId, kind: "pending", text: asking ? "Looking in Monday…" : withPhotos.length ? "Reading the photo…" : "Reading your note…" },
    ]);
    setText("");
    setPhotos([]);
    if (asking) {
      await ask(note, pendingId);
      setBusy(false);
      return;
    }
    try {
      const res = await fetch("/api/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note, photos: withPhotos.map(({ data, mediaType }) => ({ data, mediaType })) }),
      });
      const data = (await res.json().catch(() => ({}))) as { proposals?: Proposal[]; photo?: PhotoReport | null; error?: string };
      if (res.status === 401) {
        window.location.href = "/signin";
        return;
      }
      if (!res.ok || !data.proposals) throw new Error(data.error ?? "Something went wrong.");
      const proposals = data.proposals;
      const unreadable = data.photo?.unreadable;
      setEntries((e) => [
        ...e.filter((x) => x.id !== pendingId),
        proposals.length
          ? { id: nextId++, kind: "app", text: proposals.length > 1 ? `${proposals.length} people in this note. Each has its own changes.` : "Here's what I'll save. Tap a value to change it." }
          : unreadable
            ? { id: nextId++, kind: "app", text: `I couldn't read the photo clearly (${unreadable}). Try again in good light, with the card flat and filling the frame. Nothing was saved.` }
            : { id: nextId++, kind: "app", text: withPhotos.length ? "I didn't find a person in that photo, so there's nothing to save." : "I didn't find a person in that note, so there's nothing to save." },
        // The photos go with each proposal, to attach to Files on approval.
        ...proposals.map((proposal) => ({
          id: nextId++, kind: "proposal" as const, proposal,
          photos: withPhotos.length ? withPhotos : undefined, attachByDefault: proposals.length === 1,
        })),
      ]);
    } catch (err) {
      setEntries((e) => [
        ...e.filter((x) => x.id !== pendingId),
        { id: nextId++, kind: "app", text: `${(err as Error).message} Nothing was saved.`, retry: note, retryPhotos: withPhotos.length ? withPhotos : undefined },
      ]);
    } finally {
      setBusy(false);
    }
  }

  // Read only: shows what Monday holds, and says so when it holds nothing.
  async function ask(question: string, pendingId: number) {
    const done = (...add: Entry[]) => setEntries((e) => [...e.filter((x) => x.id !== pendingId), ...add]);
    try {
      const res = await fetch("/api/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
      const data = (await res.json().catch(() => ({}))) as Partial<LookupResult> & { error?: string };
      if (res.status === 401) {
        window.location.href = "/signin";
        return;
      }
      if (!res.ok || !data.kind) throw new Error(data.error ?? "Something went wrong.");
      const result = data as LookupResult;

      if (result.kind === "properties") {
        const p = result.for;
        done(
          {
            id: nextId++, kind: "app", text: propertyIntro(result), asNote: question,
            // A person's requirement links to their record.
            more: p ? [{ name: p.name, url: p.url, boardLabel: p.boardLabel }] : undefined,
          },
          ...result.hits.map((hit) => ({ id: nextId++, kind: "property" as const, hit })),
          ...(result.more.length ? [{ id: nextId++, kind: "app" as const, text: "Also matching:", more: result.more }] : []),
        );
        return;
      }

      if (result.kind === "summary") {
        done(result.points.length
          ? { id: nextId++, kind: "summary", points: result.points, recordsRead: result.recordsRead }
          : { id: nextId++, kind: "app", text: `No Lead or Contact in Monday answers that. I read all ${result.recordsRead} with requirements.`, asNote: question });
        return;
      }

      if (result.kind === "propertyLeads") {
        done(
          { id: nextId++, kind: "app", text: result.leads.length === 1 ? "Here's the Property Lead. Its brokers can tap a value to change it." : `${result.leads.length} Property Leads match.`, asNote: question },
          ...result.leads.map((lead) => ({ id: nextId++, kind: "lead" as const, lead })),
        );
        return;
      }

      const { answers, more, partial } = result;
      const total = answers.length + more.length;
      if (total === 0) {
        done({ id: nextId++, kind: "app", text: NOTHING_FOUND, asNote: question });
        return;
      }
      const intro = total === 1
        ? partial ? `One record partly matches. Here's what Monday has.` : "Here's what Monday has."
        : `${total} records ${partial ? "partly match" : "match"}.${more.length ? ` The first ${answers.length} are below.` : ""}`;
      done(
        { id: nextId++, kind: "app", text: intro, asNote: question },
        ...answers.map((answer) => ({ id: nextId++, kind: "answer" as const, answer })),
        ...(more.length ? [{ id: nextId++, kind: "app" as const, text: "Also matching:", more }] : []),
      );
    } catch (err) {
      done({ id: nextId++, kind: "app", text: (err as Error).message, retry: question });
    }
  }

  function replace(id: number, proposal: Proposal) {
    // A picked match keeps the photos that came with the note.
    setEntries((e) => e.map((x) => (x.id === id && x.kind === "proposal" ? { ...x, id: nextId++, proposal } : x)));
  }

  return (
    <>
      <main className="thread" aria-live="polite">
        {entries.length === 0 && (
          <p className="empty">Hi {firstName}. Type what happened, and I&apos;ll propose the changes for Monday. Nothing is saved until you approve. You can also ask what Monday has on someone, search properties, or ask who is looking for what.
            {onPhone && <span className="tip">Tip: tap the microphone on your keyboard to talk instead of typing.</span>}
          </p>
        )}
        {entries.map((entry) => {
          switch (entry.kind) {
            case "me":
              return (
                <div key={entry.id} className="bubble me">
                  {entry.photos && (
                    <span className="bubble-photos">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {entry.photos.map((p, i) => <img key={i} src={p.preview} alt={i ? "Back of the photo" : "Photo"} />)}
                    </span>
                  )}
                  {entry.text}
                </div>
              );
            case "pending":
              return <div key={entry.id} className="bubble app pending">{entry.text}</div>;
            case "app":
              return (
                <div key={entry.id} className="bubble app">
                  {entry.text}
                  {entry.more && (
                    <ul className="more-list">
                      {entry.more.map((m) => (
                        <li key={m.url}><a href={m.url} target="_blank" rel="noreferrer">{m.name} <span className="chip" style={{ fontSize: 11, padding: "2px 8px" }}>{m.boardLabel.toUpperCase()}</span> <Out /></a></li>
                      ))}
                    </ul>
                  )}
                  {entry.retry && (
                    <div><button className="small-btn" style={{ marginTop: 8 }} onClick={() => send(entry.retry!, false, "auto", entry.retryPhotos)}>Try again</button></div>
                  )}
                  {entry.asNote && (
                    <div><button className="link-btn" disabled={busy} onClick={() => send(entry.asNote!, false, "note")}>Read it as a note instead</button></div>
                  )}
                </div>
              );
            case "answer":
              return <LookupCard key={entry.id} answer={entry.answer} />;
            case "property":
              return <PropertyCard key={entry.id} hit={entry.hit} />;
            case "lead":
              return <PropertyLeadCard key={entry.id} lead={entry.lead} />;
            case "summary":
              return <SummaryCard key={entry.id} points={entry.points} recordsRead={entry.recordsRead} />;
            case "proposal":
              return <ProposalCard key={entry.id} proposal={entry.proposal} photos={entry.photos} attachByDefault={entry.attachByDefault} onReplace={(p) => replace(entry.id, p)} />;
          }
        })}
        <div ref={end} />
      </main>
      <div className="composer-wrap">
        {(photos.length > 0 || photoError) && (
          <div className="photo-tray">
            {photos.map((p, i) => (
              <span className="photo-thumb" key={i}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.preview} alt={i ? "Back" : "Front"} />
                <button type="button" aria-label={`Remove the ${i ? "back" : "front"}`} onClick={() => setPhotos((all) => all.filter((_, j) => j !== i))}><Close /></button>
              </span>
            ))}
            {photos.length === 1 && (
              <button type="button" className="link-btn" onClick={() => picker.current?.click()}>Add the back (optional)</button>
            )}
            {photoError && <p className="inline-msg bad" role="alert">{photoError}</p>}
          </div>
        )}
        <form className="composer" onSubmit={(e) => { e.preventDefault(); send(text, true, "auto", photos); }}>
          {/* The phone offers Take Photo or Photo Library; a computer opens a file picker. */}
          <input ref={picker} type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
          <button className="round-btn camera" type="button" aria-label="Add a photo" disabled={busy || photos.length >= 2} onClick={() => picker.current?.click()}><Camera /></button>
          <label>
            <span className="sr-only">Message</span>
            <textarea
              rows={1}
              value={text}
              placeholder={photos.length ? "Add a note (optional)…" : "Notes or a question…"}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(min-width: 900px)").matches) {
                  e.preventDefault();
                  send(text, true, "auto", photos);
                }
              }}
            />
          </label>
          <button className="round-btn send" type="submit" aria-label="Send" disabled={(!text.trim() && !photos.length) || busy}><Send /></button>
        </form>
        <p className="composer-hint">Enter to send · Shift + Enter for a new line</p>
      </div>
    </>
  );
}
