// The stimulus window (monitor sessions). It gets the plan from the control page and draws it full screen on the
// participant's display; the session itself (clock, n-back, audio, files) is the Presenter's. This file is the
// window around it: full screen, the display's geometry, the participant's keys and clicks, and the messages to and
// from the control page.

import * as THREE from "../vendor/three-slim.module.js";
import { configureRenderer } from "./stage.js";
import { canvasField } from "./geometry.js";
import { Presenter } from "./presenter.js";
import { RESPONSE_KEYS } from "./task.js";

const canvas = document.getElementById("stage");
const prompt = document.getElementById("prompt");
// the control page: the window that opened this one, or the page this one is framed in (a dry run)
const control = window.opener ?? (window.parent !== window ? window.parent : null);
const ORIGIN = location.origin;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
configureRenderer(THREE, renderer);

const send = (msg) => { try { control?.postMessage(msg, ORIGIN); } catch { /* the control page was closed */ } };
const isFullscreen = () => !!document.fullscreenElement;
let display = null, wake = null;

const presenter = new Presenter({
  THREE, renderer, mode: "screen", display: () => display,
  emit: (msg) => {
    if (msg.type === "started") navigator.wakeLock?.request("screen").then((w) => { wake = w; }).catch(() => {});
    if (msg.type === "done") { wake?.release?.().catch(() => {}); showPrompt(); }
    if (msg.type === "status") msg.fullscreen = isFullscreen();
    send(msg);
  },
});

function measure() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(w, h, false);
  const c = presenter.config;
  const vfov = c ? canvasField({ cssHeight: h, screenCssHeight: screen.height, screenCm: c.screenCm, distanceCm: c.distanceCm }) : 50;
  display = { vfov, aspect: w / h, screen_height_cm: c?.screenCm ?? null, viewing_distance_cm: c?.distanceCm ?? null,
    window_css_px: [w, h], screen_css_px: [screen.width, screen.height], device_pixel_ratio: window.devicePixelRatio,
    fullscreen: isFullscreen() };
  presenter.stage.fitScreen(vfov, w / h);
  send({ type: "display", display });
}

function showPrompt() {
  if (presenter.running) { prompt.hidden = true; return; }
  if (!control) { prompt.hidden = false; prompt.textContent = "Open this window from the control page (index.html)."; return; }
  if (!presenter.config) { prompt.hidden = false; prompt.textContent = "Waiting for the control page…"; return; }
  prompt.hidden = isFullscreen();
  prompt.innerHTML = "Move this window to the participant's display, then click here or press <b>F</b> for full screen." +
    "<small>The session is started from the control page.</small>";
}

async function goFullscreen() {
  try { await document.documentElement.requestFullscreen({ navigationUI: "hide" }); } catch { /* refused: stays windowed */ }
}

window.addEventListener("message", (e) => {
  if (e.origin !== ORIGIN || e.source !== control) return;
  const m = e.data;
  if (m.type === "setup" && !presenter.running) { presenter.setup(m.config, m.plan); measure(); showPrompt(); }
  else if (m.type === "preview" && !presenter.running) { presenter.preview(m.step); prompt.hidden = true; }
  else if (m.type === "start") { prompt.hidden = true; presenter.start(); }
  else if (m.type === "pause") presenter.pause();
  else if (m.type === "resume") presenter.resume();
  else if (m.type === "abort") presenter.abort(m.reason || "control page");
});

window.addEventListener("resize", () => { measure(); showPrompt(); });
document.addEventListener("fullscreenchange", () => {
  if (presenter.running && !isFullscreen()) presenter.note("left full screen");
  measure(); showPrompt();
});
prompt.addEventListener("click", () => { presenter.unlockAudio(); goFullscreen(); });
window.addEventListener("pointerdown", (e) => { presenter.unlockAudio(); presenter.press(e.timeStamp); });
window.addEventListener("keydown", (e) => {
  presenter.unlockAudio();
  if (e.key === "f" || e.key === "F") { e.preventDefault(); goFullscreen(); return; }
  if (RESPONSE_KEYS.has(e.key)) {
    e.preventDefault();                 // no scrolling or page keys while the window has the focus
    if (!e.repeat) presenter.press(e.timeStamp);
  }
});
window.addEventListener("beforeunload", (e) => { if (presenter.running) { e.preventDefault(); e.returnValue = ""; } });
window.addEventListener("pagehide", () => { if (presenter.running) presenter.abort("stimulus window closed"); });

renderer.setAnimationLoop((t) => {
  presenter.frame(t);
  renderer.render(presenter.stage.scene, presenter.stage.camera);
});

measure();
showPrompt();
send({ type: "hello" });
