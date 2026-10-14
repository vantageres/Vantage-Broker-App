import type { LookupAnswer } from "@/lib/lookup/details";
import { Out } from "./icons";

const WHEN = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", year: "numeric" });
const when = (iso: string) => WHEN.format(new Date(iso));

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
            <span className="row-value">{f.value}</span>
          </div>
        ))}
        {answer.fields.length === 0 && <p className="inline-msg">No requirement or contact details in Monday yet.</p>}
      </div>
      <section className="lookup-section">
        <h3>Latest notes</h3>
        {answer.notes.length === 0 ? (
          <p className="inline-msg">No notes in Monday yet.</p>
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
