import type { Store } from "./store.ts";
import type { Reminder } from "./types.ts";

const MAX_AHEAD_MS = 366 * 864e5;

/**
 * Works out when a reminder is due from the tool input: `in_minutes` from
 * now, or `at` as a local date-time ("2026-10-21T08:30"). Returns an error
 * message string when neither gives a sensible future time.
 */
export function parseDue(input: { in_minutes?: unknown; at?: unknown }, now = Date.now()): number | string {
  let due = NaN;
  if (input.in_minutes != null && input.in_minutes !== "") due = now + Number(input.in_minutes) * 60_000;
  else if (typeof input.at === "string" && input.at.trim()) due = Date.parse(input.at.trim());
  if (!Number.isFinite(due)) return 'Give "in_minutes" (a number) or "at" (a local date-time like 2026-10-21T08:30).';
  if (due < now - 60_000) return "That time has already passed.";
  if (due > now + MAX_AHEAD_MS) return "Reminders can be at most a year ahead.";
  return Math.max(due, now);
}

/**
 * Checks for due reminders every few seconds. `deliver` hands one to the
 * open pages and returns whether any page received it; undelivered ones are
 * retried when a page connects (`deliverPending`).
 */
export class ReminderClock {
  #store: Store;
  #deliver: (r: Reminder) => boolean;
  #timer: NodeJS.Timeout | null = null;

  constructor(store: Store, deliver: (r: Reminder) => boolean) {
    this.#store = store;
    this.#deliver = deliver;
  }

  start(everyMs = 10_000): void {
    this.#timer = setInterval(() => void this.tick(), everyMs);
    this.#timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
  }

  /** Fires every reminder that is due and hasn't fired yet. */
  async tick(now = Date.now()): Promise<Reminder[]> {
    const state = await this.#store.load();
    const due = state.reminders.filter((r) => !r.firedAt && r.due <= now);
    if (!due.length) return [];
    await this.#store.update(() => {
      for (const r of due) {
        r.firedAt = now;
        r.delivered = this.#deliver(r);
      }
    });
    return due;
  }

  /** Delivers reminders that fired while no page was open. */
  async deliverPending(): Promise<void> {
    const state = await this.#store.load();
    const waiting = state.reminders.filter((r) => r.firedAt && !r.delivered);
    if (!waiting.length) return;
    await this.#store.update(() => {
      for (const r of waiting) r.delivered = this.#deliver(r);
    });
  }
}
