import { test } from "node:test";
import assert from "node:assert/strict";

import { rngFrom, stream } from "../src/rng.js";
import { COLOUR_SETS, nominalY, GRAY_LEVELS } from "../src/colour.js";
import { SESSION, VISUAL, NBACK } from "../src/config.js";
import { loadOrder, loadTimeline, totalDuration, loadState } from "../src/load.js";
import { visualTimeline, split } from "../src/visual.js";
import { nbackBlock, isTarget, isLure, score } from "../src/nback.js";

const SEEDS = Array.from({ length: 40 }, (_, i) => `P${String(i + 1).padStart(2, "0")}`);
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test("seeding matches the calibration presenter", () => {
  // the first values the calibration presenter's rngFrom("P01") gives (checked against its code, October 2026)
  const r = rngFrom("P01");
  assert.deepEqual([r(), r(), r()], [0.47567072231322527, 0.05652470630593598, 0.8403677365276963]);
  assert.notEqual(stream("P01", "load")(), stream("P01", "visual")());
});

test("equal-luminance sets match the design table", () => {
  const dim = COLOUR_SETS.dim.colours, bright = COLOUR_SETS.bright.colours;
  assert.deepEqual(dim, { gray: [76, 76, 76], red: [158, 0, 0], green: [0, 89, 0], blue: [0, 0, 255],
    yellow: [79, 79, 0], cyan: [0, 85, 85], magenta: [138, 0, 138] });
  assert.deepEqual(bright, { gray: [127, 127, 127], red: [255, 0, 0], green: [0, 148, 0],
    yellow: [132, 132, 0], cyan: [0, 142, 142], magenta: [224, 0, 224] });
  // 8-bit rounding keeps every colour within 2 % of the set's luminance
  for (const set of Object.values(COLOUR_SETS))
    for (const rgb of Object.values(set.colours)) assert.ok(Math.abs(nominalY(rgb) / set.Y - 1) < 0.02, String(rgb));
});

test("load timeline: 27.7 min, two rounds of the four levels", () => {
  for (const seed of SEEDS) {
    const rounds = loadOrder(seed);
    assert.equal(rounds.length, 2);
    for (const r of rounds) assert.deepEqual([...r].sort(), SESSION.levels);
    assert.notEqual(rounds[1][0], rounds[0][3], seed);
    const phases = loadTimeline(seed);
    assert.equal(totalDuration(phases), 1660);
    const blocks = phases.filter((p) => p.kind === "block");
    assert.equal(blocks.length, 8);
    assert.deepEqual(blocks.map((b) => b.level), rounds.flat());
    // contiguous, and every block right after its instruction
    phases.forEach((p, i) => { if (i) assert.ok(close(p.start, phases[i - 1].start + phases[i - 1].duration)); });
    phases.forEach((p, i) => { if (p.kind === "block") assert.equal(phases[i - 1].kind, "instruction"); });
    assert.deepEqual(phases.map((p) => p.label).filter((l) => !l.endsWith("-back")).slice(0, 2), ["Baseline", "Instruction"]);
  }
  assert.deepEqual(loadTimeline("P07"), loadTimeline("P07"));
});

test("split fills the total with pieces near the asked length", () => {
  const rng = rngFrom("split");
  for (let k = 0; k < 200; k++) {
    const total = 24 + 12 * rng();
    const parts = split(total, [5, 10], rng);
    assert.ok(close(parts.reduce((s, [, d]) => s + d, 0), total));
    for (const [, d] of parts) assert.ok(d > 3.5 && d < 13.5, `${d}`);
  }
});

test("visual timeline: contiguous, balanced, no type twice in a row", () => {
  for (const seed of SEEDS) {
    const phases = loadTimeline(seed);
    const T = totalDuration(phases);
    const v = visualTimeline(seed, phases);
    const segs = v.segments;
    assert.ok(close(segs[0].start, 0));
    assert.ok(close(segs.at(-1).start + segs.at(-1).duration, T));
    segs.forEach((s, i) => {
      if (i) {
        assert.ok(close(s.start, segs[i - 1].start + segs[i - 1].duration));
        assert.notEqual(s.type, segs[i - 1].type, `${seed} segment ${s.index}`);
      }
      assert.ok(s.duration > 20 && s.duration < 40, `${seed}: ${s.duration}`);
    });
    for (const t of VISUAL.types) assert.ok(segs.filter((s) => s.type === t).length >= 8, `${seed} ${t}`);
    assert.ok(v.balance.cost <= VISUAL.balanceTolerance, `${seed}: balance ${v.balance.cost.toFixed(2)}`);
    assert.deepEqual(new Set(v.balance.states), new Set(phases.map(loadState)));
  }
  assert.deepEqual(visualTimeline("P03", loadTimeline("P03")), visualTimeline("P03", loadTimeline("P03")));
});

test("within a segment only one variable changes per step", () => {
  for (const seed of SEEDS.slice(0, 10)) {
    for (const seg of visualTimeline(seed, loadTimeline(seed)).segments) {
      const st = seg.steps;
      assert.ok(close(st.reduce((s, x) => s + x.duration, 0), seg.duration));
      assert.equal(st[0].change, "onset");
      for (let i = 1; i < st.length; i++) {
        const a = st[i - 1], b = st[i];
        const diff = [];
        if (String(a.field) !== String(b.field)) diff.push("field");
        if (String(a.target?.rgb) !== String(b.target?.rgb)) diff.push("target_rgb");
        if (a.target?.diameter !== b.target?.diameter) diff.push("target_size");
        if (a.scene !== b.scene) diff.push("scene");
        const allowed = {
          field: ["field"], colour: ["field"], scene: ["scene"],
          // the target's first appearance changes its luminance and its size from "none"
          target_level: a.target ? ["target_rgb"] : ["target_rgb", "target_size"],
          target_size: a.target ? ["target_size"] : ["target_rgb", "target_size"],
        }[b.change];
        assert.ok(diff.length >= 1, `${seed} ${seg.type}: step ${b.step} changes nothing`);
        assert.ok(diff.every((d) => allowed.includes(d)), `${seed} ${seg.type}: ${diff} for ${b.change}`);
      }
    }
  }
});

test("condition details follow the design", () => {
  const v = visualTimeline("P11", loadTimeline("P11"), { maxDiameter: 31 });
  for (const s of v.steps) {
    if (s.type === "steps") {
      assert.ok(GRAY_LEVELS.includes(s.field[0]));
    }
    if (s.type === "target_size" && s.target) assert.ok(s.target.diameter <= 31 && VISUAL.target.sizes.includes(s.target.diameter));
    if (s.type === "target_luminance" && s.target) {
      assert.equal(s.target.diameter, VISUAL.target.diameter);
      assert.notEqual(s.target.rgb[0], s.field[0]);
    }
    if (s.type === "colour") assert.deepEqual(s.field, COLOUR_SETS[s.variant].colours[s.colour]);
    if (s.type === "scenes") assert.ok(s.scene && s.field === null);
  }
  // gray steps never go to the level next to the previous one
  for (const seg of v.segments.filter((s) => s.type === "steps"))
    for (let i = 1; i < seg.steps.length; i++)
      assert.ok(Math.abs(GRAY_LEVELS.indexOf(seg.steps[i].field[0]) - GRAY_LEVELS.indexOf(seg.steps[i - 1].field[0])) > 1);
  // both backgrounds and both colour sets are used
  for (const t of ["target_luminance", "target_size", "colour"])
    assert.equal(new Set(v.segments.filter((s) => s.type === t).map((s) => s.variant)).size, 2, t);
  assert.throws(() => visualTimeline("P11", loadTimeline("P11"), { maxDiameter: 2 }));
});

test("n-back blocks have exact targets and lures, by the definition", () => {
  const items = SESSION.block / NBACK.soa;
  for (const seed of SEEDS) {
    for (const n of SESSION.levels) {
      const b = nbackBlock(seed, n + 1, n, items);
      const digits = b.items.map((x) => x.digit);
      assert.equal(digits.length, 60);
      assert.equal(b.items.filter((x) => x.target).length, 20);
      assert.equal(b.items.filter((x) => x.lure).length, n >= 2 ? NBACK.lures : 0);
      b.items.forEach((x, i) => {
        assert.equal(isTarget(digits, i, n, b.targetDigit), x.target, `${seed} ${n}-back item ${i}`);
        assert.equal(isLure(digits, i, n), x.lure, `${seed} ${n}-back lure ${i}`);
        assert.ok(NBACK.digits.includes(x.digit));
      });
      for (let i = 0, run = 0; i < digits.length; i++) {
        run = b.items[i].target ? run + 1 : 0;
        assert.ok(run <= NBACK.maxTargetRun);
      }
      if (n > 0) assert.ok(b.items.slice(0, n).every((x) => !x.target));
    }
  }
});

test("scores: counts, d′ and median RT", () => {
  const items = [
    { target: true, rt: 500 }, { target: true, rt: 700 }, { target: true, rt: null },
    { target: false, rt: null }, { target: false, rt: 400 }, { target: false, rt: null },
  ];
  const s = score(items);
  assert.deepEqual([s.hit, s.miss, s.false_alarm, s.correct_rejection], [2, 1, 1, 2]);
  assert.equal(s.medianRt, 600);
  // hit rate 2.5/4 and false alarms 1.5/4 with the log-linear correction: d′ = 2 · z(0.625)
  assert.ok(close(s.dprime, 2 * 0.31863936396437515, 1e-6));
  assert.ok(Number.isFinite(score([{ target: true, rt: 1 }, { target: false, rt: null }]).dprime));
});
