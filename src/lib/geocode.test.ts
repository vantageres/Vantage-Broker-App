import { describe, expect, it } from "vitest";
import type { Proposal } from "./capture/proposal";
import { googleGeocoder, resolveLocations } from "./geocode";

function proposalWith(place: string): Proposal {
  return {
    person: {} as Proposal["person"],
    subject: "Dave Reyes",
    target: { kind: "new-lead" },
    changes: [{ field: "desiredLocation", label: "Desired Location", current: "", proposed: place }],
    noteText: "",
    placedInNotes: [],
    questions: [],
    automations: [],
  };
}

function fakeFetch(body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body))) as typeof fetch;
}

describe("resolveLocations", () => {
  it("attaches the map point Google found", async () => {
    const geocode = googleGeocoder("key", fakeFetch({
      status: "OK",
      results: [{ formatted_address: "I-295, Bellmawr, NJ, USA", geometry: { location: { lat: 39.86, lng: -75.09 } } }],
    }));
    const p = await resolveLocations(proposalWith("I-295, NJ"), geocode);
    expect(p.changes[0].location).toEqual({ lat: 39.86, lng: -75.09, address: "I-295, Bellmawr, NJ, USA" });
  });

  it("drops the field and asks when the place can't be found", async () => {
    const geocode = googleGeocoder("key", fakeFetch({ status: "ZERO_RESULTS", results: [] }));
    const p = await resolveLocations(proposalWith("the old mill"), geocode);
    expect(p.changes).toEqual([]);
    expect(p.questions[0].field).toBe("desiredLocation");
  });

  it("asks instead of trusting a partial match", async () => {
    const geocode = googleGeocoder("key", fakeFetch({
      status: "OK",
      results: [{
        formatted_address: "Bergen Mills, Millstone Township, NJ 08535, USA",
        partial_match: true,
        geometry: { location: { lat: 40.2, lng: -74.4 } },
      }],
    }));
    const p = await resolveLocations(proposalWith("the old Bergen Mill site"), geocode);
    expect(p.changes).toEqual([]);
    expect(p.questions[0].question).toContain("Bergen Mills, Millstone Township");
  });

  it("reports a Google error instead of hiding it", async () => {
    const geocode = googleGeocoder("key", fakeFetch({ status: "REQUEST_DENIED", error_message: "bad key", results: [] }));
    await expect(resolveLocations(proposalWith("Mount Laurel, NJ"), geocode)).rejects.toThrow("REQUEST_DENIED");
  });
});
