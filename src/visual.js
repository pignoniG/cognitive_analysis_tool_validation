// The visual timeline: segments of 24–36 s, each one condition, running from the start of the baseline to the end
// of the final rest independently of the load phases. Within a segment the stimulus changes in steps, one variable
// at a time. The order of the segment types is seeded, with no type twice in a row, and balanced so that every type
// spends about the same share of its time in each load state (rest, 0-, 1-, 2-, 3-back).

import { VISUAL } from "./config.js";
import { stream, shuffle, uniform } from "./rng.js";
import { gray, COLOUR_SETS } from "./colour.js";
import { loadState, totalDuration } from "./load.js";

const round1 = (t) => Math.round(t * 10) / 10;

/** Split `total` s into pieces of about `lo`–`hi` s: as many as the mean length fits, drawn uniformly, then scaled
 *  to fill `total` exactly. Returns `[offset, duration]` pairs, offsets rounded to 0.1 s. */
export function split(total, [lo, hi], rng) {
  const k = Math.max(1, Math.round(total / ((lo + hi) / 2)));
  const raw = Array.from({ length: k }, () => uniform(lo, hi, rng));
  const scale = total / raw.reduce((s, v) => s + v, 0);
  const bounds = [0];
  let acc = 0;
  for (const v of raw.slice(0, -1)) { acc += v * scale; bounds.push(round1(acc)); }
  bounds.push(total);
  return raw.map((_, i) => [bounds[i], bounds[i + 1] - bounds[i]]);
}

/** A draw-without-replacement deck that reshuffles when empty and never deals the same item twice in a row. */
function deck(items, rng) {
  let pile = [], last;
  return () => {
    if (!pile.length) {
      pile = shuffle(items, rng);
      if (items.length > 1 && pile[0] === last) pile.push(pile.shift());
    }
    return (last = pile.shift());
  };
}

/** `n` segment types, as evenly as possible, in a random order with no type twice in a row. */
function typeSequence(n, types, rng) {
  const extra = new Set(shuffle(types, rng).slice(0, n % types.length));
  for (;;) {
    const left = Object.fromEntries(types.map((t) => [t, Math.floor(n / types.length) + (extra.has(t) ? 1 : 0)]));
    const seq = [];
    for (let i = 0; i < n; i++) {
      // weighted by what is left, so the most frequent type cannot be stranded at the end
      const options = types.filter((t) => left[t] > 0 && t !== seq.at(-1));
      const total = options.reduce((s, t) => s + left[t], 0);
      if (!total) break;
      let r = rng() * total, t = options[0];
      for (const o of options) { if ((r -= left[o]) < 0) { t = o; break; } }
      seq.push(t);
      left[t]--;
    }
    if (seq.length === n) return seq;
  }
}

/** Seconds each segment spends in each load state: one `{ state: s }` per segment. */
function segmentOverlaps(bounds, phases) {
  return bounds.map(([s0, d]) => {
    const o = {};
    for (const p of phases) {
      const ov = Math.min(s0 + d, p.start + p.duration) - Math.max(s0, p.start);
      if (ov > 0) { const k = loadState(p); o[k] = (o[k] || 0) + ov; }
    }
    return o;
  });
}

/** How far each type's time in each load state is from an even split: `{ cost, overlap, expected, states }`,
 *  with `cost` the largest relative deviation. */
export function balanceOf(types, segTypes, overlaps, phases) {
  const T = totalDuration(phases);
  const states = [...new Set(phases.map(loadState))].sort((a, b) => (a === "rest") - (b === "rest") || a.localeCompare(b));
  const stateTime = Object.fromEntries(states.map((s) => [s, 0]));
  for (const p of phases) stateTime[loadState(p)] += p.duration;
  const overlap = Object.fromEntries(types.map((t) => [t, Object.fromEntries(states.map((s) => [s, 0]))]));
  segTypes.forEach((t, i) => { for (const [s, v] of Object.entries(overlaps[i])) overlap[t][s] += v; });
  const expected = {};
  let cost = 0;
  for (const t of types) {
    const typeTime = states.reduce((a, s) => a + overlap[t][s], 0);
    expected[t] = {};
    for (const s of states) {
      expected[t][s] = (typeTime * stateTime[s]) / T;
      if (expected[t][s] > 0) cost = Math.max(cost, Math.abs(overlap[t][s] - expected[t][s]) / expected[t][s]);
    }
  }
  return { cost, overlap, expected, states };
}

/** Improve the balance by swapping the types of two segments, keeping no type twice in a row. */
function rebalance(segTypes, types, overlaps, phases, tol, rng, iterations = 4000) {
  const seq = segTypes.slice();
  let cost = balanceOf(types, seq, overlaps, phases).cost;
  const ok = (i) => seq[i] !== seq[i - 1] && seq[i] !== seq[i + 1];
  for (let it = 0; it < iterations && cost > tol; it++) {
    const i = Math.floor(rng() * seq.length), j = Math.floor(rng() * seq.length);
    if (seq[i] === seq[j]) continue;
    [seq[i], seq[j]] = [seq[j], seq[i]];
    const c = ok(i) && ok(j) ? balanceOf(types, seq, overlaps, phases).cost : Infinity;
    if (c <= cost) cost = c;
    else [seq[i], seq[j]] = [seq[j], seq[i]];
  }
  return { seq, cost };
}

/** The steps of one segment, at offsets from the segment's start. Each step says which variable it changed. */
function segmentSteps(type, variant, duration, cfg, rng, decks) {
  const step = (o, d, fields, change) => ({ offset: o, duration: d, field: null, target: null, colour: null, scene: null, change, ...fields });
  switch (type) {
    case "constant":
      return [step(0, duration, { field: gray(cfg.constant.level) }, "onset")];
    case "steps": {
      const levels = cfg.steps.levels;
      let prev;
      return split(duration, cfg.steps.duration, rng).map(([o, d], i) => {
        // no level next to (or equal to) the one before it in brightness rank
        const options = levels.map((_, k) => k).filter((k) => prev === undefined || Math.abs(k - prev) > 1);
        prev = options[Math.floor(rng() * options.length)];
        return step(o, d, { field: gray(levels[prev]) }, i ? "field" : "onset");
      });
    }
    case "target_luminance":
    case "target_size": {
      const t = cfg.target, bg = gray(t.backgrounds[variant]);
      const lum = type === "target_luminance";
      const next = lum ? decks.level[variant] : decks.size;
      return split(duration, t.duration, rng).map(([o, d], i) => {
        if (i === 0) return step(o, d, { field: bg }, "onset");
        const target = lum ? { rgb: gray(next()), diameter: t.diameter } : { rgb: gray(t.sizeLevel[variant]), diameter: next() };
        return step(o, d, { field: bg, target }, lum ? "target_level" : "target_size");
      });
    }
    case "colour": {
      const set = COLOUR_SETS[variant].colours;
      return split(duration, [cfg.colour.duration, cfg.colour.duration], rng).map(([o, d], i) => {
        const name = i === 0 ? "gray" : decks.colour[variant]();
        return step(o, d, { field: set[name], colour: name }, i ? "colour" : "onset");
      });
    }
    case "scenes":
      return split(duration, [cfg.scenes.duration, cfg.scenes.duration], rng)
        .map(([o, d], i) => step(o, d, { scene: decks.scene() }, i ? "scene" : "onset"));
    default:
      throw new Error(`Unknown segment type ${type}`);
  }
}

/**
 * The visual timeline for `seed` over the load `phases`.
 * Options: `set` (A or B, the segment types the participant gets), `maxDiameter` (°, the largest target the display shows whole; larger sizes are dropped) and `scenes`
 * (scene ids, by default the configured panoramas). Returns `{ segments, steps, attempt, balance }`; every step carries its absolute `start`.
 */
export function visualTimeline(seed, phases, { maxDiameter = Infinity, scenes, set } = {}, cfg = VISUAL) {
  const T = totalDuration(phases);
  const setName = set ?? cfg.defaultSet;
  if (!cfg.sets[setName]) throw new Error(`Unknown visual set "${setName}"`);
  const types = cfg.sets[setName].types;
  const sizes = cfg.target.sizes.filter((s) => s <= maxDiameter);
  if (!sizes.length) throw new Error(`No target size fits a display ${maxDiameter}° high`);

  let best = null;
  for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
    const rng = stream(seed, "visual", attempt);
    const bounds = split(T, cfg.segment, rng);
    const overlaps = segmentOverlaps(bounds, phases);
    const { seq, cost } = rebalance(typeSequence(bounds.length, types, rng), types, overlaps, phases, cfg.balanceTolerance, rng);
    if (!best || cost < best.cost) best = { attempt, bounds, seq, cost };
    if (cost <= cfg.balanceTolerance) break;
  }

  const rng = stream(seed, "visual", best.attempt, "steps");
  const decks = {
    level: Object.fromEntries(Object.entries(cfg.target.levels).map(([v, l]) => [v, deck(l, rng)])),
    size: deck(sizes, rng),
    colour: Object.fromEntries(cfg.colour.sets.map((v) => [v, deck(Object.keys(COLOUR_SETS[v].colours).filter((c) => c !== "gray"), rng)])),
    scene: deck(scenes ?? cfg.scenes.ids, rng),
  };
  // the two backgrounds (and the two colour sets) alternate within each type, from a seeded start
  const variants = { target_luminance: ["dark", "bright"], target_size: ["dark", "bright"], colour: cfg.colour.sets };
  const seen = Object.fromEntries(types.map((t) => [t, Math.floor(rng() * 2)]));

  const segments = best.bounds.map(([start, duration], index) => {
    const type = best.seq[index];
    const v = variants[type];
    const variant = v ? v[seen[type]++ % v.length] : null;
    const steps = segmentSteps(type, variant, duration, cfg, rng, decks)
      .map(({ offset, ...s }, k) => ({ segment: index + 1, step: k + 1, type, variant, start: round1(start + offset), ...s }));
    return { index: index + 1, type, variant, start, duration, steps };
  });
  const balance = balanceOf(types, best.seq, segmentOverlaps(best.bounds, phases), phases);
  return { segments, steps: segments.flatMap((s) => s.steps), attempt: best.attempt, balance };
}
