import { test } from "node:test";
import assert from "node:assert/strict";

import { loadTimeline } from "../src/load.js";
import { visualTimeline } from "../src/visual.js";
import { SessionRun } from "../src/session.js";
import { Sink } from "../src/sink.js";
import { EVENT_LOG_HEADER, VISUAL_LOG_HEADER } from "../src/formats.js";
import { stepLuminance } from "../src/geometry.js";

const FILES = { events: "event_log.csv", visual: "visual_log.csv" };
const plan = (() => { const phases = loadTimeline("T1"); return { phases, visual: visualTimeline("T1", phases) }; })();

/** Run frames at `hz` from frame time `t0` (ms) until the run ends or `untilS` seconds of frames; `at` maps a
 *  frame number to an action. */
function drive(run, { hz = 60, t0 = 1000, untilS = 4000, at = {} } = {}) {
  let t = t0;
  for (let i = 0; run.state !== "done" && i < untilS * hz; i++) {
    at[i]?.(run, t);
    run.frame(t);
    t += 1000 / hz;
  }
  return t;
}

const rows = (sink, name) => sink.files.get(name).trim().split("\n").map((l) => l.split(","));
const make = (shown = []) => {
  const sink = new Sink("test", false);
  const run = new SessionRun(plan, { show: (s) => shown.push(s), sink, files: FILES, unix: (t) => 1.7e12 + t,
    luminance: (s) => stepLuminance(s, { vfov: 34, aspect: 16 / 9 }) });
  return { sink, run, shown };
};

test("a full run logs every phase and step once, back to back", () => {
  const { sink, run, shown } = make();
  run.frame(0);                       // frames before start do nothing
  assert.equal(run.state, "ready");
  run.start();
  drive(run);
  assert.equal(run.summary.status, "completed");
  const ev = rows(sink, FILES.events), vis = rows(sink, FILES.visual);
  assert.deepEqual(ev[0], EVENT_LOG_HEADER);
  assert.deepEqual(vis[0], VISUAL_LOG_HEADER);
  assert.deepEqual(ev.slice(1).map((r) => r[0]), plan.phases.map((p) => p.label));
  assert.equal(vis.length - 1, plan.visual.steps.length);
  assert.equal(shown.length, plan.visual.steps.length);
  // each row starts where the previous ended, and durations match the plan within a frame
  for (const r of [ev, vis]) for (let i = 2; i < r.length; i++) assert.equal(r[i][4], r[i - 1][5]);
  ev.slice(1).forEach((r, i) => assert.ok(Math.abs(Number(r[3]) - plan.phases[i].duration) <= 1 / 60 + 1e-3, r.join()));
  assert.ok(Math.abs(run.summary.session_s - 1660) < 0.05);
  assert.equal(run.summary.frames.dropped, 0);
  // nominal luminance columns are filled for fields, empty for scenes
  const yg = VISUAL_LOG_HEADER.indexOf("Y_gaze");
  vis.slice(1).forEach((r, i) => assert.equal(r[yg] === "", plan.visual.steps[i].scene !== null));
});

test("pausing freezes the session and splits the rows", () => {
  const { sink, run } = make();
  run.start();
  const hz = 60;
  drive(run, { hz, at: { [200 * hz]: (r) => r.pause(), [230 * hz]: (r) => r.resume() } });
  assert.equal(run.summary.status, "completed");
  assert.equal(run.summary.pauses.length, 1);
  assert.ok(Math.abs(run.summary.pauses[0].duration_s - 30) < 0.05);
  const ev = rows(sink, FILES.events).slice(1);
  const pauseAt = ev.findIndex((r) => r[0] === "Pause");
  assert.ok(pauseAt > 0);
  assert.equal(ev[pauseAt - 1][0], ev[pauseAt + 1][0]);          // the same phase continues after the pause
  assert.equal(ev.length, plan.phases.length + 2);
  // the session still lasts its planned time, without the pause
  assert.ok(Math.abs(run.summary.session_s - 1660) < 0.05);
  const vis = rows(sink, FILES.visual).slice(1);
  const ch = VISUAL_LOG_HEADER.indexOf("change");
  assert.equal(vis.filter((r) => r[ch] === "resume").length, 1);
  assert.equal(vis.length, plan.visual.steps.length + 1);
});

test("aborting closes the running rows; dropped frames are counted", () => {
  const { sink, run } = make();
  run.start();
  let t = 0;
  for (let i = 0; i < 600; i++) { run.frame(t); t += i === 400 ? 100 : 1000 / 60; }
  run.abort("test");
  assert.match(run.summary.status, /^aborted/);
  assert.equal(run.summary.frames.dropped, 1);
  const ev = rows(sink, FILES.events).slice(1);
  assert.equal(ev.at(-1)[0], "Baseline");
  run.frame(t + 10);                 // nothing after the end
  assert.equal(rows(sink, FILES.events).length, ev.length + 1);
});

test("luminance: gaze circle and field means", () => {
  const bg = [36, 36, 36], white = [255, 255, 255];
  const noTarget = stepLuminance({ field: bg, target: null }, { vfov: 60, aspect: 1.5 });
  assert.ok(Math.abs(noTarget.yGaze - noTarget.yField) < 1e-9);
  // a target as large as the gaze circle fills it (within the sampling of the edge)
  const full = stepLuminance({ field: bg, target: { rgb: white, diameter: 32.7 } }, { vfov: 60, aspect: 1.5 });
  assert.ok(Math.abs(full.yGaze - 1) < 0.02, String(full.yGaze));
  // on a screen shorter than the gaze circle, the dark room lowers the gaze mean
  const short = stepLuminance({ field: white, target: null }, { vfov: 20, aspect: 1.5 });
  assert.ok(short.yGaze < 0.9 && short.yField === 1);
});
