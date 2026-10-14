// Is the broker asking what Monday holds, rather than writing a note? Decided
// without Claude so a lookup answers fast. A wrong guess is one tap to undo:
// every answer offers "Read it as a note instead".

// Openings that are almost always a question.
const ASKING = /^(what|what's|whats|who|who's|whos|where|which|any|anything|tell me|show me|show|find|look ?up|lookup|pull up|get me|give me|info on|details on|search|status of|status on|summari[sz]e|summary|list|how many)\b/i;
// Openings that also start ordinary notes ("Did a tour with…"): a question only with a question mark.
const MAYBE = /^(is|are|do|does|did|has|have|had|can|when|how|was|were|should)\b/i;

// A short search typed without a question mark ("Available industrial 15 to
// 20k sf", "Retail in Haddonfield"): starts with what is wanted, and says
// nothing that happened, so it isn't a note.
const SEARCH_START = /^(available|vacant|open|industrial|warehouse|flex|retail|office|land|medical|healthcare|multifamily|properties|property|listings?|space|suites?|\d[\d,.]*\s*k?\s*(sf|sq|square|acres?)?\b)/i;
const SEARCH_WORDS = /\b(sf|sq\.?\s?ft|square f(ee|oo)t|acres?|space|suites?|listings?|propert(y|ies)|for (lease|sale)|available|vacant|industrial|warehouse|flex|retail|office|land)\b/i;
const HAPPENED = /\b(met|meet|meeting|talked|spoke|called|call|emailed|texted|toured|tour|visited|said|says|told|wants|needs|left|follow ?up|lunch|coffee)\b/i;

export function isQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (ASKING.test(t)) return true;
  if (SEARCH_START.test(t) && SEARCH_WORDS.test(t) && !HAPPENED.test(t) && t.split(/\s+/).length <= 12) return true;
  const asked = t.endsWith("?");
  if (asked && MAYBE.test(t)) return true;
  // A short line ending in "?" ("Linda Park?") is a question; a long note that
  // ends with one is still a note.
  return asked && t.split(/\s+/).length <= 12;
}

// Which kind of answer a question wants. A question that names a Lead or
// Contact is a record lookup whatever else it says; the caller, which has the
// records, checks that first.
export type AskKind = "summary" | "property" | "record";

// About people's requirements, across records.
const ABOUT_PEOPLE = /\b(requirements?|looking|searching|interested|needs?|wants?|clients?|tenants?|buyers?|leads|contacts|prospects?)\b/i;
const ACROSS = /\b(summari[sz]e|summary|overview|who|which|how many|list|any)\b/i;
// About buildings and space.
const ABOUT_PROPERTY = /\b(propert(y|ies)|listings?|space|spaces|suites?|units?|buildings?|sites?|parcels?|sf|sq\.?\s?ft|square f(ee|oo)t|acres?|for (lease|sale)|available|vacant|warehouses?|storefronts?|inventory)\b/i;

// With a Lead or Contact named: does the question ask for listings that fit
// them ("Any listings for Ray Fulton?"), rather than for their record? Asking
// which properties are linked to them is still a record lookup.
const FIT = /\b(listings?|propert(y|ies)|spaces?|suites?|buildings?|options?|fits?|fitting|match(es|ing)?|available|inventory|show(ing)?s?)\b/i;
export function asksForListings(question: string): boolean {
  return FIT.test(question) && !/\b(linked|associated|attached|connected)\b/i.test(question);
}

export function askKind(question: string): AskKind {
  if (ABOUT_PEOPLE.test(question) && (ACROSS.test(question) || /\b(requirements?|clients?|leads|contacts)\b/i.test(question))) return "summary";
  if (ABOUT_PROPERTY.test(question)) return "property";
  return "record";
}
