import { describe, expect, it } from "vitest";
import { photoNoteText } from "./service";

describe("the Broker Note for a photo", () => {
  it("is one short line, plus anything the broker typed", () => {
    expect(photoNoteText("", { kind: "business_card", unreadable: null })).toBe("Added from a business card.");
    expect(photoNoteText("Met at the NAIOP lunch", { kind: "business_card", unreadable: null })).toBe("Added from a business card.\n\nMet at the NAIOP lunch");
    expect(photoNoteText("Typed only", null)).toBe("Typed only");
  });
});
