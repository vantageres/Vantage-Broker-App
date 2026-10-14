import type { PropertyRecord, Suite } from "../monday/properties";

// Property and suite search, done in code so answers are exact and fast.
// The question is read for a type, a size, a town, sale or lease, and
// "available". Anything not understood is simply not used as a filter, and
// the answer says what was understood. A property whose size or type Monday
// doesn't hold is left out of a search on that, never guessed.

export interface SizeFilter {
  min: number | null;
  max: number | null;
  unit: "sf" | "acres";
  around: number | null; // "about 2,000 sf" gives 1,500 to 2,500
}

export interface PropertyQuery {
  types: string[];
  size: SizeFilter | null;
  deal: "Sale" | "Lease" | null;
  availableOnly: boolean;
  towns: string[];
}

const TYPE_WORDS: [RegExp, string][] = [
  [/\boffices?\b/, "Office"],
  [/\b(retail|stores?|storefronts?|shops?|shopping)\b/, "Retail"],
  [/\b(industrial|warehouses?|flex|manufacturing|distribution|logistics)\b/, "Industrial"],
  [/\b(land|lots?|parcels?)\b/, "Land"],
  [/\b(medical|healthcare|health care)\b/, "Healthcare"],
  [/\b(multifamily|multi-family|apartments?)\b/, "Multifamily"],
  [/\b(investment)\b/, "Investment"],
];

// "Around" a single size: a quarter either side.
const AROUND = 0.25;

const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k)?`;
const SF = String.raw`(?:\s*(?:sq\.?\s*f(?:ee)?t\.?|square\s+f(?:ee|oo)t|sf|sqft|s\.f\.|feet|ft))`;
const ACRES = String.raw`\s*acres?\b`;

const num = (digits: string, k?: string) => Number(digits.replace(/,/g, "")) * (k ? 1000 : 1);

function readSize(q: string): SizeFilter | null {
  let m: RegExpMatchArray | null;
  // Acres: "2 to 5 acres", "under 3 acres", "5 acres".
  if ((m = q.match(new RegExp(String.raw`${NUM}\s*(?:to|-|–|and)\s*${NUM}${ACRES}`)))) {
    return { min: num(m[1]), max: num(m[3]), unit: "acres", around: null };
  }
  if ((m = q.match(new RegExp(String.raw`(under|less than|below|up to|at most|no more than)\s+${NUM}${ACRES}`)))) {
    return { min: null, max: num(m[2]), unit: "acres", around: null };
  }
  if ((m = q.match(new RegExp(String.raw`(over|more than|above|at least|bigger than|larger than)\s+${NUM}${ACRES}`)))) {
    return { min: num(m[2]), max: null, unit: "acres", around: null };
  }
  if ((m = q.match(new RegExp(String.raw`${NUM}${ACRES}`)))) {
    const n = num(m[1]);
    return { min: n * (1 - AROUND), max: n * (1 + AROUND), unit: "acres", around: n };
  }

  // Square feet. A range: "15 to 20k sf", "1,500-2,500 sf", "between 10,000 and 15,000".
  if ((m = q.match(new RegExp(String.raw`(between\s+)?${NUM}\s*(?:to|-|–|and)\s*${NUM}(${SF})?`)))) {
    const [, between, a, ak, b, bk, unit] = m;
    let lo = num(a, ak);
    const hi = num(b, bk);
    if (!ak && bk && lo < 1000) lo *= 1000; // "15 to 20k" means 15,000 to 20,000
    if ((unit || ak || bk || between || (lo >= 1000 && hi >= 1000)) && lo <= hi) {
      return { min: lo, max: hi, unit: "sf", around: null };
    }
  }
  if ((m = q.match(new RegExp(String.raw`(under|less than|below|up to|at most|no more than|smaller than|max(?:imum)?(?: of)?)\s+${NUM}(${SF})?`)))) {
    if (m[3] || m[4] || num(m[2]) >= 1000) return { min: null, max: num(m[2], m[3]), unit: "sf", around: null };
  }
  if ((m = q.match(new RegExp(String.raw`(over|more than|above|at least|bigger than|larger than|min(?:imum)?(?: of)?)\s+${NUM}(${SF})?`)))) {
    if (m[3] || m[4] || num(m[2]) >= 1000) return { min: num(m[2], m[3]), max: null, unit: "sf", around: null };
  }
  // A single size: "2,000 sq ft", "2000 sf", "20k".
  if ((m = q.match(new RegExp(String.raw`${NUM}${SF}`))) || (m = q.match(new RegExp(String.raw`\b(\d+(?:\.\d+)?)\s*(k)\b`)))) {
    const n = num(m[1], m[2]);
    return { min: Math.round(n * (1 - AROUND)), max: Math.round(n * (1 + AROUND)), unit: "sf", around: n };
  }
  return null;
}

// The towns the boards know, from each property's address and name
// ("Kings Crossing Retail Plaza - Haddonfield").
export function knownTowns(properties: PropertyRecord[]): string[] {
  const towns = new Set<string>();
  for (const p of properties) {
    const fromName = p.name.split(/\s+[-–]\s+/).slice(1).join(" ").trim();
    if (fromName) towns.add(fromName);
    const parts = p.address.split(",").map((s) => s.trim());
    const state = parts.findIndex((s) => /^(NJ|PA|DE|NY)\b/.test(s) || /^New Jersey|Pennsylvania|Delaware/.test(s));
    if (state > 0) towns.add(parts[state - 1].replace(/\s+Township$/i, ""));
  }
  return [...towns].filter((t) => t.length >= 4 && !/\d/.test(t));
}

export function readQuery(question: string, towns: string[] = []): PropertyQuery {
  const q = ` ${question.toLowerCase().replace(/[’']/g, "'")} `;
  const types = TYPE_WORDS.filter(([re]) => re.test(q)).map(([, t]) => t);
  const sale = /\b(for sale|to buy|buy|buying|purchase|sale)\b/.test(q);
  const lease = /\b(for lease|lease|leasing|rent|renting|rental)\b/.test(q);
  return {
    types,
    size: readSize(q),
    deal: sale && !lease ? "Sale" : lease && !sale ? "Lease" : null,
    availableOnly: /\b(available|vacant|open|unleased|on the market|on market)\b/.test(q),
    towns: towns.filter((t) => q.includes(` ${t.toLowerCase()}`) || q.includes(`${t.toLowerCase()} `)),
  };
}

export function hasFilters(query: PropertyQuery): boolean {
  return query.types.length > 0 || !!query.size || !!query.deal || query.availableOnly || query.towns.length > 0;
}

export interface PropertyHit {
  property: PropertyRecord;
  suites: Suite[]; // the suites that match; all of them when nothing about suites was asked
  otherSuites: number;
  available: boolean;
}

const isAvailable = (status: string) => /on market|available|vacant/i.test(status);
const typeMatches = (have: string[], want: string[]) =>
  want.length === 0 || have.some((h) => want.some((w) => h.toLowerCase().includes(w.toLowerCase())));
const dealMatches = (have: string, want: PropertyQuery["deal"]) =>
  !want || have.toLowerCase().includes(want.toLowerCase());
const sizeMatches = (value: number | null, size: SizeFilter | null) =>
  !size || (value !== null && (size.min === null || value >= size.min) && (size.max === null || value <= size.max));

function townMatches(p: PropertyRecord, towns: string[]) {
  if (towns.length === 0) return true;
  const where = `${p.name} ${p.address}`.toLowerCase();
  return towns.some((t) => where.includes(t.toLowerCase()));
}

export function searchProperties(properties: PropertyRecord[], query: PropertyQuery): PropertyHit[] {
  const hits: PropertyHit[] = [];
  const target = query.size?.around ?? null;

  for (const p of properties) {
    if (!townMatches(p, query.towns) || !dealMatches(p.deal, query.deal)) continue;

    if (p.suites.length) {
      // Properties New: the suites carry type, size and status.
      const askedAboutSuites = !!query.size || query.availableOnly || query.types.length > 0 || !!query.deal;
      const matching = p.suites.filter((s) =>
        typeMatches(s.type ? [s.type] : p.types, query.types)
        && sizeMatches(s.sqft, query.size?.unit === "sf" ? query.size : null)
        && (!query.availableOnly || isAvailable(s.status))
        // A sale is of the whole property; only a lease is by the suite.
        && (query.deal !== "Lease" || !s.deal || dealMatches(s.deal, query.deal)));
      if (query.size?.unit === "acres") continue; // suites are measured in sf
      if (askedAboutSuites && matching.length === 0) continue;
      const shown = askedAboutSuites ? matching : p.suites;
      hits.push({ property: p, suites: shown, otherSuites: p.suites.length - shown.length, available: shown.some((s) => isAvailable(s.status)) });
      continue;
    }

    // Properties (old), or a property with no suites: the property itself.
    const value = query.size?.unit === "acres" ? p.acres : p.sqft;
    if (!typeMatches(p.types, query.types) || !sizeMatches(value, query.size)) continue;
    if (query.availableOnly && !isAvailable(p.status)) continue;
    hits.push({ property: p, suites: [], otherSuites: 0, available: isAvailable(p.status) });
  }

  // Available first, then nearest the size asked for, then by name.
  const distance = (h: PropertyHit) => {
    if (target === null) return 0;
    const sizes = h.suites.length ? h.suites.map((s) => s.sqft ?? Infinity) : [query.size?.unit === "acres" ? h.property.acres ?? Infinity : h.property.sqft ?? Infinity];
    return Math.min(...sizes.map((v) => Math.abs(v - target)));
  };
  return hits.sort((a, b) => Number(b.available) - Number(a.available) || distance(a) - distance(b) || a.property.name.localeCompare(b.property.name));
}

const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });

// What the search understood, shown above the results.
export function describeQuery(query: PropertyQuery): string {
  const parts: string[] = [];
  if (query.availableOnly) parts.push("available");
  parts.push(query.types.length ? query.types.join(" or ") : "any type");
  const s = query.size;
  if (s) {
    const u = s.unit === "sf" ? "sf" : "acres";
    if (s.around !== null) parts.push(`about ${n(s.around)} ${u} (${n(s.min!)} to ${n(s.max!)})`);
    else if (s.min !== null && s.max !== null) parts.push(`${n(s.min)} to ${n(s.max)} ${u}`);
    else if (s.max !== null) parts.push(`up to ${n(s.max)} ${u}`);
    else if (s.min !== null) parts.push(`${n(s.min)} ${u} or more`);
  }
  if (query.deal) parts.push(`for ${query.deal.toLowerCase()}`);
  if (query.towns.length) parts.push(`in ${query.towns.join(" or ")}`);
  return parts.join(" · ");
}
