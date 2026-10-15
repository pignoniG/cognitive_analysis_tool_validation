// Session preview: draws what a participant ID generates (load phases, visual timeline, n-back blocks).

import { SESSION, NBACK, VISUAL } from "./config.js";
import { loadTimeline, totalDuration } from "./load.js";
import { visualTimeline } from "./visual.js";
import { nbackBlock } from "./nback.js";

const $ = (s) => document.querySelector(s);
const SVG = "http://www.w3.org/2000/svg";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const TYPE_NAMES = {
  constant: "Constant", steps: "Gray steps", target_luminance: "Target luminance", target_size: "Target size",
  colour: "Equal-luminance colour", scenes: "Natural scenes",
};
const TYPE_COLOURS = {
  constant: "#9aa1b2", steps: "#E6643B", target_luminance: "#96D35F", target_size: "#3d8b6e", colour: "#7b61c9", scenes: "#2f7fb8",
};
const STATE_VAR = { rest: "--rest", "0-back": "--l0", "1-back": "--l1", "2-back": "--l2", "3-back": "--l3" };
const rgb = (c) => `rgb(${c.join(",")})`;
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;

/** Visual angle (°) of `size` cm at `distance` cm. */
const angle = (size, distance) => (2 * Math.atan(size / 2 / distance) * 180) / Math.PI;

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
}
const tip = (node, text) => { el("title", {}, node).textContent = text; return node; };

let plan = null;

function build() {
  const participant = $("#participant").value.trim();
  const h = Number($("#screen-h").value), d = Number($("#distance").value);
  const maxDiameter = h > 0 && d > 0 ? angle(h, d) : Infinity;
  $("#max-d").value = Number.isFinite(maxDiameter) ? `${maxDiameter.toFixed(1)}°` : "—";
  const status = $("#status");
  status.className = "muted";
  if (!participant) { status.textContent = "Enter a participant ID."; return; }
  try {
    const phases = loadTimeline(participant);
    const visual = visualTimeline(participant, phases, { maxDiameter });
    const items = SESSION.block / NBACK.soa;
    const blocks = phases.filter((p) => p.kind === "block").map((p) => ({ ...p, ...nbackBlock(participant, p.block, p.level, items) }));
    plan = { participant, maxDiameter, phases, visual, blocks };
    const dropped = VISUAL.target.sizes.filter((s) => s > maxDiameter);
    status.textContent = `${mmss(totalDuration(phases))} min, ${visual.segments.length} visual segments, ` +
      `${visual.steps.length} steps (generator attempt ${visual.attempt + 1}, largest deviation ` +
      `${Math.round(visual.balance.cost * 100)} %).` + (dropped.length ? ` Sizes ${dropped.join("°, ")}° do not fit and are left out.` : "");
    drawTimeline(phases, visual);
    drawBalance(visual.balance);
    drawBlocks(blocks);
  } catch (e) {
    status.className = "err";
    status.textContent = e.message;
  }
}

function drawTimeline(phases, visual) {
  const T = totalDuration(phases), L = 92, W = 1100, x = (t) => L + ((W - L - 4) * t) / T;
  const svg = el("svg", { viewBox: `0 0 ${W} 150`, role: "img", "aria-label": "Session timeline" });
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  const text = (s, attrs) => { const t = el("text", { "font-size": 11, fill: v("--muted"), ...attrs }, svg); t.textContent = s; return t; };

  for (let m = 0; m * 60 <= T; m++) {
    el("line", { x1: x(m * 60), x2: x(m * 60), y1: 12, y2: 146, stroke: v("--line"), "stroke-width": m % 5 ? 0.5 : 1 }, svg);
    if (m % 5 === 0) text(`${m} min`, { x: x(m * 60) + 2, y: 10 });
  }
  text("Load", { x: 0, y: 34 });
  text("Condition", { x: 0, y: 64 });
  text("Stimulus", { x: 0, y: 108 });

  for (const p of phases) {
    const state = p.kind === "block" ? p.label : "rest";
    const r = el("rect", { x: x(p.start), y: 18, width: x(p.start + p.duration) - x(p.start), height: 26, fill: `var(${STATE_VAR[state]})` }, svg);
    tip(r, `${p.label}${p.kind === "instruction" ? ` (${p.level}-back next)` : ""}: ${mmss(p.start)}–${mmss(p.start + p.duration)}`);
    if (p.kind === "block") {
      const t = el("text", { x: (x(p.start) + x(p.start + p.duration)) / 2, y: 35, "text-anchor": "middle", "font-size": 12,
        "font-weight": 600, fill: p.level === 0 ? "#1c2030" : "#fff" }, svg);
      t.textContent = p.label;
    }
  }

  const defs = el("defs", {}, svg);
  const pat = el("pattern", { id: "hatch", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
  el("rect", { width: 6, height: 6, fill: "#5b7f9e" }, pat);
  el("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "#c9d8e6", "stroke-width": 3 }, pat);

  for (const s of visual.segments) {
    tip(el("rect", { x: x(s.start), y: 52, width: x(s.start + s.duration) - x(s.start) - 0.5, height: 18, fill: TYPE_COLOURS[s.type] }, svg),
      `${s.index}. ${TYPE_NAMES[s.type]}${s.variant ? ` (${s.variant})` : ""}: ${mmss(s.start)}, ${s.duration.toFixed(1)} s`);
  }
  for (const st of visual.steps) {
    const x0 = x(st.start), w = Math.max(0.5, x(st.start + st.duration) - x0);
    const g = el("g", {}, svg);
    el("rect", { x: x0, y: 78, width: w, height: 60, fill: st.scene ? "url(#hatch)" : rgb(st.field) }, g);
    if (st.target) {
      const th = Math.max(2, (60 * st.target.diameter) / 32);
      el("rect", { x: x0 + w * 0.2, y: 108 - th / 2, width: w * 0.6, height: th, fill: rgb(st.target.rgb) }, g);
    }
    tip(g, [`Segment ${st.segment}, step ${st.step} (${TYPE_NAMES[st.type]}), ${st.duration.toFixed(1)} s, change: ${st.change}`,
      st.field && `field ${st.field.join(", ")}${st.colour ? ` (${st.colour})` : ""}`,
      st.target && `target ${st.target.rgb.join(", ")}, ${st.target.diameter}°`, st.scene && `scene ${st.scene}`].filter(Boolean).join("\n"));
  }
  $("#timeline").replaceChildren(svg);

  $("#legend").innerHTML =
    Object.entries(STATE_VAR).map(([s, c]) => `<span><i style="background:var(${c})"></i>${s === "rest" ? "Rest, instruction" : s}</span>`).join("") +
    Object.entries(TYPE_NAMES).map(([t, n]) => `<span><i style="background:${TYPE_COLOURS[t]}"></i>${n}</span>`).join("") +
    `<span>Stimulus row: the field's colour; a target is the inner bar, its height in proportion to its diameter (32° = full height); scenes are hatched.</span>`;
}

function drawBalance({ overlap, expected, states }) {
  const head = `<tr><th>Condition</th>${states.map((s) => `<th class="num">${esc(s)}</th>`).join("")}</tr>`;
  const rows = Object.keys(overlap).map((t) => `<tr><td>${esc(TYPE_NAMES[t])}</td>${states.map((s) => {
    const o = overlap[t][s], e = expected[t][s], dev = e ? (o - e) / e : 0;
    return `<td class="num${Math.abs(dev) > VISUAL.balanceTolerance ? " warn" : ""}">${Math.round(o)} s (${dev >= 0 ? "+" : ""}${Math.round(dev * 100)} %)</td>`;
  }).join("")}</tr>`).join("");
  $("#balance").innerHTML = `<thead>${head}</thead><tbody>${rows}</tbody>`;
}

function drawBlocks(blocks) {
  const head = "<tr><th>Block</th><th>Level</th><th>Start</th><th>Target</th><th>Digits</th></tr>";
  const rows = blocks.map((b) => {
    const digits = b.items.map((it) => (it.target ? `<b>${it.digit}</b>` : it.lure ? `<u>${it.digit}</u>` : it.digit)).join(" ");
    return `<tr><td>${b.block}</td><td>${esc(b.label)}</td><td>${mmss(b.start)}</td><td>${b.targetDigit ?? `${b.level} back`}</td>` +
      `<td class="digits">${digits}</td></tr>`;
  }).join("");
  $("#nback").innerHTML = `<thead>${head}</thead><tbody>${rows}</tbody>`;
}

function downloadPlan() {
  if (!plan) return;
  const blob = new Blob([JSON.stringify(plan, null, 1)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `plan_${plan.participant.replace(/[^\w-]+/g, "-")}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

let timer;
for (const id of ["#participant", "#screen-h", "#distance"]) $(id).addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(build, 200); });
$("#btn-plan").addEventListener("click", downloadPlan);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", build);
build();
