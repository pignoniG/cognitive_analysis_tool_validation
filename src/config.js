// The session's parameters, as in docs/design.md. Times are in seconds, sizes in degrees of visual angle.

export const APP_VERSION = "0.1.0";

export const SESSION = {
  baseline: 120,        // rest before the first instruction
  instruction: 10,      // spoken instruction before each block
  block: 150,           // one n-back block
  rest: 20,             // between a block and the next instruction
  finalRest: 120,
  levels: [0, 1, 2, 3], // n of the n-back
  rounds: 2,            // each round is one permutation of the levels
};

// The calibration is the calibration presenter's default sequence ("full calibration", docs/calibration-tool of
// cwtool), played at the start of the same recording, so one recording holds the calibration and the validation.
export const CALIBRATION = {
  leadIn: 5,            // s of neutral gray before the first step, as the presenter's default
  leadGray: 128,
  presetSeed: "calibration",   // the seed of the preset order (cwtool.calibration.PRESET_SEED)
  grayLengths: { 0: 20, 36: 15, 73: 10, 109: 8, 146: 6, 182: 6, 219: 6, 255: 12 },   // gray level: seconds
  colourLevels: [64, 128, 191, 255],
  colourSeconds: 8,     // each colour, and the black step before it
  repeats: [73, 182],   // grays shown again, 8 s each
};

// The n-back practice: each level once, on a constant gray field, with a feedback sound on every press.
export const PRACTICE = {
  levels: [0, 1, 2, 3],
  items: 20,            // per level (50 s)
  instruction: 10,
  lures: 2,             // per 2- and 3-back block
};

export const NBACK = {
  soa: 2.5,             // one digit every 2.5 s, so 60 items per block
  digits: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  targetShare: 1 / 3,   // 20 targets in 60 items
  lures: 6,             // per 2- and 3-back block: the digit n-1 or n+1 back, not n
  maxTargetRun: 2,      // no more than two targets in a row
};

export const VISUAL = {
  segment: [24, 36],    // segment lengths, drawn uniformly, then scaled to fill the session exactly
  balanceTolerance: 0.25, // each segment type's time in each load state within ±25 % of an even split
  maxAttempts: 50,
  types: ["constant", "steps", "target_luminance", "target_size", "colour", "scenes"],

  constant: { level: 128 },
  steps: { duration: [5, 10], levels: [0, 36, 73, 109, 146, 182, 219, 255] },
  target: {
    duration: [5, 7],
    backgrounds: { dark: 36, bright: 182 },
    // target luminance segments: the target's gray levels on each background (never the background itself)
    levels: { dark: [0, 109, 182, 255], bright: [0, 36, 109, 255] },
    diameter: 16,
    // target size segments: a fixed target luminance per background, and the diameters
    sizeLevel: { dark: 255, bright: 0 },
    sizes: [4, 8, 16, 24, 32],
  },
  colour: { duration: 6, sets: ["dim", "bright"] },
  // the panoramas (assets/scenes/manifest.json): a night park, a warehouse, an overcast square, a sunny meadow
  scenes: { duration: 7.5, ids: ["night", "indoor", "overcast", "bright"] },
};

export const FIXATION = { diameter: 0.3, outline: 0.08, fill: [128, 128, 128], stroke: [0, 0, 0] };
