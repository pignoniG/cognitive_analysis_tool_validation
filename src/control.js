// The control page: participant and display set-up, the plan preview, and the session, run in the stimulus window
// (stimulus.html) on the participant's display. The stimulus window owns the timing and the files; this page sends
// it the plan and the commands, and shows what it reports.

import { APP_VERSION } from "./config.js";
import { angleOf } from "./geometry.js";
import { serverAvailable } from "./sink.js";
import { makePlan, describePlan, renderPreview, mmss, TYPE_NAMES } from "./preview.js";

const $ = (s) => document.querySelector(s);
const ORIGIN = location.origin;
const store = {
  get(k) { try { return localStorage.getItem(`validation.${k}`); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`validation.${k}`, v); } catch { /* no storage: nothing remembered */ } },
};

let plan = null, stim = null, display = null, state = "idle";   // idle | running | paused | done
const SETUP_INPUTS = ["#participant", "#screen-h", "#distance", "#language"];

function setup() {
  return { participant: $("#participant").value.trim(), screenCm: Number($("#screen-h").value),
    distanceCm: Number($("#distance").value), language: $("#language").value, appVersion: APP_VERSION };
}

function build() {
  const c = setup();
  if (state === "done") state = "idle";   // a changed set-up is the next session
  const maxDiameter = c.screenCm > 0 && c.distanceCm > 0 ? angleOf(c.screenCm, c.distanceCm) : Infinity;
  $("#max-d").value = Number.isFinite(maxDiameter) ? `${maxDiameter.toFixed(1)}°` : "—";
  const status = $("#status");
  status.className = "muted";
  plan = null;
  if (!c.participant) status.textContent = "Enter a participant ID.";
  else {
    try {
      plan = makePlan(c.participant, maxDiameter);
      status.textContent = describePlan(plan);
      renderPreview(plan, { onStep: previewStep });
    } catch (e) {
      status.className = "err";
      status.textContent = e.message;
    }
  }
  sendSetup();
  updateButtons();
}

/* ---------- the stimulus window ---------- */

/** A dry run: the stimulus in a frame on this page, to rehearse or check a session on one screen. */
function openInline() {
  if (state === "running" || state === "paused") return;
  closeStimulus();
  const frame = Object.assign(document.createElement("iframe"), { src: "stimulus.html", title: "Stimulus (dry run)", allow: "fullscreen; screen-wake-lock" });
  $("#inline").replaceChildren(frame);
  stim = frame.contentWindow;
  display = null;
  setLive("#live-window", "dry run in this page: opening…");
}

function closeStimulus() {
  if (!stim) return;
  if ($("#inline iframe")?.contentWindow === stim) $("#inline").replaceChildren();
  else if (!stim.closed) stim.close();
  stim = null;
}

async function openStimulus() {
  if (stim && !stim.closed && !$("#inline iframe")) { stim.focus(); return; }
  closeStimulus();
  let features = "popup,width=960,height=600";
  // with the Window Management API (Chrome, Edge), open it on another display than this one
  if ("getScreenDetails" in window) {
    try {
      const details = await window.getScreenDetails();
      const other = details.screens.find((s) => s !== details.currentScreen);
      if (other) features = `popup,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
    } catch { /* permission refused: open it here and drag it */ }
  }
  stim = window.open("stimulus.html", "validation-stimulus", features);
  if (!stim) { setLive("#live-window", "the browser blocked the window: allow pop-ups for this page", true); return; }
  display = null;
  setLive("#live-window", "opening…");
}

function sendSetup() {
  if (stim && !stim.closed && plan && state !== "running" && state !== "paused") {
    stim.postMessage({ type: "setup", config: setup(), plan }, ORIGIN);
  }
}

const send = (type, extra = {}) => { if (stim && !stim.closed) stim.postMessage({ type, ...extra }, ORIGIN); };

window.addEventListener("message", (e) => {
  if (e.origin !== ORIGIN || !stim || e.source !== stim) return;
  const m = e.data;
  if (m.type === "hello") sendSetup();
  else if (m.type === "display") { display = m.display; showDisplay(); updateButtons(); }
  else if (m.type === "started") {
    state = "running";
    setLive("#live-saving", m.saving === "server" ? `to disk as it runs: sessions/${m.folder}/` : savingMemoryText());
    $("#files").replaceChildren();
    updateButtons();
  } else if (m.type === "status") showStatus(m);
  else if (m.type === "done") finished(m);
});

function showDisplay() {
  if (!display) return;
  const [w, h] = display.css;
  const hfov = 2 * Math.atan(Math.tan((display.vfov * Math.PI) / 360) * display.aspect) * 180 / Math.PI;
  const field = `${hfov.toFixed(1)}° × ${display.vfov.toFixed(1)}° (${w} × ${h} px)`;
  if ($("#inline iframe")) {
    setLive("#live-window", `dry run in this page, ${field}: sizes are only right in full screen on the participant's display`, true);
    return;
  }
  const tooSmall = plan?.maxDiameter && display.fullscreen && display.vfov + 0.5 < plan.maxDiameter;
  if (display.fullscreen) {
    setLive("#live-window", tooSmall
      ? `full screen, ${field}: smaller than the screen height entered; check the screen size`
      : `full screen, ${field}`, tooSmall);
  } else setLive("#live-window", `not full screen yet (${field}): move it to the participant's display and click it or press F`, true);
}

function showStatus({ status: s, fullscreen, saving }) {
  if (display && display.fullscreen !== fullscreen) { display.fullscreen = fullscreen; showDisplay(); }
  $("#progress").style.width = `${(100 * s.elapsed) / s.total}%`;
  const paused = s.state === "paused" ? " · paused" : "";
  setLive("#live-phase", s.phase
    ? `${s.phase} · ${mmss(s.phaseLeft)} left · phase ${s.phaseIndex} of ${s.phases} · ${mmss(s.elapsed)} of ${mmss(s.total)}${paused}`
    : "starting…");
  setLive("#live-visual", s.segment ? `segment ${s.segment}: ${TYPE_NAMES[s.condition]}${s.variant ? ` (${s.variant})` : ""}` : "—");
  setLive("#live-frames", s.frameMs ? `${s.frameMs.toFixed(1)} ms per frame (${(1000 / s.frameMs).toFixed(0)} Hz), ` +
    `${s.dropped} dropped${s.pauses ? `, ${s.pauses} pause${s.pauses > 1 ? "s" : ""}` : ""}` : `${s.frames} frames`, s.dropped > 0);
  if (saving.error) setLive("#live-saving", `disk copy interrupted (${saving.error}); everything is kept in the stimulus window and rewritten at the end`, true);
  if (!fullscreen && s.state !== "done" && !$("#inline iframe")) setLive("#live-window", "left full screen during the session: click it or press F", true);
  const st = s.state === "paused" ? "paused" : s.state === "running" ? "running" : state;
  if (st !== state) { state = st; updateButtons(); }
}

function finished(m) {
  state = "done";
  const sum = m.summary;
  setLive("#live-phase", `${sum.status} after ${mmss(sum.session_s)} of ${mmss(sum.planned_s)}`, sum.status !== "completed");
  setLive("#live-frames", `${sum.frames.count} frames, median ${sum.frames.interval_median_ms?.toFixed(2) ?? "—"} ms, ` +
    `longest ${sum.frames.interval_max_ms?.toFixed(1) ?? "—"} ms, ${sum.frames.dropped} dropped`, sum.frames.dropped > 0);
  if (m.diskComplete === true) setLive("#live-saving", `saved to disk: sessions/${m.folder}/`);
  else if (m.diskComplete === false) setLive("#live-saving", `the disk copy is incomplete (${m.diskError}): download the files below`, true);
  else setLive("#live-saving", "in the browser only: download the files below");
  showFiles(m.folder, m.files);
  updateButtons();
}

function showFiles(folder, files) {
  for (const a of document.querySelectorAll("#files a")) URL.revokeObjectURL(a.href);
  const items = Object.entries(files).map(([name, text]) => {
    const href = URL.createObjectURL(new Blob([text], { type: name.endsWith(".json") ? "application/json" : "text/csv" }));
    return `<li><a href="${href}" download="${folder}__${name}">${name}</a> <span class="muted">(${(text.length / 1024).toFixed(1)} kB)</span></li>`;
  }).join("");
  $("#files").innerHTML = `<p class="muted">Files of <b>${folder}</b> (the downloads are prefixed with the folder name):</p><ul>${items}</ul>`;
}

/** Show one step of the plan in the stimulus window (not during a session), e.g. to check a target's size. */
function previewStep(step) {
  if (!stim || stim.closed || state === "running" || state === "paused") return;
  send("preview", { step });
  const what = step.target ? `target ${step.target.rgb[0]} at ${step.target.diameter}° on ${step.field[0]}`
    : step.scene ? `scene ${step.scene}` : `field ${step.field.join(", ")}${step.colour ? ` (${step.colour})` : ""}`;
  setLive("#live-visual", `showing segment ${step.segment}, step ${step.step}: ${TYPE_NAMES[step.type]}, ${what}`);
}

function savingMemoryText() {
  return "in the browser only (no server.py): keep the stimulus window open and download the files at the end";
}

function setLive(sel, text, warn = false) {
  const el = $(sel);
  el.textContent = text;
  el.classList.toggle("warn", warn);
}

function updateButtons() {
  const open = !!stim && !stim.closed;
  const active = state === "running" || state === "paused";
  $("#btn-start").disabled = !open || !plan || !display || active || state === "done";
  $("#btn-pause").disabled = !active;
  $("#btn-pause").textContent = state === "paused" ? "Resume" : "Pause";
  $("#btn-abort").disabled = !active;
  for (const id of SETUP_INPUTS) $(id).disabled = active;
  if (stim?.closed && !active) setLive("#live-window", "closed");
}

$("#btn-open").addEventListener("click", openStimulus);
$("#btn-inline").addEventListener("click", openInline);
$("#btn-start").addEventListener("click", () => {
  if (!display?.fullscreen && !confirm("The stimulus window is not full screen. Start anyway?")) return;
  send("start");
});
$("#btn-pause").addEventListener("click", () => send(state === "paused" ? "resume" : "pause"));
$("#btn-abort").addEventListener("click", () => { if (confirm("Abort the session? The files keep what was shown so far.")) send("abort", { reason: "aborted by the experimenter" }); });
$("#btn-plan").addEventListener("click", () => {
  if (!plan) return;
  const blob = new Blob([JSON.stringify(plan, null, 1)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `plan_${plan.participant.replace(/[^\w-]+/g, "-")}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
window.addEventListener("beforeunload", (e) => { if (state === "running" || state === "paused") { e.preventDefault(); e.returnValue = ""; } });
setInterval(updateButtons, 1000);   // notices a stimulus window closed by hand

let timer;
for (const id of SETUP_INPUTS) {
  const saved = store.get(id.slice(1));
  if (saved !== null && id !== "#participant") $(id).value = saved;
  $(id).addEventListener("input", () => { store.set(id.slice(1), $(id).value); clearTimeout(timer); timer = setTimeout(build, 200); });
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => plan && renderPreview(plan, { onStep: previewStep }));
serverAvailable().then((ok) => setLive("#live-saving", ok ? "to disk through server.py (sessions/)" : savingMemoryText(), !ok));
build();
