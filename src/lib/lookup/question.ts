// Is the broker asking what Monday holds, rather than writing a note? Decided
// without Claude so a lookup answers fast. A wrong guess is one tap to undo:
// every answer offers "Read it as a note instead".

// Openings that are almost always a question.
const ASKING = /^(what|what's|whats|who|who's|whos|where|which|any|anything|tell me|show me|show|find|look ?up|lookup|pull up|get me|give me|info on|details on|search|status of|status on)\b/i;
// Openings that also start ordinary notes ("Did a tour with…"): a question only with a question mark.
const MAYBE = /^(is|are|do|does|did|has|have|had|can|when|how|was|were|should)\b/i;

export function isQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (ASKING.test(t)) return true;
  const asked = t.endsWith("?");
  if (asked && MAYBE.test(t)) return true;
  // A short line ending in "?" ("Linda Park?") is a question; a long note that
  // ends with one is still a note.
  return asked && t.split(/\s+/).length <= 12;
}
