import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CALIBRATION, PRACTICE, NBACK } from "../src/config.js";
import { calibrationSteps, calibrationLength, designedSteps, scrambleIndices, CalibrationRun } from "../src/calibration.js";
import { makePlan } from "../src/plan.js";
import { SessionRun } from "../src/session.js";
import { Sink } from "../src/sink.js";
import { TaskRun, audioCues } from "../src/task.js";
import { CALIBRATION_RUN_COLUMNS, NBACK_LOG_HEADER } from "../src/formats.js";

test("the calibration sequence is cwtool's full calibration, in the same order for the same seed", () => {
  // cwtool.calibration.DEFAULT (the preset order) and cwtool.calibration.scrambled(DEFAULT, "P01"), from cwtool
  const designed = designedSteps();
  assert.equal(designed.length, 34);
  assert.equal(calibrationLength(designed), 291);
  const preset = scrambleIndices(designed, CALIBRATION.presetSeed).map((i) => designed[i].label);
  assert.deepEqual(preset.slice(0, 6), ["Gray 255", "Gray 219", "Black", "Blue 255", "Black", "Green 191"]);
  const p01 = calibrationSteps("P01");
  assert.deepEqual(p01.map((s) => s.label), [
    "Black", "Green 64", "Gray 73", "Black", "Blue 64", "Black", "Red 255", "Gray 219", "Gray 146", "Gray 182 (repeat)",
    "Gray 73 (repeat)", "Gray 36", "Black", "Green 191", "Gray 255", "Black", "Red 64", "Black", "Red 128", "Gray 109", "Black",
    "Blue 191", "Black", "Blue 128", "Black", "Red 191", "Black", "Green 128", "Black", "Green 255", "Gray 0", "Gray 182", "Black", "Blue 255"]);
  assert.deepEqual(p01.slice(0, 3).map((s) => s.source + 1), [32, 33, 28]);
  // every colour comes right after its black step
  p01.forEach((s, i) => { if (s.linked) { assert.equal(p01[i - 1].label, "Black"); assert.equal(p01[i - 1].source + 1, s.source); } });
  assert.notDeepEqual(calibrationSteps("P02").map((s) => s.label), p01.map((s) => s.label));
  assert.deepEqual(calibrationSteps("P01"), p01);
});

test("a plan puts the calibration and the practice before the session, on one clock", () => {
  const plan = makePlan("P01");
  const lead = CALIBRATION.leadIn + 291, practice = PRACTICE.levels.length * (PRACTICE.instruction + PRACTICE.items * NBACK.soa);
  assert.equal(plan.pre.duration, lead + practice);
  assert.equal(plan.pre.duration, 296 + 240);
  assert.deepEqual(plan.phases.slice(0, 1 + 2 * PRACTICE.levels.length).map((p) => p.kind),
    ["calibration", ...PRACTICE.levels.flatMap(() => ["practice_instruction", "practice_block"])]);
  assert.equal(plan.phases.find((p) => p.kind === "baseline").start, plan.pre.duration);
  let t = 0;
  for (const p of plan.phases) { assert.ok(Math.abs(p.start - t) < 1e-9, `${p.label} starts at ${p.start}, expected ${t}`); t += p.duration; }
  assert.equal(t, 536 + 1660);
  // the visual steps cover the recording without gaps or overlaps, and the real ones start after the prelude
  let s = 0;
  for (const st of plan.visual.steps) { assert.ok(Math.abs(st.start - s) < 0.06, `${st.type} step at ${st.start}, expected ${s}`); s = st.start + st.duration; }
  assert.ok(Math.abs(s - t) < 0.06);
  assert.ok(plan.visual.segments.every((g) => g.start >= plan.pre.duration));
  assert.equal(plan.visual.pre.filter((x) => x.type === "calibration").length, 35);   // the lead-in and 34 steps
  assert.equal(plan.visual.pre.filter((x) => x.type === "practice").length, 1);
  assert.equal(plan.practiceBlocks.length, 4);
  assert.equal(plan.blocks.length, 8);
  assert.ok(plan.blocks.every((b) => b.start >= plan.pre.duration));
});

test("either part can be left out, and the plan still adds up", () => {
  for (const options of [{ calibration: false }, { practice: false }, { calibration: false, practice: false }]) {
    const plan = makePlan("P01", Infinity, options);
    const total = plan.phases.reduce((n, p) => n + p.duration, 0);
    assert.equal(plan.phases[0].start, 0);
    assert.equal(total, plan.pre.duration + 1660);
    assert.equal(plan.visual.steps[0].start, 0);
    assert.equal(plan.phases.some((p) => p.kind === "calibration"), options.calibration !== false);
    assert.equal(plan.phases.some((p) => p.kind === "practice_block"), options.practice !== false);
  }
  const bare = makePlan("P01", Infinity, { calibration: false, practice: false });
  const full = makePlan("P01");
  // the session itself is the same with and without the prelude: only shifted
  assert.deepEqual(bare.blocks.map((b) => b.items), full.blocks.map((b) => b.items));
  assert.deepEqual(bare.visual.segments.map((g) => [g.type, g.duration]), full.visual.segments.map((g) => [g.type, g.duration]));
});

test("the cues of the practice: its own digits and instructions, no clip overlapping the next", () => {
  const plan = makePlan("P01");
  const cues = audioCues(plan);
  assert.equal(cues.filter((c) => c.kind === "digit").length, 8 * 60 + 4 * PRACTICE.items);
  assert.equal(cues.filter((c) => String(c.block).startsWith("p") && c.kind === "digit").length, 80);
  assert.equal(cues[0].id, "rest");               // the calibration opens with "keep your gaze on the point"
  assert.equal(cues[0].phase, "Calibration");
  for (const lang of ["it", "en"]) {
    const m = JSON.parse(readFileSync(new URL(`../assets/audio/${lang}/manifest.json`, import.meta.url))).clips;
    for (const c of cues) assert.ok(m[c.id], `${lang}: ${c.id}`);
    for (let i = 1; i < cues.length; i++) assert.ok(cues[i - 1].e + m[cues[i - 1].id].duration_s <= cues[i].e, `${lang}: ${cues[i - 1].id} overlaps ${cues[i].id}`);
  }
});

class FakeAudio {
  constructor() { this.feedbacks = []; }
  play(id, perfMs) { return { id, onsetPerf: perfMs, duration: 1, late: false }; }
  stop() {}
  stopAll() {}
  feedback(hit) { this.feedbacks.push(hit); }
}

test("a full recording: calibration run file, practice log with feedback, and the session unchanged", () => {
  const plan = makePlan("P01");
  const sink = new Sink("t", false), audio = new FakeAudio(), unix = (t) => 1.7e12 + t;
  const task = new TaskRun(plan, { audio, sink, unix });
  const cal = new CalibrationRun(plan.pre.calibration, { participant: "P01", mode: "screen", runId: "t", tool: "test" }, { time_zone: "UTC" });
  let lastT = 0, t = 0;
  const run = new SessionRun(plan, { show() {}, sink, files: { events: "ev.csv", visual: "vis.csv" }, unix,
    hooks: { onStepClosed: (st, a, b, why) => { cal.step(st, a, b, why); }, onEnd: (s) => task.end(lastT, s.status === "completed") } });
  const pressed = new Set();
  run.start();
  for (let i = 0; run.state !== "done" && i < 3000 * 60; i++, t += 1000 / 60) {
    lastT = t;
    run.frame(t);
    task.frame(t, run.elapsed(t), run.state);
    // press 500 ms after every target of the practice and of the session
    for (const b of task.blocks.values()) {
      for (const it of b.items) {
        if (it.target && it.onsetPerf !== null && !pressed.has(it) && t >= it.onsetPerf + 500) { pressed.add(it); task.press(t); }
      }
    }
  }
  assert.equal(run.summary.status, "completed");
  assert.ok(Math.abs(run.summary.session_s - 2196) < 0.05);

  const ev = sink.files.get("ev.csv").trim().split("\n").map((l) => l.split(","));
  assert.deepEqual(ev.slice(1, 10).map((r) => r[0]), ["Calibration", "Practice instruction", "Practice 0-back", "Practice instruction", "Practice 1-back",
    "Practice instruction", "Practice 2-back", "Practice instruction", "Practice 3-back"]);
  assert.equal(ev[10][0], "Baseline");

  // the calibration run file: the presenter's columns, 34 rows, in the presenter's timing
  const lines = cal.csv(true).trim().split("\n");
  const meta = lines.filter((l) => l.startsWith("# "));
  assert.ok(meta.includes("# status: completed"));
  assert.ok(meta.some((l) => l.startsWith("# sequence_start_unix_ms: ")));
  const table = lines.filter((l) => !l.startsWith("# ")).map((l) => l.split(","));
  assert.deepEqual(table[0], CALIBRATION_RUN_COLUMNS);
  assert.equal(table.length - 1, 34);
  assert.equal(table[1][0], "0");
  assert.equal(table[1][6], "1");                                     // index
  assert.equal(table[1][7], "32");                                    // source_index (P01 starts with preset step 32)
  assert.ok(Math.abs(Number(table[1][9]) - 8) < 1e-9);               // planned_duration_s
  assert.ok(table.slice(1).every((r) => r[12] === "true"));
  const durations = table.slice(1).reduce((n, r) => n + Number(r[1]), 0);
  assert.ok(Math.abs(durations - 291) < 0.1, `${durations}`);

  // the practice: its own log, with feedback on the presses, never in the session's log
  const practice = sink.files.get("practice_nback_log.csv").trim().split("\n").map((l) => l.split(","));
  assert.deepEqual(practice[0], NBACK_LOG_HEADER);
  assert.equal(practice.length - 1, 4 * PRACTICE.items);
  assert.equal(task.practiceScores.length, 4);
  assert.equal(task.scores.length, 8);
  assert.ok(practice.slice(1).filter((r) => r[4] === "1").every((r) => r[10] === "hit"));
  assert.equal(audio.feedbacks.length, plan.practiceBlocks.reduce((n, b) => n + b.items.filter((i) => i.target).length, 0));
  assert.ok(audio.feedbacks.every((hit) => hit === true));
  const main = sink.files.get("nback_log.csv").trim().split("\n");
  assert.equal(main.length - 1, 8 * 60);
});
