import { describe, expect, it } from "vitest";
import { photoNoteText } from "./service";

describe("the Broker Note for a photo", () => {
  it("is one short line, plus anything the broker typed", () => {
    const card = { kind: "business_card" as const, unreadable: null, sign: null };
    expect(photoNoteText("", card)).toBe("Added from a business card.");
    expect(photoNoteText("Met at the NAIOP lunch", card)).toBe("Added from a business card.\n\nMet at the NAIOP lunch");
    expect(photoNoteText("", { kind: "sign", unreadable: null, sign: { listing: "For Lease", address: null } })).toBe("Added from a sign photo.");
    expect(photoNoteText("Typed only", null)).toBe("Typed only");
  });
});
