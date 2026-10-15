// What runs a session, whatever shows it: the stage, the session clock, the n-back with its audio, and the files.
// The monitor's stimulus window (stimulus.js) and the headset (vr.js) each give it a renderer and a frame loop, and
// pass on the experimenter's commands; it reports back through `emit` with the messages the control page reads:
// display, audio, started, status, score and done.

import { APP_VERSION, VISUAL } from "./config.js";
import { createStage } from "./stage.js";
import { stepLuminance, GAZE_RADIUS } from "./geometry.js";
import { SessionRun } from "./session.js";
import { Sink, serverAvailable } from "./sink.js";
import { eventLogName, sessionFolder } from "./formats.js";
import { AudioCues } from "./audio.js";
import { TaskRun, RESPONSE_KEYS } from "./task.js";

export const IDLE = { field: [VISUAL.constant.level, VISUAL.constant.level, VISUAL.constant.level], target: null, scene: null };

export class Presenter {
  /**
   * `mode`: "screen" or "vr". `emit(message)` reports to the control page. `display()` gives the display's
   * `{ vfov, aspect, ... }` (for the nominal luminance, and saved in session.json); `headYaw()` the head's yaw in
   * radians, so a panorama starts ahead of the participant.
   */
  constructor({ THREE, renderer, mode, emit, display, headYaw = () => 0 }) {
    Object.assign(this, { mode, emit, display, headYaw });
    this.stage = createStage(THREE, renderer);
    this.stage.show(IDLE);
    this.audio = new AudioCues();
    this.audioLanguage = null;
    this.audioError = null;
    this.config = null;
    this.plan = null;
    this.run = null;
    this.task = null;
    this.sink = null;
    this.files = null;
    this.notes = [];
    this.lastStatus = 0;
    this.serverP = serverAvailable();
  }

  /** A session is under way (running or paused). */
  get running() { return !!this.run && (this.run.state === "running" || this.run.state === "paused"); }

  setup(config, plan) {
    if (this.running) return;
    this.config = config;
    this.plan = plan;
    this.run = null;               // a finished session is replaced by the next one
    this.task = null;
    this.notes = [];
    this.loadAudio(config.language);
  }

  async loadAudio(language) {
    if (this.audioLanguage === language) return this.sendAudio();
    this.audioLanguage = language;
    this.audioError = null;
    this.sendAudio();
    try { await this.audio.load(language); } catch (e) { this.audioError = `could not load the ${language} audio: ${e.message}`; }
    this.sendAudio();
  }

  sendAudio() {
    const a = this.audio;
    this.emit({ type: "audio", audio: { language: this.audioLanguage, loaded: a.buffers.size > 0 && a.manifest?.language === this.audioLanguage,
      running: a.running, error: this.audioError, voice: a.manifest?.voice ?? null } });
  }

  /** Call from any click or key press: browsers start audio only after one. */
  unlockAudio() {
    if (!this.audio.running) this.audio.unlock().then(() => this.sendAudio(), () => {});
  }

  /** Show one step of the plan (not during a session). */
  preview(step) { if (!this.running) this.stage.show(step, { headYaw: this.headYaw() }); }

  note(text) {
    this.notes.push({ unix_ms: Date.now(), session_s: this.run ? this.run.elapsed(performance.now()) : null, note: text });
  }

  async start() {
    if (this.run || !this.plan) return;
    const now = Date.now();
    const folder = sessionFolder(this.config.participant, this.mode, now);
    this.files = { events: eventLogName(now), visual: "visual_log.csv" };
    const sink = this.sink = new Sink(folder, await this.serverP);
    const task = this.task = new TaskRun(this.plan, { audio: this.audio, sink, onScore: (score) => this.emit({ type: "score", score }) });
    this.run = new SessionRun(this.plan, {
      show: (step) => this.stage.show(step, { headYaw: this.headYaw() }),
      luminance: (step) => stepLuminance(step, this.display()),
      sink, files: this.files,
      hooks: {
        onStart: () => sink.write("session.json", JSON.stringify(this.sessionInfo({ status: "running" }), null, 1)),
        onPause: (t) => task.pause(t),
        onEnd: (summary) => this.finish(summary),
      },
    });
    this.run.start();
    this.emit({ type: "started", folder, saving: sink.mode });
  }

  pause() { this.run?.pause(); }
  resume() { this.run?.resume(); }
  abort(reason) { this.run?.abort(reason); }

  /** A participant's response at `timeStamp` (performance clock). */
  press(timeStamp) { if (this.run?.state === "running") this.task.press(timeStamp); }

  /** Every frame, before rendering: `t` is the frame's time. */
  frame(t) {
    const { run, task } = this;
    run?.frame(t);
    if (task) task.frame(t, run.elapsed(t), run.state);
    if (t - this.lastStatus > 250) {
      this.lastStatus = t;
      if (this.running) {
        this.emit({ type: "status", status: run.status(t),
          saving: { mode: this.sink.mode, sent: this.sink.sent, error: this.sink.broken ? String(this.sink.broken.message || this.sink.broken) : null },
          audio: { running: this.audio.running, late: task.late, stray: task.stray } });
      }
    }
  }

  async finish(summary) {
    const { sink } = this;
    this.task.end(summary.end_unix_ms - performance.timeOrigin, summary.status === "completed");
    this.stage.show(IDLE);
    sink.write("session.json", JSON.stringify(this.sessionInfo({ status: summary.status, summary }), null, 1));
    const complete = await sink.flush();
    this.emit({ type: "done", summary, folder: sink.folder, saving: sink.mode, diskComplete: sink.server ? complete : null,
      diskError: sink.broken ? String(sink.broken.message || sink.broken) : null, files: sink.snapshot() });
  }

  sessionInfo(extra = {}) {
    const { config, plan, task, sink } = this;
    return {
      app: "validation-task", app_version: APP_VERSION, mode: this.mode,
      participant: config.participant, seed: config.participant, language: config.language,
      generator_attempt: plan.visual.attempt, balance_max_deviation: plan.visual.balance.cost,
      load_order: plan.phases.filter((p) => p.kind === "block").map((p) => p.level),
      display: { ...this.display(), largest_target_planned_deg: plan.maxDiameter, gaze_circle_radius_deg: GAZE_RADIUS },
      luminance: "nominal sRGB (no display profile)",
      audio: { ...this.audio.info(), language: config.language, onsets: "expected time the sound leaves the output (Web Audio output timestamp)" },
      nback: task ? { scores: task.scores, stray_presses: task.stray, late_cues: task.late,
        responses: this.mode === "vr" ? "controller trigger (select); keys as on the monitor" : [...RESPONSE_KEYS, "any mouse button"] } : null,
      files: this.files,
      saving: sink.mode, server_folder: sink.server ? sink.folder : null,
      browser: navigator.userAgent,
      notes: this.notes,
      ...extra,
    };
  }
}
