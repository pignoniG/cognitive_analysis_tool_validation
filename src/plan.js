// Everything a participant ID generates: the optional calibration and practice, then the load phases, the visual
// timeline and the n-back blocks, all on one clock from the start of the recording.

import { SESSION } from "./config.js";
import { loadTimeline } from "./load.js";
import { visualTimeline } from "./visual.js";
import { nbackBlock } from "./nback.js";
import { preTimeline } from "./prelude.js";

/** The plan for `participant`, for a display whose largest whole target is `maxDiameter` (°). `options`:
 *  `{ calibration, practice }` (both on by default). */
export function makePlan(participant, maxDiameter = Infinity, options = {}) {
  const opts = { calibration: options.calibration ?? true, practice: options.practice ?? true };
  const pre = preTimeline(participant, opts);
  const off = pre.duration;
  const loadPhases = loadTimeline(participant);
  const visual = visualTimeline(participant, loadPhases, { maxDiameter });
  const items = SESSION.block / 2.5;
  const blocks = loadPhases.filter((p) => p.kind === "block").map((p) => ({ ...p, ...nbackBlock(participant, p.block, p.level, items) }));

  // the load timeline and everything built on it starts after the prelude
  const shift = (o) => ({ ...o, start: o.start + off });
  const segments = visual.segments.map((s) => ({ ...shift(s), steps: s.steps.map(shift) }));
  return {
    participant, maxDiameter: Number.isFinite(maxDiameter) ? maxDiameter : null, options: opts,
    pre: { duration: off, calibration: pre.calibration, practice: pre.practice },
    phases: [...pre.phases, ...loadPhases.map(shift)],
    visual: { ...visual, segments, steps: [...pre.steps, ...segments.flatMap((s) => s.steps)], pre: pre.steps },
    blocks: blocks.map(shift),
    practiceBlocks: pre.practiceBlocks,
  };
}
