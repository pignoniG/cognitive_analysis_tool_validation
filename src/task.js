// The auditory n-back during a session: when each spoken cue plays, which item a press belongs to, and the rows
// of nback_log.csv.
//
// Cues are placed on the session clock (seconds from the start of the baseline, which stops while paused) and
// scheduled a second ahead on the audio clock, so pausing simply stops scheduling: cues not yet heard are
// cancelled and play at their place on the session clock after the resume. An item's response window runs from
// its onset for one item interval (2.5 s); a pause inside it cuts it short and marks the item interrupted.

import { NBACK } from "./config.js";
import { NBACK_LOG_HEADER, csvRow, nbackLogRow } from "./formats.js";
import { outcome, score } from "./nback.js";

/** When the spoken phrases sit in their phases (s from the phase start, or from its end when negative). */
export const CUE_TIMES = { phrase: 0.3, start: -1.25, end: -2.5 };

/** Keys that count as a response: Space, Enter, and the keys presentation clickers send. */
export const RESPONSE_KEYS = new Set([" ", "Enter", "PageDown", "PageUp", "ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "b", "B", "."]);

/**
 * Every audio cue of a plan, in time order: `{ e, id, kind, phase, block?, item? }`, with `e` on the session clock.
 * Each rest (and the baseline and final rest) opens with the rest phrase; each instruction with the next block's
 * instruction and ends with the start cue; each block plays its digits, one every `soa` seconds from its start;
 * the session ends with the end phrase.
 */
/** The key of a block: the practice blocks are numbered from 1 as well, so they get their own keys. */
export const blockKey = (b) => (b.practice ? `p${b.block}` : b.block);

export function audioCues(plan, cfg = NBACK) {
  const cues = [];
  const blocks = new Map([...plan.blocks, ...(plan.practiceBlocks ?? [])].map((b) => [blockKey(b), b]));
  for (const p of plan.phases) {
    const end = p.start + p.duration;
    const key = blockKey(p);
    if (["baseline", "rest", "final", "calibration"].includes(p.kind)) cues.push({ e: p.start + CUE_TIMES.phrase, id: "rest", kind: "phrase", phase: p.label });
    if (p.kind === "practice_end") cues.push({ e: p.start + CUE_TIMES.phrase, id: "end", kind: "phrase", phase: p.label });
    if (p.kind === "instruction" || p.kind === "practice_instruction") {
      const b = blocks.get(key);
      cues.push({ e: p.start + CUE_TIMES.phrase, id: p.level === 0 ? `back_0_${b.targetDigit}` : `back_${p.level}`, kind: "phrase", phase: p.label, block: key });
      cues.push({ e: end + CUE_TIMES.start, id: "start", kind: "phrase", phase: p.label, block: key });
    }
    if (p.kind === "block" || p.kind === "practice_block") {
      blocks.get(key).items.forEach((it, k) =>
        cues.push({ e: p.start + k * cfg.soa, id: `digit_${it.digit}`, kind: "digit", phase: p.label, block: key, item: k }));
    }
    if (p.kind === "final") cues.push({ e: end + CUE_TIMES.end, id: "end", kind: "phrase", phase: p.label });
  }
  return cues.sort((a, b) => a.e - b.e);
}

export class TaskRun {
  /**
   * `audio`: `{ play(id, perfMs) -> handle, stop(handle), stopAll() }` (AudioCues); `sink` and `file` receive the
   * rows; `onScore(blockScore)` gets each block's scores when its last window closes; `unix(perfMs)` converts
   * times for the log.
   */
  constructor(plan, { audio, sink, file = "nback_log.csv", practiceFile = "practice_nback_log.csv", onScore = () => {},
    unix = (t) => performance.timeOrigin + t, lookahead = 1, cfg = NBACK }) {
    Object.assign(this, { audio, sink, file, practiceFile, onScore, unix, lookahead, cfg });
    const all = [...plan.blocks, ...(plan.practiceBlocks ?? [])];
    this.cues = audioCues(plan, cfg);
    this.next = 0;                         // first cue not yet scheduled
    this.blocks = new Map(all.map((b) => [blockKey(b), {
      block: b.block, n: b.level, targetDigit: b.targetDigit, scored: false, practice: !!b.practice,
      items: b.items.map((it) => ({ ...it, onsetPerf: null, windowEnd: null, responsePerf: null, extra: 0, interrupted: false, written: false })),
    }]));
    this.scheduled = [];                   // cues with a pending or playing sound: { cue, handle }
    this.stray = 0;                        // presses outside any item's window
    this.late = 0;                         // cues that could only be played late
    this.scores = [];                      // the session's blocks; the practice's are in `practiceScores`
    this.practiceScores = [];
    if (plan.blocks.length) sink.append(file, csvRow(NBACK_LOG_HEADER));
    if (plan.practiceBlocks?.length) sink.append(practiceFile, csvRow(NBACK_LOG_HEADER));
  }

  /** Each frame: schedule the cues due within the look-ahead, and close the windows that have ended. `t` is the
   *  frame time, `e` the session time at `t`, `state` the session's state. */
  frame(t, e, state) {
    if (state === "running") {
      while (this.next < this.cues.length && this.cues[this.next].e <= e + this.lookahead) {
        const index = this.next++, cue = this.cues[index];
        const handle = this.audio.play(cue.id, t + (cue.e - e) * 1000);
        if (handle.late) this.late++;
        this.scheduled.push({ index, cue, handle });
        if (cue.kind === "digit") {
          const it = this.blocks.get(cue.block).items[cue.item];
          it.onsetPerf = handle.onsetPerf;
          it.windowEnd = handle.onsetPerf + this.cfg.soa * 1000;
        }
      }
    }
    this.#closeWindows(t);
  }

  /** A response at `timeStamp` (performance clock, as on the key event). Returns what it was counted as. */
  press(timeStamp) {
    for (const b of this.blocks.values()) {
      for (const it of b.items) {
        if (it.onsetPerf !== null && !it.written && timeStamp >= it.onsetPerf && timeStamp < it.windowEnd) {
          if (it.responsePerf === null) {
            it.responsePerf = timeStamp;
            if (b.practice) this.audio.feedback?.(it.target);      // practice only: a high tone for a hit, a low one for a false alarm
            return "response";
          }
          it.extra++;
          return "extra";
        }
      }
    }
    this.stray++;
    return "stray";
  }

  /** The session paused at `t`: stop the sounds, cut the running window, and put cues not yet heard back. */
  pause(t) {
    // cues are scheduled in order, so the ones not yet heard are the last scheduled: start again from the first
    for (const { index, cue, handle } of this.scheduled) {
      this.audio.stop(handle);
      if (handle.onsetPerf > t) {
        this.next = Math.min(this.next, index);
        if (cue.kind === "digit") Object.assign(this.blocks.get(cue.block).items[cue.item], { onsetPerf: null, windowEnd: null });
      }
    }
    this.scheduled = [];
    for (const b of this.blocks.values()) {
      for (const it of b.items) {
        if (it.onsetPerf !== null && !it.written && it.onsetPerf <= t && t < it.windowEnd) { it.windowEnd = t; it.interrupted = true; }
      }
    }
  }

  /** The session ended at `t`: close every window; on an abort also silence everything (the end phrase of a
   *  completed session is left to finish). */
  end(t, completed) {
    if (!completed) this.audio.stopAll();
    for (const b of this.blocks.values()) {
      for (const it of b.items) {
        if (it.onsetPerf === null || it.written) continue;
        if (it.onsetPerf > t) Object.assign(it, { onsetPerf: null, windowEnd: null });   // scheduled, never heard
        else if (it.windowEnd > t) it.windowEnd = t;
      }
    }
    this.#closeWindows(Infinity);
  }

  #closeWindows(now) {
    this.scheduled = this.scheduled.filter(({ handle }) => handle.onsetPerf + handle.duration * 1000 > now);
    for (const b of this.blocks.values()) {
      let open = false;
      b.items.forEach((it, k) => {
        if (it.written) return;
        if (it.onsetPerf === null) { open = true; return; }
        if (it.windowEnd > now) { open = true; return; }
        const o = outcome(it.target, it.responsePerf !== null);
        this.sink.append(b.practice ? this.practiceFile : this.file, nbackLogRow(b.block, b.n, k + 1, {
          ...it, onsetMs: this.unix(it.onsetPerf), responseMs: it.responsePerf === null ? null : this.unix(it.responsePerf),
        }, b.targetDigit, o));
        it.written = true;
      });
      const played = b.items.filter((it) => it.written);
      if (!b.scored && played.length && (!open || now === Infinity)) {
        b.scored = true;
        const counted = played.filter((it) => !it.interrupted);
        const s = { block: b.block, n: b.n, items: played.length, interrupted: played.length - counted.length,
          ...score(counted.map((it) => ({ target: it.target, rt: it.responsePerf === null ? null : it.responsePerf - it.onsetPerf }))) };
        (b.practice ? this.practiceScores : this.scores).push(s);
        this.onScore({ ...s, practice: b.practice });
      }
    }
  }
}
