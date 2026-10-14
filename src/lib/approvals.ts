import type { Store } from "./store";

// Approval settings, one per action type (spec: "Loosening later"). Every type
// starts at "confirm". Only the Operations Manager changes them.

export const ACTIONS = [
  { id: "create", name: "Create a record", detail: "A new Lead from a note, card, or sign. The broker becomes Contact Broker." },
  { id: "field", name: "Change a field", detail: "Requirement fields, contact details, and Follow Up Date on Leads and Contacts." },
  { id: "note", name: "Add a note", detail: "A Broker Note in the record's Emails & Activities timeline." },
  { id: "photo", name: "Attach a photo", detail: "Business cards, signs, and images added to a record's Files." },
  { id: "claim", name: "Claim a record", detail: "Setting the broker as Contact Broker on an unassigned record." },
  { id: "qualify", name: "Move a Lead to Contacts", detail: "Setting Status to Qualified, which starts the Monday automation that moves the Lead." },
] as const;

export type ActionId = (typeof ACTIONS)[number]["id"];
export type Mode = "confirm" | "auto";

export interface ApprovalSettings {
  modes: Record<ActionId, Mode>;
  changedBy?: string;
  changedAt?: string;
}

const KEY = "settings:approvals";

export function defaults(): ApprovalSettings {
  return { modes: Object.fromEntries(ACTIONS.map((a) => [a.id, "confirm"])) as Record<ActionId, Mode> };
}

export async function readApprovals(store: Store): Promise<ApprovalSettings> {
  const saved = await store.get<ApprovalSettings>(KEY);
  const base = defaults();
  if (!saved?.modes) return base;
  for (const a of ACTIONS) if (saved.modes[a.id] === "auto") base.modes[a.id] = "auto";
  return { ...base, changedBy: saved.changedBy, changedAt: saved.changedAt };
}

export async function setApproval(store: Store, action: string, mode: string, by: string): Promise<ApprovalSettings> {
  if (!ACTIONS.some((a) => a.id === action)) throw new Error("Unknown action type.");
  if (mode !== "confirm" && mode !== "auto") throw new Error("Unknown setting.");
  const current = await readApprovals(store);
  const next: ApprovalSettings = {
    modes: { ...current.modes, [action]: mode },
    changedBy: by,
    changedAt: new Date().toISOString(),
  };
  await store.set(KEY, next);
  return next;
}

// The Operations Manager: Monday user ids in OPERATIONS_MANAGER_IDS.
export function isOperationsManager(userId: string): boolean {
  return (process.env.OPERATIONS_MANAGER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean).includes(userId);
}
