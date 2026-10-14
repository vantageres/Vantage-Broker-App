import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { CONTACT_TYPES, PROPERTY_TYPES, SOURCES } from "../monday/boards";

export const UNCERTAIN_FIELDS = [
  "name", "business_name", "phones", "emails", "contact_type", "property_types", "size",
  "budget", "desired_location", "follow_up_date", "source", "address", "other",
] as const;

// What Claude reads out of a broker's note. Claude only extracts; matching,
// permissions, and fit rules are applied in code afterwards.
export const ExtractedPerson = z.object({
  name: z.string().nullable().describe("Person's name as written, or null if no person is named"),
  business_name: z.string().nullable(),
  title: z.string().nullable().describe("Job title, e.g. from a business card"),
  address: z.string().nullable()
    .describe("The person's or business's street address as written, e.g. from a business card. Not where they want space"),
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
  location_is_addition: z.boolean()
    .describe('True when the note adds desired_location to areas already being considered ("also near Route 73"), false when it replaces them or is the only area'),
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

// Only when photos were sent: what they show, and whether they could be read.
export const PhotoReport = z.object({
  kind: z.enum(["business_card", "sign", "other"]),
  unreadable: z.string().nullable()
    .describe("When the photo can't be read well enough to use, a short reason for the broker (blurry, too dark, cut off). Null when it was read"),
  sign: z.object({
    listing: z.string().nullable().describe('What the sign offers, in one short line, e.g. "For Lease, 5,000 sf retail, $18/sf"'),
    address: z.string().nullable().describe("A street address printed on the sign, if any"),
  }).nullable().describe("Only for a sign; null otherwise"),
});

export const Extraction = z.object({
  people: z.array(ExtractedPerson),
  photo: PhotoReport.nullable().describe("Null when no photos were sent"),
});

// A saved extraction (development and the try-capture script), which may
// predate photos and addresses.
export const SavedExtraction = z.object({
  people: z.array(ExtractedPerson.extend({ address: z.string().nullable().optional().transform((a) => a ?? null) })),
  photo: PhotoReport.extend({ sign: PhotoReport.shape.sign.optional().transform((s) => s ?? null) })
    .nullable().optional().transform((p) => p ?? null),
});

export type ExtractedPerson = z.infer<typeof ExtractedPerson>;
export type Extraction = z.infer<typeof Extraction>;
export type PhotoReport = z.infer<typeof PhotoReport>;

// A photo as the phone sent it: already shrunk to a JPEG of about 1,600 pixels.
export interface Photo {
  data: string; // base64, no data: prefix
  mediaType: "image/jpeg" | "image/png" | "image/webp";
}

const SYSTEM = `You read notes that commercial real estate brokers at Vantage write after meeting or talking with someone. Extract each person mentioned into the schema.

Rules:
- Use only what the note says. Never invent or infer a phone number, email, date, or amount.
- One entry per person. If the note covers several people, return several entries.
- Budget is a single total dollar amount. Rent per square foot, price ranges, and lease terms go in requirement_notes instead.
- requirement_notes is only for new details that no other field holds. Never repeat a value that has its own field, and never write filler such as "requirement updated". Leave it null when there is nothing to add.
- A named site, building, or property the person is interested in ("the old Bergen Mill site") is a new detail: put it in requirement_notes as well as properties_mentioned. Only put it in desired_location if it is a town, road, or address that can be found on a map.
- desired_location holds one place. Put any further areas in extra_locations.
- Highway numbers in New Jersey are usually interstates or routes: "295" means I-295, "73" means Route 73.
- Write sizes out in full: "15 to 20k sf" becomes "15,000 to 20,000 sf".
- follow_up_date is only for a specific day. "March", "next quarter", or "in a few weeks" leave it null and keep the words in follow_up_phrase.
- If something is unclear (a garbled number, an ambiguous day, lease versus buy), leave that field empty and add one question to uncertain rather than choosing. Do not add a question just because only a first name was given; the app handles matching.

Notes are often dictated on a phone, so read spoken forms as what they mean:
- Phone numbers said as words: "eight five six, five five five, oh one seven five" is 856-555-0175. "Oh" is zero. Write the digits. If a dictated number doesn't come to 10 digits (or 11 starting with 1), leave it out of phones and ask for it.
- Emails said aloud: "linda at park medical dot com" is linda@parkmedical.com. If the spelling of any part is uncertain (a name heard by sound), leave it out of emails and ask the broker to type it.
- Sizes and money said as words: "fifteen to twenty thousand square feet" is "15,000 to 20,000 sf"; "nine dollars a foot" is $9/sf (rent per square foot, so it goes in requirement_notes); "six hundred fifty thousand" is 650000.
- Dictation can mishear names and words that sound alike. Don't correct a name to one you think is likelier; use it as written.

Photos may come with the note: a business card (one photo, or front and back), a sign, or another image. Read only what is printed.
- A business card is one person: name, title, business_name, phones, emails, and address (the card's street address, never desired_location). Contact type, property types and source are not on a card; leave them empty and don't ask about them.
- Never guess a character. If any digit of a phone number or any letter of an email can't be read with certainty, leave that value out and add a question to uncertain asking the broker to type it or send a clearer photo.
- If the photo can't be read well enough to use at all, set photo.unreadable to a short reason and return no people.
- A sign is one person or company to call: name if a person is named, business_name for the company or brokerage, and the phone numbers. contact_type is Broker when it names a real estate company or agent, Property Owner when it says by owner, otherwise null. What the sign offers (For Lease or For Sale, size, type, price) goes in photo.sign.listing, and a street address on the sign in photo.sign.address. Never put them in desired_location, size or property_types: they describe the property, not what this person wants. Leave source empty; the app sets it.
- Words the broker typed with the photo are a note about the same person.
- Set photo.kind; set photo to null when no photo was sent.`;

// Opus 5.5 is the default. Sonnet 5.5 and Haiku 5.5 are being compared for
// speed and accuracy (see docs/build-plan.md).
export const CAPTURE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export type CaptureModel = (typeof CAPTURE_MODELS)[number];

export async function extractPeople(
  client: Anthropic,
  note: string,
  today: string,
  model: CaptureModel = "claude-opus-5-5",
  photos: Photo[] = [],
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
    messages: [{
      role: "user",
      content: [
        // Sent inline with the request: nothing is stored on Anthropic's side.
        ...photos.map((p) => ({ type: "image" as const, source: { type: "base64" as const, media_type: p.mediaType, data: p.data } })),
        { type: "text" as const, text: `Today is ${today}.\n\n${photos.length ? `${photos.length === 2 ? "Two photos are" : "A photo is"} attached.\n\n` : ""}Broker's note:\n${note || "(no words, only the photo)"}` },
      ],
    }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined to read this note (${response.stop_details?.category ?? "no category"})`);
  }
  if (!response.parsed_output) {
    throw new Error(`Claude did not return a readable result (stop reason: ${response.stop_reason})`);
  }
  return response.parsed_output;
}
