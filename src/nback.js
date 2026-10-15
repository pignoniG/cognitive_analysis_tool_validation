// Auditory n-back: the digit sequences of a block, and its scores.
//
// 0-back: a target is the block's target digit (named in the instruction). n ≥ 1: a target is a digit equal to the
// one n items back. For n ≥ 2 a fixed number of lures (equal to the digit n-1 or n+1 back, but not n back) stop
// familiarity alone from working. Every other item matches none of these, so the counts are exact.

import { NBACK } from "./config.js";
import { stream, shuffle, pick } from "./rng.js";

/** The items of one block: `{ n, targetDigit, items: [{ digit, target, lure }] }`. */
export function nbackBlock(seed, block, n, items, cfg = NBACK) {
  const rng = stream(seed, "nback", block);
  const nTargets = Math.round(items * cfg.targetShare);
  const nLures = n >= 2 ? cfg.lures : 0;
  const targetDigit = n === 0 ? pick(cfg.digits, rng) : null;
  for (let tries = 0; tries < 1000; tries++) {
    const r = attempt(n, items, nTargets, nLures, targetDigit, cfg, rng);
    if (r) return { n, targetDigit, items: r };
  }
  throw new Error(`Could not build a ${n}-back block of ${items} items`);
}

function attempt(n, items, nTargets, nLures, targetDigit, cfg, rng) {
  const first = n === 0 ? 0 : n;
  const eligible = Array.from({ length: items - first }, (_, i) => i + first);
  const order = shuffle(eligible, rng);
  const targets = new Set(order.slice(0, nTargets));
  for (let i = 0, run = 0; i < items; i++) { run = targets.has(i) ? run + 1 : 0; if (run > cfg.maxTargetRun) return null; }
  // lures need both comparison items (n-1 and n+1 back) to exist, so the n+1 back one decides
  const lures = new Set(order.slice(nTargets).filter((i) => i >= n + 1).slice(0, nLures));
  if (lures.size < nLures) return null;

  const d = [];
  const back = (i, k) => (k >= 1 && i - k >= 0 ? d[i - k] : undefined);
  for (let i = 0; i < items; i++) {
    if (n === 0) {
      d.push(targets.has(i) ? targetDigit : pick(cfg.digits.filter((x) => x !== targetDigit && x !== d[i - 1]), rng));
      continue;
    }
    const nBack = back(i, n), near = [back(i, n - 1), back(i, n + 1)];
    if (targets.has(i)) { d.push(nBack); continue; }
    if (lures.has(i)) {
      const options = near.filter((x) => x !== undefined && x !== nBack);
      if (!options.length) return null;
      d.push(pick(options, rng));
      continue;
    }
    const avoid = new Set([nBack, ...(n >= 2 ? near : [])]);
    const options = cfg.digits.filter((x) => !avoid.has(x));
    d.push(pick(options, rng));
  }
  return d.map((digit, i) => ({ digit, target: targets.has(i), lure: lures.has(i) }));
}

/** Whether item `i` of `digits` is a target, from the digits alone (the definition the generator must follow). */
export function isTarget(digits, i, n, targetDigit = null) {
  return n === 0 ? digits[i] === targetDigit : i >= n && digits[i] === digits[i - n];
}

/** Whether item `i` is a lure: n ≥ 2, not a target, and equal to the digit n-1 or n+1 back. */
export function isLure(digits, i, n) {
  if (n < 2 || isTarget(digits, i, n)) return false;
  return (i - (n - 1) >= 0 && digits[i] === digits[i - (n - 1)]) || (i - (n + 1) >= 0 && digits[i] === digits[i - (n + 1)]);
}

/** The outcome of an item: hit, miss, false alarm or correct rejection. */
export const outcome = (target, responded) => (target ? (responded ? "hit" : "miss") : responded ? "false_alarm" : "correct_rejection");

// inverse of the standard normal CDF (Acklam's rational approximation, relative error below 1.2e-9)
function probit(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const e = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((e[0] * q + e[1]) * q + e[2]) * q + e[3]) * q + 1); }
  if (p > 1 - lo) return -probit(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Scores of a block from `[{ target, rt }]` (rt in ms, null when there was no press): counts, d′ with the
 * log-linear correction (Hautus 1995: add 0.5 to every count, so perfect blocks stay finite) and the median
 * reaction time of the hits.
 */
export function score(items) {
  const c = { hit: 0, miss: 0, false_alarm: 0, correct_rejection: 0 };
  const rts = [];
  for (const it of items) {
    const o = outcome(it.target, it.rt != null);
    c[o]++;
    if (o === "hit") rts.push(it.rt);
  }
  const hr = (c.hit + 0.5) / (c.hit + c.miss + 1), far = (c.false_alarm + 0.5) / (c.false_alarm + c.correct_rejection + 1);
  rts.sort((x, y) => x - y);
  const m = rts.length >> 1;
  const medianRt = !rts.length ? null : rts.length % 2 ? rts[m] : (rts[m - 1] + rts[m]) / 2;
  return { ...c, dprime: probit(hr) - probit(far), medianRt };
}
