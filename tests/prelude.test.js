import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CALIBRATION, GAZE_CHECK, PRACTICE, NBACK } from "../src/config.js";
import { calibrationSteps, calibrationLength, designedSteps, scrambleIndices, sequenceName, CalibrationRun } from "../src/calibration.js";
import { makePlan } from "../src/plan.js";
import { practicePlan, gazePlaces } from "../src/prelude.js";
import { SessionRun } from "../src/session.js";
import { Sink } from "../src/sink.js";
import { TaskRun, audioCues } from "../src/task.js";
import { CALIBRATION_RUN_COLUMNS, NBACK_LOG_HEADER } from "../src/formats.js";

test("the calibration is cwtool's time-course calibration, in the same order for the same seed", () => {
  // cwtool.calibration.TIME_COURSE (the preset order) and cwtool.calibration.scrambled(TIME_COURSE, "P01"), from cwtool
  const designed = designedSteps();
  assert.equal(designed.length, 30);
  assert.equal(calibrationLength(designed), 281);
  assert.ok(designed.every((s) => s.rgb.some((c) => c > 0)));            // no black
  const preset = scrambleIndices(designed, CALIBRATION.presetSeed).map((i) => designed[i].label);
  assert.deepEqual(preset.slice(0, 6), ["Gray 96 (before dim)", "Gray 12 (after moderate)", "Gray 40", "Gray 96",
    "Gray 196 (repeat)", "Gray 127 (as Red 255)"]);
  const p01 = calibrationSteps("P01");
  assert.deepEqual(p01.map((s) => s.label), ["Gray 24", "Gray 64 (repeat)", "Blue 255 (before dim)", "Gray 12 (after blue)",
    "Gray 96", "Gray 196", "Gray 128 (before dim)", "Gray 24 (after moderate)", "Gray 96 (before dim)", "Gray 12 (after moderate)",
    "Gray 220 (as Green 255)", "Green 255", "Gray 76 (as Blue 255)", "Blue 255", "Gray 255 (before dim)", "Gray 24 (after bright)",
    "Gray 110 (as Green 128)", "Green 128", "Gray 255", "Gray 12", "Gray 60 (as Red 128)", "Red 128", "Gray 196 (repeat)",
    "Gray 33 (as Blue 128)", "Blue 128", "Gray 127 (as Red 255)", "Red 255", "Gray 64", "Gray 40", "Gray 140"]);
  assert.deepEqual(p01.slice(0, 5).map((s) => s.source + 1), [27, 12, 13, 14, 4]);
  // every linked step comes right after its context
  p01.forEach((s, i) => { if (s.linked) assert.equal(p01[i - 1].source + 1, s.source); });
  assert.equal(sequenceName().cwtool, "TIME_COURSE");
});

test("a plan puts the calibration before the session, on one clock", () => {
  const plan = makePlan("P01");
  const gaze = GAZE_CHECK.cueSeconds + GAZE_CHECK.points.length * GAZE_CHECK.seconds;   // the gaze check opens the calibration: 1 + 27 s
  assert.equal(plan.pre.duration, CALIBRATION.leadIn + 281 + gaze);
  assert.equal(plan.phases[0].kind, "calibration");
  assert.equal(plan.phases[1].kind, "baseline");
  assert.equal(plan.phases[1].start, 314);
  let t = 0;
  for (const p of plan.phases) { assert.ok(Math.abs(p.start - t) < 1e-9, `${p.label} starts at ${p.start}, expected ${t}`); t += p.duration; }
  assert.equal(t, 314 + 1180);                      // 24:54
  // the visual steps cover the recording without gaps or overlaps, and the real ones start after the calibration
  let s = 0;
  for (const st of plan.visual.steps) { assert.ok(Math.abs(st.start - s) < 0.06, `${st.type} step at ${st.start}, expected ${s}`); s = st.start + st.duration; }
  assert.ok(Math.abs(s - t) < 0.06);
  assert.ok(plan.visual.segments.every((g) => g.start >= plan.pre.duration));
  assert.equal(plan.visual.pre.filter((x) => x.type === "calibration").length, 41);   // the lead-in, the cue, 9 gaze targets, 30 steps
  assert.ok(plan.visual.pre[1].cue && plan.visual.pre[1].start === CALIBRATION.leadIn);  // the gaze check right after the lead-in
  const targets = plan.visual.pre.filter((x) => x.gaze);
  const firstLight = plan.visual.pre.find((x) => x.change === "step");
  assert.equal(firstLight.start, CALIBRATION.leadIn + gaze);                  // the light steps after it
  assert.ok(targets.every((x) => x.start < firstLight.start));
  assert.deepEqual(targets.map((x) => [x.gaze.u, x.gaze.v]), GAZE_CHECK.points);
  assert.ok(targets.every((x) => x.field.every((c) => c === CALIBRATION.leadGray) && x.duration === GAZE_CHECK.seconds));
  assert.deepEqual([targets[3].gaze.az, targets[3].gaze.el], [15, 12]);   // up and to the right
  assert.equal(plan.blocks.length, 6);
  assert.deepEqual(plan.blocks.map((b) => b.level).sort(), [1, 1, 2, 2, 3, 3]);
  assert.ok(plan.blocks.every((b) => b.start >= plan.pre.duration));
  assert.equal(plan.practiceBlocks, undefined);     // the practice is not in the recording
  assert.equal(plan.options.set, "A");
});

test("the calibration can be left out, and the visual set is the participant's", () => {
  const bare = makePlan("P01", Infinity, { calibration: false });
  assert.equal(bare.phases[0].kind, "baseline");
  assert.equal(bare.phases.reduce((n, p) => n + p.duration, 0), 1180);
  assert.equal(bare.visual.steps[0].start, 0);
  const full = makePlan("P01");
  // the session itself is the same with and without the calibration: only shifted
  assert.deepEqual(bare.blocks.map((b) => b.items), full.blocks.map((b) => b.items));
  assert.deepEqual(bare.visual.segments.map((g) => [g.type, g.duration]), full.visual.segments.map((g) => [g.type, g.duration]));
  // set B has circles and no solid colours, set A the reverse; both have scenes
  const types = (set) => new Set(makePlan("P01", Infinity, { set }).visual.steps.map((st) => st.type));
  assert.ok(types("A").has("colour") && types("A").has("steps") && !types("A").has("target_size"));
  assert.ok(types("B").has("target_size") && !types("B").has("colour") && !types("B").has("steps"));
  assert.ok(types("A").has("scenes") && types("B").has("scenes"));
  assert.equal(makePlan("P01", Infinity, { set: "B" }).options.set, "B");
});

test("the practice plan: each level once, the end phrase, its own cues", () => {
  const plan = practicePlan("P01");
  assert.deepEqual(plan.phases.map((p) => p.kind), ["practice_instruction", "practice_block", "practice_instruction", "practice_block",
    "practice_instruction", "practice_block", "practice_end"]);
  assert.deepEqual(plan.practiceBlocks.map((b) => b.level), [1, 2, 3]);
  assert.equal(plan.duration, 3 * (PRACTICE.instruction + PRACTICE.items * NBACK.soa) + PRACTICE.end);   // 3:05
  let t = 0;
  for (const p of plan.phases) { assert.equal(p.start, t); t += p.duration; }
  const cues = audioCues(plan);
  assert.equal(cues.filter((c) => c.kind === "digit").length, 3 * PRACTICE.items);
  assert.equal(cues.at(-1).id, "end");
  for (const lang of ["it", "en"]) {
    const m = JSON.parse(readFileSync(new URL(`../assets/audio/${lang}/manifest.json`, import.meta.url))).clips;
    for (const c of cues) assert.ok(m[c.id], `${lang}: ${c.id}`);
    for (let i = 1; i < cues.length; i++) assert.ok(cues[i - 1].e + m[cues[i - 1].id].duration_s <= cues[i].e, `${lang}: ${cues[i - 1].id} overlaps ${cues[i].id}`);
  }
  assert.deepEqual(practicePlan("P01").practiceBlocks.map((b) => b.items), plan.practiceBlocks.map((b) => b.items));
});

class FakeAudio {
  constructor() { this.feedbacks = []; }
  play(id, perfMs) { return { id, onsetPerf: perfMs, duration: 1, late: false }; }
  stop() {}
  stopAll() {}
  feedback(hit) { this.feedbacks.push(hit); }
}

/** Run a plan at 60 Hz; a participant who presses 500 ms after every target. */
function simulate(plan, { onStepClosed } = {}) {
  const sink = new Sink("t", false), audio = new FakeAudio(), unix = (t) => 1.7e12 + t;
  const task = new TaskRun(plan, { audio, sink, unix });
  let lastT = 0, t = 0;
  const run = new SessionRun(plan, { show() {}, sink, files: { events: "ev.csv", visual: "vis.csv" }, unix,
    hooks: { onStepClosed, onEnd: (s) => task.end(lastT, s.status === "completed") } });
  const pressed = new Set();
  run.start();
  for (let i = 0; run.state !== "done" && i < 3000 * 60; i++, t += 1000 / 60) {
    lastT = t;
    run.frame(t);
    task.frame(t, run.elapsed(t), run.state);
    for (const b of task.blocks.values()) {
      for (const it of b.items) {
        if (it.target && it.onsetPerf !== null && !pressed.has(it) && t >= it.onsetPerf + 500) { pressed.add(it); task.press(t); }
      }
    }
  }
  return { run, task, sink, audio };
}

test("a full recording: calibration, then the session; the calibration run file reads like the presenter's", () => {
  const plan = makePlan("P01");
  const cal = new CalibrationRun(plan.pre.calibration, { participant: "P01", mode: "screen", runId: "t", tool: "test" }, { time_zone: "UTC" });
  const { run, task, sink } = simulate(plan, { onStepClosed: (st, a, b, why) => { cal.step(st, a, b, why); } });
  assert.equal(run.summary.status, "completed");
  assert.ok(Math.abs(run.summary.session_s - 1494) < 0.05);

  const ev = sink.files.get("ev.csv").trim().split("\n").map((l) => l.split(","));
  assert.deepEqual(ev.slice(1, 4).map((r) => r[0]), ["Calibration", "Baseline", "Instruction"]);
  assert.equal(task.scores.length, 6);
  assert.equal(sink.files.has("practice_nback_log.csv"), false);

  const lines = cal.csv(true).trim().split("\n");
  const meta = lines.filter((l) => l.startsWith("# "));
  assert.ok(meta.includes("# status: completed"));
  assert.ok(meta.some((l) => l.startsWith("# sequence_start_unix_ms: ")));
  const table = lines.filter((l) => !l.startsWith("# ")).map((l) => l.split(","));
  assert.deepEqual(table[0], CALIBRATION_RUN_COLUMNS);
  assert.equal(table.length - 1, 40);                                 // the cue, 9 gaze targets, then 30 light steps
  assert.equal(table[1][0], "0");
  assert.equal(table[1][5], "Gaze check cue (tone)");                 // the gaze check first
  assert.ok(table.slice(1, 11).every((r) => r[13] === "gaze") && table.slice(11).every((r) => r[13] === "light"));
  assert.equal(table[11][6], "11");                                   // index
  assert.equal(table[11][7], "27");                                   // source_index (P01 starts with preset step 27)
  assert.ok(Math.abs(Number(table[11][9]) - 12) < 1e-9);             // planned_duration_s (Gray 24)
  assert.ok(table.slice(1).every((r) => r[12] === "true"));
  assert.ok(meta.includes("# sequence_name: time-course calibration (presenter default)"));
  const light = table.slice(1).filter((r) => r[13] === "light"), gazeRows = table.slice(1).filter((r) => r[13] === "gaze");
  assert.equal(light.length, 30);
  const durations = light.reduce((n, r) => n + Number(r[1]), 0);
  assert.ok(Math.abs(durations - 281) < 0.1, `${durations}`);
  const [cueRow, ...placeRows] = gazeRows;                             // the tone first, with no place
  assert.equal(cueRow[5], "Gaze check cue (tone)");
  assert.deepEqual(cueRow.slice(14), ["", "", "", "", "", ""]);
  assert.deepEqual(placeRows.map((r) => [r[14], r[15]].map(Number)), GAZE_CHECK.points);
  assert.ok(placeRows.every((r) => r[7] === "" && r[5].startsWith("Gaze target")));
  assert.deepEqual(placeRows[1].slice(18).map(Number), [-15, 12]);     // up and to the left: az, el
  assert.ok(meta.includes("# gaze_check: true"));
  assert.ok(meta.some((l) => l.startsWith("# gaze_cue: 880 Hz tone")));
});

test("the practice run: its own log, scores and a feedback tone on every press", () => {
  const plan = practicePlan("P01");
  const { run, task, sink, audio } = simulate(plan);
  assert.equal(run.summary.status, "completed");
  const rows = sink.files.get("practice_nback_log.csv").trim().split("\n").map((l) => l.split(","));
  assert.deepEqual(rows[0], NBACK_LOG_HEADER);
  assert.equal(rows.length - 1, 3 * PRACTICE.items);
  assert.equal(task.practiceScores.length, 3);
  assert.equal(task.scores.length, 0);
  assert.ok(rows.slice(1).filter((r) => r[4] === "1").every((r) => r[10] === "hit"));
  assert.equal(audio.feedbacks.length, plan.practiceBlocks.reduce((n, b) => n + b.items.filter((i) => i.target).length, 0));
  assert.ok(audio.feedbacks.every((hit) => hit === true));
});

test("the gaze check is placed as the calibration presenter places it", () => {
  assert.deepEqual(gazePlaces("vr")[5], { u: 1, v: 1, az: 15, el: -12 });      // headset: a direction from the head
  assert.deepEqual(gazePlaces("screen")[5], { u: 1, v: 1, x: 0.85, y: 0.85 });  // monitor: ±0.35 of the screen, any size
  assert.deepEqual(gazePlaces("screen")[0], { u: 0, v: 0, x: 0.5, y: 0.5 });
  const plan = makePlan("P01", 20, { mode: "screen" });
  assert.equal(plan.pre.calibration.gaze.length, 9);
  assert.ok(plan.pre.calibration.gaze.every((g) => g.az === undefined && g.x >= 0.15 && g.x <= 0.85));
});
