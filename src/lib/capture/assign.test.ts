import { describe, expect, it } from "vitest";
import { withAssign } from "./service";
import { buildProposal } from "./proposal";
import { TEST_BOARDS } from "../monday/boards";
import type { ExtractedPerson } from "./extract";
import type { PersonRecord } from "../monday/records";

const JOHN = { id: "3", name: "John Smyth" };
const ANDREA = { id: "9", name: "Andrea Hannigan" };
const team = {
  owners: ["3", "9"],
  people: [{ id: "1", name: "Emily Stein" }, { id: "2", name: "Ken Richardson" }, { id: "3", name: "John Smyth" }, { id: "4", name: "John Doss" }],
};
const person = (o: Partial<ExtractedPerson>): ExtractedPerson => ({
  name: "Jack Smyth", business_name: null, title: null, address: null, phones: [], emails: [], contact_type: null, property_types: ["Office"],
  size: "3,500 sf", budget: null, desired_location: "Moorestown, NJ", extra_locations: [], location_is_addition: false, follow_up_phrase: null,
  follow_up_date: null, source: "Sign", requirement_notes: null, properties_mentioned: [], uncertain: [], qualify: false,
  assign_contact_broker: null, assign_co_brokers: [], ...o,
});
const newLead = (o: Partial<ExtractedPerson>, me = JOHN) => withAssign(buildProposal(person(o), [], me, "note", "2026-11-06"), team, me);

describe("assigning from the note", () => {
  it("fills in the brokers the note names", () => {
    const p = newLead({ assign_contact_broker: "Emily", assign_co_brokers: ["Ken"] });
    expect(p.assign).toMatchObject({ contactBroker: "1", coBrokers: ["2"] });
    expect(p.assign?.unmatched).toBeUndefined();
  });

  it("leaves an unclear name for the broker to choose, and says why", () => {
    const p = newLead({ assign_contact_broker: "John", assign_co_brokers: ["Zed"] });
    expect(p.assign?.contactBroker).toBe(""); // no one chosen, not the default
    expect(p.assign?.unmatched).toEqual([
      'John Smyth and John Doss are both in the Brokers team, so choose which one for "John".',
      'No one named "Zed" is in the Brokers team, so choose who you meant.',
    ]);
  });

  it("doesn't make the Contact Broker a Co-Broker too", () => {
    expect(newLead({ assign_contact_broker: "Emily", assign_co_brokers: ["Emily Stein", "Ken"] }).assign?.coBrokers).toEqual(["2"]);
  });

  it("explains when the broker asking isn't an owner of the Leads board", () => {
    const emily = { id: "1", name: "Emily Stein" };
    const p = newLead({ assign_contact_broker: "Ken" }, emily);
    expect(p.assign).toBeUndefined();
    expect(p.assignNotDone).toBe("Only an owner of the Leads board can choose who a new Lead goes to, so you'll be the Contact Broker.");
  });

  it("explains that brokers are chosen only for a new Lead", () => {
    const existing: PersonRecord = {
      board: TEST_BOARDS.leads, id: "5", name: "Jack Smyth", url: "", updatedAt: "", businessName: "", phones: [], emails: [],
      contactBrokerIds: ["3"], coBrokerIds: [], contactBrokerNames: "John Smyth",
      current: { contactType: "", propertyType: "", budget: "", size: "", desiredLocation: "", notes: "", followUp: "", source: "", businessName: "", phone: "", email: "", status: "", contactAddress: "" },
    };
    const p = withAssign(buildProposal(person({ assign_contact_broker: "Emily" }), [existing], JOHN, "note", "2026-11-06"), team, JOHN);
    expect(p.assignNotDone).toBe("Brokers are chosen only when a new Lead is added, so Emily wasn't assigned. Change the Contact Broker in Monday.");
  });

  it("lets Andrea, who isn't a broker, start from the note's choice", () => {
    expect(newLead({ assign_contact_broker: "Ken" }, ANDREA).assign).toMatchObject({ contactBroker: "2", me: "9" });
  });
});
