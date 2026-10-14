import type { PersonRecord } from "../monday/records";

// Which Leads and Contacts does the question name? A full name or business
// name in the question is a strong hit. Failing that, a first or last name,
// or a distinctive word of a business name, is a weak hit. Nothing is guessed:
// no hit means "nothing found".

const clean = (s: string) =>
  ` ${s.toLowerCase().replace(/['’]s\b/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;

// Words that say nothing about which business is meant.
const GENERIC = new Set([
  "the", "and", "llc", "inc", "corp", "corporation", "company", "co", "group", "holdings", "partners",
  "associates", "services", "enterprises", "international", "industries", "properties", "realty",
  "real", "estate", "management", "solutions", "of", "new", "jersey", "nj",
]);

export interface Hit {
  record: PersonRecord;
  strength: "strong" | "weak";
  on: string; // what in the question matched
}

export function findMentioned(question: string, records: PersonRecord[]): Hit[] {
  const q = clean(question);
  const has = (phrase: string) => phrase.trim().length > 0 && q.includes(` ${phrase.trim()} `);
  const strong: Hit[] = [];
  const weak: Hit[] = [];

  for (const record of records) {
    const name = clean(record.name);
    const business = clean(record.businessName);
    const nameWords = name.trim().split(" ").filter((w) => w.length >= 3);
    const businessWords = business.trim().split(" ").filter((w) => w.length >= 4 && !GENERIC.has(w));

    if (nameWords.length >= 2 && has(name)) strong.push({ record, strength: "strong", on: record.name });
    else if (record.businessName && business.trim().split(" ").some((w) => !GENERIC.has(w)) && has(business)) {
      strong.push({ record, strength: "strong", on: record.businessName });
    } else {
      const word = [...nameWords, ...businessWords].find((w) => has(w));
      if (word) weak.push({ record, strength: "weak", on: word });
    }
  }

  const hits = strong.length ? strong : weak;
  // Contacts first (the fuller record), then the most recently updated.
  return hits.sort((a, b) =>
    a.record.board.key === b.record.board.key
      ? b.record.updatedAt.localeCompare(a.record.updatedAt)
      : a.record.board.key === "contacts" ? -1 : 1,
  );
}
