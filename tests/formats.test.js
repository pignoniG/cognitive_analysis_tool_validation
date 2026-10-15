import { test } from "node:test";
import assert from "node:assert/strict";

import { csvRow, isoLocal, EVENT_LOG_HEADER, eventLogRow, VISUAL_LOG_HEADER, visualLogRow, NBACK_LOG_HEADER,
  nbackLogRow, sessionFolder } from "../src/formats.js";

test("CSV quoting", () => {
  assert.equal(csvRow(["a", 1, null, undefined, 'say "hi"', "x,y"]), 'a,1,,,"say ""hi""","x,y"\n');
});

test("ISO times carry the offset and round-trip to the same instant", () => {
  const ms = Date.UTC(2026, 9, 15, 10, 30, 5, 123);
  const iso = isoLocal(ms);
  assert.match(iso, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}[+-]\d\d:\d\d$/);
  assert.equal(Date.parse(iso), ms);
});

test("event_log has cwtool's columns", () => {
  assert.deepEqual(EVENT_LOG_HEADER, ["Event", "Start Time", "End Time", "Duration (s)", "Start (unix s)", "End (unix s)"]);
  const row = eventLogRow("2-back", 1_760_000_000_000, 1_760_000_150_250).trim().split(",");
  assert.equal(row.length, 6);
  assert.deepEqual([row[0], row[3], row[4], row[5]], ["2-back", "150.250", "1760000000.000", "1760000150.250"]);
});

test("visual_log and nback_log rows fill their headers", () => {
  const step = { segment: 3, step: 2, type: "target_size", variant: "dark", change: "target_size", field: [36, 36, 36],
    target: { rgb: [255, 255, 255], diameter: 8 }, colour: null, scene: null, start: 70.4, duration: 6.1 };
  const v = visualLogRow(step, 1e12, 1e12 + 6100, { yGaze: 0.1 }).trim().split(",");
  assert.equal(v.length, VISUAL_LOG_HEADER.length);
  assert.equal(v[VISUAL_LOG_HEADER.indexOf("target_diameter_deg")], "8");
  assert.equal(v[VISUAL_LOG_HEADER.indexOf("Y_gaze")], "0.1");

  const n = nbackLogRow(2, 3, 14, { digit: 7, target: true, lure: false, onsetMs: 1000.4, responseMs: 1612.9 }, null, "hit")
    .trim().split(",");
  assert.equal(n.length, NBACK_LOG_HEADER.length);
  assert.equal(n[NBACK_LOG_HEADER.indexOf("rt_ms")], "613");
});

test("session folder names are safe", () => {
  assert.match(sessionFolder(" P 01/../x ", "vr", Date.now()), /^P-01-x_vr_\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d$/);
  assert.match(sessionFolder("", "screen", Date.now()), /^anonymous_screen_/);
});
