// Property Leads, the seller-side listing pipeline: the fields a broker can
// see and change, and the status rules. Shared by the server (which enforces
// them) and the card (which shows them). No server-only code here.

export type LeadField =
  | "status" | "listingType" | "propertyType" | "listingPrice" | "sizeAvailable"
  | "dateListed" | "listingExpiration" | "laSigned"
  | "keyForBroker" | "loans" | "currentOnLoans" | "lender";

export type FieldKind = "status" | "text" | "date" | "checkbox";

export interface FieldDef {
  field: LeadField;
  label: string;
  kind: FieldKind;
  options?: readonly string[];
  // Shown only to the Broker, Co-Broker and Co-Broker2 (spec: sensitive property fields).
  sensitive?: boolean;
}

// Statuses a broker can set from the app, with approval.
export const SETTABLE_STATUSES = [
  "New Lead", "Listing Presentation", "LA In Progress", "LA Signed", "Marketing Review", "Unqualified Lead/Archive",
] as const;

// Statuses set in Monday only, and why. Each starts an automation, or is set by one.
export const MONDAY_ONLY_STATUSES: Record<string, string> = {
  "Generate Property Folder and LA": "It creates the property folder and listing agreement, and needs a linked Vantage Contact.",
  "In Marketing": "Its automation needs an LA Signed date.",
  "On Market": "It moves the listing to the older properties board.",
  "Error - See Update": "Monday's automations set it.",
  "Ready for New Documents": "Monday's automations set it.",
};

export const LISTING_TYPES = ["Lease", "Sale", "Sale or Lease", "Not Set"] as const;
export const LEAD_PROPERTY_TYPES = ["Office", "Retail", "Industrial/Flex", "Land", "Farm/Agricultural", "Multifamily", "Mixed-Use", "Other"] as const;

export const FIELDS: FieldDef[] = [
  { field: "status", label: "Status", kind: "status", options: SETTABLE_STATUSES },
  { field: "listingType", label: "Listing Type", kind: "status", options: LISTING_TYPES },
  { field: "propertyType", label: "Property Type", kind: "status", options: LEAD_PROPERTY_TYPES },
  { field: "listingPrice", label: "Listing Price", kind: "text" },
  { field: "sizeAvailable", label: "Size Available", kind: "text" },
  { field: "dateListed", label: "Date Listed", kind: "date" },
  { field: "listingExpiration", label: "Listing Expiration Date", kind: "date" },
  { field: "laSigned", label: "LA Signed (date)", kind: "date" },
  { field: "keyForBroker", label: "Key for Broker", kind: "text", sensitive: true },
  { field: "loans", label: "Outstanding Loans Amount", kind: "text", sensitive: true },
  { field: "currentOnLoans", label: "Current On Loan Payments", kind: "checkbox", sensitive: true },
  { field: "lender", label: "Lender Name & Contact Info", kind: "text", sensitive: true },
];

export const fieldDef = (field: LeadField) => FIELDS.find((f) => f.field === field)!;

export interface LeadChange {
  field: LeadField;
  from: string; // what the broker saw, so a change made in Monday meanwhile isn't overwritten
  to: string;
}

// Values as the app holds them: dates as YYYY-MM-DD, a checkbox as "Yes" or "".
export function sameValue(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

// What a status change will start, said on the approval card.
export function statusNote(to: string): string | null {
  // LA Signed starts Monday's marketing automations (seen on Property Leads Test,
  // Oct 14, 2026: checklist subitems, Pre-Listing group, Status In Marketing).
  // Brokers get one plain line, at John's request.
  if (to === "LA Signed") return "This moves the listing into marketing.";
  // Other statuses haven't been tried on the test board, so nothing is promised.
  return "Monday may update this listing after the change.";
}
