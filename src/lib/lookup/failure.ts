import Anthropic from "@anthropic-ai/sdk";
import { BoardHidden, MondayError, mondayReason } from "../monday/client";
import { SummaryProblem } from "./summary";

// What the broker sees when a lookup fails: a plain sentence with a short
// reason, never a technical message. When rephrasing could help, it asks for
// another way; when the trouble is Monday or Claude being busy or out of
// reach, asking differently wouldn't help, so it says to try again. The
// technical detail goes to the server log only.

const ASK_AGAIN = "I couldn't answer that. Can you ask in another way?";

export function lookupFailure(error: unknown): { message: string; status: number } {
  if (error instanceof BoardHidden) return { message: error.message, status: 403 };

  if (error instanceof MondayError) {
    const reason = mondayReason(error);
    if (/complexity|budget|rate limit|too many|429/i.test(reason)) {
      return { message: "I couldn't answer that: Monday is busy right now. Try again in a minute.", status: 503 };
    }
    if (/couldn't be reached|HTTP 5\d\d/i.test(reason)) {
      return { message: "I couldn't answer that: Monday didn't respond. Try again in a moment.", status: 502 };
    }
    return { message: `${ASK_AGAIN} Monday couldn't run the search it needed.`, status: 502 };
  }

  if (error instanceof Anthropic.APIConnectionError) {
    return { message: "I couldn't answer that: Claude couldn't be reached. Try again in a moment.", status: 502 };
  }
  if (error instanceof Anthropic.APIError) {
    if (error.status === 429 || error.status === 529 || /overloaded/i.test(error.message)) {
      return { message: "I couldn't answer that: Claude is busy right now. Try again in a minute.", status: 503 };
    }
    if (error.status && error.status >= 500) {
      return { message: "I couldn't answer that: Claude had a problem. Try again in a moment.", status: 502 };
    }
    if (/too long|too large|too many tokens/i.test(error.message)) {
      return { message: `${ASK_AGAIN} It needed more records than Claude can read at once. Try naming a property type or a town.`, status: 502 };
    }
    return { message: `${ASK_AGAIN} Claude couldn't work with the question as asked.`, status: 502 };
  }

  if (error instanceof SummaryProblem) {
    return {
      message: error.why === "declined"
        ? `${ASK_AGAIN} Claude declined to summarize it.`
        : `${ASK_AGAIN} The summary came back incomplete.`,
      status: 502,
    };
  }

  return { message: `${ASK_AGAIN} Something went wrong on our side, and it's been logged.`, status: 500 };
}
