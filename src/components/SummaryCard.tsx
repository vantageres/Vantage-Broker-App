import type { SummaryPoint } from "@/lib/lookup/summary";
import { Out } from "./icons";

// A summary across Leads and Contacts. Every point links to the records it
// comes from; points without a source never reach the screen.
export function SummaryCard({ points, recordsRead }: { points: SummaryPoint[]; recordsRead: number }) {
  return (
    <article className="card lookup" aria-label="Summary">
      <div className="card-head">
        <div>
          <div className="title">Summary</div>
          <div className="inline-msg">From {recordsRead} Leads and Contacts with requirements, read from Monday just now.</div>
        </div>
        <span className="chip">SUMMARY</span>
      </div>
      <ul className="summary-points">
        {points.map((p, i) => (
          <li key={i}>
            <span className="text">{p.text}</span>
            <span className="sources">
              {p.sources.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.name} <span className="chip" style={{ fontSize: 10, padding: "1px 6px" }}>{s.boardLabel.toUpperCase()}</span> <Out /></a>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <div className="lookup-foot">
        <span>Written by Claude from Monday&apos;s records. Check the linked records before acting.</span>
      </div>
    </article>
  );
}
