// Run a broker note through the capture pipeline against the Monday test
// boards and print the proposals. Reads only; nothing is saved to Monday.
//
//   npm run try-capture -- "Met Dave Reyes at Garrison Foods..."
//   npm run try-capture -- --extraction path/to/extraction.json "note text"
//
// --extraction skips the Claude call and uses a saved extraction instead.

import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { mondayClient } from "../src/lib/monday/client";
import { TEST_BOARDS } from "../src/lib/monday/boards";
import { loadPersonRecords } from "../src/lib/monday/records";
import { extractPeople, Extraction } from "../src/lib/capture/extract";
import { buildProposal, type Proposal } from "../src/lib/capture/proposal";

const args = process.argv.slice(2);
let extractionFile: string | undefined;
if (args[0] === "--extraction") {
  extractionFile = args[1];
  args.splice(0, 2);
}
const note = args.join(" ").trim();
if (!note) {
  console.error('Usage: npm run try-capture -- [--extraction file.json] "note text"');
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
    ? Promise.resolve(Extraction.parse(JSON.parse(readFileSync(extractionFile, "utf8"))))
    : extractPeople(claude(), note, today),
]);
const extractedAt = Date.now();
const records = (
  await Promise.all(Object.values(TEST_BOARDS).map((b) => loadPersonRecords(monday, b, account.slug)))
).flat();
const loadedAt = Date.now();

const proposals = extraction.people.map((p) => buildProposal(p, records, { id: String(me.id), name: me.name }, note, today));

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
    for (const c of p.changes) console.log(`  ${c.label}: ${c.current ? `"${c.current}" -> ` : ""}"${c.proposed}"`);
  }
  for (const n of p.placedInNotes) console.log(`Placed in Notes: "${n.text}" (${n.why})`);
  for (const q of p.questions) console.log(`Question: ${q.question}`);
  for (const a of p.automations) console.log(`Automation: ${a}`);
  if (!p.blocked && t.kind !== "pick") console.log(`Broker Note to save: "${p.noteText}"`);
}

proposals.forEach(print);
console.log(
  `\nTiming: ${extractionFile ? "saved extraction" : "Claude"} ${extractedAt - started} ms, Monday load ${loadedAt - extractedAt} ms (${records.length} records)`,
);
