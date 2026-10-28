// The n-back practice: a separate part of the page, done before the recording (before the headset goes on, or the
// participant sits at the monitor). It runs on the control page itself: each level once, a spoken instruction then
// 20 items, a high tone for a hit and a low one for a false alarm, and the scores at the end. It uses the session's
// engine and task with a practice plan, and saves a folder of its own (`<participant>_practice_<date>/`), so it never
// mixes with a recording.

import { APP_VERSION, PRACTICE, NBACK } from "./config.js";
import { practicePlan } from "./prelude.js";
import { SessionRun } from "./session.js";
import { TaskRun } from "./task.js";
import { AudioCues } from "./audio.js";
import { Sink, serverAvailable } from "./sink.js";
import { sessionFolder } from "./formats.js";

export class PracticeRun {
  /** `emit(message)`: `{ type: "status", status }`, `{ type: "score", score }`, `{ type: "feedback", hit }` and
   *  `{ type: "done", summary, folder, saving, files, scores }`. */
  constructor(emit) {
    this.emit = emit;
    this.audio = null;
    this.language = null;
    this.run = null;
    this.task = null;
    this.raf = 0;
    this.serverP = serverAvailable();
  }

  get running() { return !!this.run && this.run.state !== "done"; }

  /** Call from the click that starts the practice: browsers start audio only after one. Resolves once the clips of
   *  `language` are loaded. */
  async prepare(language) {
    this.audio ??= new AudioCues();
    await this.audio.unlock();
    if (this.language !== language) {
      await this.audio.load(language);
      this.language = language;
    }
  }

  async start(participant, language) {
    if (this.running) return;
    const plan = practicePlan(participant);
    const now = Date.now();
    const folder = sessionFolder(participant, "practice", now);
    const sink = new Sink(folder, await this.serverP);
    const a = this.audio;                                        // the task's view of it: the tones are also shown
    const audio = { play: (id, perfMs) => a.play(id, perfMs), stop: (h) => a.stop(h), stopAll: () => a.stopAll(),
      feedback: (hit) => { a.feedback(hit); this.emit({ type: "feedback", hit }); } };
    this.sink = sink;
    this.task = new TaskRun(plan, { audio, sink, onScore: (score) => this.emit({ type: "score", score }) });
    this.run = new SessionRun(plan, {
      show() {}, sink, files: { events: "practice_event_log.csv", visual: "practice_visual_log.csv" },
      hooks: {
        onPause: (t) => this.task.pause(t),
        onEnd: (summary) => this.finish(summary, { participant, language, folder }),
      },
    });
    this.run.start();
    const tick = (t) => {
      if (!this.running) return;
      this.run.frame(t);
      this.task.frame(t, this.run.elapsed(t), this.run.state);
      this.emit({ type: "status", status: this.run.status(t) });
      if (this.running) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** The participant's response at `timeStamp` (performance clock). */
  press(timeStamp) { if (this.run?.state === "running") this.task.press(timeStamp); }

  stop() { if (this.running) this.run.abort("stopped by the experimenter"); }

  async finish(summary, { participant, language, folder }) {
    cancelAnimationFrame(this.raf);
    const { sink, task } = this;
    task.end(summary.end_unix_ms - performance.timeOrigin, summary.status === "completed");
    sink.write("session.json", JSON.stringify({
      app: "validation-task", app_version: APP_VERSION, part: "n-back practice", participant, language,
      levels: PRACTICE.levels, items_per_level: PRACTICE.items, soa_s: NBACK.soa,
      feedback: "a high tone on a hit, a low one on a false alarm",
      status: summary.status, scores: task.practiceScores, stray_presses: task.stray, late_cues: task.late,
      audio: this.audio.info(), saving: sink.mode, server_folder: sink.server ? folder : null, browser: navigator.userAgent,
    }, null, 1));
    const complete = await sink.flush();
    this.emit({ type: "done", summary, folder, saving: sink.mode, diskComplete: sink.server ? complete : null,
      files: sink.snapshot(), scores: task.practiceScores });
  }
}
