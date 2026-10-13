// Board and column ids for the Monday boards the app reads and writes.
// The test workspace ids come from docs/monday-test-boards.md. Live ids are
// added at cutover; nothing else in the app hard-codes an id.

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
  };
  // Label used when Contact Type has no value.
  contactTypeUnset: string;
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
    },
    contactTypeUnset: "Not Set",
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
    },
    contactTypeUnset: "Not Labeled",
  },
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
