// Per-session memory: the names, phones, and emails used for matching are
// kept for one chat session and dropped after 10 minutes with no activity.
// Nothing here is written to disk.

const IDLE_MS = 10 * 60 * 1000;

export class IdleCache<V> {
  private entries = new Map<string, { value: V; touched: number }>();

  constructor(private idleMs = IDLE_MS, private now: () => number = Date.now) {}

  get(key: string): V | undefined {
    this.sweep();
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.touched = this.now();
    return entry.value;
  }

  set(key: string, value: V) {
    this.sweep();
    this.entries.set(key, { value, touched: this.now() });
  }

  delete(key: string) {
    this.entries.delete(key);
  }

  private sweep() {
    const cutoff = this.now() - this.idleMs;
    for (const [key, entry] of this.entries) if (entry.touched < cutoff) this.entries.delete(key);
  }
}
