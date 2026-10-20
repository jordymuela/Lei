import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ReminderClock, parseDue } from "../server/reminders.ts";
import { Store, addReminder } from "../server/store.ts";
import type { Reminder } from "../server/types.ts";

test("parseDue accepts minutes from now or a date-time, and rejects nonsense", () => {
  const now = Date.parse("2026-10-20T10:00:00");
  assert.equal(parseDue({ in_minutes: 30 }, now), now + 30 * 60_000);
  assert.equal(parseDue({ at: "2026-10-20T18:30" }, now), Date.parse("2026-10-20T18:30"));
  assert.match(String(parseDue({}, now)), /in_minutes/);
  assert.match(String(parseDue({ at: "2026-10-19T09:00" }, now)), /already passed/);
  assert.match(String(parseDue({ in_minutes: 60 * 24 * 400 }, now)), /a year/);
});

test("due reminders fire once; undelivered ones wait for a page", async () => {
  const store = new Store(path.join(await mkdtemp(path.join(tmpdir(), "lei-")), "state.json"));
  await store.update((s) => {
    addReminder(s, "stretch", 1000, 0);
    addReminder(s, "later", 5000, 0);
  });
  const got: Reminder[] = [];
  let pageOpen = false;
  const clock = new ReminderClock(store, (r) => {
    if (pageOpen) got.push(r);
    return pageOpen;
  });
  assert.deepEqual((await clock.tick(2000)).map((r) => r.text), ["stretch"]);
  assert.equal(got.length, 0);
  assert.equal((await clock.tick(3000)).length, 0);
  pageOpen = true;
  await clock.deliverPending();
  assert.deepEqual(got.map((r) => r.text), ["stretch"]);
  await clock.deliverPending();
  assert.equal(got.length, 1);
});
