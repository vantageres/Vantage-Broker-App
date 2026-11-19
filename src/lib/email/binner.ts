import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { readFile } from "node:fs/promises";
import { PROPOSE_BINS_PROMPT } from "./prompts/propose-bins";
import { BinAnswer, forModel, ScanProblem, type Binner } from "./scan";

// Who proposes the contact types in a scan: Claude (no tools, email as data),
// or saved answers in development (DEV_SCAN_FILE). Server only.

export function claudeBinner(client: Anthropic): Binner {
  return async (brokerName, contacts) => {
    const response = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(BinAnswer) },
      system: PROPOSE_BINS_PROMPT.replace("{{broker_name}}", brokerName),
      messages: [{ role: "user", content: `Contacts (JSON):\n${JSON.stringify(contacts.map(forModel))}` }],
    });
    if (response.stop_reason === "refusal") throw new ScanProblem("Claude declined to sort these contacts.");
    if (!response.parsed_output) throw new ScanProblem(`Claude did not return a readable answer (stop reason: ${response.stop_reason}).`);
    return response.parsed_output;
  };
}

// Development: answers saved in a file (DEV_SCAN_FILE), used instead of Claude.
export function savedBinner(path: string): Binner {
  return async (_name, contacts) => {
    const saved = BinAnswer.parse(JSON.parse(await readFile(path, "utf8")));
    const wanted = new Set(contacts.map((c) => c.email));
    return {
      contacts: saved.contacts.filter((c) => wanted.has(c.email.toLowerCase())),
      properties: saved.properties.filter((p) => p.contacts.some((e) => wanted.has(e.toLowerCase()))),
    };
  };
}
