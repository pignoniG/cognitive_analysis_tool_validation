import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SESSION, NBACK } from "../src/config.js";
import { loadTimeline } from "../src/load.js";
import { visualTimeline } from "../src/visual.js";
import { nbackBlock } from "../src/nback.js";
import { SessionRun } from "../src/session.js";
import { Sink } from "../src/sink.js";
import { NBACK_LOG_HEADER } from "../src/formats.js";
import { audioCues, TaskRun, CUE_TIMES } from "../src/task.js";

function makePlan(id) {
  const phases = loadTimeline(id);
  const blocks = phases.filter((p) => p.kind === "block").map((p) => ({ ...p, ...nbackBlock(id, p.block, p.level, SESSION.block / NBACK.soa) }));
  return { phases, visual: visualTimeline(id, phases), blocks };
}
const plan = makePlan("A1");
const manifests = Object.fromEntries(["it", "en"].map((l) =>
  [l, JSON.parse(readFileSync(new URL(`../assets/audio/${l}/manifest.json`, import.meta.url)))]));

/** A stand-in for AudioCues: every clip is heard exactly when asked. */
class FakeAudio {
  constructor(lang = "en") { this.clips = manifests[lang].clips; this.played = []; this.stopped = 0; }
  play(id, perfMs) {
    if (!this.clips[id]) throw new Error(`no clip ${id}`);
    const h = { id, onsetPerf: perfMs, duration: this.clips[id].duration_s, late: false };
    this.played.push(h);
    return h;
  }
  stop() { this.stopped++; }
  stopAll() {}
}

test("cues: every clip exists, phrases fit their phases, digits fit their interval", () => {
  const cues = audioCues(plan);
  assert.equal(cues.filter((c) => c.kind === "digit").length, 6 * 60);
  for (const [lang, m] of Object.entries(manifests)) {
    for (const c of cues) assert.ok(m.clips[c.id], `${lang}: ${c.id}`);
    for (let i = 1; i <= 9; i++) assert.ok(m.clips[`digit_${i}`].duration_s < NBACK.soa - 1, `${lang} digit ${i}`);
    // no clip runs into the next cue
    for (let i = 1; i < cues.length; i++) {
      const prev = cues[i - 1];
      assert.ok(prev.e + m.clips[prev.id].duration_s <= cues[i].e, `${lang}: ${prev.id} at ${prev.e} overlaps ${cues[i].id}`);
    }
  }
  // the first digit of each block starts with the block, the start cue just before
  for (const b of plan.phases.filter((p) => p.kind === "block")) {
    assert.ok(cues.some((c) => c.kind === "digit" && c.block === b.block && c.item === 0 && c.e === b.start));
    assert.ok(cues.some((c) => c.id === "start" && c.block === b.block && c.e === b.start + CUE_TIMES.start));
  }
  // each block's instruction names its level (there is no 0-back, so no target digit to announce)
  for (const b of plan.blocks) assert.ok(cues.some((c) => c.id === `back_${b.level}` && c.block === b.block));
});

/** Run a whole session at 60 Hz with a participant who presses `rt` ms after every target (and on lures if
 *  `fooled`); `at` maps a session second to an action. */
function simulate({ rt = 600, fooled = false, at = {}, resumeAfterMs = null } = {}) {
  const sink = new Sink("t", false);
  const audio = new FakeAudio();
  const scores = [];
  const unix = (t) => 1.7e12 + t;
  const task = new TaskRun(plan, { audio, sink, unix, onScore: (s) => scores.push(s) });
  const run = new SessionRun(plan, { show() {}, sink, files: { events: "ev.csv", visual: "vis.csv" }, unix,
    hooks: { onPause: (t) => { task.pause(t); pausedAt = t; }, onEnd: (s) => task.end(lastT, s.status === "completed") } });
  const presses = [];
  let lastT = 0, t = 0, pausedAt = null;
  run.start();
  const done = new Set();
  for (let i = 0; run.state !== "done" && i < 3000 * 60; i++, t += 1000 / 60) {
    lastT = t;
    const e = run.elapsed(t);
    for (const [s, f] of Object.entries(at)) if (!done.has(s) && e >= Number(s)) { done.add(s); f(run, t); }
    if (run.state === "paused" && resumeAfterMs !== null && t >= pausedAt + resumeAfterMs) run.resume();
    run.frame(t);
    task.frame(t, run.elapsed(t), run.state);
    for (const h of audio.played.splice(0)) {
      if (!h.id.startsWith("digit_")) continue;
      const it = [...task.blocks.values()].flatMap((b) => b.items).find((x) => x.onsetPerf === h.onsetPerf);
      if (it && (it.target || (fooled && it.lure))) presses.push(h.onsetPerf + rt);
    }
    while (presses.length && presses[0] <= t) task.press(presses.shift());
  }
  const rows = sink.files.get("nback_log.csv").trim().split("\n").map((l) => l.split(","));
  return { run, task, rows, scores, audio };
}

test("a full session: 360 rows, all hits at the right reaction time", () => {
  const { run, rows, scores } = simulate();
  assert.equal(run.summary.status, "completed");
  assert.deepEqual(rows[0], NBACK_LOG_HEADER);
  assert.equal(rows.length - 1, 360);
  const col = (n) => NBACK_LOG_HEADER.indexOf(n);
  const outcomes = rows.slice(1).map((r) => r[col("outcome")]);
  assert.equal(outcomes.filter((o) => o === "hit").length, 120);
  assert.equal(outcomes.filter((o) => o === "correct_rejection").length, 240);
  for (const r of rows.slice(1)) if (r[col("outcome")] === "hit") assert.ok(Math.abs(Number(r[col("rt_ms")]) - 600) <= 17);
  // onsets follow the plan: 2.5 s apart within a block
  const b1 = rows.slice(1).filter((r) => r[col("block")] === "1").map((r) => Number(r[col("onset_unix_ms")]));
  for (let i = 1; i < b1.length; i++) assert.ok(Math.abs(b1[i] - b1[i - 1] - 2500) <= 1);
  assert.equal(scores.length, 6);
  for (const s of scores) { assert.equal(s.hit, 20); assert.equal(s.false_alarm, 0); assert.ok(s.dprime > 3); }
});

test("lures fool a careless participant into false alarms", () => {
  const { scores } = simulate({ fooled: true });
  for (const s of scores) assert.equal(s.false_alarm, s.n >= 2 ? NBACK.lures : 0, `${s.n}-back`);
});

test("a pause inside a block interrupts one item and the rest follow on the session clock", () => {
  const block = plan.phases.find((p) => p.kind === "block" && p.block === 2);
  const pauseAt = block.start + 30.2;   // 0.2 s into item 13
  const { run, rows, scores } = simulate({ at: { [pauseAt]: (r) => r.pause() }, resumeAfterMs: 20000 });
  assert.equal(run.summary.status, "completed");
  assert.equal(run.summary.pauses.length, 1);
  const col = (n) => NBACK_LOG_HEADER.indexOf(n);
  const b2 = rows.slice(1).filter((r) => r[col("block")] === "2");
  assert.equal(b2.length, 60);
  assert.equal(b2.filter((r) => r[col("interrupted")] === "1").length, 1);
  assert.equal(scores.find((s) => s.block === 2).interrupted, 1);
});

test("an abort writes what was heard and scores the partial block", () => {
  const block = plan.phases.find((p) => p.kind === "block" && p.block === 1);
  const { run, rows, scores } = simulate({ at: { [block.start + 20.1]: (r) => r.abort("test") } });
  assert.match(run.summary.status, /^aborted/);
  assert.equal(rows.length - 1, 9);    // items 0..8 started by 20.1 s
  assert.equal(scores.length, 1);
  assert.equal(scores[0].items, 9);
});
