// Run a broker note through the capture pipeline against the Monday test
// boards (or the live ones with MONDAY_BOARDS=live) and print the proposals.
// Reads only; nothing is saved to Monday.
//
//   npm run try-capture -- "Met Dave Reyes at Garrison Foods..."
//   npm run try-capture -- --model claude-sonnet-5-5 "note text"
//   npm run try-capture -- --extraction path/to/extraction.json "note text"
//
// --model picks Opus 5.5 (default), Sonnet 5.5, or Haiku 5.5.
// --extraction skips the Claude call and uses a saved extraction instead.

import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { mondayClient } from "../src/lib/monday/client";
import { BOARDS } from "../src/lib/capture/service";
import { searchPersonRecords } from "../src/lib/monday/records";
import { matchTerms } from "../src/lib/matching";
import { CAPTURE_MODELS, extractPeople, SavedExtraction, type CaptureModel } from "../src/lib/capture/extract";
import { buildProposal, type Proposal } from "../src/lib/capture/proposal";
import { googleGeocoder, resolveLocations } from "../src/lib/geocode";

const args = process.argv.slice(2);
let extractionFile: string | undefined;
let model: CaptureModel = "claude-opus-5-5";
while (args[0]?.startsWith("--")) {
  const [flag, value] = args.splice(0, 2);
  if (flag === "--extraction") extractionFile = value;
  else if (flag === "--model" && (CAPTURE_MODELS as readonly string[]).includes(value)) model = value as CaptureModel;
  else {
    console.error(`Unknown option ${flag} ${value ?? ""}`);
    process.exit(1);
  }
}
const note = args.join(" ").trim();
if (!note) {
  console.error('Usage: npm run try-capture -- [--model id] [--extraction file.json] "note text"');
  process.exit(1);
}

// The app's Claude key is Vantage's own, added to requests to api.anthropic.com
// by the environment's network secret. The placeholder only satisfies the SDK;
// credentials from the surrounding shell are deliberately not used.
function claude() {
  return new Anthropic({ apiKey: process.env.BROKER_APP_ANTHROPIC_KEY ?? "added-by-network-proxy", authToken: null });
}

const today = new Date().toISOString().slice(0, 10);
const monday = mondayClient();

const started = Date.now();
const [{ me, account }, extraction] = await Promise.all([
  monday.query<{ me: { id: string; name: string }; account: { slug: string } }>("{ me { id name } account { slug } }"),
  extractionFile
    ? Promise.resolve(SavedExtraction.parse(JSON.parse(readFileSync(extractionFile, "utf8"))))
    : extractPeople(claude(), note, today, model),
]);
const extractedAt = Date.now();
// Monday is searched for the people Claude found, as the app does.
const terms = matchTerms(extraction.people.map((p) => ({ name: p.name, businessName: p.business_name, phones: p.phones, emails: p.emails })));
const records = (
  await Promise.all(Object.values(BOARDS).map((b) => searchPersonRecords(monday, b, account.slug, terms)))
).flat();
const loadedAt = Date.now();

let proposals = extraction.people.map((p) => buildProposal(p, records, { id: String(me.id), name: me.name }, note, today));

// Map lookup for Desired Location, when a Google Maps key is available.
const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
if (mapsKey) {
  const geocode = googleGeocoder(mapsKey);
  proposals = await Promise.all(proposals.map((p) => resolveLocations(p, geocode)));
} else {
  console.log("(No GOOGLE_MAPS_API_KEY, so Desired Location is not looked up on the map.)");
}
const mappedAt = Date.now();

function print(p: Proposal) {
  console.log(`\n=== ${p.subject} ===`);
  const t = p.target;
  if (t.kind === "new-lead") console.log("Target: new Lead");
  if (t.kind === "existing") console.log(`Target: ${t.record.boardLabel} "${t.record.name}" (matched on ${t.matchedOn.join(", ")}), owner ${t.record.owner || "none"}\n  ${t.record.url}`);
  if (t.kind === "pick") {
    console.log("Target: broker must pick");
    for (const c of t.candidates) {
      console.log(`  - ${c.boardLabel} "${c.name}" (matched on ${c.matchedOn.join(", ")})${c.id === t.recommended ? "  <- recommended" : ""}`);
    }
  }
  if (p.blocked?.reason === "not-owner") console.log(`Blocked: this record belongs to ${p.blocked.owner}. No changes proposed.`);
  if (p.blocked?.reason === "unassigned") console.log("Blocked: no Contact Broker. Offer to claim it first.");
  if (p.changes.length) {
    console.log("Changes:");
    for (const c of p.changes) {
      const now = c.currentDisplay ?? c.current;
      const next = c.location ? `${c.proposed}" (map: ${c.location.address})` : `${c.proposedDisplay ?? c.proposed}"`;
      console.log(`  ${c.label}: ${now ? `"${now}" -> ` : ""}"${next}`);
    }
  }
  for (const n of p.placedInNotes) console.log(`Placed in Notes: "${n.text}" (${n.why})`);
  // The app asks one question at a time.
  if (p.questions.length) {
    const more = p.questions.length - 1;
    console.log(`Question: ${p.questions[0].question}${more ? `  (${more} more after this)` : ""}`);
  }
  for (const a of p.automations) console.log(`Automation: ${a}`);
  if (!p.blocked && t.kind !== "pick") console.log(`Broker Note to save: "${p.noteText}"`);
}

proposals.forEach(print);
console.log(
  `\nTiming: ${extractionFile ? "saved extraction" : model} ${extractedAt - started} ms, Monday search ${loadedAt - extractedAt} ms (${records.length} candidates)${mapsKey ? `, map lookup ${mappedAt - loadedAt} ms` : ""}`,
);
