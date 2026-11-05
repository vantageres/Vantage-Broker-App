import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { lookupFailure } from "./failure";
import { BoardHidden, MondayError } from "../monday/client";
import { SummaryProblem } from "./summary";

const apiError = (status: number, message: string) => new Anthropic.APIError(status, { type: "error", error: { message } }, message, new Headers());

describe("lookupFailure", () => {
  it("asks for another way, with a short reason, when rephrasing could help", () => {
    expect(lookupFailure(new TypeError("Cannot read properties of undefined (reading 'items_page')")).message)
      .toBe("I couldn't answer that. Can you ask in another way? Something went wrong on our side, and it's been logged.");
    expect(lookupFailure(new SummaryProblem("declined", "x")).message).toBe("I couldn't answer that. Can you ask in another way? Claude declined to summarize it.");
    expect(lookupFailure(new SummaryProblem("unreadable", "x")).message).toBe("I couldn't answer that. Can you ask in another way? The summary came back incomplete.");
    expect(lookupFailure(apiError(400, "prompt is too long: 250000 tokens")).message)
      .toBe("I couldn't answer that. Can you ask in another way? It needed more records than Claude can read at once. Try naming a property type or a town.");
    expect(lookupFailure(new MondayError("Monday rejected the request", [{ message: "Column not found" }])).message)
      .toBe("I couldn't answer that. Can you ask in another way? Monday couldn't run the search it needed.");
  });

  it("says to try again when Monday or Claude is busy or out of reach", () => {
    expect(lookupFailure(new MondayError("Monday rejected the request", [{ message: "Complexity budget exhausted" }])).message)
      .toBe("I couldn't answer that: Monday is busy right now. Try again in a minute.");
    expect(lookupFailure(new MondayError("Monday couldn't be reached (fetch failed)")).message)
      .toBe("I couldn't answer that: Monday didn't respond. Try again in a moment.");
    expect(lookupFailure(new MondayError("Monday returned HTTP 503")).message).toBe("I couldn't answer that: Monday didn't respond. Try again in a moment.");
    expect(lookupFailure(apiError(529, "Overloaded")).message).toBe("I couldn't answer that: Claude is busy right now. Try again in a minute.");
    expect(lookupFailure(new Anthropic.APIConnectionError({ message: "Connection error." })).message)
      .toBe("I couldn't answer that: Claude couldn't be reached. Try again in a moment.");
  });

  it("keeps the plain message for a board the broker can't see", () => {
    expect(lookupFailure(new BoardHidden("the Leads board"))).toEqual({
      message: "You don't have access to the Leads board in Monday. Ask a board owner to add you.",
      status: 403,
    });
  });

  it("never shows technical detail", () => {
    for (const e of [new TypeError("Cannot read properties of undefined"), apiError(500, "internal stack trace"), new MondayError("Monday returned HTTP 500")]) {
      expect(lookupFailure(e).message).not.toMatch(/undefined|stack|HTTP|\(/);
    }
  });
});
