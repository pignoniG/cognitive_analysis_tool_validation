// Display geometry and the nominal luminance of a step as cwtool's video analysis would see it.
//
// Everything is drawn on the image plane one unit in front of the eye, so a disc of angular diameter θ centred on
// the fixation point has radius tan(θ/2): exact on a flat monitor, and the same in a headset (head-locked).

import { nominalY } from "./colour.js";

export const rad = (d) => (d * Math.PI) / 180;
export const deg = (r) => (r * 180) / Math.PI;

/** Visual angle (°) of `size` at `distance` (same units). */
export const angleOf = (size, distance) => 2 * deg(Math.atan(size / 2 / distance));

/** cwtool's default gaze circle radius (`fixation_radius_deg`, Eckert et al. 2022). */
export const GAZE_RADIUS = 16.35;

/** The vertical field (°) of a canvas `cssHeight` px tall on a screen `screenCssHeight` px and `screenCm` cm tall,
 *  seen from `distanceCm`. Works whether or not the canvas fills the screen. */
export function canvasField({ cssHeight, screenCssHeight, screenCm, distanceCm }) {
  const heightCm = (screenCm * cssHeight) / screenCssHeight;
  return angleOf(heightCm, distanceCm);
}

/**
 * Nominal relative luminance (0–1) of a step: `yField`, the mean over the display, and `yGaze`, the mean over
 * cwtool's gaze circle around the fixation point, both by area on the image plane (as a camera's pixels would
 * average them). On a monitor the gaze circle can reach past the screen; that part is the dark room and counts
 * as 0. The fixation point (under 0.1 deg²) is left out. Scenes return null until their panoramas are measured.
 * `display`: `{ vfov, aspect }` (vertical field in degrees, width / height).
 */
export function stepLuminance(step, { vfov, aspect }, gazeRadius = GAZE_RADIUS) {
  if (!step.field) return { yGaze: null, yField: null };
  const yBg = nominalY(step.field);
  const yT = step.target ? nominalY(step.target.rgb) : yBg;
  const hh = Math.tan(rad(vfov / 2)), hw = hh * aspect;
  const rt = step.target ? Math.tan(rad(step.target.diameter / 2)) : 0;
  const at = (x, y) => (Math.abs(x) > hw || Math.abs(y) > hh ? 0 : x * x + y * y <= rt * rt ? yT : yBg);

  // the display: exact, a target is always smaller than the screen; clip it to be safe
  const screen = 4 * hw * hh;
  const disc = Math.min(Math.PI * rt * rt, screen);
  const yField = (yBg * (screen - disc) + yT * disc) / screen;

  // the gaze circle: equal-area rings, so each sample stands for the same area
  const rg = Math.tan(rad(gazeRadius)), rings = 64, spokes = 128;
  let sum = 0;
  for (let i = 0; i < rings; i++) {
    const r = rg * Math.sqrt((i + 0.5) / rings);
    for (let j = 0; j < spokes; j++) {
      const a = (2 * Math.PI * (j + 0.5)) / spokes;
      sum += at(r * Math.cos(a), r * Math.sin(a));
    }
  }
  return { yGaze: sum / (rings * spokes), yField };
}
