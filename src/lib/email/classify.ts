import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { CLASSIFY_THREADS_PROMPT } from "./prompts/classify-threads";
import type { Known } from "./people";
import type { Thread } from "./threads";

// Step 4 of the monitor: Claude sorts and summarizes new threads. No tools:
// email text goes in as data, and the answer is checked in code (the
// schema's x-validated-in-code rules) before anything is shown.

const PROPOSABLE_BINS = ["Client", "Prospect", "Outside Broker", "Attorney", "Lender", "Title and Escrow", "Appraiser or Inspector", "Vendor", "Personal", "Lead Source", "Noise"] as const;
const CONTACT_TYPES = ["Property Owner", "Leasee", "Buyer", "Broker", "Ask"] as const;
const LEAD_SOURCES = ["Costar/LoopNet", "Crexi", "Website", "Sign", "Referral", "Phone", "Personal Contact", "Business Development", "Social", "Cold Call", "Not Set"] as const;

const ThreadAnswer = z.object({
  thread_id: z.string(),
  group: z.enum(["deal", "leads", "other", "internal_broker", "internal_staff"]),
  deal_id: z.string().nullable(),
  internal: z.boolean(),
  importance: z.enum(["high", "normal", "fyi", "noise"]),
  title: z.string(),
  what: z.string(),
  priority: z.string().nullable(),
  waiting: z.string().nullable(),
  dates: z.array(z.object({ date: z.string(), what: z.string() })),
  new_contacts: z.array(z.object({
    name: z.string().nullable(),
    email: z.string(),
    company: z.string().nullable(),
    proposed_bin: z.enum(PROPOSABLE_BINS),
    related_deal_id: z.string().nullable(),
    confidence: z.enum(["high", "low"]),
  })),
  lead: z.object({
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    company: z.string().nullable(),
    asked_about: z.string().nullable(),
    proposed_contact_type: z.enum(CONTACT_TYPES),
    proposed_source: z.enum(LEAD_SOURCES),
  }).nullable(),
});

export const Classification = z.object({ threads: z.array(ThreadAnswer) });
export type ThreadAnswer = z.infer<typeof ThreadAnswer>;

export interface Deal {
  id: string;
  name: string;
}

export interface ClassifyInput {
  brokerName: string;
  today: string; // YYYY-MM-DD, US Eastern
  deals: Deal[];
  threads: Thread[];
  known: Map<string, Known>;
}

const MAX_TEXT = 1500; // characters per message sent to Claude
const MAX_MESSAGES = 6; // latest messages per thread
export const THREADS_PER_CALL = 20;

// What Claude sees for one thread: names, addresses, bins, dates and the
// trimmed new text of each message. No attachments, no headers.
export function threadForModel(t: Thread, known: Map<string, Known>, bodies: Record<string, string>) {
  return {
    thread_id: t.conversationId,
    subject: t.subject,
    participants: t.participants.map((p) => ({ name: p.name, email: p.address, bin: known.get(p.address)?.bin ?? null })),
    messages: t.messages.slice(-MAX_MESSAGES).map((m) => ({
      from: m.folder === "sent" ? "the broker" : `${m.from.name} <${m.from.address}>`,
      to: m.to.map((p) => p.address),
      date: m.at,
      text: (bodies[m.id] ?? m.preview ?? "").replace(/\s+\n/g, "\n").trim().slice(0, MAX_TEXT),
    })),
    broker_replied_after_latest: !!t.brokerRepliedAt,
  };
}

export class ClassifyProblem extends Error {}

export interface Classifier {
  (input: ClassifyInput, bodies: Record<string, string>): Promise<ThreadAnswer[]>;
}

export function claudeClassifier(client: Anthropic): Classifier {
  return async (input, bodies) => {
    const out: ThreadAnswer[] = [];
    for (let i = 0; i < input.threads.length; i += THREADS_PER_CALL) {
      const batch = input.threads.slice(i, i + THREADS_PER_CALL);
      const payload = { deals: input.deals, threads: batch.map((t) => threadForModel(t, input.known, bodies)) };
      const response = await client.beta.messages.parse({
        model: "claude-opus-5-5",
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(Classification) },
        system: CLASSIFY_THREADS_PROMPT.replace("{{broker_name}}", input.brokerName).replace("{{today}}", input.today),
        messages: [{ role: "user", content: `Input (JSON):\n${JSON.stringify(payload)}` }],
      });
      if (response.stop_reason === "refusal") throw new ClassifyProblem("Claude declined to sort this mail.");
      if (!response.parsed_output) throw new ClassifyProblem(`Claude did not return a readable answer (stop reason: ${response.stop_reason}).`);
      out.push(...response.parsed_output.threads);
    }
    return out;
  };
}

// Development: answers saved in a file (DEV_CLASSIFICATION_FILE), keyed by
// thread id, used instead of calling Claude. Threads with no saved answer
// come back missing and are shown as FYI by subject, as a real gap would be.
export function savedClassifier(path: string): Classifier {
  return async (input) => {
    const saved = Classification.parse(JSON.parse(await readFile(path, "utf8")));
    const wanted = new Set(input.threads.map((t) => t.conversationId));
    return saved.threads.filter((t) => wanted.has(t.thread_id));
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// The schema's rules checked in code. Every thread gets exactly one answer:
// unknown ids are dropped, missing ones become FYI titled by their subject.
export function checkAnswers(threads: Thread[], answers: ThreadAnswer[], deals: Deal[]): (ThreadAnswer & { checked: string[] })[] {
  const dealIds = new Set(deals.map((d) => d.id));
  const byId = new Map<string, ThreadAnswer>();
  for (const a of answers) if (!byId.has(a.thread_id)) byId.set(a.thread_id, a);
  return threads.map((t) => {
    const a = byId.get(t.conversationId);
    const checked: string[] = [];
    if (!a) {
      return {
        thread_id: t.conversationId, group: "other", deal_id: null, internal: false, importance: "fyi",
        title: t.subject || "(no subject)", what: "Not sorted this run.", priority: null, waiting: null,
        dates: [], new_contacts: [], lead: null, checked: ["missing"],
      };
    }
    const fixed: ThreadAnswer = { ...a, dates: a.dates.filter((d) => ISO_DATE.test(d.date)).sort((x, y) => x.date.localeCompare(y.date)) };
    if (fixed.group === "deal" && (!fixed.deal_id || !dealIds.has(fixed.deal_id))) {
      fixed.group = "other";
      fixed.deal_id = null;
      checked.push("unknown deal");
    }
    if (fixed.group !== "deal") fixed.deal_id = null;
    if ((fixed.importance === "high" || fixed.importance === "normal") && !fixed.priority?.trim()) {
      fixed.priority = "Read and decide what is needed.";
      checked.push("no action given");
    }
    if (fixed.importance === "fyi" || fixed.importance === "noise") fixed.priority = null;
    if (fixed.group === "leads" && !fixed.lead) {
      fixed.group = "other";
      checked.push("lead without a person");
    }
    if (fixed.group !== "leads") fixed.lead = null;
    // Proposals only for outside people the app doesn't already know.
    const participants = new Set(t.participants.map((p) => p.address));
    fixed.new_contacts = fixed.new_contacts.filter((c) => participants.has(c.email.toLowerCase()) && !/@(vantageres|vantagepm)\.com$/i.test(c.email));
    return { ...fixed, checked };
  });
}
