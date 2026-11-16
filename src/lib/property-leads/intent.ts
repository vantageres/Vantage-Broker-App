// Is the broker asking to create a Property Lead ("New Property Lead: 140
// Main St…", "Add a property lead for 22 Elm St")? Decided without Claude, so
// the note goes to the right reader. A question about Property Leads ("Any
// new property leads this week?") is a lookup, not a request to create one.
const CREATE = /\b(new|add|create|start|open|enter|log)\b[^.?!\n]{0,40}\bproperty lead\b|^\s*property lead\s*[:-]/i;
const ASKING = /^\s*(any|what|what's|which|who|how many|list|show|find|are there|is there|did|do we)\b/i;

export function asksForNewPropertyLead(text: string): boolean {
  return CREATE.test(text) && !ASKING.test(text);
}
