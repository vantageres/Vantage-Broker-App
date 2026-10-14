import type { MapPoint, PropertyRecord } from "../monday/properties";
import type { PropertyLeadRecord } from "../property-leads/board";

// Which property a sign photo was taken at. The phone's location, when the
// broker allowed it, is compared with each property's map point; failing
// that, a street address printed on the sign is matched against property
// names and addresses. Nothing found means nothing is proposed.

// A sign stands on its property, but a map point is often the building's
// address and the phone's location can be off by tens of metres.
export const NEAR_METRES = 200;
// The nearest must be clearly nearer than the next one.
export const TIE_METRES = 40;

export interface SignProperty {
  board: "propertiesNew" | "propertiesOld" | "propertyLeads";
  boardLabel: string;
  id: string;
  name: string;
  url: string;
  how: "location" | "address";
  metres?: number; // how far the phone was from the property's map point
  // Leads and Contacts link only to the old Properties board (Associated Properties).
  linkable: boolean;
}

export function metresBetween(a: MapPoint, b: MapPoint): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

interface Candidate {
  board: SignProperty["board"];
  boardLabel: string;
  id: string;
  name: string;
  url: string;
  address: string;
  point: MapPoint | null;
}

const clean = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

// "1200 Commerce Pkwy" from "1200 Commerce Parkway, Mount Laurel": the number
// and the first word of the street, which survive abbreviations.
function streetKey(text: string): string | null {
  const m = clean(text).match(/ (\d+[a-z]?) ([a-z]+) /);
  return m ? `${m[1]} ${m[2]}` : null;
}

export function findSignProperty(
  properties: PropertyRecord[],
  leads: PropertyLeadRecord[],
  where: { location?: MapPoint | null; address?: string | null },
): SignProperty | null {
  const candidates: Candidate[] = [
    ...properties.map((p) => ({ board: p.board, boardLabel: p.boardLabel, id: p.id, name: p.name, url: p.url, address: p.address, point: p.point })),
    ...leads.map((l) => ({ board: "propertyLeads" as const, boardLabel: "Property Leads", id: l.id, name: l.name, url: l.url, address: l.info.location, point: l.point })),
  ];
  const result = (c: Candidate, how: SignProperty["how"], metres?: number): SignProperty => ({
    board: c.board, boardLabel: c.boardLabel, id: c.id, name: c.name, url: c.url, how,
    ...(metres !== undefined ? { metres: Math.round(metres) } : {}),
    linkable: c.board === "propertiesOld",
  });

  if (where.location) {
    const [nearest, next] = candidates
      .filter((c) => c.point)
      .map((c) => ({ c, metres: metresBetween(where.location!, c.point!) }))
      .sort((a, b) => a.metres - b.metres);
    // Two properties about as close (e.g. both mapped to a town's centre) is a guess, not a match.
    const clear = !next || next.metres - nearest.metres > TIE_METRES;
    if (nearest && nearest.metres <= NEAR_METRES && clear) return result(nearest.c, "location", nearest.metres);
  }

  const key = where.address ? streetKey(where.address) : null;
  if (key) {
    const hits = candidates.filter((c) => [c.name, c.address].some((t) => streetKey(t) === key));
    // Only one property with that street number and name: otherwise it's a guess.
    if (hits.length === 1) return result(hits[0], "address");
  }
  return null;
}
