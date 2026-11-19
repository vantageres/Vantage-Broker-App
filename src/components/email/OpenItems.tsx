"use client";

import { useCallback, useEffect, useState } from "react";
import {
  countsOf, grouped, shortDay, type ItemGroup, type OpenItem, type TapAction,
} from "@/lib/email/open-items";
import { Out } from "../icons";
import { emailFetch } from "./api";

// The Open Items screen (spec 08): everything from email that still needs
// the broker, grouped High, Normal, Past due, Dropping soon, With a
// colleague, Snoozed and Closed. Text from Claude is shown as plain text.

const GROUP_LABEL: Record<ItemGroup, string> = {
  high: "High",
  normal: "Normal",
  pastdue: "Past due",
  dropping: "Dropping soon",
  colleague: "With a colleague",
  snoozed: "Snoozed",
  closed: "Closed",
};

type Filter = "all" | "high" | "normal" | "pastdue" | "dropping" | "closed";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All open" },
  { key: "high", label: "High" },
  { key: "normal", label: "Normal" },
  { key: "pastdue", label: "Past due" },
  { key: "dropping", label: "Dropping" },
  { key: "closed", label: "Closed" },
];

const TAG_TONE: Partial<Record<ItemGroup, string>> = { dropping: "bad", pastdue: "bad", high: "importance-high", closed: "ok" };

export function OpenItems({ refreshKey, lastLine }: { refreshKey: number; lastLine: string | null }) {
  const [items, setItems] = useState<OpenItem[] | null>(null);
  const [today, setToday] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<number | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const [itemMsg, setItemMsg] = useState<{ num: number; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await emailFetch("/api/email/items", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not load your open items.");
      setItems(body.items);
      setToday(body.today);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your open items.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function tap(item: OpenItem, action: TapAction) {
    setSaving(item.num);
    setItemMsg(null);
    try {
      const res = await emailFetch("/api/email/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ num: item.num, action, version: item.version }),
      });
      const body = await res.json();
      if (body.item) setItems((list) => list?.map((i) => (i.num === body.item.num ? body.item : i)) ?? null);
      if (body.today) setToday(body.today);
      if (!res.ok) setItemMsg({ num: item.num, text: body.error ?? "Could not save. Try again." });
    } catch {
      setItemMsg({ num: item.num, text: "Could not save. Try again." });
    } finally {
      setSaving(null);
    }
  }

  if (error) return <p className="alert" role="alert">{error}</p>;
  if (!items) return <p className="empty">Loading your open items…</p>;

  const counts = countsOf(items, today);
  const groups = grouped(items, today);
  const droppingToday = [...groups.values()].flat().filter((x) => x.view.droppingToday);
  const urgent = counts.high + counts.pastdue + counts.dropping;
  const countFor: Record<Filter, number> = { all: counts.open, high: counts.high, normal: counts.normal, pastdue: counts.pastdue, dropping: counts.dropping, closed: counts.closed };
  const shown = [...groups.entries()].filter(([g, list]) =>
    list.length && (filter === "all" ? g !== "closed" : g === filter));

  return (
    <section className="email-run" aria-label="Open items">
      {lastLine && <p className="inline-msg" style={{ margin: 0 }}>{lastLine}</p>}

      {droppingToday.map(({ item }) => (
        <div key={item.num} className="oi-drop" role="alert">
          <div>
            <strong>#{item.num} drops today.</strong> {item.title}. Tap Keep or it leaves the list next business day.
          </div>
          <button className="approve" type="button" disabled={saving === item.num} onClick={() => tap(item, "keep")}>Keep 10 more days</button>
        </div>
      ))}

      <div className="oi-filters" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={filter === f.key} className="oi-filter" onClick={() => setFilter(f.key)}>
            <strong>{countFor[f.key]}</strong>
            {f.label}
          </button>
        ))}
      </div>

      {items.length === 0 && <p className="empty">No open items yet. Check now adds High and Normal email here.</p>}
      {counts.open > 0 && urgent === 0 && filter === "all" && <p className="oi-calm">Nothing urgent. No High, Past due or Dropping items.</p>}
      {items.length > 0 && shown.length === 0 && <p className="empty">Nothing here.</p>}

      {shown.map(([group, list]) => (
        <div key={group} className="email-section">
          <h2 className="email-group">{GROUP_LABEL[group]} <span className="oi-count">{list.length}</span></h2>
          {list.map(({ item, view }) => {
            const expanded = open === item.num;
            const busy = saving === item.num;
            const firstName = item.delegatedTo?.name.split(/\s+/)[0];
            return (
              <article key={item.num} className={`card oi-item${view.droppingToday ? " oi-item-drop" : ""}`}>
                <button type="button" className="oi-row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : item.num)}>
                  <span className="oi-num">#{item.num}</span>
                  <span className="oi-main">
                    <span className="oi-title">{item.title}</span>
                    <span className="oi-sub">{[item.deal ?? "No deal", item.waiting].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="oi-side">
                    {view.tag && <span className={`chip ${TAG_TONE[group] ?? ""}`}>{view.tag}</span>}
                    {item.state === "open" && <span className="oi-age" title="Business days open">{view.age}d</span>}
                  </span>
                </button>
                {item.webLink && !expanded && (
                  <a className="open-link oi-email" href={item.webLink} target="_blank" rel="noreferrer">Email <Out /></a>
                )}
                {expanded && (
                  <div className="email-body">
                    <p>{item.what}</p>
                    {item.action && <p><strong>Action:</strong> {item.action}</p>}
                    <p className="inline-msg">
                      {[item.due && `Due ${shortDay(item.due)}`, `Opened ${shortDay(item.opened)}`, item.delegatedTo && `With ${item.delegatedTo.name}`, item.closedBy && `Closed by ${item.closedBy}`].filter(Boolean).join(" · ")}
                    </p>
                    <ul className="oi-history">
                      {item.history.slice(-5).reverse().map((e, i) => <li key={i}>{shortDay(e.on)} {e.change}</li>)}
                    </ul>
                    {itemMsg?.num === item.num && <p className="alert" role="alert">{itemMsg.text}</p>}
                    <div className="oi-actions">
                      {item.state === "open" ? (
                        <>
                          <button className="approve" type="button" disabled={busy} onClick={() => tap(item, "done")}>{busy ? "Saving…" : "Done"}</button>
                          <button className="secondary" type="button" disabled={busy} onClick={() => tap(item, "finished")}>{firstName ? `${firstName} finished it` : "Colleague handled"}</button>
                          <button className="secondary" type="button" disabled={busy} onClick={() => tap(item, "keep")}>{view.group === "dropping" ? "Keep 10 more days" : "Keep"}</button>
                          {item.importance === "normal" && !item.escalated && (
                            <button className="secondary" type="button" disabled={busy} onClick={() => tap(item, "high")}>Make High</button>
                          )}
                          <button className="secondary" type="button" disabled={busy} onClick={() => tap(item, item.snoozeUntil ? "unsnooze" : "snooze")}>
                            {item.snoozeUntil ? "Unsnooze" : "Snooze 1 day"}
                          </button>
                        </>
                      ) : (
                        <button className="secondary" type="button" disabled={busy} onClick={() => tap(item, "reopen")}>{busy ? "Saving…" : "Reopen"}</button>
                      )}
                    </div>
                    {item.webLink && (
                      <a className="open-link" href={item.webLink} target="_blank" rel="noreferrer">Open email in Outlook <Out /></a>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ))}
    </section>
  );
}

