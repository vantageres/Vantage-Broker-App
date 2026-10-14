import type { Proposal } from "./capture/proposal";

// Desired Location is a map column, so a place name needs a map point before
// it can be saved. Google Maps Geocoding finds it; the broker sees the address
// it found on the approval screen.

export interface MapPoint {
  lat: number;
  lng: number;
  address: string;
  // Google matched only part of the place name, e.g. "old Bergen Mill site"
  // became "Bergen Mills, Millstone Township". Treat as a guess.
  partial?: boolean;
}

export type Geocoder = (place: string) => Promise<MapPoint | null>;

// Prefer results in South Jersey and the Philadelphia area without excluding
// anywhere else.
const AREA_BIAS = "39.5,-75.6|40.4,-74.3";

export function googleGeocoder(apiKey: string, fetchImpl: typeof fetch = fetch): Geocoder {
  return async (place) => {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", place);
    url.searchParams.set("region", "us");
    url.searchParams.set("bounds", AREA_BIAS);
    url.searchParams.set("key", apiKey);
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Google Maps returned HTTP ${res.status}`);
    const body = (await res.json()) as {
      status: string;
      error_message?: string;
      results: {
        formatted_address: string;
        partial_match?: boolean;
        geometry: { location: { lat: number; lng: number } };
      }[];
    };
    if (body.status === "ZERO_RESULTS") return null;
    if (body.status !== "OK") throw new Error(`Google Maps: ${body.status} ${body.error_message ?? ""}`.trim());
    const [best] = body.results;
    return {
      lat: best.geometry.location.lat,
      lng: best.geometry.location.lng,
      address: best.formatted_address,
      partial: best.partial_match === true,
    };
  };
}

// The map columns: Desired Location, and Contact Address on Contacts.
const MAP_FIELDS = ["desiredLocation", "contactAddress"] as const;

// Attach a map point to each proposed map value. If a place can't be found,
// or Google only matched part of it, the field is left out and the broker is
// asked instead of saving a guess.
export async function resolveLocations(proposal: Proposal, geocode: Geocoder): Promise<Proposal> {
  let resolved = proposal;
  for (const field of MAP_FIELDS) resolved = await resolveOne(resolved, field, geocode);
  return resolved;
}

async function resolveOne(proposal: Proposal, field: (typeof MAP_FIELDS)[number], geocode: Geocoder): Promise<Proposal> {
  const change = proposal.changes.find((c) => c.field === field);
  if (!change) return proposal;
  const point = await geocode(change.proposed);
  if (point && !point.partial) {
    const location = { lat: point.lat, lng: point.lng, address: point.address };
    return { ...proposal, changes: proposal.changes.map((c) => (c === change ? { ...c, location } : c)) };
  }
  const question = point
    ? `For "${change.proposed}" the map found ${point.address}. Is that the right place, or which town or address should I use?`
    : `I couldn't find "${change.proposed}" on the map. Which town or address should I use?`;
  return {
    ...proposal,
    changes: proposal.changes.filter((c) => c !== change),
    questions: [...proposal.questions, { field, question }],
  };
}
