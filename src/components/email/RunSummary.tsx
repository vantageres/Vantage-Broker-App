"use client";

import type { Run, RunItem } from "@/lib/email/run";
import { timeInNewJersey } from "@/lib/time";
import { Out } from "../icons";

// One run's new mail, grouped Leads, Deals, Other, Internal Brokers,
// Internal Staff. Everything from Claude is shown as plain text.

const GROUP_LABEL: Record<RunItem["group"], string> = {
  leads: "Leads",
  deal: "Deals",
  other: "Other",
  internal_broker: "Internal brokers",
  internal_staff: "Internal staff",
};

const NOISE_LABEL: Record<string, string> = {
  receipt: "read and delivery receipts",
  calendar: "calendar notices",
  "auto-reply": "automatic replies",
  notification: "notifications",
  newsletter: "newsletters",
  "your rule": "your noise rules",
  "sorted as noise": "other automated mail",
};

const day = (date: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

function dayAndTime(iso: string) {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(d);
  return `${date}, ${timeInNewJersey(iso)}`;
}

function sections(items: RunItem[]) {
  const out: { key: string; label: string; items: RunItem[] }[] = [];
  for (const item of items) {
    const key = item.group === "deal" ? `deal:${item.dealId}` : item.group;
    let s = out.find((x) => x.key === key);
    if (!s) {
      s = { key, label: item.group === "deal" ? item.dealName ?? "Deal" : GROUP_LABEL[item.group], items: [] };
      out.push(s);
    }
    s.items.push(item);
  }
  return out;
}

function Item({ item }: { item: RunItem }) {
  const due = item.dates[0];
  return (
    <article className="card email-item">
      <div className="card-head">
        <span className="title" style={{ fontSize: 16 }}>{item.num ? <span className="oi-num">#{item.num} </span> : null}{item.title}</span>
        <span className={`chip importance-${item.importance}`}>{item.importance === "fyi" ? "FYI" : item.importance === "high" ? "HIGH" : "NORMAL"}</span>
      </div>
      <div className="email-body">
        <p>{item.what}</p>
        {item.priority && <p><strong>Action:</strong> {item.priority}</p>}
        {item.waiting && <p className="inline-msg">{item.waiting}</p>}
        {due && <p className="inline-msg">Due {day(due.date)}: {due.what}</p>}
        {item.youRepliedAt && <p className="inline-msg">You replied {timeInNewJersey(item.youRepliedAt)}.</p>}
        {item.group === "deal" && item.internal && <p className="inline-msg">Internal</p>}
        {item.lead && (
          <div className="email-lead">
            <span className="kicker">Lead</span>
            <span>{[item.lead.name, item.lead.company].filter(Boolean).join(", ") || "Name not given"}</span>
            {item.lead.email && <a href={`mailto:${item.lead.email}`}>{item.lead.email}</a>}
            {item.lead.phone && <a href={`tel:${item.lead.phone.replace(/[^\d+]/g, "")}`}>{item.lead.phone}</a>}
            {item.lead.asked_about && <span className="inline-msg">Asked about: {item.lead.asked_about}</span>}
            <span className="inline-msg">{item.lead.proposed_contact_type === "Ask" ? "Contact Type unclear" : item.lead.proposed_contact_type} · {item.lead.proposed_source}</span>
          </div>
        )}
        {item.inMonday.map((m) => m && (
          <p key={m.url} className="inline-msg">
            In Monday: <a href={m.url} target="_blank" rel="noreferrer">{m.name}</a> ({m.board}{m.owner ? `, ${m.owner}` : ""})
          </p>
        ))}
      </div>
      {item.webLink && (
        <a className="open-link email-open" href={item.webLink} target="_blank" rel="noreferrer">
          Open in Outlook <Out />
        </a>
      )}
    </article>
  );
}

export function RunSummary({ run }: { run: Run }) {
  const noiseParts = Object.entries(run.noise).filter(([, n]) => n).map(([k, n]) => `${n} ${NOISE_LABEL[k] ?? k}`);
  const groups = sections(run.items);
  let lastGroup = "";
  return (
    <section className="email-run" aria-label="New email">
      <p className="inline-msg" style={{ margin: 0 }}>
        Checked {dayAndTime(run.at)}. Mail since {dayAndTime(run.windowStart)}.
      </p>
      <p className="email-counts">
        <span><strong>{run.counts.high}</strong> High</span>
        <span><strong>{run.counts.normal}</strong> Normal</span>
        <span><strong>{run.counts.fyi}</strong> FYI</span>
        <span><strong>{run.counts.noise}</strong> Noise</span>
      </p>
      {!run.mondayChecked && <p className="alert" role="status">Monday didn&apos;t respond, so people already in Monday aren&apos;t marked this time.</p>}

      {run.items.length === 0 && <p className="empty">Nothing new since {dayAndTime(run.windowStart)}.</p>}

      {groups.map((g) => {
        const groupName = g.key.startsWith("deal:") ? "deal" : g.key;
        const heading = groupName !== lastGroup && groupName === "deal" ? <h2 className="email-group">Deals</h2> : null;
        lastGroup = groupName;
        return (
          <div key={g.key} className="email-section">
            {heading}
            <h2 className={groupName === "deal" ? "email-deal" : "email-group"}>{g.label}</h2>
            {g.items.map((i) => <Item key={i.conversationId} item={i} />)}
          </div>
        );
      })}

      {run.newContacts.length > 0 && (
        <div className="email-section">
          <h2 className="email-group">New contacts</h2>
          <ul className="email-contacts">
            {run.newContacts.map((c) => (
              <li key={c.email}>
                <span>{c.name ?? c.email}{c.company ? `, ${c.company}` : ""}</span>
                <span className="inline-msg">{c.email} · {c.proposedBin}{c.confidence === "low" ? " (not sure)" : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {noiseParts.length > 0 && <p className="inline-msg">Not shown: {noiseParts.join(", ")}.</p>}
    </section>
  );
}
