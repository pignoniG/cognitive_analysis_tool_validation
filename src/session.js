// One session run: a state machine driven by frame timestamps (ms on the performance.now clock), the same for the
// monitor and the headset. Each frame it works out which load phase and which visual step the session is in, shows
// a new step on the frame that carries it, and writes a row when a phase or a step ends (so a crash loses only the
// running one). Onsets are the timestamps of the frames that first showed them; the display adds about one frame.
//
// Pausing freezes the session clock and the stimulus (nothing changes on screen); the running phase and step end at
// the pause, a Pause row is written, and both are written again from the resume, with the same labels.

import { EVENT_LOG_HEADER, VISUAL_LOG_HEADER, csvRow, eventLogRow, visualLogRow } from "./formats.js";
import { totalDuration } from "./load.js";

const MAX_FRAMES = 1 << 19;   // 72 min at 120 Hz

export class SessionRun {
  /**
   * `plan`: `{ phases, visual: { steps } }`. Options: `show(step)` puts a step on the display; `luminance(step)` gives
   * its `{ yGaze, yField }`; `sink` and `files` (`{ events, visual }` names) receive the rows; `hooks` get
   * `onStart(t)`, `onPhase(phase, t)`, `onStepClosed(step, startUnixMs, endUnixMs, why)` (`why`: next, pause or end),
   * `onPause(t)`, `onResume(t)` and `onEnd(summary)`.
   */
  constructor(plan, { show, luminance = () => ({}), sink, files, hooks = {}, unix = (t) => performance.timeOrigin + t }) {
    Object.assign(this, { plan, show, luminance, sink, files, hooks, unix });
    this.phases = plan.phases;
    this.steps = plan.visual.steps;
    this.total = totalDuration(this.phases);
    this.state = "ready";
    this.request = null;
    this.phaseIdx = -1;
    this.stepIdx = -1;
    this.openPhase = null;      // { label, start }
    this.openStep = null;       // { step, start, change }
    this.t0 = null;
    this.pausedMs = 0;
    this.pauseStart = null;
    this.pauses = [];
    this.intervals = new Float32Array(MAX_FRAMES);
    this.nIntervals = 0;
    this.lastT = null;
    this.refInterval = null;    // median of the first 300 frame intervals, for counting dropped frames live
    this.dropped = 0;
    sink.append(files.events, csvRow(EVENT_LOG_HEADER));
    sink.append(files.visual, csvRow(VISUAL_LOG_HEADER));
  }

  start() { if (this.state === "ready") this.request = "start"; }
  pause() { if (this.state === "running") this.request = "pause"; }
  resume() { if (this.state === "paused") this.request = "resume"; }
  /** Abort now (not on the next frame: frames may have stopped). */
  abort(reason) { if (this.state !== "done" && this.state !== "ready") this.#end(performance.now(), `aborted (${reason})`); }

  /** The session time (s) at frame time `t`. */
  elapsed(t) {
    if (this.t0 === null) return 0;
    const pausedNow = this.state === "paused" ? t - this.pauseStart : 0;
    return Math.min(this.total, (t - this.t0 - this.pausedMs - pausedNow) / 1000);
  }

  frame(t) {
    if (this.state === "done") return;
    if (this.state !== "ready") this.#countFrame(t);
    const req = this.request;
    this.request = null;

    if (this.state === "ready") {
      if (req !== "start") return;
      this.t0 = t;
      this.lastT = t;
      this.state = "running";
      this.hooks.onStart?.(t);
    } else if (this.state === "running" && req === "pause") {
      this.#closePhase(t);
      this.#closeStep(t, "pause");
      this.pauseStart = t;
      this.state = "paused";
      this.hooks.onPause?.(t);
      return;
    } else if (this.state === "paused") {
      if (req !== "resume") return;
      this.sink.append(this.files.events, eventLogRow("Pause", this.unix(this.pauseStart), this.unix(t)));
      this.pauses.push({ start_unix_ms: this.unix(this.pauseStart), duration_s: (t - this.pauseStart) / 1000, at_s: this.elapsed(this.pauseStart) });
      this.pausedMs += t - this.pauseStart;
      this.pauseStart = null;
      this.openPhase = { label: this.phases[this.phaseIdx].label, start: t };
      this.openStep = { step: this.steps[this.stepIdx], start: t, change: "resume" };
      this.state = "running";
      this.hooks.onResume?.(t);
    }

    const e = (t - this.t0 - this.pausedMs) / 1000;
    while (this.phaseIdx + 1 < this.phases.length && e >= this.phases[this.phaseIdx + 1].start) {
      this.#closePhase(t);
      const phase = this.phases[++this.phaseIdx];
      this.openPhase = { label: phase.label, start: t };
      this.hooks.onPhase?.(phase, t);
    }
    let changed = false;   // a step is logged even when a stalled frame jumped over all of it
    while (this.stepIdx + 1 < this.steps.length && e >= this.steps[this.stepIdx + 1].start) {
      this.#closeStep(t, "next");
      const step = this.steps[++this.stepIdx];
      this.openStep = { step, start: t, change: step.change };
      changed = true;
    }
    if (e >= this.total) return this.#end(t, "completed");
    if (changed) this.show(this.steps[this.stepIdx]);
  }

  /** What the control window shows. */
  status(t = performance.now()) {
    const e = this.elapsed(t);
    const phase = this.phases[this.phaseIdx];
    const step = this.steps[this.stepIdx];
    return {
      state: this.state, elapsed: e, total: this.total,
      phase: phase?.label ?? null, phaseLeft: phase ? Math.max(0, phase.start + phase.duration - e) : null,
      phaseIndex: this.phaseIdx + 1, phases: this.phases.length,
      segment: step?.segment ?? null, condition: step?.type ?? null, variant: step?.variant ?? null, stepLabel: step?.colour ?? null,
      frames: this.nIntervals + (this.t0 === null ? 0 : 1), dropped: this.dropped, frameMs: this.refInterval,
      pauses: this.pauses.length,
    };
  }

  #countFrame(t) {
    if (this.lastT !== null && this.nIntervals < MAX_FRAMES) {
      const dt = t - this.lastT;
      this.intervals[this.nIntervals++] = dt;
      if (this.refInterval === null && this.nIntervals === 300) this.refInterval = median(this.intervals.subarray(0, 300));
      if (this.refInterval !== null && dt > 1.5 * this.refInterval) this.dropped++;
    }
    this.lastT = t;
  }

  #closePhase(t) {
    if (!this.openPhase) return;
    this.sink.append(this.files.events, eventLogRow(this.openPhase.label, this.unix(this.openPhase.start), this.unix(t)));
    this.openPhase = null;
  }

  #closeStep(t, why) {
    if (!this.openStep) return;
    const { step, start, change } = this.openStep;
    this.sink.append(this.files.visual, visualLogRow({ ...step, change }, this.unix(start), this.unix(t), this.luminance(step)));
    this.hooks.onStepClosed?.(step, this.unix(start), this.unix(t), why);
    this.openStep = null;
  }

  #end(t, status) {
    if (this.state === "paused") {
      this.sink.append(this.files.events, eventLogRow("Pause", this.unix(this.pauseStart), this.unix(t)));
      this.pauses.push({ start_unix_ms: this.unix(this.pauseStart), duration_s: (t - this.pauseStart) / 1000, at_s: this.elapsed(this.pauseStart) });
    } else {
      this.#closePhase(t);
      this.#closeStep(t, "end");
    }
    const reached = this.elapsed(t);
    this.state = "done";
    const iv = this.intervals.subarray(0, this.nIntervals);
    const med = iv.length ? median(iv) : null;
    let dropped = 0, max = 0;
    for (const dt of iv) { if (med && dt > 1.5 * med) dropped++; if (dt > max) max = dt; }
    this.summary = {
      status,
      start_unix_ms: this.t0 === null ? null : this.unix(this.t0),
      end_unix_ms: this.unix(t),
      session_s: reached, planned_s: this.total,
      phases_started: this.phaseIdx + 1, steps_started: this.stepIdx + 1,
      pauses: this.pauses,
      frames: { count: this.nIntervals + 1, interval_median_ms: med, interval_max_ms: iv.length ? max : null,
        dropped, dropped_rule: "interval longer than 1.5 times the median" },
    };
    this.hooks.onEnd?.(this.summary);
  }
}

function median(values) {
  const a = Float64Array.from(values).sort();
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
