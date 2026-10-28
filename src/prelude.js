// What comes before the load timeline in the same recording: the calibration (cwtool's full calibration sequence,
// so the pupil model can be fitted on the participant's own recording). It is optional and counts within the setup
// time, not the session's minutes. It comes first, with the participant fresh and nothing else to do; the session's
// 2-minute baseline follows to let the pupil settle.
//
// The n-back practice is not part of the recording: it is a separate part of the page (practice.js), done before the
// headset goes on or the participant sits at the monitor. Its plan is built here.

import { CALIBRATION, PRACTICE, NBACK } from "./config.js";
import { calibrationSteps, calibrationLength } from "./calibration.js";
import { nbackBlock } from "./nback.js";
import { gray } from "./colour.js";

/**
 * `{ phases, steps, calibration, duration }` for `participant`, times in s from the start of the recording.
 * `steps` are visual steps in the visual timeline's shape (segment 0, type "calibration"). `options`:
 * `{ calibration }`.
 */
export function preTimeline(participant, { calibration = true } = {}, cc = CALIBRATION) {
  const phases = [], steps = [];
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

  return { phases, steps, calibration: calibrationInfo, duration: t };
}

/** The practice's plan: each level once (instruction, then the block), then the end phrase, on a constant gray field.
 *  Same shape as a session plan, so the session engine and the task run it as they run a session. */
export function practicePlan(participant, pc = PRACTICE) {
  const phases = [], practiceBlocks = [];
  let t = 0;
  pc.levels.forEach((level, i) => {
    const block = i + 1;
    const generated = nbackBlock(`${participant}/practice`, block, level, pc.items, { ...NBACK, lures: pc.lures });
    phases.push({ label: "Practice instruction", kind: "practice_instruction", start: t, duration: pc.instruction, level, block, practice: true });
    t += pc.instruction;
    const duration = pc.items * NBACK.soa;
    phases.push({ label: `Practice ${level}-back`, kind: "practice_block", start: t, duration, level, block, practice: true });
    practiceBlocks.push({ label: `Practice ${level}-back`, level, block, practice: true, start: t, duration, ...generated });
    t += duration;
  });
  phases.push({ label: "Practice end", kind: "practice_end", start: t, duration: pc.end });
  t += pc.end;
  const step = { segment: 0, step: 1, type: "practice", variant: null, start: 0, duration: t, field: gray(128), target: null,
    colour: null, scene: null, change: "onset" };
  return { participant, phases, blocks: [], practiceBlocks, visual: { steps: [step], segments: [] }, duration: t };
}
