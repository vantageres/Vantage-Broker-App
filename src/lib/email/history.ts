import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { HISTORY_LINE_PROMPT } from "./prompts/history-line";
import { capWords } from "./schedule";
import type { MailMessage } from "./source";

// History lines (spec 02 step 5): for up to 15 High and Normal threads a run,
// Highs first, code fetches up to 10 earlier messages in the conversation
// from the last 90 days and Claude writes one line. Others say
// "History: not checked this run." Server only.

export const HISTORY_MAX_THREADS = 15;
export const HISTORY_MAX_MESSAGES = 10;
export const HISTORY_DAYS = 90;
export const NOT_CHECKED = "History: not checked this run.";

export const HistoryAnswer = z.object({ lines: z.array(z.object({ thread_id: z.string(), history: z.string() })) });

export interface HistoryAsk {
  thread_id: string;
  summary: string;
  earlier: { from: string; date: string; preview: string }[];
}

export interface Historian {
  (asks: HistoryAsk[]): Promise<Record<string, string>>;
}

export function earlierFor(thread: { conversationId: string; messages: MailMessage[] }, conversation: MailMessage[], summary: string): HistoryAsk {
  const now = new Set(thread.messages.map((m) => m.id));
  const earlier = conversation.filter((m) => !now.has(m.id)).slice(-HISTORY_MAX_MESSAGES).map((m) => ({
    from: m.folder === "sent" ? "the broker" : m.from.name || m.from.address,
    date: m.at.slice(0, 10),
    preview: m.preview.replace(/\s+/g, " ").trim().slice(0, 300),
  }));
  return { thread_id: thread.conversationId, summary, earlier };
}

const clean = (answer: z.infer<typeof HistoryAnswer>, asks: HistoryAsk[]) => {
  const wanted = new Set(asks.map((a) => a.thread_id));
  const out: Record<string, string> = {};
  for (const l of answer.lines) if (wanted.has(l.thread_id) && l.history.trim() && !out[l.thread_id]) out[l.thread_id] = capWords(l.history);
  return out;
};

export function claudeHistorian(client: Anthropic): Historian {
  return async (asks) => {
    if (!asks.length) return {};
    const response = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(HistoryAnswer) },
      system: HISTORY_LINE_PROMPT,
      messages: [{ role: "user", content: `Threads (JSON):\n${JSON.stringify(asks)}` }],
    });
    if (!response.parsed_output) return {}; // a missing line shows "not checked"; the run still saves
    return clean(response.parsed_output, asks);
  };
}

// Development: saved lines (DEV_HISTORY_FILE), keyed by thread id.
export function savedHistorian(path: string): Historian {
  return async (asks) => clean(HistoryAnswer.parse(JSON.parse(await readFile(path, "utf8"))), asks);
}
