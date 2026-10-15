// sRGB colours and their nominal luminance. "Nominal Y" is the relative luminance of an sRGB colour on an ideal
// sRGB display: the BT.709 photopic weights on linearised RGB, as in cwtool's luminance model. A display profile
// (measured cd/m², later) replaces it with what the display actually emits.

export const PHOTOPIC = [0.2126, 0.7152, 0.0722];

/** The calibration sequence's gray levels (Eckert et al. 2022). */
export const GRAY_LEVELS = [0, 36, 73, 109, 146, 182, 219, 255];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** 0–255 sRGB value to linear light 0–1. */
export const toLinear = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

/** Linear light 0–1 to the nearest 0–255 sRGB value. */
export const toByte = (lin) => {
  const c = lin <= 0.0031308 ? 12.92 * lin : 1.055 * lin ** (1 / 2.4) - 0.055;
  return clamp(Math.round(c * 255), 0, 255);
};

export const gray = (v) => [v, v, v];

/** Nominal relative luminance (0–1) of an [r, g, b] colour. */
export const nominalY = ([r, g, b]) => PHOTOPIC[0] * toLinear(r) + PHOTOPIC[1] * toLinear(g) + PHOTOPIC[2] * toLinear(b);

/** The colour with luminance `Y` that uses only `channels` (indices 0–2), all at the same level; null if out of
 *  gamut (e.g. blue alone cannot reach more than Y = 0.0722). */
export function equalLuminance(Y, channels) {
  const lin = Y / channels.reduce((s, c) => s + PHOTOPIC[c], 0);
  if (lin > 1 + 1e-9) return null;
  const v = toByte(Math.min(1, lin));
  return [0, 1, 2].map((c) => (channels.includes(c) ? v : 0));
}

const HUES = { gray: [0, 1, 2], red: [0], green: [1], blue: [2], yellow: [0, 1], cyan: [1, 2], magenta: [0, 2] };

/** The equal-luminance colour sets of the design (condition 4): `dim` at the luminance of full blue, `bright` at
 *  that of full red (where blue is out of gamut and left out). Each maps a name to [r, g, b]; gray comes first. */
export const COLOUR_SETS = Object.fromEntries(Object.entries({ dim: PHOTOPIC[2], bright: PHOTOPIC[0] }).map(([name, Y]) => [
  name,
  { Y, colours: Object.fromEntries(Object.entries(HUES).map(([h, ch]) => [h, equalLuminance(Y, ch)]).filter(([, rgb]) => rgb)) },
]));
