import type { LookupResult } from "../capture/service";

type PropertiesResult = Extract<LookupResult, { kind: "properties" }>;

const list = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

// The line above a property answer: what was searched, and for a person's
// requirement, what the record lacks or what couldn't be checked.
export function propertyIntro(result: PropertiesResult): string {
  const total = result.hits.length + result.more.length;
  const firstOf = result.more.length ? ` The first ${result.hits.length} are below.` : "";
  const p = result.for;

  if (!p) {
    return total === 0
      ? `No properties in Monday match ${result.understood}. I searched all ${result.searched} on Properties New and Properties (old).`
      : `${total === 1 ? "One property matches" : `${total} properties match`}: ${result.understood}.${firstOf}`;
  }

  const whose = `${p.name}'s requirement (${p.boardLabel})`;
  if (!result.understood) {
    const lacking = p.missing.filter((m) => m !== "Desired Location");
    return `${p.name} has no ${list(lacking)} in Monday, so I can't match listings without guessing. Add ${lacking.length > 1 ? "them" : "it"} to the ${p.boardLabel} first.`;
  }
  const lines: string[] = [];
  if (total === 0) {
    lines.push(`No available listings fit ${whose}: ${result.understood}${p.place && !result.understood.includes(" · in ") ? ` · in ${p.place}` : ""}.`);
    if (p.place) lines.push("Nothing fits anywhere else either.");
  } else {
    lines.push(`${total === 1 ? "One available listing fits" : `${total} available listings fit`} ${whose}: ${result.understood}.${firstOf}`);
    if (p.elsewhere) lines.push(`None are in ${p.place}, so these are elsewhere.`);
  }
  if (p.missing.includes("Property Type")) lines.push("The record has no Property Type, so every type is included.");
  if (p.missing.includes("Sq Ft/Acres")) lines.push("The record has no Sq Ft/Acres, so every size is included.");
  if (p.notChecked.length) lines.push(`Not checked: ${list(p.notChecked)}.`);
  return lines.join(" ");
}
