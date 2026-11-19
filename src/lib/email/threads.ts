import { noiseKind, type AlwaysNoise, type NoiseKind } from "./noise";
import type { MailMessage, Person } from "./source";

// Mail grouped into conversations (Graph conversationId), with what code can
// settle before Claude sees anything: noise, who took part, and whether the
// broker replied after the latest message in.

export const INTERNAL_DOMAINS = ["vantageres.com", "vantagepm.com"];
export const isInternal = (address: string) => INTERNAL_DOMAINS.some((d) => address.toLowerCase().endsWith(`@${d}`));

export interface Thread {
  conversationId: string;
  subject: string;
  messages: MailMessage[]; // in the window, oldest first
  inbound: MailMessage[]; // received, not from the broker, not noise
  latestInbound: MailMessage | null;
  brokerRepliedAt: string | null; // a Sent message after the latest inbound one
  participants: Person[]; // everyone but the broker
  webLink?: string; // newest received message
}

export interface Sorted {
  threads: Thread[]; // with new mail that needs sorting
  noise: Partial<Record<NoiseKind, number>>; // messages, by kind
  sentOnly: Thread[]; // only the broker's own mail in the window (feeds open items later)
}

export function sortMail(messages: MailMessage[], owner: Person, seen: Set<string>, always: AlwaysNoise[] = []): Sorted {
  const noise: Sorted["noise"] = {};
  const byConversation = new Map<string, MailMessage[]>();
  for (const m of messages) {
    const list = byConversation.get(m.conversationId) ?? [];
    list.push(m);
    byConversation.set(m.conversationId, list);
  }

  const threads: Thread[] = [];
  const sentOnly: Thread[] = [];
  for (const [conversationId, list] of byConversation) {
    list.sort((a, b) => a.at.localeCompare(b.at));
    const received = list.filter((m) => m.folder === "inbox" && m.from.address !== owner.address);
    const inbound: MailMessage[] = [];
    for (const m of received) {
      const kind = noiseKind(m, always);
      if (!kind) {
        inbound.push(m);
      } else if (!seen.has(m.id)) {
        noise[kind] = (noise[kind] ?? 0) + 1;
      }
    }
    // Messages from the broker to themselves (calendar syncs and the like).
    for (const m of list) {
      if (m.folder === "inbox" && m.from.address === owner.address && !seen.has(m.id)) {
        const kind = noiseKind(m, always);
        if (kind) noise[kind] = (noise[kind] ?? 0) + 1;
      }
    }

    const latestInbound = inbound.at(-1) ?? null;
    const brokerReply = latestInbound ? list.filter((m) => m.folder === "sent" && m.at > latestInbound.at).at(-1) : null;
    const people = new Map<string, Person>();
    for (const m of list) for (const p of [m.from, ...m.to, ...m.cc]) if (p.address && p.address !== owner.address && !people.has(p.address)) people.set(p.address, p);
    const thread: Thread = {
      conversationId,
      subject: (latestInbound ?? list.at(-1)!).subject,
      messages: list,
      inbound,
      latestInbound,
      brokerRepliedAt: brokerReply?.at ?? null,
      participants: [...people.values()],
      webLink: (latestInbound ?? received.at(-1))?.webLink,
    };
    // Sorted only when it has an inbound message not sorted before.
    if (inbound.some((m) => !seen.has(m.id))) threads.push(thread);
    else if (!received.length && list.some((m) => m.folder === "sent")) sentOnly.push(thread);
  }
  return { threads, noise, sentOnly };
}
