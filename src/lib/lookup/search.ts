import type { PersonRecord, SearchTerms } from "../monday/records";

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

// Question words that are never what a name is being matched on. Leaving
// them out keeps Monday's search short; a record is still found through any
// other word of its name in the question.
const QUESTION_WORDS = new Set([
  "what", "who", "whom", "which", "where", "when", "why", "how", "have", "has", "had", "does", "did",
  "any", "anything", "about", "for", "with", "from", "that", "this", "there", "their", "still", "show",
  "look", "find", "tell", "give", "list", "notes", "note", "info", "latest", "update", "updates",
  "record", "records", "contact", "lead", "can", "you", "are", "was", "his", "her", "him", "she",
]);

// What to ask Monday for: every word of the question that could be part of a
// name or business name. findMentioned needs a whole name word (3+ letters)
// in the question, so these words bring back the records it would find.
// Shorter words ("is", "on") would match parts of hundreds of names.
export function questionTerms(question: string): SearchTerms {
  const words = clean(question).trim().split(" ")
    .filter((w) => w.length >= 3 && !QUESTION_WORDS.has(w) && !GENERIC.has(w));
  return { words: [...new Set(words)], phones: [], emails: [] };
}

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
