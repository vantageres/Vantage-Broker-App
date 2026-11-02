import type { PersonRecord } from "../monday/records";
import type { MapPoint } from "../monday/properties";
import type { Geocoder } from "../geocode";

// Summaries send records to Claude, and the live boards hold about 1,600
// Leads and Contacts: too many to read and send for every question. When the
// question names a property type or a place, only the records that say
// something about it are sent. A record that says nothing about the type or
// place asked for can't answer the question from what it says, which is all
// Claude may use. A place narrows only when no type is named: with a type,
// the type's records are few enough, and Claude can point to ones in nearby
// towns when none is in the place asked for. When nothing is named, every
// record with a requirement is sent, as before.

export interface TypeAsked {
  label: string; // the Property Type label on the boards
  words: string[]; // lower-case text that counts as a mention in Notes or Business Name
}

// Question words for each Property Type, and what counts as a mention of it.
// Mentions are matched as parts of words, as Monday's search does.
const TYPES: { asked: RegExp; label: string; words: string[] }[] = [
  { asked: /\boffices?\b/, label: "Office", words: ["office"] },
  { asked: /\b(retail|stores?|storefronts?|shops?|shopping)\b/, label: "Retail", words: ["retail", "storefront", "store front", "shop"] },
  {
    asked: /\b(industrial|warehouses?|flex|manufacturing|distribution|logistics)\b/,
    label: "Industrial",
    // Industrial users often describe the space rather than name it.
    words: [
      "industrial", "warehouse", "flex", "manufactur", "distribution", "logistic", "storage", "dock",
      "drive-in", "drive in", "overhead door", "clear height", "truck", "shipping", "fabricat", "contractor",
    ],
  },
  { asked: /\b(land|lots?|parcels?|acres?|acreage)\b/, label: "Land", words: ["acre", "parcel", "vacant land", "raw land"] },
  { asked: /\b(medical|healthcare|health care|dental|clinic)\b/, label: "Healthcare", words: ["medical", "healthcare", "health care", "dental", "clinic"] },
  { asked: /\b(multifamily|multi-family|apartments?)\b/, label: "Multifamily", words: ["multifamily", "multi-family", "apartment"] },
  { asked: /\binvestment\b/, label: "Investment", words: ["investment"] },
  { asked: /\b(hospitality|hotels?|restaurants?)\b/, label: "Specialty & Hospitality", words: ["hospitality", "hotel", "restaurant"] },
  { asked: /\b(residential|houses?|homes?)\b/, label: "Residential", words: ["residential"] },
];

export function typesAsked(question: string): TypeAsked[] {
  const q = ` ${question.toLowerCase()} `;
  return TYPES.filter((t) => t.asked.test(q)).map(({ label, words }) => ({ label, words }));
}

// Does the record say it wants one of these types: in Property Type, or in
// Notes or Business Name?
export function mentionsType(r: PersonRecord, types: TypeAsked[]): boolean {
  const typed = r.current.propertyType.toLowerCase();
  const text = `${r.current.notes} ${r.businessName}`.toLowerCase();
  return types.some((t) => typed.includes(t.label.toLowerCase()) || t.words.some((w) => text.includes(w)));
}

export interface PlaceAsked {
  name: string; // as the question has it, e.g. "Mount Laurel" or "295"
  point: MapPoint | null; // null for a highway or route: only its name is matched
}

export const NEAR_MILES = 10;

const NOT_PLACES = new Set([
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november",
  "december", "leads", "contacts", "monday", "the area", "town", "nj", "new jersey", "pa", "pennsylvania",
  "this month", "this week", "this year",
]);

// The place in "near Mount Laurel", "in Cherry Hill", "around 295". Found on
// the map, unless it's a highway or route number. A place Google only
// partly recognises, or a whole state or county, narrows nothing.
export async function placeAsked(question: string, geocode: Geocoder | null): Promise<PlaceAsked | null> {
  const phrases = question.matchAll(
    /\b(?:near|in|around|by|close to|outside(?: of)?)\s+((?:i-|route |rt\.? |nj-|us-)?\d+[a-z]?\b|[a-z][a-z.'-]*(?:\s+[a-z][a-z.'-]*){0,3}?)(?=\s*(?:$|[,.?!;]|\s(?:with|for|that|who|which|and|or|under|over|looking|needing|wanting|area|between|near|in|around|by|close|outside)\b))/gi,
  );
  for (const m of phrases) {
    const name = m[1].trim().replace(/[.'-]+$/, ""); // "near Mount Laurel." ends a sentence
    const key = name.toLowerCase();
    if (NOT_PLACES.has(key) || typesAsked(key).length || /^(the|a|an|my|our|this|that|their|his|her)\s/.test(key)) continue;
    if (/\d/.test(name)) return { name, point: null };
    if (!geocode) return null;
    try {
      const found = await geocode(`${name}, NJ`);
      // Accept a town or neighbourhood that Google fully recognises and names
      // the same way ("Mt Laurel Township" for "Mount Laurel"). A county or
      // state is too wide to be "near".
      const first = (found?.address.split(",")[0] ?? "").toLowerCase().replace(/^mt\.?\s/, "mount ");
      const lastWord = key.replace(/^mt\.?\s/, "mount ").split(/\s+/).at(-1)!;
      if (found && !found.partial && first.includes(lastWord) && !/county/.test(first) && found.address.split(",").length >= 3) {
        return { name, point: { lat: found.lat, lng: found.lng } };
      }
    } catch {
      return null; // the map is a help here, never a reason to fail
    }
  }
  return null;
}

function miles(a: MapPoint, b: MapPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

// Is the record's Desired Location near the place, or does it name the place
// in Desired Location or Notes?
export function nearPlace(r: PersonRecord, place: PlaceAsked): boolean {
  const name = place.name.toLowerCase();
  const text = `${r.current.desiredLocation} ${r.current.notes}`.toLowerCase();
  if (text.includes(name)) return true;
  // "Mount Laurel" is also written "Mt Laurel".
  if (/^mount\s/.test(name) && text.includes(name.replace(/^mount\s/, "mt "))) return true;
  return !!(place.point && r.desiredPoint && miles(place.point, r.desiredPoint) <= NEAR_MILES);
}

// Says what the summary was written from, for the screen.
export function describeScope(count: number, types: TypeAsked[], place: PlaceAsked | null): string {
  const people = `${count.toLocaleString("en-US")} ${count === 1 ? "Lead or Contact" : "Leads and Contacts"}`;
  const typeText = types.map((t) => t.label.toLowerCase()).join(" or ");
  const placeText = place ? (place.point ? `within ${NEAR_MILES} miles of ${place.name} or naming it` : `naming ${place.name}`) : "";
  if (!types.length && !place) return `all ${people} with requirements`;
  if (types.length && place) return `the ${people} that mention ${typeText}, ${placeText}`;
  if (types.length) return `the ${people} that mention ${typeText}`;
  return `the ${people} ${placeText}`;
}
