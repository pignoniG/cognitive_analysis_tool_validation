import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CALIBRATION, PRACTICE, NBACK } from "../src/config.js";
import { calibrationSteps, calibrationLength, designedSteps, scrambleIndices, CalibrationRun } from "../src/calibration.js";
import { makePlan } from "../src/plan.js";
import { practicePlan } from "../src/prelude.js";
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

test("a plan puts the calibration before the session, on one clock", () => {
  const plan = makePlan("P01");
  assert.equal(plan.pre.duration, CALIBRATION.leadIn + 291);
  assert.equal(plan.phases[0].kind, "calibration");
  assert.equal(plan.phases[1].kind, "baseline");
  assert.equal(plan.phases[1].start, 296);
  let t = 0;
  for (const p of plan.phases) { assert.ok(Math.abs(p.start - t) < 1e-9, `${p.label} starts at ${p.start}, expected ${t}`); t += p.duration; }
  assert.equal(t, 296 + 1240);                      // 25:36
  // the visual steps cover the recording without gaps or overlaps, and the real ones start after the calibration
  let s = 0;
  for (const st of plan.visual.steps) { assert.ok(Math.abs(st.start - s) < 0.06, `${st.type} step at ${st.start}, expected ${s}`); s = st.start + st.duration; }
  assert.ok(Math.abs(s - t) < 0.06);
  assert.ok(plan.visual.segments.every((g) => g.start >= plan.pre.duration));
  assert.equal(plan.visual.pre.filter((x) => x.type === "calibration").length, 35);   // the lead-in and 34 steps
  assert.equal(plan.blocks.length, 6);
  assert.deepEqual(plan.blocks.map((b) => b.level).sort(), [1, 1, 2, 2, 3, 3]);
  assert.ok(plan.blocks.every((b) => b.start >= plan.pre.duration));
  assert.equal(plan.practiceBlocks, undefined);     // the practice is not in the recording
  assert.equal(plan.options.set, "A");
});

test("the calibration can be left out, and the visual set is the participant's", () => {
  const bare = makePlan("P01", Infinity, { calibration: false });
  assert.equal(bare.phases[0].kind, "baseline");
  assert.equal(bare.phases.reduce((n, p) => n + p.duration, 0), 1240);
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
  assert.ok(Math.abs(run.summary.session_s - 1536) < 0.05);

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
  assert.equal(table.length - 1, 34);
  assert.equal(table[1][0], "0");
  assert.equal(table[1][6], "1");                                     // index
  assert.equal(table[1][7], "32");                                    // source_index (P01 starts with preset step 32)
  assert.ok(Math.abs(Number(table[1][9]) - 8) < 1e-9);               // planned_duration_s
  assert.ok(table.slice(1).every((r) => r[12] === "true"));
  const durations = table.slice(1).reduce((n, r) => n + Number(r[1]), 0);
  assert.ok(Math.abs(durations - 291) < 0.1, `${durations}`);
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
