// The stimulus window (monitor sessions). It gets the plan from the control page, draws it full screen on the
// participant's display, runs the session clock and writes the files; the control page only sends commands and
// shows what this window reports.

import * as THREE from "../vendor/three-slim.module.js";
import { APP_VERSION, VISUAL } from "./config.js";
import { configureRenderer, createStage } from "./stage.js";
import { canvasField, stepLuminance, GAZE_RADIUS } from "./geometry.js";
import { SessionRun } from "./session.js";
import { Sink, serverAvailable } from "./sink.js";
import { eventLogName, sessionFolder } from "./formats.js";
import { AudioCues } from "./audio.js";
import { TaskRun, RESPONSE_KEYS } from "./task.js";

const canvas = document.getElementById("stage");
const prompt = document.getElementById("prompt");
// the control page: the window that opened this one, or the page this one is framed in (a dry run)
const control = window.opener ?? (window.parent !== window ? window.parent : null);
const ORIGIN = location.origin;
const IDLE = { field: [VISUAL.constant.level, VISUAL.constant.level, VISUAL.constant.level], target: null, scene: null };

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
configureRenderer(THREE, renderer);
const stage = createStage(THREE, renderer);
stage.show(IDLE);

let config = null, plan = null, run = null, task = null, sink = null, display = null, wake = null;
const audio = new AudioCues();
let audioLanguage = null, audioError = null;
const notes = [];
const serverP = serverAvailable();

const send = (msg) => { try { control?.postMessage(msg, ORIGIN); } catch { /* the control page was closed */ } };
const isFullscreen = () => !!document.fullscreenElement;
const running = () => run && (run.state === "running" || run.state === "paused");

function measure() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(w, h, false);
  const vfov = config ? canvasField({ cssHeight: h, screenCssHeight: screen.height, screenCm: config.screenCm, distanceCm: config.distanceCm }) : 50;
  display = { vfov, aspect: w / h, css: [w, h], screen: [screen.width, screen.height], dpr: window.devicePixelRatio, fullscreen: isFullscreen() };
  stage.fitScreen(vfov, w / h);
  send({ type: "display", display });
}

async function loadAudio(language) {
  if (audioLanguage === language) return sendAudio();
  audioLanguage = language;
  audioError = null;
  sendAudio();
  try { await audio.load(language); } catch (e) { audioError = `could not load the ${language} audio: ${e.message}`; }
  sendAudio();
}

function sendAudio() {
  send({ type: "audio", audio: { language: audioLanguage, loaded: audio.buffers.size > 0 && audio.manifest?.language === audioLanguage,
    running: audio.running, error: audioError, voice: audio.manifest?.voice ?? null } });
}

/** Any click or key press in this window lets the browser start the audio. */
function unlockAudio() {
  if (!audio.running) audio.unlock().then(sendAudio, () => {});
}

function showPrompt() {
  if (running()) { prompt.hidden = true; return; }
  if (!control) { prompt.hidden = false; prompt.textContent = "Open this window from the control page (index.html)."; return; }
  if (!config) { prompt.hidden = false; prompt.textContent = "Waiting for the control page…"; return; }
  prompt.hidden = isFullscreen();
  prompt.innerHTML = "Move this window to the participant's display, then click here or press <b>F</b> for full screen." +
    "<small>The session is started from the control page.</small>";
}

async function goFullscreen() {
  try { await document.documentElement.requestFullscreen({ navigationUI: "hide" }); } catch { /* refused: stays windowed */ }
}

function sessionInfo(extra = {}) {
  return {
    app: "validation-task", app_version: APP_VERSION, mode: "screen",
    participant: config.participant, seed: config.participant, language: config.language,
    generator_attempt: plan.visual.attempt, balance_max_deviation: plan.visual.balance.cost,
    load_order: plan.phases.filter((p) => p.kind === "block").map((p) => p.level),
    display: { screen_height_cm: config.screenCm, viewing_distance_cm: config.distanceCm, vertical_field_deg: display.vfov,
      aspect: display.aspect, window_css_px: display.css, screen_css_px: display.screen, device_pixel_ratio: display.dpr,
      largest_target_planned_deg: plan.maxDiameter, gaze_circle_radius_deg: GAZE_RADIUS },
    luminance: "nominal sRGB (no display profile)",
    audio: { ...audio.info(), language: config.language, onsets: "expected time the sound leaves the output (Web Audio output timestamp)" },
    nback: task ? { scores: task.scores, stray_presses: task.stray, late_cues: task.late, response_keys: [...RESPONSE_KEYS], mouse_buttons: "any button counts as a response during a session" } : null,
    files,
    saving: sink.mode, server_folder: sink.server ? sink.folder : null,
    browser: navigator.userAgent,
    notes,
    ...extra,
  };
}

let files = null;
async function start() {
  if (run || !plan) return;
  const now = Date.now();
  const folder = sessionFolder(config.participant, "screen", now);
  files = { events: eventLogName(now), visual: "visual_log.csv" };
  sink = new Sink(folder, await serverP);
  task = new TaskRun(plan, { audio, sink, onScore: (score) => send({ type: "score", score }) });
  run = new SessionRun(plan, {
    show: (step) => stage.show(step),
    luminance: (step) => stepLuminance(step, display),
    sink, files,
    hooks: {
      onStart: () => sink.write("session.json", JSON.stringify(sessionInfo({ status: "running" }), null, 1)),
      onPause: (t) => task.pause(t),
      onEnd: (summary) => finish(summary),
    },
  });
  prompt.hidden = true;
  navigator.wakeLock?.request("screen").then((w) => { wake = w; }).catch(() => {});
  run.start();
  send({ type: "started", folder, saving: sink.mode });
}

async function finish(summary) {
  task.end(summary.end_unix_ms - performance.timeOrigin, summary.status === "completed");
  stage.show(IDLE);
  wake?.release?.().catch(() => {});
  sink.write("session.json", JSON.stringify(sessionInfo({ status: summary.status, summary }), null, 1));
  const complete = await sink.flush();
  send({ type: "done", summary, folder: sink.folder, saving: sink.mode, diskComplete: sink.server ? complete : null,
    diskError: sink.broken ? String(sink.broken.message || sink.broken) : null, files: sink.snapshot() });
  showPrompt();
}

window.addEventListener("message", (e) => {
  if (e.origin !== ORIGIN || e.source !== control) return;
  const m = e.data;
  if (m.type === "setup" && !running()) {
    config = m.config; plan = m.plan;
    run = null; task = null;        // a finished session is replaced by the next one
    measure(); showPrompt();
    loadAudio(config.language);
  } else if (m.type === "preview" && !running()) { stage.show(m.step); prompt.hidden = true; }
  else if (m.type === "start") start();
  else if (m.type === "pause") run?.pause();
  else if (m.type === "resume") run?.resume();
  else if (m.type === "abort") run?.abort(m.reason || "control page");
  else if (m.type === "files" && sink) send({ type: "files", files: sink.snapshot(), folder: sink.folder });
});

window.addEventListener("resize", () => { measure(); showPrompt(); });
document.addEventListener("fullscreenchange", () => {
  if (running() && !isFullscreen()) notes.push({ unix_ms: Date.now(), session_s: run.elapsed(performance.now()), note: "left full screen" });
  measure(); showPrompt();
});
prompt.addEventListener("click", () => { unlockAudio(); goFullscreen(); });
window.addEventListener("pointerdown", (e) => {
  unlockAudio();
  if (running() && run.state === "running") task.press(e.timeStamp);
});
window.addEventListener("keydown", (e) => {
  unlockAudio();
  if (e.key === "f" || e.key === "F") { e.preventDefault(); goFullscreen(); return; }
  if (RESPONSE_KEYS.has(e.key)) {
    e.preventDefault();                 // no scrolling or page keys while the window has the focus
    if (!e.repeat && run?.state === "running") task.press(e.timeStamp);
  }
});
window.addEventListener("beforeunload", (e) => { if (running()) { e.preventDefault(); e.returnValue = ""; } });
window.addEventListener("pagehide", () => { if (running()) run.abort("stimulus window closed"); });

let lastStatus = 0;
renderer.setAnimationLoop((t) => {
  run?.frame(t);
  if (task) task.frame(t, run.elapsed(t), run.state);
  renderer.render(stage.scene, stage.camera);
  if (t - lastStatus > 250) {
    lastStatus = t;
    if (running()) send({ type: "status", status: run.status(t), fullscreen: isFullscreen(),
      saving: { mode: sink.mode, sent: sink.sent, error: sink.broken ? String(sink.broken.message || sink.broken) : null },
      audio: { running: audio.running, late: task.late, stray: task.stray } });
  }
});

measure();
showPrompt();
send({ type: "hello" });
