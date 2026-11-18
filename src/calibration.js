// The calibration sequence, ported exactly from cwtool and the calibration presenter: the same seed gives the same order
// here, in the presenter and in cwtool.
//
// The time-course calibration (cwtool.calibration.TIME_COURSE, the presenter's default from November 2026): 30 steps,
// 281 s: eight grays from 12 to 255, no black; dimming after moderate light and after bright light, each probe linked to
// its context; red, green and blue at 128 and 255, each after a linked gray of the same luminance; two grays repeated.
// The full calibration (cwtool.calibration.DEFAULT, before): 34 steps, 291 s, the 8 grays of Eckert et al. (2022) longer
// the darker, red, green and blue at four levels each after a linked black step, two grays repeated.
//
// The preset order is the pseudo-random one for the seed "calibration"; a participant's run scrambles that order again with
// the participant ID (the presenter's "scrambled, seeded by participant"), so no two consecutive levels are neighbours in
// brightness and each linked step stays with the one before it.

import { CALIBRATION, GAZE_CHECK } from "./config.js";
import { rngFrom, shuffled } from "./rng.js";
import { calibrationRunCsv } from "./formats.js";

/** The presenter's luminance for ordering steps (Eckert et al. 2022, eq. 1): not the BT.709 weights of colour.js. */
const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export const eckertY = ([r, g, b]) => 0.2125 * lin(r) + 0.7154 * lin(g) + 0.072 * lin(b);

/** The presenter's `scrambleIndices`: indices of `items` in a seeded order; a linked item moves with its
 *  predecessor, and with `avoid` no two consecutive groups are neighbours in brightness rank (the first of 4000
 *  shuffles that manages it, else the best). */
export function scrambleIndices(items, seed, avoid = true) {
  const groups = [];
  items.forEach((s, i) => { if (s.linked && groups.length) groups.at(-1).push(i); else groups.push([i]); });
  const n = groups.length, rng = rngFrom(seed);
  const rank = new Array(n);
  [...groups.keys()].sort((a, b) => eckertY(items[groups[a].at(-1)].rgb) - eckertY(items[groups[b].at(-1)].rgb) || a - b)
    .forEach((g, k) => { rank[g] = k; });
  let best = null, bestBad = Infinity;
  for (let tries = 0; tries < 4000; tries++) {
    const o = shuffled(n, rng);
    let bad = 0;
    if (avoid && n >= 4) for (let i = 1; i < n; i++) if (Math.abs(rank[o[i]] - rank[o[i - 1]]) === 1) bad++;
    if (bad === 0) return o.flatMap((g) => groups[g]);
    if (bad < bestBad) { best = o; bestBad = bad; }
  }
  return best.flatMap((g) => groups[g]);
}

/** The sequence's name, and its name in cwtool. */
export const sequenceName = (cfg = CALIBRATION) => (cfg.design === "full"
  ? { name: "full calibration (presenter default until November 2026)", cwtool: "DEFAULT" }
  : { name: "time-course calibration (presenter default)", cwtool: "TIME_COURSE" });

/** The designed steps, `{ label, rgb, seconds, linked }`, before any ordering. */
export function designedSteps(cfg = CALIBRATION) {
  if (cfg.design !== "full") return cfg.items.map(([label, rgb, seconds, linked]) => ({ label, rgb: [...rgb], seconds, linked }));
  const items = Object.entries(cfg.grayLengths).map(([v, seconds]) => ({ label: `Gray ${v}`, rgb: [+v, +v, +v], seconds, linked: false }));
  ["Red", "Green", "Blue"].forEach((name, axis) => {
    for (const v of cfg.colourLevels) {
      const rgb = [0, 0, 0];
      rgb[axis] = v;
      items.push({ label: "Black", rgb: [0, 0, 0], seconds: cfg.colourSeconds, linked: false },
        { label: `${name} ${v}`, rgb, seconds: cfg.colourSeconds, linked: true });
    }
  });
  for (const v of cfg.repeats) items.push({ label: `Gray ${v} (repeat)`, rgb: [v, v, v], seconds: cfg.colourSeconds, linked: false });
  return items;
}

/** The calibration steps for `participant` in the order played, each `{ label, rgb, seconds, linked, source }`
 *  with `source` the 0-based position in the preset order (the run file's `source_index` is that plus one). */
export function calibrationSteps(participant, cfg = CALIBRATION) {
  const designed = designedSteps(cfg);
  const preset = scrambleIndices(designed, cfg.presetSeed).map((i) => designed[i]);
  return scrambleIndices(preset, participant).map((i) => ({ ...preset[i], source: i }));
}

export const calibrationLength = (steps) => steps.reduce((s, st) => s + st.seconds, 0);
const round = (v, n = 3) => Math.round(v * 10 ** n) / 10 ** n;

/**
 * The calibration as it was played, for the run file in the calibration presenter's format (so cwtool's *Load
 * sequence…* reads it). Feed it every closed visual step; `csv()` gives the file so far, rewritten as steps close so
 * a crash loses only the running one. A step cut by a pause is one row, from its first onset to its last end.
 */
export class CalibrationRun {
  /** `info`: the plan's `pre.calibration`; `env`: the meta lines that depend on the browser and the display. */
  constructor(info, { participant, mode, runId, tool }, env = {}) {
    Object.assign(this, { info, participant, mode, runId, tool, env });
    this.rows = new Map();
  }

  /** A visual step closed: `why` is "next", "pause" or "end". Returns true when it changed the file. */
  step(step, startMs, endMs, why) {
    if (step.type !== "calibration") return false;
    if (step.step === 1) return false;                                     // the lead-in is not a row
    const row = this.rows.get(step.step);
    if (row) Object.assign(row, { end: endMs, why });
    else this.rows.set(step.step, { step, onset: startMs, end: endMs, why });
    return true;
  }

  get empty() { return this.rows.size === 0; }

  csv(final = false) {
    const { info } = this;
    const list = [...this.rows.values()];
    const first = list[0].onset;
    const rows = list.map(({ step, onset, end, why }) => ({
      time: (onset - first) / 1000, duration: (end - onset) / 1000, rgb: step.field, label: step.colour,
      index: step.step - 1, source_index: step.source >= 0 ? step.source + 1 : "", planned_start_s: step.start - info.firstStepStart,
      planned_duration_s: step.duration, onset_unix_ms: onset, Y: eckertY(step.field), completed: why === "next", gaze: step.gaze ?? null,
      phase: step.gaze || step.cue ? "gaze" : "light",
    }));
    const gazeCount = info.gaze?.length ?? 0;
    const cueCount = info.cueSeconds ? 1 : 0;
    const complete = rows.length === info.steps.length + cueCount + gazeCount && rows.every((r) => r.completed);
    const last = list.at(-1);
    const meta = {
      tool: this.tool, run_id: this.runId, participant: this.participant, mode: this.mode,
      status: complete ? "completed" : final ? "incomplete" : "running",
      sequence_name: sequenceName().name, order: "scrambled, seeded by participant", seed: this.participant,
      keep_neighbours_apart: true,
      started_iso: new Date(first).toISOString(), sequence_start_unix_ms: first.toFixed(3),
      planned_total_s: calibrationLength(info.steps) + (info.cueSeconds ?? 0) + gazeCount * (info.gazeSeconds ?? 0),
      actual_total_s: ((last.end - first) / 1000).toFixed(3),
      lead_in_s: info.leadIn, lead_in_rgb: Array(3).fill(info.leadGray).join(" "), waited_for_start_signal: false,
      fixation_point: "shown during the sequence (gray 128, 0.3 deg), unlike the standalone presenter",
      gaze_check: gazeCount > 0, gaze_step_s: gazeCount ? info.gazeSeconds : "",
      gaze_cue: cueCount ? `${GAZE_CHECK.cueHz} Hz tone, ${GAZE_CHECK.cueLength} s, then ${info.cueSeconds} s of gray before the first point${this.cueMissed ? " (the tone could not be played)" : ""}` : "",
      gaze_grid: gazeCount ? `±${round(Math.max(...info.gaze.map((g) => Math.abs(g.az))))}° × ±${round(Math.max(...info.gaze.map((g) => Math.abs(g.el))))}° from straight ahead, fixed to the head` : "",
      ...this.env,
      note: "time = frame timestamp (s from the first step); display latency of about one frame is not included; a step cut by a pause lasts from its first onset to its last end",
    };
    return calibrationRunCsv(meta, rows);
  }
}
