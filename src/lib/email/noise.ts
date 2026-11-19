import type { MailMessage } from "./source";

// The rule-based noise filter (spec 02, step 2; config/noise-senders.json in
// the package). Runs in code before any model call, in this order:
// 1. a lead-platform notification is never noise; 2. the broker's Always
// Noise rules; 3. known notification senders; 4. noise domains, matched on
// whole labels; 5. subject prefixes; 6. List-Unsubscribe or Auto-Submitted.

export type NoiseKind = "receipt" | "calendar" | "auto-reply" | "notification" | "newsletter" | "your rule";

export const NOISE_RULES = {
  leadSourceDomains: ["loopnet.com", "crexi.com", "showcase.com", "ten-x.com", "costar.com"],
  notLeadSourceDomains: ["email.costar.com"], // CoStar newsletters, not lead notices
  senders: ["notifications@monday.com"],
  domainSuffixes: ["ccsend.com", "email.costar.com", "buildium.com"],
  subjectPrefixes: [
    { prefix: "read:", kind: "receipt" },
    { prefix: "delivered:", kind: "receipt" },
    { prefix: "undeliverable:", kind: "receipt" },
    { prefix: "synced invitation:", kind: "calendar" },
    { prefix: "automatic reply:", kind: "auto-reply" },
  ] as { prefix: string; kind: NoiseKind }[],
};

// The broker's own rules (Settings, later): an address, a domain or a subject phrase.
export interface AlwaysNoise {
  pattern: string;
}

const domainOf = (address: string) => address.split("@")[1]?.toLowerCase() ?? "";

// Whole labels: "email.costar.com" matches itself and its subdomains, never "notemail.costar.com".
export function domainMatches(domain: string, suffix: string): boolean {
  return domain === suffix || domain.endsWith(`.${suffix}`);
}

export function isLeadSource(address: string): boolean {
  const d = domainOf(address);
  if (NOISE_RULES.notLeadSourceDomains.some((s) => domainMatches(d, s))) return false;
  return NOISE_RULES.leadSourceDomains.some((s) => domainMatches(d, s));
}

export function noiseKind(m: MailMessage, always: AlwaysNoise[] = []): NoiseKind | null {
  const from = m.from.address;
  if (isLeadSource(from)) return null;
  const subject = m.subject.trim().toLowerCase();
  if (always.some((r) => {
    const p = r.pattern.trim().toLowerCase();
    if (!p) return false;
    if (p.includes("@")) return from === p;
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(p)) return domainMatches(domainOf(from), p);
    return subject.includes(p);
  })) return "your rule";
  if (NOISE_RULES.senders.includes(from)) return "notification";
  if (NOISE_RULES.domainSuffixes.some((s) => domainMatches(domainOf(from), s))) return "newsletter";
  const prefix = NOISE_RULES.subjectPrefixes.find((p) => subject.startsWith(p.prefix));
  if (prefix) return prefix.kind;
  if (m.autoSubmitted === "auto-generated" || m.autoSubmitted === "auto-replied") return m.autoSubmitted === "auto-replied" ? "auto-reply" : "notification";
  if (m.listUnsubscribe) return "newsletter";
  return null;
}
