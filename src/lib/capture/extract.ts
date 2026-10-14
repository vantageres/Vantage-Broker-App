import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { CONTACT_TYPES, PROPERTY_TYPES, SOURCES } from "../monday/boards";

export const UNCERTAIN_FIELDS = [
  "name", "business_name", "phones", "emails", "contact_type", "property_types", "size",
  "budget", "desired_location", "follow_up_date", "source", "other",
] as const;

// What Claude reads out of a broker's note. Claude only extracts; matching,
// permissions, and fit rules are applied in code afterwards.
export const ExtractedPerson = z.object({
  name: z.string().nullable().describe("Person's name as written, or null if no person is named"),
  business_name: z.string().nullable(),
  title: z.string().nullable(),
  phones: z.array(z.string()).describe("Phone numbers exactly as written"),
  emails: z.array(z.string()),
  contact_type: z.enum(CONTACT_TYPES).nullable()
    .describe("Leasee = wants to lease space; Buyer = wants to buy; Property Owner = owns property; Broker = another broker"),
  property_types: z.array(z.enum(PROPERTY_TYPES)),
  size: z.string().nullable()
    .describe('Size requirement written out in full, e.g. "15,000 to 20,000 sf" or "2 acres"'),
  budget: z.number().nullable()
    .describe("A single total dollar amount only. Null for rent per square foot, ranges, or anything else"),
  desired_location: z.string().nullable()
    .describe('One place, written so it can be found on a map, e.g. "I-295, NJ" or "Mount Laurel, NJ"'),
  extra_locations: z.array(z.string()).describe("Any further areas beyond the first"),
  follow_up_phrase: z.string().nullable()
    .describe("The broker's own words about when to follow up, if any"),
  follow_up_date: z.string().nullable()
    .describe("YYYY-MM-DD only when the broker gave a specific day. Null for a month, quarter, or vague time"),
  source: z.enum(SOURCES).nullable().describe("How the broker met this person, only if stated"),
  requirement_notes: z.string().nullable()
    .describe("One short line with requirement details that have no field: rent per sf, budget ranges, lease end dates, extra areas, timing"),
  properties_mentioned: z.array(z.string()),
  uncertain: z.array(z.object({
    field: z.enum(UNCERTAIN_FIELDS),
    question: z.string().describe("One short question to ask the broker, ending in a question mark"),
  })).describe("Anything you could not read with confidence. Never guess a value; ask about it here instead"),
});

export const Extraction = z.object({
  people: z.array(ExtractedPerson),
});

export type ExtractedPerson = z.infer<typeof ExtractedPerson>;
export type Extraction = z.infer<typeof Extraction>;

const SYSTEM = `You read notes that commercial real estate brokers at Vantage write after meeting or talking with someone. Extract each person mentioned into the schema.

Rules:
- Use only what the note says. Never invent or infer a phone number, email, date, or amount.
- One entry per person. If the note covers several people, return several entries.
- Budget is a single total dollar amount. Rent per square foot, price ranges, and lease terms go in requirement_notes instead.
- desired_location holds one place. Put any further areas in extra_locations.
- Highway numbers in New Jersey are usually interstates or routes: "295" means I-295, "73" means Route 73.
- Write sizes out in full: "15 to 20k sf" becomes "15,000 to 20,000 sf".
- follow_up_date is only for a specific day. "March", "next quarter", or "in a few weeks" leave it null and keep the words in follow_up_phrase.
- If something is unclear (a garbled number, an ambiguous day, lease versus buy), leave that field empty and add one question to uncertain rather than choosing. Do not add a question just because only a first name was given; the app handles matching.`;

// Opus 5.5 is the default. Sonnet 5.5 and Haiku 5.5 are being compared for
// speed and accuracy (see docs/build-plan.md).
export const CAPTURE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export type CaptureModel = (typeof CAPTURE_MODELS)[number];

export async function extractPeople(
  client: Anthropic,
  note: string,
  today: string,
  model: CaptureModel = "claude-opus-5-5",
): Promise<Extraction> {
  // Haiku has no server-side fallback; a declined note is simply reported.
  const fallback = model === "claude-haiku-5-5"
    ? {}
    : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
  const response = await client.beta.messages.parse({
    model,
    max_tokens: 16000,
    ...fallback,
    output_config: { effort: "medium", format: betaZodOutputFormat(Extraction) },
    system: SYSTEM,
    messages: [{ role: "user", content: `Today is ${today}.\n\nBroker's note:\n${note}` }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined to read this note (${response.stop_details?.category ?? "no category"})`);
  }
  if (!response.parsed_output) {
    throw new Error(`Claude did not return a readable result (stop reason: ${response.stop_reason})`);
  }
  return response.parsed_output;
}
