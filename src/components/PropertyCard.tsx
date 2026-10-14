import type { PropertyHit } from "@/lib/property/search";
import { Out } from "./icons";

const WHEN = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", year: "numeric" });
const when = (iso: string) => WHEN.format(new Date(iso));
// A Monday date ("2027-09-30") is a calendar day: read it at noon so no time zone moves it.
const day = (date: string) => WHEN.format(new Date(`${date}T12:00:00`));
const money = (n: number) => `$${n.toLocaleString("en-US")}`;
const sf = (n: number) => `${n.toLocaleString("en-US")} sf`;

// A property from Properties New or Properties (old), read only, with the
// suites that matched the search. Sensitive fields are never read.
export function PropertyCard({ hit }: { hit: PropertyHit }) {
  const p = hit.property;
  const fields = [
    { label: "Address", value: p.address },
    { label: "Status", value: p.status },
    { label: "Type", value: p.types.join(", ") },
    { label: "Sale or Lease", value: p.deal },
    { label: "Size", value: [p.sqft !== null ? sf(p.sqft) : "", p.acres !== null ? `${p.acres.toLocaleString("en-US")} acres` : ""].filter(Boolean).join(" · ") },
    { label: "Price", value: p.price !== null ? money(p.price) : "" },
    { label: "Lease Type", value: p.leaseType },
  ].filter((f) => f.value);

  return (
    <article className="card lookup" aria-label={`Property ${p.name}`}>
      <div className="card-head">
        <div>
          <div className="title">{p.name}</div>
          <div className="inline-msg">{p.brokers ? `Broker: ${p.brokers}` : "No broker"}</div>
        </div>
        <span className="chip">{p.boardLabel.toUpperCase()}</span>
      </div>
      <div className="rows">
        {fields.map((f) => (
          <div className="row lookup-row" key={f.label}>
            <span className="row-label">{f.label}</span>
            <span className="row-value">{f.value}</span>
          </div>
        ))}
      </div>
      {hit.suites.length > 0 && (
        <section className="lookup-section">
          <h3>{hit.otherSuites ? "Matching suites" : "Suites"}</h3>
          <ul className="lookup-notes">
            {hit.suites.map((s) => (
              <li key={s.id}>
                <span className="meta">{[s.name, s.sqft !== null ? sf(s.sqft) : "size not in Monday", s.type].filter(Boolean).join(" · ")}</span>
                <span className="text">
                  {[s.status || "No status", s.deal, s.leaseValue !== null ? `Lease value ${money(s.leaseValue)}` : "", s.expires ? `Expires ${day(s.expires)}` : ""].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
          {hit.otherSuites > 0 && <p className="inline-msg">{hit.otherSuites} other suite{hit.otherSuites > 1 ? "s" : ""} here didn&apos;t match.</p>}
        </section>
      )}
      <div className="lookup-foot">
        <span>Updated {when(p.updatedAt)}</span>
        <a className="open" href={p.url} target="_blank" rel="noreferrer">Open in Monday <Out /></a>
      </div>
    </article>
  );
}
