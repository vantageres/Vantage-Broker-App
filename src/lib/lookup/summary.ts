import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { PersonRecord } from "../monday/records";

// Summaries across Leads and Contacts ("Who is looking near Mount Laurel?").
// Claude sees only requirement fields, names and owners (no phones or
// emails), and must cite a record for every point. Points whose citations
// don't name a real record are dropped in code, so nothing uncited is shown.

const Summary = z.object({
  points: z.array(z.object({
    text: z.string().describe("One short statement, using only what the cited records say"),
    sources: z.array(z.string()).describe("Ids of the records this statement comes from, e.g. [\"R3\", \"R7\"]"),
  })),
  nothing_found: z.boolean().describe("True when no record answers the question"),
});

const SYSTEM = `You answer questions that commercial real estate brokers at Vantage ask about their Leads and Contacts in Monday.com. You are given every record as one line, with an id like R12.

Rules:
- Use only what the records say. Never add facts, estimates or advice.
- Every point cites the ids of the records it comes from. A point with no source is not allowed.
- Keep each point short, one record or one clear group per point. Name the people and businesses.
- Include every record that answers the question, from every broker.
- Read sizes and budgets carefully: "15,000 to 20,000 sf" is under 20k sf only if the whole range is. When a record's value is unclear or missing, say so in its point rather than guessing.
- If no record answers the question, set nothing_found to true and return no points.`;

export interface SummaryPoint {
  text: string;
  sources: { board: "leads" | "contacts"; boardLabel: string; id: string; name: string; url: string }[];
}

export interface SummaryAnswer {
  points: SummaryPoint[];
  recordsRead: number;
}

const field = (label: string, value: string) => (value.trim() ? `${label}: ${value.trim()}` : "");

export function recordLine(r: PersonRecord, ref: string): string {
  const c = r.current;
  return [
    ref, r.board.label, r.name,
    field("Business", r.businessName), field("Status", c.status), field("Contact Type", c.contactType),
    field("Property Type", c.propertyType), field("Size", c.size), field("Budget", c.budget && `$${c.budget}`),
    field("Desired Location", c.desiredLocation), field("Notes", c.notes), field("Follow Up", c.followUp),
    field("Contact Broker", r.contactBrokerNames || "none"), field("Updated", r.updatedAt.slice(0, 10)),
  ].filter(Boolean).join(" | ");
}

export async function summarize(client: Anthropic, question: string, records: PersonRecord[], today: string): Promise<SummaryAnswer> {
  const refs = new Map(records.map((r, i) => [`R${i + 1}`, r]));
  const lines = [...refs].map(([ref, r]) => recordLine(r, ref)).join("\n");
  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(Summary) },
    system: SYSTEM,
    messages: [{ role: "user", content: `Today is ${today}.\n\nRecords:\n${lines}\n\nQuestion: ${question}` }],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined to summarize this.");
  const parsed = response.parsed_output;
  if (!parsed) throw new Error(`Claude did not return a readable summary (stop reason: ${response.stop_reason}).`);
  return { points: cite(parsed, refs), recordsRead: records.length };
}

// Keeps only points that cite at least one real record.
export function cite(parsed: z.infer<typeof Summary>, refs: Map<string, PersonRecord>): SummaryPoint[] {
  if (parsed.nothing_found) return [];
  return parsed.points
    .map((p) => {
      const seen = new Set<string>();
      const sources = p.sources
        .map((s) => refs.get(s.trim().toUpperCase()))
        .filter((r): r is PersonRecord => !!r && !seen.has(r.url) && !!seen.add(r.url))
        .map((r) => ({ board: r.board.key, boardLabel: r.board.label, id: r.id, name: r.name, url: r.url }));
      return { text: p.text.trim(), sources };
    })
    .filter((p) => p.text && p.sources.length > 0);
}
