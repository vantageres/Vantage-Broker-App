// What went wrong connecting Outlook, as a short code for the URL, and the
// sentence the Email tab shows for it.

export type Outcome = "connected" | "admin-approval" | "declined" | "no-mail-read" | "expired" | "not-set-up" | "failed";

// Microsoft's sign-in errors. AADSTS65001 / 90094 / 900941 mean the tenant
// requires an admin to approve the app first.
export function outlookProblem(error: string, description: string | null): Outcome {
  if (/AADSTS(65001|90094|900941|90095)\b/.test(description ?? "")) return "admin-approval";
  if (error === "consent_required" || error === "access_denied") return "declined";
  return "failed";
}

export const OUTCOME_TEXT: Record<Outcome, string> = {
  connected: "Outlook is connected.",
  "admin-approval": "Your Microsoft account needs admin approval for Broker Assistant. Contact John Smyth.",
  declined: "Outlook was not connected, because access was not allowed.",
  "no-mail-read": "Outlook was connected without permission to read mail, so the monitor can't run. Connect again and allow reading mail.",
  expired: "That took too long or came from another sign-in. Try Connect Outlook again.",
  "not-set-up": "The Outlook connection is not set up yet.",
  failed: "Outlook could not be connected. Try again in a minute.",
};

export function isOutcome(value: string | undefined): value is Outcome {
  return !!value && value in OUTCOME_TEXT;
}
