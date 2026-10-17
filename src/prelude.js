// What comes before the load timeline in the same recording: the calibration (cwtool's full calibration sequence,
// so the pupil model can be fitted on the participant's own recording) and the n-back practice (each level once, on
// a constant gray field, with feedback sounds). Both are optional and count within the setup time, not the 30 minutes
// of the session. The calibration comes first, with the participant fresh and nothing else to do; the practice then
// teaches the task, and the session's 2-minute baseline follows to let the pupil settle.

import { CALIBRATION, PRACTICE, NBACK } from "./config.js";
import { calibrationSteps, calibrationLength } from "./calibration.js";
import { nbackBlock } from "./nback.js";
import { gray } from "./colour.js";

/**
 * `{ phases, steps, practiceBlocks, calibration, duration }` for `participant`, times in s from the start of the
 * recording. `steps` are visual steps in the visual timeline's shape (segment 0, types "calibration" and "practice").
 * `options`: `{ calibration, practice }` booleans.
 */
export function preTimeline(participant, { calibration = true, practice = true } = {}, cc = CALIBRATION, pc = PRACTICE) {
  const phases = [], steps = [], practiceBlocks = [];
  let t = 0, calibrationInfo = null;
  const phase = (label, kind, duration, extra = {}) => { phases.push({ label, kind, start: t, duration, ...extra }); };
  const step = (n, type, duration, field, extra = {}) =>
    steps.push({ segment: 0, step: n, type, variant: null, start: t, duration, field, target: null, colour: null, scene: null,
      change: n === 1 ? "onset" : "step", ...extra });

  if (calibration) {
    const played = calibrationSteps(participant, cc);
    const duration = cc.leadIn + calibrationLength(played);
    phase("Calibration", "calibration", duration);
    step(1, "calibration", cc.leadIn, gray(cc.leadGray), { colour: "Lead-in" });
    let at = t + cc.leadIn;
    played.forEach((st, k) => {
      steps.push({ segment: 0, step: k + 2, type: "calibration", variant: null, start: at, duration: st.seconds, field: st.rgb,
        target: null, colour: st.label, scene: null, change: "step", source: st.source, linked: st.linked });
      at += st.seconds;
    });
    calibrationInfo = { steps: played, leadIn: cc.leadIn, leadGray: cc.leadGray, start: t, duration, firstStepStart: t + cc.leadIn };
    t += duration;
  }

  if (practice) {
    const start = t;
    pc.levels.forEach((level, i) => {
      const block = i + 1;
      const generated = nbackBlock(`${participant}/practice`, block, level, pc.items, { ...NBACK, lures: pc.lures });
      phase("Practice instruction", "practice_instruction", pc.instruction, { level, block, practice: true });
      t += pc.instruction;
      const duration = pc.items * NBACK.soa;
      phase(`Practice ${level}-back`, "practice_block", duration, { level, block, practice: true });
      practiceBlocks.push({ label: `Practice ${level}-back`, level, block, practice: true, start: t, duration, ...generated });
      t += duration;
    });
    step(1, "practice", t - start, gray(128), { start });     // one constant gray field under the whole practice
    steps.at(-1).start = start;
  }
  return { phases, steps, practiceBlocks, calibration: calibrationInfo, practice, duration: t };
}
