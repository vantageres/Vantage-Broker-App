import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "../store";
import { BOARDS, peopleMatching, propertyLeadsFor, type Context } from "../capture/service";
import { teamFor } from "../monday/team";
import { claudeClassifier, savedClassifier, type Classifier } from "./classify";
import { accessToken, getConnection } from "./connection";
import { knownPeople } from "./people";
import { runCheck, type MonitorState, type Run } from "./run";
import { sealer } from "./server";
import { devMailboxFile, fileSource, outlookSource, type MailSource, type Person } from "./source";

// Wires a run to the real pieces: the broker's mail (Outlook, or the
// development file), Monday for who people are and for deals, Claude (or
// saved answers in development), and the store. Runs and state are sealed
// and expire on their own (plan decision 6).

const RUN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const STATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const runKey = (userId: string) => `email:run:${userId}`;
const stateKey = (userId: string) => `email:state:${userId}`;

export class NotConnected extends Error {
  constructor() {
    super("Connect Outlook first.");
  }
}

export async function mailSourceFor(userId: string): Promise<MailSource> {
  const file = devMailboxFile();
  if (file) return fileSource(file);
  const deps = { store: getStore(), sealer };
  const conn = await getConnection(deps, userId);
  if (!conn) throw new NotConnected();
  const token = await accessToken(deps, userId);
  return outlookSource(token, { name: conn.name, address: conn.address });
}

// Development uses saved answers when DEV_CLASSIFICATION_FILE is set, so made-up
// or snapshot mail never needs the Claude key.
export function classifierFor(env = process.env): Classifier {
  if (env.NODE_ENV !== "production" && env.DEV_CLASSIFICATION_FILE) return savedClassifier(env.DEV_CLASSIFICATION_FILE);
  const apiKey = env.BROKER_APP_ANTHROPIC_KEY;
  if (!apiKey) throw new Error("Claude is not set up for the email monitor.");
  return claudeClassifier(new Anthropic({ apiKey, authToken: null }));
}

async function lookupInMonday(ctx: Context, people: Person[]) {
  const external = people.filter((p) => !/@(vantageres|vantagepm)\.com$/i.test(p.address)).map((p) => p.address);
  try {
    const [records, team] = await Promise.all([
      external.length ? peopleMatching(ctx.monday, ctx.accountSlug, { words: [], phones: [], emails: external }) : Promise.resolve([]),
      teamFor(ctx.monday, BOARDS.leads).catch(() => null),
    ]);
    return knownPeople(people, records, team?.people.map((p) => p.name) ?? []);
  } catch (error) {
    console.error(`[email] Monday lookup failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    return null;
  }
}

async function readSealed<T>(key: string): Promise<T | null> {
  const sealed = await getStore().get<string>(key);
  return sealed ? sealer.unseal<T>(sealed) : null;
}

export function latestRun(userId: string): Promise<Run | null> {
  return readSealed<Run>(runKey(userId));
}

export async function checkNow(ctx: Context): Promise<Run> {
  const source = await mailSourceFor(ctx.me.id);
  const state = (await readSealed<MonitorState>(stateKey(ctx.me.id))) ?? { seen: {} };
  const { run, state: next } = await runCheck({
    source,
    classify: classifierFor(),
    brokerName: ctx.me.name,
    deals: async () => (await propertyLeadsFor(ctx)).map((l) => ({ id: l.id, name: l.name })),
    lookup: (people) => lookupInMonday(ctx, people),
  }, state);
  const store = getStore();
  await store.set(runKey(ctx.me.id), await sealer.seal(run), { px: RUN_TTL_MS });
  await store.set(stateKey(ctx.me.id), await sealer.seal(next), { px: STATE_TTL_MS });
  return run;
}

// Development: start again from an empty state, so the made-up mail is sorted afresh.
export async function resetMonitor(userId: string) {
  await getStore().del(runKey(userId));
  await getStore().del(stateKey(userId));
}
