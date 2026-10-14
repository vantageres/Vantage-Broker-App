import { describe, expect, it } from "vitest";
import { AttachIncomplete, attachPhotos, findAttachTargets } from "./attach";
import { TEST_BOARDS } from "./monday/boards";
import { TEST_PROPERTY_LEADS } from "./property-leads/board";
import type { MondayClient } from "./monday/client";
import type { PersonRecord } from "./monday/records";
import type { PropertyLeadRecord } from "./property-leads/board";

const JOHN = { id: "44432289", name: "John Smyth" };
const person = (id: string, name: string, owner: string[], ownerName = "") =>
  ({ board: TEST_BOARDS.leads, id, name, url: `u${id}`, businessName: "", updatedAt: "2026-10-14T00:00:00Z", contactBrokerIds: owner, coBrokerIds: [], contactBrokerNames: ownerName }) as unknown as PersonRecord;
const lead = (id: string, name: string, owners: string[], broker: string) =>
  ({ id, name, url: `u${id}`, ownerIds: owners, brokers: { broker, coBroker: "", coBroker2: "" } }) as unknown as PropertyLeadRecord;

const people = [person("1", "Linda Park", [JOHN.id], "John Smyth"), person("2", "Ray Fulton", ["25374507"], "Emily Stein"), person("3", "Tom Alvarez", [])];
const leads = [lead("9", "22 Elm St Warehouse - Cherry Hill", [JOHN.id], "John Smyth"), lead("8", "510 Main St Office Condo - Moorestown", ["25374507"], "Emily Stein")];

describe("which record a photo is for", () => {
  it("finds the broker's own Lead, ready to attach", () => {
    expect(findAttachTargets("Linda Park", people, leads, JOHN)).toEqual([
      { target: { kind: "person", board: "leads", id: "1" }, label: "Lead", name: "Linda Park", url: "u1", owner: "John Smyth", canAttach: true },
    ]);
  });

  it("names the owner of someone else's record, and asks for a claim on an unassigned one", () => {
    expect(findAttachTargets("Ray Fulton", people, leads, JOHN)[0]).toMatchObject({ canAttach: false, why: "This record belongs to Emily Stein." });
    expect(findAttachTargets("Tom Alvarez", people, leads, JOHN)[0]).toMatchObject({ canAttach: false, why: "Tom Alvarez has no Contact Broker. Claim it first." });
  });

  it("finds a Property Lead by street address", () => {
    expect(findAttachTargets("22 Elm St", people, leads, JOHN)[0]).toMatchObject({ target: { kind: "propertyLead", id: "9" }, label: "Property Lead", canAttach: true });
    expect(findAttachTargets("510 Main St", people, leads, JOHN)[0]).toMatchObject({ canAttach: false, why: "This Property Lead belongs to Emily Stein." });
  });

  it("finds nothing for a name Monday doesn't have", () => {
    expect(findAttachTargets("Nobody Here", people, leads, JOHN)).toEqual([]);
  });
});

describe("attaching", () => {
  const jpeg = { data: Buffer.from("x").toString("base64"), mediaType: "image/jpeg" as const };
  const boards = { people: TEST_BOARDS, leads: TEST_PROPERTY_LEADS };

  function monday(owner: number, failAt?: number) {
    const uploads: string[] = [];
    const client: MondayClient = {
      async query<T>() {
        const people = JSON.stringify({ personsAndTeams: [{ id: owner, kind: "person" }] });
        return { items: [{ name: "Linda Park", board: { id: TEST_BOARDS.leads.boardId }, column_values: [{ id: "person", text: owner === 44432289 ? "John Smyth" : "Emily Stein", value: people }, { id: "people", text: "", value: null }] }] } as T;
      },
      async uploadFile(item, column) {
        if (uploads.length === failAt) throw new Error("failed");
        uploads.push(`${item}:${column}`);
      },
    };
    return { client, uploads };
  }

  it("uploads to the record's Files after checking it's the broker's", async () => {
    const { client, uploads } = monday(44432289);
    await expect(attachPhotos(client, boards, JOHN, { kind: "person", board: "leads", id: "1" }, [jpeg, jpeg], "acct")).resolves.toEqual({ name: "Linda Park", attached: 2 });
    expect(uploads).toEqual(["1:file_mm82xcfx", "1:file_mm82xcfx"]);
  });

  it("refuses someone else's record without uploading", async () => {
    const { client, uploads } = monday(25374507);
    await expect(attachPhotos(client, boards, JOHN, { kind: "person", board: "leads", id: "1" }, [jpeg], "acct")).rejects.toThrow("belongs to Emily Stein");
    expect(uploads).toEqual([]);
  });

  it("says how many made it when one fails", async () => {
    const { client } = monday(44432289, 1);
    const error = await attachPhotos(client, boards, JOHN, { kind: "person", board: "leads", id: "1" }, [jpeg, jpeg], "acct").catch((e) => e);
    expect(error).toBeInstanceOf(AttachIncomplete);
    expect(error.attached).toBe(1);
  });
});
