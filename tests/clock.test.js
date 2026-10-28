import { test } from "node:test";
import assert from "node:assert/strict";

import { ClockSync, ClockRecorder, CLOCK_LOG_HEADER } from "../src/clock.js";
import { Sink } from "../src/sink.js";

/** A virtual client clock and a server whose clock is `offset` ms ahead; each round trip has its own delays. */
function world({ offset = 2500, delays = [], wallStep = 0, start = 1.7e12 }) {
  let clock = start, i = 0;
  return {
    now: () => clock,
    wall: () => clock + wallStep,
    async fetchTime() {
      const [up, down] = delays[i++ % delays.length];
      clock += up;
      const serverTime = clock + offset;       // the server's clock when the request arrives
      clock += down;
      return serverTime;
    },
  };
}

test("the offset comes from the round trip with the shortest delay", async () => {
  const w = world({ offset: 2500, delays: [[40, 90], [60, 30], [5, 6], [200, 50], [30, 120]] });
  const m = await new ClockSync(w).measure(5);
  assert.equal(m.ok, true);
  assert.equal(m.rtt_ms, 11);                                   // the 5 ms + 6 ms trip
  assert.ok(Math.abs(m.offset_ms - 2500) <= m.rtt_ms / 2, `${m.offset_ms}`);   // never worse than half its round trip
  assert.equal(m.samples, 5);
  assert.equal(m.page_vs_wall_ms, 0);
});

test("a symmetric network gives the exact offset, a negative offset is kept", async () => {
  for (const offset of [2500, -37.25, 0]) {
    const m = await new ClockSync(world({ offset, delays: [[20, 20], [25, 25]] })).measure(4);
    assert.ok(Math.abs(m.offset_ms - offset) < 1e-6, `${offset}: ${m.offset_ms}`);
  }
});

test("a wall clock that was stepped after the page opened shows in page_vs_wall_ms", async () => {
  const m = await new ClockSync(world({ delays: [[10, 10]], wallStep: 750 })).measure(3);
  assert.equal(m.page_vs_wall_ms, 750);
});

test("no server: the measurement fails softly", async () => {
  const sync = new ClockSync({ fetchTime: async () => { throw new Error("offline"); }, now: () => 0, wall: () => 0 });
  assert.deepEqual(await sync.measure(3), { ok: false, reason: "offline" });
  // partial failure: the samples that arrived are used
  let calls = 0;
  const flaky = new ClockSync({ fetchTime: async () => { if (++calls > 2) throw new Error("late"); return 1000; }, now: () => 10, wall: () => 10 });
  const m = await flaky.measure(5);
  assert.equal(m.ok, true);
  assert.equal(m.samples, 2);
});

test("the recorder writes clock_offset.csv as it goes and summarises the drift", async () => {
  const sink = new Sink("t", false);
  const rec = new ClockRecorder(sink, { sync: new ClockSync(world({ offset: 1000, delays: [[10, 10]] })) });
  await rec.measure("start", null, 3);
  // ten minutes later the server's clock is 30 ms further ahead
  rec.sync = new ClockSync(world({ offset: 1030, delays: [[10, 10]], start: 1.7e12 + 600000 }));
  await rec.measure("end", 600, 3);
  const rows = sink.files.get("clock_offset.csv").trim().split("\n").map((l) => l.split(","));
  assert.deepEqual(rows[0], CLOCK_LOG_HEADER);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.slice(1).map((r) => r[0]), ["start", "end"]);
  const s = rec.summary();
  assert.equal(s.available, true);
  assert.ok(Math.abs(s.start.offset_ms - 1000) < 1e-6 && Math.abs(s.end.offset_ms - 1030) < 1e-6);
  assert.ok(Math.abs(s.drift_ms_per_min - 3) < 0.01, `${s.drift_ms_per_min}`);
  assert.match(s.convention, /server_unix_ms = logged_unix_ms \+ offset_ms/);
});

test("without a server the summary says so and no file is written", async () => {
  const sink = new Sink("t", false);
  const rec = new ClockRecorder(sink, { sync: new ClockSync({ fetchTime: async () => { throw new Error("api/time: 404"); }, now: () => 0, wall: () => 0 }) });
  assert.equal((await rec.measure("start")).ok, false);
  assert.equal(sink.files.has("clock_offset.csv"), false);
  const s = rec.summary();
  assert.equal(s.available, false);
  assert.equal(s.reason, "api/time: 404");
});
