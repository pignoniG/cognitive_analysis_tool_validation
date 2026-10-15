// The load timeline: baseline, then the n-back blocks (each after a spoken instruction, with rests between),
// then a final rest. The order of the levels is two seeded permutations, the second not starting with the level
// that ended the first.

import { SESSION } from "./config.js";
import { stream, shuffle } from "./rng.js";

export const blockLabel = (n) => `${n}-back`;

/** The block order for `seed`: one array of levels per round. */
export function loadOrder(seed, cfg = SESSION) {
  const rng = stream(seed, "load");
  const rounds = [];
  for (let r = 0; r < cfg.rounds; r++) {
    let order = shuffle(cfg.levels, rng);
    const prev = rounds.at(-1)?.at(-1);
    for (let tries = 0; prev !== undefined && order[0] === prev && tries < 100; tries++) order = shuffle(cfg.levels, rng);
    rounds.push(order);
  }
  return rounds;
}

/**
 * The planned phases for `seed`, contiguous from 0: `{ label, kind, start, duration, level?, block?, round? }`.
 * `kind` is baseline, instruction, block, rest or final; `level` is the n of the block an instruction or block
 * belongs to; `block` numbers the blocks from 1.
 */
export function loadTimeline(seed, cfg = SESSION) {
  const phases = [];
  let t = 0;
  const add = (label, kind, duration, extra = {}) => { phases.push({ label, kind, start: t, duration, ...extra }); t += duration; };
  add("Baseline", "baseline", cfg.baseline);
  let block = 0;
  loadOrder(seed, cfg).forEach((round, r) => round.forEach((level) => {
    if (block > 0) add("Rest", "rest", cfg.rest);
    block++;
    add("Instruction", "instruction", cfg.instruction, { level, block, round: r + 1 });
    add(blockLabel(level), "block", cfg.block, { level, block, round: r + 1 });
  }));
  add("Final rest", "final", cfg.finalRest);
  return phases;
}

export const totalDuration = (phases) => phases.reduce((s, p) => s + p.duration, 0);

/** The load state of a phase, for balancing the visual timeline: "rest" for everything but the blocks, else the
 *  block's label. */
export const loadState = (phase) => (phase.kind === "block" ? phase.label : "rest");
