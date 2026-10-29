// Board and column ids for the Monday boards the app reads and writes.
// The test workspace ids come from docs/monday-test-boards.md; the live boards
// use the same column ids (checked Oct 29, 2026). Nothing else in the app
// hard-codes an id.

// Which boards the app uses. The deployed app uses the live boards; local
// runs and scripts use the test boards unless MONDAY_BOARDS=live is set, so
// trying something out never writes to a real client by accident.
export const USE_LIVE_BOARDS = process.env.MONDAY_BOARDS
  ? process.env.MONDAY_BOARDS === "live"
  : process.env.NODE_ENV === "production";

// The Vantage Monday account's web address, used for "Open in Monday" links.
// Fixed, so sign-in doesn't need the account:read scope to look it up.
export const MONDAY_ACCOUNT_SLUG = process.env.MONDAY_ACCOUNT_SLUG ?? "vantage-real-estate-services";

export type PersonBoardKey = "leads" | "contacts";

export interface PersonBoard {
  key: PersonBoardKey;
  label: string;
  boardId: string;
  columns: {
    businessName: string;
    contactType: string;
    propertyType: string;
    budget: string;
    size: string;
    desiredLocation: string;
    notes: string;
    followUp: string;
    contactBroker: string;
    coBrokers: string;
    phone: string;
    email: string;
    source: string;
    status?: string;
    contactAddress?: string; // Contacts only: a map column
    files: string;
  };
  // Label used when Contact Type has no value.
  contactTypeUnset: string;
  // Link columns to the property boards, shown in lookups.
  propertyLinks: string[];
}

export const TEST_BOARDS: Record<PersonBoardKey, PersonBoard> = {
  leads: {
    key: "leads",
    label: "Lead",
    boardId: "18435326752",
    columns: {
      businessName: "text_mkpmr5fe",
      contactType: "contact_type9",
      propertyType: "dropdown_mkqsh3rg",
      budget: "numeric_mm7yt73y",
      size: "text_mm7yw1c2",
      desiredLocation: "location_mkr71a8e",
      notes: "text",
      followUp: "date_mkqpryjm",
      contactBroker: "person",
      coBrokers: "people",
      phone: "phone",
      email: "email",
      source: "label7",
      status: "color_mkpme1c1",
      files: "file_mm82xcfx",
    },
    contactTypeUnset: "Not Set",
    propertyLinks: ["board_relation_mkr7eesb"],
  },
  contacts: {
    key: "contacts",
    label: "Contact",
    boardId: "18435326853",
    columns: {
      businessName: "text_mm82gy6x",
      contactType: "contact_type9",
      propertyType: "dropdown_mm7yh3e2",
      budget: "numeric_mm7y1ep3",
      size: "text_mm7yvh3n",
      desiredLocation: "location",
      notes: "text",
      followUp: "date_mm3rtdnf",
      contactBroker: "person",
      coBrokers: "people",
      phone: "phone",
      email: "email",
      source: "label7",
      contactAddress: "location_mkqhcmz4",
      files: "file_mm82c8v0",
    },
    contactTypeUnset: "Not Labeled",
    propertyLinks: ["connect_boards7", "board_relation_mm839kb1"],
  },
};

// The live boards (Main workspace): same columns, different board ids. Live
// Contacts has no link to Properties New; its Associated Properties column
// links to the old Properties board, as on the test board.
export const LIVE_BOARDS: Record<PersonBoardKey, PersonBoard> = {
  leads: { ...TEST_BOARDS.leads, boardId: "8842865081" },
  contacts: { ...TEST_BOARDS.contacts, boardId: "8842962019", propertyLinks: ["connect_boards7"] },
};

export const BROKER_NOTE_ACTIVITY_ID = "a087433e-74e8-45bb-9a91-a16346e18fbc";

// Option lists shared by Leads and Contacts.
export const CONTACT_TYPES = ["Property Owner", "Leasee", "Broker", "Buyer"] as const;
export const PROPERTY_TYPES = [
  "Office", "Retail", "Industrial", "Investment", "Land", "Healthcare",
  "Multifamily", "Specialty & Hospitality", "Business", "Residential",
] as const;
export const SOURCES = [
  "Business Development", "Social", "Cold Call", "Referral", "Personal Contact",
  "Phone", "Costar/LoopNet", "Crexi", "Sign", "Website",
] as const;

// Fields a Lead needs before the Qualified automation can move it to Contacts.
export const QUALIFY_REQUIRED = ["email", "phone", "propertyType", "source", "contactType"] as const;
