import type { PersonRecord } from "../monday/records";
import { isInternal } from "./threads";
import type { Person } from "./source";

// Who an address is, settled in code: Monday first (decision 7: no separate
// directory for people already there), then the internal domains. Unknown
// external people go to Claude, which proposes a type.

export type Bin =
  | "Client" | "Prospect" | "Outside Broker" | "Attorney" | "Lender" | "Title and Escrow" | "Appraiser or Inspector"
  | "Vendor" | "Internal Broker" | "Internal Staff" | "Personal" | "Lead Source" | "Noise";

export interface Known {
  bin: Bin;
  inMonday?: { board: "Leads" | "Contacts"; name: string; url: string; owner: string };
}

// A Contact is a client; a Lead a prospect; either with Contact Type Broker is an outside broker.
export function binFromMonday(record: PersonRecord): Bin {
  if (record.current.contactType === "Broker") return "Outside Broker";
  return record.board.key === "contacts" ? "Client" : "Prospect";
}

// Exact address match in code: Monday's contains_text also returns
// bigjohn@x.com for john@x.com, so only an exact match counts.
export function knownPeople(people: Person[], records: PersonRecord[], brokerNames: string[]): Map<string, Known> {
  const out = new Map<string, Known>();
  const brokers = new Set(brokerNames.map((n) => n.trim().toLowerCase()));
  for (const p of people) {
    if (isInternal(p.address)) {
      out.set(p.address, { bin: brokers.has(p.name.trim().toLowerCase()) ? "Internal Broker" : "Internal Staff" });
      continue;
    }
    // Contacts win over Leads when someone is on both.
    const matches = records.filter((r) => r.emails.includes(p.address)).sort((a, b) => (a.board.key === "contacts" ? -1 : 1) - (b.board.key === "contacts" ? -1 : 1));
    const r = matches[0];
    if (r) {
      out.set(p.address, {
        bin: binFromMonday(r),
        inMonday: { board: r.board.key === "contacts" ? "Contacts" : "Leads", name: r.name, url: r.url, owner: r.contactBrokerNames },
      });
    }
  }
  return out;
}
