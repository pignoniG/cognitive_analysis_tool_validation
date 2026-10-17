// The control page: participant and display set-up, the plan preview, and the session. On a monitor the session
// runs in the stimulus window (stimulus.html) on the participant's display, which owns the timing and the files:
// this page sends it the plan and the commands, and shows what it reports. In the headset, this page runs the
// session itself (vr.js) and its reports go through the same handler.

import { APP_VERSION } from "./config.js";
import { angleOf } from "./geometry.js";
import { serverAvailable } from "./sink.js";
import { makePlan, describePlan, renderPreview, mmss, TYPE_NAMES } from "./preview.js";
import { RESPONSE_KEYS } from "./task.js";
import { createVR, vrSupported } from "./vr.js";

const $ = (s) => document.querySelector(s);
const ORIGIN = location.origin;
const store = {
  get(k) { try { return localStorage.getItem(`validation.${k}`); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`validation.${k}`, v); } catch { /* no storage: nothing remembered */ } },
};

let plan = null, stim = null, display = null, state = "idle";   // idle | running | paused | done
let mode = store.get("mode") === "vr" ? "vr" : "screen";         // screen (glasses) | vr (headset)
let vr = null, vrState = null;                                    // the headset side, once created
let audio = null;                                                 // what the stimulus window reports about its audio
const scores = [];
const SETUP_INPUTS = ["#participant", "#screen-h", "#distance", "#language", "#calibration", "#practice"];

function setup() {
  return { participant: $("#participant").value.trim(), screenCm: Number($("#screen-h").value),
    distanceCm: Number($("#distance").value), language: $("#language").value, mode, appVersion: APP_VERSION,
    calibration: $("#calibration").checked, practice: $("#practice").checked };
}

function build() {
  const c = setup();
  if (state === "done") state = "idle";   // a changed set-up is the next session
  const maxDiameter = mode === "screen" && c.screenCm > 0 && c.distanceCm > 0 ? angleOf(c.screenCm, c.distanceCm) : Infinity;
  $("#max-d").value = mode === "vr" ? "all fit (headset)" : Number.isFinite(maxDiameter) ? `${maxDiameter.toFixed(1)}°` : "—";
  const status = $("#status");
  status.className = "muted";
  plan = null;
  if (!c.participant) status.textContent = "Enter a participant ID.";
  else {
    try {
      plan = makePlan(c.participant, maxDiameter, { calibration: c.calibration, practice: c.practice });
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
  display = null; audio = null; showAudio();
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
  display = null; audio = null; showAudio();
  setLive("#live-window", "opening…");
}

/* ---------- the headset ---------- */

async function enterVR() {
  if (!vr) return;
  try {
    await vr.enter();
  } catch (e) {
    setLive("#live-window", `could not enter VR: ${e.message || e}`, true);
  }
}

async function prepareVR() {
  if (vr) return;
  if (!(await vrSupported())) {
    setLive("#live-window", "no headset: this browser has no WebXR immersive-vr session (use Chrome or Edge on the Varjo computer, with Varjo Base running, from localhost)", true);
    return;
  }
  try {
    vr = await createVR({ emit: (m) => queueMicrotask(() => handle(m)) });
    display = { vr: true };
    vrState = { presenting: false };
    showVR();
    sendSetup();
  } catch (e) {
    setLive("#live-window", `the headset could not be set up: ${e.message || e}`, true);
  }
  updateButtons();
}

function showVR() {
  if (mode !== "vr") return;
  if (!vr) return;
  if (vrState?.presenting) setLive("#live-window", `in the headset${vrState.frameRate ? `, ${vrState.frameRate} Hz` : ""}`);
  else setLive("#live-window", state === "paused" ? "left VR: the session is paused; Enter VR, then Resume" : "headset ready: press Enter VR, then put it on the participant", true);
}

/* ---------- commands and reports ---------- */

const connected = () => (mode === "vr" ? !!vr : !!stim && !stim.closed);

function sendSetup() {
  if (connected() && plan && state !== "running" && state !== "paused") send("setup", { config: setup(), plan });
}

/** A command to whatever shows the session. */
function send(type, extra = {}) {
  if (mode === "vr") {
    if (!vr) return;
    const p = vr.presenter;
    if (type === "setup") p.setup(extra.config, extra.plan);
    else if (type === "preview") p.preview(extra.step);
    else if (type === "start") p.start();
    else if (type === "pause") p.pause();
    else if (type === "resume") p.resume();
    else if (type === "abort") p.abort(extra.reason);
  } else if (stim && !stim.closed) stim.postMessage({ type, ...extra }, ORIGIN);
}

window.addEventListener("message", (e) => {
  if (e.origin !== ORIGIN || !stim || e.source !== stim) return;
  handle(e.data);
});

/** A report from the stimulus window or the headset. */
function handle(m) {
  if (m.type === "hello") sendSetup();
  else if (m.type === "vr") { vrState = m; showVR(); updateButtons(); }
  else if (m.type === "display") { display = m.display; showDisplay(); updateButtons(); }
  else if (m.type === "audio") { audio = m.audio; showAudio(); }
  else if (m.type === "scenes") {
    if (m.scenes.error) setLive("#live-scenes", `${m.scenes.error}; placeholders are drawn`, true);
    else setLive("#live-scenes", m.scenes.loaded ? `${m.scenes.count} panoramas loaded` : "loading…");
  }
  else if (m.type === "score") { scores.push(m.score); showScores(); }
  else if (m.type === "started") {
    state = "running";
    setLive("#live-saving", m.saving === "server" ? `to disk as it runs: sessions/${m.folder}/` : savingMemoryText());
    $("#files").replaceChildren();
    scores.length = 0;
    showScores();
    updateButtons();
  } else if (m.type === "status") showStatus(m);
  else if (m.type === "done") finished(m);
}

function showDisplay() {
  if (!display || display.vr) return;
  const [w, h] = display.window_css_px;
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

function showAudio() {
  if (!audio) return setLive("#live-audio", "—");
  const lang = { it: "Italian", en: "English" }[audio.language] ?? audio.language;
  if (audio.error) setLive("#live-audio", audio.error, true);
  else if (!audio.loaded) setLive("#live-audio", `loading the ${lang} clips…`);
  else if (!audio.running) setLive("#live-audio", `${lang} (${audio.voice}) loaded; ${mode === "vr" ? "click this page or Enter VR" : "click the stimulus window or press a key in it"} to let it play sound`, true);
  else setLive("#live-audio", `${lang} (${audio.voice}), ready`);
}

function showScores() {
  if (!scores.length) { $("#scores").replaceChildren(); return; }
  const rows = scores.map((s) => `<tr><td>${s.practice ? "practice " : ""}${s.block}</td><td>${s.n}-back</td><td class="num">${s.hit}/${s.hit + s.miss}</td>` +
    `<td class="num">${s.false_alarm}</td><td class="num">${s.dprime.toFixed(2)}</td><td class="num">${s.medianRt === null ? "—" : Math.round(s.medianRt)}</td>` +
    `<td class="num">${s.interrupted || ""}</td></tr>`).join("");
  $("#scores").innerHTML = "<table><thead><tr><th>Block</th><th>Level</th><th class=\"num\">Hits</th><th class=\"num\">False alarms</th>" +
    "<th class=\"num\">d′</th><th class=\"num\">Median RT (ms)</th><th class=\"num\">Interrupted</th></tr></thead><tbody>" + rows + "</tbody></table>";
}

function showStatus({ status: s, fullscreen, saving, audio: a }) {
  if (a && audio && a.running !== audio.running) { audio.running = a.running; showAudio(); }
  if (a && (a.late || a.stray)) setLive("#live-audio", `${audio?.voice ?? ""} playing; ${a.late} cue${a.late === 1 ? "" : "s"} played late, ${a.stray} press${a.stray === 1 ? "" : "es"} outside any item`, a.late > 0);
  if (mode === "screen" && display && display.fullscreen !== fullscreen) { display.fullscreen = fullscreen; showDisplay(); }
  $("#progress").style.width = `${(100 * s.elapsed) / s.total}%`;
  const paused = s.state === "paused" ? " · paused" : "";
  setLive("#live-phase", s.phase
    ? `${s.phase} · ${mmss(s.phaseLeft)} left · phase ${s.phaseIndex} of ${s.phases} · ${mmss(s.elapsed)} of ${mmss(s.total)}${paused}`
    : "starting…");
  setLive("#live-visual", s.condition
    ? `${s.segment ? `segment ${s.segment}: ` : ""}${TYPE_NAMES[s.condition]}${s.variant ? ` (${s.variant})` : ""}${!s.segment && s.stepLabel ? `: ${s.stepLabel}` : ""}` : "—");
  setLive("#live-frames", s.frameMs ? `${s.frameMs.toFixed(1)} ms per frame (${(1000 / s.frameMs).toFixed(0)} Hz), ` +
    `${s.dropped} dropped${s.pauses ? `, ${s.pauses} pause${s.pauses > 1 ? "s" : ""}` : ""}` : `${s.frames} frames`, s.dropped > 0);
  if (saving.error) setLive("#live-saving", `disk copy interrupted (${saving.error}); everything is kept in the ${mode === "vr" ? "page" : "stimulus window"} and rewritten at the end`, true);
  if (mode === "screen" && !fullscreen && s.state !== "done" && !$("#inline iframe")) setLive("#live-window", "left full screen during the session: click it or press F", true);
  const st = s.state === "paused" ? "paused" : s.state === "running" ? "running" : state;
  if (st !== state) { state = st; updateButtons(); showVR(); }
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
  if (!connected() || state === "running" || state === "paused") return;
  send("preview", { step });
  const what = step.target ? `target ${step.target.rgb[0]} at ${step.target.diameter}° on ${step.field[0]}`
    : step.scene ? `scene ${step.scene}` : `field ${step.field.join(", ")}${step.colour ? ` (${step.colour})` : ""}`;
  setLive("#live-visual", `showing segment ${step.segment}, step ${step.step}: ${TYPE_NAMES[step.type]}, ${what}`);
}

function savingMemoryText() {
  return `in the browser only (no server.py): keep the ${mode === "vr" ? "page" : "stimulus window"} open and download the files at the end`;
}

function setLive(sel, text, warn = false) {
  const el = $(sel);
  el.textContent = text;
  el.classList.toggle("warn", warn);
}

function updateButtons() {
  const open = connected();
  const active = state === "running" || state === "paused";
  for (const el of document.querySelectorAll("[data-mode]")) el.hidden = el.dataset.mode !== mode;
  for (const el of document.querySelectorAll("input[name=mode]")) el.disabled = active;
  $("#btn-vr").disabled = !vr;
  $("#btn-vr").textContent = vrState?.presenting ? "Exit VR" : "Enter VR";
  for (const id of ["#screen-h", "#distance"]) $(id).disabled = active || mode === "vr";
  $("#btn-start").disabled = !open || !plan || !display || active || state === "done";
  $("#btn-pause").disabled = !active;
  $("#btn-pause").textContent = state === "paused" ? "Resume" : "Pause";
  $("#btn-abort").disabled = !active;
  for (const id of ["#participant", "#language"]) $(id).disabled = active;
  if (mode === "screen" && stim?.closed && !active) setLive("#live-window", "closed");
}

/** Switch between the monitor and the headset (not during a session). */
function setMode(m) {
  if (m === mode || state === "running" || state === "paused") return;
  mode = m;
  store.set("mode", m);
  closeStimulus();
  vr?.exit();
  display = mode === "vr" && vr ? { vr: true } : null;
  audio = null;
  showAudio();
  setLive("#live-window", "not open");
  if (mode === "vr") prepareVR();
  build();
}

$("#btn-open").addEventListener("click", openStimulus);
$("#btn-inline").addEventListener("click", openInline);
$("#btn-vr").addEventListener("click", () => (vrState?.presenting ? vr.exit() : enterVR()));
for (const el of document.querySelectorAll("input[name=mode]")) {
  el.checked = el.value === mode;
  el.addEventListener("change", () => el.checked && setMode(el.value));
}
// in the headset, this page takes the participant's keys (a clicker), as the stimulus window does on a monitor
window.addEventListener("keydown", (e) => {
  if (mode !== "vr" || !vr || state !== "running" || !RESPONSE_KEYS.has(e.key) || e.target.closest?.("input, select, textarea")) return;
  e.preventDefault();
  if (!e.repeat) vr.presenter.press(e.timeStamp);
});
document.addEventListener("pointerdown", () => vr?.presenter.unlockAudio());
$("#btn-start").addEventListener("click", () => {
  if (mode === "screen" && !display?.fullscreen && !confirm("The stimulus window is not full screen. Start anyway?")) return;
  if (mode === "vr" && !vrState?.presenting && !confirm("The headset is not showing the session yet (Enter VR first). Start anyway?")) return;
  if (!(audio?.loaded && audio?.running) && !confirm("The audio is not ready (see the Audio line): the n-back would be silent. Start anyway?")) return;
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
  const box = $(id).type === "checkbox";
  if (saved !== null && id !== "#participant") { if (box) $(id).checked = saved === "1"; else $(id).value = saved; }
  $(id).addEventListener("input", () => { store.set(id.slice(1), box ? ($(id).checked ? "1" : "0") : $(id).value); clearTimeout(timer); timer = setTimeout(build, 200); });
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => plan && renderPreview(plan, { onStep: previewStep }));
serverAvailable().then((ok) => setLive("#live-saving", ok ? "to disk through server.py (sessions/)" : savingMemoryText(), !ok));
if (mode === "vr") prepareVR();
build();
