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

test("the headset line tells whether the trigger will register", async () => {
  const { describeHeadset } = await import("../src/vrinput.js");
  const none = describeHeadset({ frameRate: 90, visibility: "visible", input: { sources: [] } });
  assert.ok(none.warn && none.text.includes("NO CONTROLLER") && none.text.startsWith("in the headset, 90 Hz"));
  const input = { sources: [{ hand: "left" }, { hand: "right" }], select_events: 3, polled_edges: 3,
    by_hand: { "left select": 3, "left gamepad": 3 }, buttons: { "left:0": 3, "right:1": 2 } };
  const two = describeHeadset({ visibility: "visible", input }, true);
  assert.equal(two.warn, false);
  assert.ok(two.text.includes("2 controllers (left, right), trigger presses seen: 3 (+3 read from the gamepad)"));
  assert.ok(two.text.includes("by hand: left select ×3, left gamepad ×3") && two.text.includes("buttons: left:0 ×3, right:1 ×2"));
  // listed but silent while a session runs: a warning; before the session it is not one yet
  const silent = { visibility: "visible-blurred", input: { sources: [{ hand: "right" }], select_events: 0, polled_edges: 0 } };
  assert.equal(describeHeadset(silent, true).warn, true);
  assert.equal(describeHeadset(silent, false).warn, false);
  assert.ok(describeHeadset(silent).text.includes("1 controller (right)") && describeHeadset(silent).text.includes("hides the controllers"));
});

test("the headset's session starts on the classic layer unless asked otherwise, and the function is put back", async () => {
  const { setSession, renderPath, PATH_CLASSIC, PATH_LAYERS } = await import("../src/xrcompat.js");
  class XRWebGLLayer {}
  class XRWebGLBinding { createProjectionLayer() { return {}; } }
  const scope = { XRWebGLLayer, XRWebGLBinding };
  // three.js's choice: the projection layer when the browser offers it at the moment the session starts
  const xr = { layer: null, getBaseLayer() { return this.layer; },
    async setSession() { this.layer = "createProjectionLayer" in XRWebGLBinding.prototype ? {} : new XRWebGLLayer(); } };
  assert.equal(await setSession(xr, {}, true, scope), PATH_CLASSIC);
  assert.ok("createProjectionLayer" in XRWebGLBinding.prototype);            // put back
  assert.equal(await setSession(xr, {}, false, scope), PATH_LAYERS);
  // put back when the session fails to start, too
  const failing = { getBaseLayer: () => null, async setSession() { throw new Error("no"); } };
  await assert.rejects(setSession(failing, {}, true, scope));
  assert.ok("createProjectionLayer" in XRWebGLBinding.prototype);
  assert.equal(renderPath(failing, scope), "unknown");
  // a browser without WebXR Layers has nothing to hide, and the session starts all the same
  const plain = { layer: null, getBaseLayer() { return this.layer; }, async setSession() { this.layer = new XRWebGLLayer(); } };
  assert.equal(await setSession(plain, {}, true, { XRWebGLLayer }), PATH_CLASSIC);
});

test("a view the session does not show is counted and named on the control page", async () => {
  const { viewCounter } = await import("../src/xrcompat.js");
  const { describeHeadset } = await import("../src/vrinput.js");
  const pose = { views: [{}, {}] }, frame = { getViewerPose: () => pose }, space = {};
  const seen = viewCounter();
  for (let i = 0; i < 200; i++) seen.frame({ visibilityState: "visible" }, frame, space);
  assert.deepEqual(seen.counts, { frames: 200, not_visible: 0, no_pose: 0 });
  assert.equal(seen.unseen, false);
  const hidden = viewCounter();
  for (let i = 0; i < 30; i++) hidden.frame({ visibilityState: "hidden" }, { getViewerPose: () => null }, space);
  assert.equal(hidden.unseen, false);                                          // too few frames to say
  for (let i = 0; i < 170; i++) hidden.frame({ visibilityState: "hidden" }, { getViewerPose: () => null }, space);
  assert.equal(hidden.unseen, true);
  const input = { sources: [{ hand: "left" }], select_events: 2 };
  const line = describeHeadset({ frameRate: 90, renderPath: "XRWebGLLayer", visibility: "hidden", input,
    view: { ...hidden.counts, unseen: true } }, true);
  assert.ok(line.warn && /MAY NOT BE SHOWING/.test(line.text) && /100 %/.test(line.text));
  const fine = describeHeadset({ frameRate: 90, renderPath: "XRWebGLLayer", visibility: "visible", input,
    view: { ...seen.counts, unseen: false } }, true);
  assert.ok(!fine.warn && /XRWebGLLayer/.test(fine.text));
});
