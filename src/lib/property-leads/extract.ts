import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { LEAD_PROPERTY_TYPES, LISTING_TYPES } from "./fields";

// What Claude reads out of a note asking for a new Property Lead: the
// property, and the person to contact about it. Matching, permissions and
// value checks happen in code.
//
// Kept small on purpose: a structured answer allows only so many fields that
// can be empty (about 16), and the full person format alone has 13.
export const PropertyLeadDraft = z.object({
  address: z.string().nullable()
    .describe('The property\'s street address as written, with the town, e.g. "140 Main St, Moorestown, NJ". Null if none is given'),
  listing_type: z.enum(LISTING_TYPES.filter((t) => t !== "Not Set") as [string, ...string[]]).nullable()
    .describe("Sale, Lease, or Sale or Lease, only if the note says"),
  property_type: z.enum(LEAD_PROPERTY_TYPES).nullable()
    .describe("Only if the note says. Warehouse or flex space is Industrial/Flex"),
  listing_price: z.string().nullable().describe('The asking price or rent as written, e.g. "$1,800,000" or "$12/sf NNN"'),
  size: z.string().nullable().describe('Size written out in full, e.g. "12,000 sf" or "2.5 acres"'),
  contact: z.object({
    name: z.string().nullable().describe("The contact's name as written, or null if no person is named"),
    business_name: z.string().nullable().describe("The contact's business, if given"),
    phones: z.array(z.string()).describe("Phone numbers exactly as written"),
    emails: z.array(z.string()),
  }).describe("The person to contact about the property (usually the owner). Name and business are null when none is named"),
  uncertain: z.array(z.object({
    field: z.enum(["address", "listing_type", "property_type", "listing_price", "size", "other"]),
    question: z.string().describe("One short question to ask the broker, ending in a question mark"),
  })).describe("Anything about the property you could not read with confidence. Never guess; ask here instead"),
});
export type PropertyLeadDraft = z.infer<typeof PropertyLeadDraft>;


const SYSTEM = `You read a note from a commercial real estate broker at Vantage asking to add a Property Lead: a property an owner may want to sell or lease through Vantage. Extract the property and its contact into the schema.

Rules:
- Use only what the note says. Never invent an address, price, size, phone number or email.
- The address is the property's, written so it can be found on a map. If no town is given, leave the address as written.
- listing_type is Sale, Lease, or Sale or Lease. "Wants to sell" is Sale; "for lease" is Lease.
- Write sizes out in full: "12k sf" becomes "12,000 sf". Keep prices as written.
- The contact is the person to call about the property (usually the owner): their name, business, phones and emails. The property's details describe the property, not the contact.
- If something is unclear, leave it empty and add one question to uncertain rather than choosing.`;

export async function extractPropertyLead(client: Anthropic, note: string, today: string): Promise<PropertyLeadDraft> {
  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(PropertyLeadDraft) },
    system: SYSTEM,
    messages: [{ role: "user", content: `Today is ${today}.\n\nBroker's note:\n${note}` }],
  });
  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined to read this note (${response.stop_details?.category ?? "no category"})`);
  }
  if (!response.parsed_output) throw new Error(`Claude did not return a readable result (stop reason: ${response.stop_reason})`);
  return response.parsed_output;
}
