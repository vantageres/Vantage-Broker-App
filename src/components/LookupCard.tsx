import type { LookupAnswer } from "@/lib/lookup/details";
import { Out } from "./icons";

const WHEN = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", year: "numeric" });
const when = (iso: string) => WHEN.format(new Date(iso));

// Phone numbers and emails open the phone's own dialer and mail app.
function telHref(shown: string): string | null {
  const digits = shown.replace(/\D/g, "");
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`;
  return digits.length >= 7 ? `tel:${shown.trim().startsWith("+") ? "+" : ""}${digits}` : null;
}

function FieldValue({ label, value }: { label: string; value: string }) {
  if (label === "Phone") {
    const href = telHref(value);
    return href ? <a href={href}>{value}</a> : <>{value}</>;
  }
  if (label === "Email") {
    // A field can hold more than one address; each gets its own link.
    const parts = value.split(/([^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+)/);
    return <>{parts.map((part, i) => (i % 2 ? <a key={i} href={`mailto:${part}`}>{part}</a> : part))}</>;
  }
  return <>{value}</>;
}

// A Monday record as it stands, read only. Shows only what Monday holds.
export function LookupCard({ answer }: { answer: LookupAnswer }) {
  const brokers = [answer.contactBroker || "No Contact Broker", answer.coBrokers && `Co-Broker: ${answer.coBrokers}`].filter(Boolean).join(" · ");
  return (
    <article className="card lookup" aria-label={`${answer.boardLabel} ${answer.name}`}>
      <div className="card-head">
        <div>
          <div className="title">{answer.name}</div>
          <div className="inline-msg">{brokers}</div>
        </div>
        <span className="chip">{answer.boardLabel.toUpperCase()}</span>
      </div>
      <div className="rows">
        {answer.fields.map((f) => (
          <div className="row lookup-row" key={f.label}>
            <span className="row-label">{f.label}</span>
            <span className="row-value"><FieldValue label={f.label} value={f.value} /></span>
          </div>
        ))}
        {answer.fields.length === 0 && <p className="inline-msg">No requirement or contact details in Monday yet.</p>}
      </div>
      <section className="lookup-section">
        <h3>Latest notes</h3>
        {answer.notesIncomplete && (
          <p className="inline-msg bad">Some notes couldn&apos;t be read from Monday, so this list may be missing some. ({answer.problems.join("; ")})</p>
        )}
        {answer.notes.length === 0 ? (
          !answer.notesIncomplete && <p className="inline-msg">No notes in Monday yet.</p>
        ) : (
          <ul className="lookup-notes">
            {answer.notes.map((n, i) => (
              <li key={i}>
                <span className="meta">{when(n.at)}{n.by ? ` · ${n.by}` : ""} · {n.kind}</span>
                <span className="text">{n.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {answer.propertiesUnknown && (
        <section className="lookup-section"><p className="inline-msg bad">Linked properties couldn&apos;t be read from Monday.</p></section>
      )}
      {answer.properties.length > 0 && (
        <section className="lookup-section">
          <h3>Linked properties</h3>
          <ul className="lookup-props">
            {answer.properties.map((p) => (
              <li key={p.url}><a href={p.url} target="_blank" rel="noreferrer">{p.name} <Out /></a></li>
            ))}
          </ul>
        </section>
      )}
      <div className="lookup-foot">
        <span>Updated {when(answer.updatedAt)}</span>
        <a className="open" href={answer.url} target="_blank" rel="noreferrer">Open in Monday <Out /></a>
      </div>
    </article>
  );
}
