// Ask a question the way the app does, against the Monday test boards, and
// print the answer. Reads only; nothing is saved to Monday.
//
//   npm run try-lookup -- "retail around 2,000 sf"
//   npx tsx --env-file=.env.local scripts/try-lookup.ts "Who is Owen Gray?"   (on a PC)
//
// Summaries need BROKER_APP_ANTHROPIC_KEY; property searches and record
// lookups don't use Claude.

import { mondayClient } from "../src/lib/monday/client";
import { whoAmI } from "../src/lib/monday/me";
import { lookup } from "../src/lib/capture/service";

const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  console.error('Usage: npm run try-lookup -- "question"');
  process.exit(1);
}

const monday = mondayClient();
const who = await whoAmI(monday);
const started = Date.now();
const result = await lookup({ monday, sid: "try-lookup", accountSlug: who.accountSlug, me: { id: who.userId, name: who.name } }, question);
const ms = Date.now() - started;

if (result.kind === "properties") {
  console.log(`Properties: ${result.understood} — ${result.hits.length + result.more.length} of ${result.searched} match (${ms} ms)`);
  for (const { property: p, suites, otherSuites } of result.hits) {
    console.log(`\n${p.name} [${p.boardLabel}] ${p.status} · ${p.types.join(", ") || "no type"} · ${p.deal} · ${p.sqft ?? "-"} sf · ${p.acres ?? "-"} acres · price ${p.price ?? "-"} · ${p.brokers}`);
    for (const s of suites) console.log(`  ${s.name}: ${s.sqft ?? "-"} sf · ${s.type} · ${s.status} · ${s.deal} · lease value ${s.leaseValue ?? "-"} · expires ${s.expires || "-"}`);
    if (otherSuites) console.log(`  (${otherSuites} other suites didn't match)`);
  }
  for (const m of result.more) console.log(`  also: ${m.name}`);
} else if (result.kind === "summary") {
  console.log(`Summary from ${result.recordsRead} records (${ms} ms)`);
  for (const p of result.points) console.log(`- ${p.text} [${p.sources.map((s) => s.name).join(", ")}]`);
} else {
  console.log(`Records: ${result.answers.length + result.more.length}${result.partial ? " (partly match)" : ""} (${ms} ms)`);
  for (const a of result.answers) {
    console.log(`\n${a.name} [${a.boardLabel}] · ${a.contactBroker || "no Contact Broker"}`);
    for (const f of a.fields) console.log(`  ${f.label}: ${f.value}`);
    for (const n of a.notes) console.log(`  note ${n.at.slice(0, 10)} ${n.kind}: ${n.text.slice(0, 100)}`);
    if (a.problems.length) console.log(`  problems: ${a.problems.join("; ")}`);
  }
  for (const m of result.more) console.log(`  also: ${m.name}`);
}
