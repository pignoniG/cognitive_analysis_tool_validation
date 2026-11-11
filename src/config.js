// The session's parameters, as in docs/design.md. Times are in seconds, sizes in degrees of visual angle.

export const APP_VERSION = "0.1.0";

export const SESSION = {
  baseline: 120,        // rest before the first instruction
  instruction: 10,      // spoken instruction before each block
  block: 150,           // one n-back block
  rest: 20,             // between a block and the next instruction
  finalRest: 60,
  levels: [1, 2, 3],    // n of the n-back (no 0-back: the rests are the low-load reference)
  rounds: 2,            // each round is one permutation of the levels
};

// The calibration is the calibration presenter's default sequence (docs/calibration-tool of cwtool), played at the start
// of the same recording, so one recording holds the calibration and the validation. From November 2026 it is the
// time-course calibration (cwtool.calibration.TIME_COURSE): no black, dimming after moderate and after bright light, colours
// after a gray of the same luminance (cwtool open issue 57). The full calibration (cwtool.calibration.DEFAULT) played before
// it, in the first run, and is kept here to regenerate such a run.
export const CALIBRATION = {
  leadIn: 5,            // s of neutral gray before the first step, as the presenter's default
  leadGray: 128,
  presetSeed: "calibration",   // the seed of the preset order (cwtool.calibration.PRESET_SEED)
  design: "time-course",       // or "full"
  // time-course: [label, [r, g, b], seconds, linked] in the design's order (cwtool.calibration.TIME_COURSE_ITEMS); a linked
  // step moves with the one before it when the order is scrambled, so each probe keeps its context
  items: [
    ["Gray 12", [12, 12, 12], 14, false], ["Gray 24", [24, 24, 24], 12, false], ["Gray 40", [40, 40, 40], 10, false],
    ["Gray 64", [64, 64, 64], 9, false], ["Gray 96", [96, 96, 96], 8, false], ["Gray 140", [140, 140, 140], 7, false],
    ["Gray 196", [196, 196, 196], 6, false], ["Gray 255", [255, 255, 255], 8, false],
    ["Gray 128 (before dim)", [128, 128, 128], 7, false], ["Gray 24 (after moderate)", [24, 24, 24], 15, true],
    ["Gray 96 (before dim)", [96, 96, 96], 6, false], ["Gray 12 (after moderate)", [12, 12, 12], 16, true],
    ["Gray 255 (before dim)", [255, 255, 255], 6, false], ["Gray 24 (after bright)", [24, 24, 24], 18, true],
    ["Blue 255 (before dim)", [0, 0, 255], 7, false], ["Gray 12 (after blue)", [12, 12, 12], 20, true],
    ["Gray 60 (as Red 128)", [60, 60, 60], 8, false], ["Red 128", [128, 0, 0], 8, true],
    ["Gray 110 (as Green 128)", [110, 110, 110], 7, false], ["Green 128", [0, 128, 0], 9, true],
    ["Gray 33 (as Blue 128)", [33, 33, 33], 9, false], ["Blue 128", [0, 0, 128], 8, true],
    ["Gray 127 (as Red 255)", [127, 127, 127], 8, false], ["Red 255", [255, 0, 0], 7, true],
    ["Gray 220 (as Green 255)", [220, 220, 220], 7, false], ["Green 255", [0, 255, 0], 8, true],
    ["Gray 76 (as Blue 255)", [76, 76, 76], 8, false], ["Blue 255", [0, 0, 255], 9, true],
    ["Gray 64 (repeat)", [64, 64, 64], 9, false], ["Gray 196 (repeat)", [196, 196, 196], 7, false],
  ],
  // full calibration (until November 2026)
  grayLengths: { 0: 20, 36: 15, 73: 10, 109: 8, 146: 6, 182: 6, 219: 6, 255: 12 },   // gray level: seconds
  colourLevels: [64, 128, 191, 255],
  colourSeconds: 8,     // each colour, and the black step before it
  repeats: [73, 182],   // grays shown again, 8 s each
};

// The n-back practice, a separate part of the page done before the recording (outside the headset): each level
// once with a feedback sound on every press.
export const PRACTICE = {
  levels: [1, 2, 3],
  items: 20,            // per level (50 s)
  instruction: 10,
  end: 5,               // s after the last block
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
  // every segment type the generator can make, and the two sets a participant is given (chosen on the control page):
  // A, solid colours: the constant field as the reference, gray steps, equal-luminance colours; B, circle size: the
  // constant field and a fixed-luminance circle of varying diameter. Natural scenes are in both.
  types: ["constant", "steps", "target_luminance", "target_size", "colour", "scenes"],
  sets: {
    A: { label: "Solid colours", types: ["constant", "steps", "colour", "scenes"] },
    B: { label: "Circle size", types: ["constant", "target_size", "scenes"] },
  },
  defaultSet: "A",

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
