import { normalizePhone, type PersonRecord } from "./monday/records";

export interface MatchQuery {
  name: string | null;
  businessName: string | null;
  phones: string[];
  emails: string[];
}

export interface MatchCandidate {
  record: PersonRecord;
  score: number;
  reasons: string[];
}

export type MatchResult =
  | { kind: "none" }
  | { kind: "one"; candidate: MatchCandidate }
  // The same person on both boards: recommend the Contacts record.
  | { kind: "both-boards"; recommended: MatchCandidate; other: MatchCandidate }
  | { kind: "several"; candidates: MatchCandidate[] };

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// Phone and email are strong signals. A full name is medium. A business name
// alone only counts alongside something else. A first name alone ("Met Dave")
// is weak, but it is all the broker gave, so those hits are shown to pick from.
export function scoreRecord(query: MatchQuery, record: PersonRecord): MatchCandidate | null {
  const reasons: string[] = [];
  let score = 0;

  const phones = query.phones.map(normalizePhone).filter((p) => p.length >= 7);
  if (phones.some((p) => record.phones.includes(p))) {
    score += 100;
    reasons.push("phone");
  }
  const emails = query.emails.map((e) => e.toLowerCase());
  if (emails.some((e) => record.emails.includes(e))) {
    score += 100;
    reasons.push("email");
  }

  if (query.name) {
    const q = clean(query.name);
    const r = clean(record.name);
    if (q === r) {
      score += 60;
      reasons.push("full name");
    } else {
      const [qFirst, ...qRest] = q.split(" ");
      const [rFirst, ...rRest] = r.split(" ");
      const qLast = qRest.at(-1);
      const rLast = rRest.at(-1);
      if (qLast && rLast && qLast === rLast && (qFirst.startsWith(rFirst) || rFirst.startsWith(qFirst))) {
        score += 50;
        reasons.push("name");
      } else if (!qLast && qFirst === rFirst) {
        score += 20;
        reasons.push("first name");
      }
    }
  }

  if (query.businessName && record.businessName && clean(query.businessName) === clean(record.businessName)) {
    score += 30;
    reasons.push("business name");
  }

  const firstNameOnly = !!query.name && !clean(query.name).includes(" ");
  const threshold = firstNameOnly && phones.length === 0 && emails.length === 0 ? 20 : 50;
  return score >= threshold ? { record, score, reasons } : null;
}

export function findMatches(query: MatchQuery, records: PersonRecord[]): MatchResult {
  const candidates = records
    .map((r) => scoreRecord(query, r))
    .filter((c): c is MatchCandidate => c !== null)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "one", candidate: candidates[0] };

  // Two candidates that are the same person, one per board.
  if (candidates.length === 2) {
    const [a, b] = candidates;
    const sameName = clean(a.record.name) === clean(b.record.name);
    if (sameName && a.record.board.key !== b.record.board.key) {
      const contact = a.record.board.key === "contacts" ? a : b;
      const lead = contact === a ? b : a;
      return { kind: "both-boards", recommended: contact, other: lead };
    }
  }

  // A clear winner backed by phone or email beats weaker name-only hits.
  const [top, second] = candidates;
  if (top.score >= 100 && second.score < 100) return { kind: "one", candidate: top };

  return { kind: "several", candidates };
}
