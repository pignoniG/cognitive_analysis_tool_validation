// The headset (Varjo XR-4 through WebXR). The control page itself runs the session and draws it in the headset:
// the same Presenter as the monitor's stimulus window, with a WebXR renderer. Responses are the controller's
// trigger. If the headset's session ends during a run (the headset taken off, the runtime restarting), the run is
// paused, so the experimenter can enter VR again and resume.
//
// The headset's display, for the nominal luminance in visual_log.csv, is cwtool's Varjo profile: a 120° × 105°
// field (tan-projected like the Varjo capture video the analysis reads).

import { configureRenderer } from "./stage.js";
import { rad } from "./geometry.js";
import { Presenter } from "./presenter.js";

export const VR_DISPLAY = { vfov: 105, aspect: Math.tan(rad(60)) / Math.tan(rad(52.5)), field_deg: [120, 105],
  source: "cwtool Varjo XR-4 profile" };

let threeLoad = null;
const loadThree = () => (threeLoad ??= import("../vendor/three-slim.module.js").catch((e) => { threeLoad = null; throw e; }));

export async function vrSupported() {
  try { return !!navigator.xr && (await navigator.xr.isSessionSupported("immersive-vr")); } catch { return false; }
}

/** The headset side. `emit` gets the Presenter's messages, plus `{ type: "vr", presenting, ... }`. */
export async function createVR({ emit }) {
  const THREE = await loadThree();
  // The GL context must be XR-compatible from the start: making it so afterwards makes the browser recreate it
  // (context lost and restored), which invalidates the session's layer (a black headset). As in the calibration tool.
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, xrCompatible: true });
  if (!gl) throw new Error("WebGL 2 is not available.");
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false });
  configureRenderer(THREE, renderer);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local");
  renderer.xr.setFoveation(0);

  let session = null, display = { ...VR_DISPLAY, presenting: false };
  const presenter = new Presenter({
    THREE, renderer, mode: "vr", emit, display: () => display,
    headYaw: () => {
      // yaw of the head (rotation about the vertical axis, Y-X-Z order) from the camera's quaternion
      const q = presenter.stage.camera.quaternion;
      return Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
    },
  });
  const camera = presenter.stage.camera;

  // The loop runs on the headset's frames while presenting and on the page's otherwise, so a pause or an abort
  // still takes effect with the headset off. Head-locked parts hang from the camera, so the camera takes this
  // frame's head pose before rendering (three.js would otherwise update it after the scene, a frame late).
  renderer.setAnimationLoop((t) => {
    if (renderer.xr.isPresenting) renderer.xr.updateCamera(camera);
    presenter.frame(t);
    if (renderer.xr.isPresenting) renderer.render(presenter.stage.scene, camera);
  });

  const state = () => ({ type: "vr", presenting: !!session, frameRate: session?.frameRate ?? null,
    blend: session?.environmentBlendMode ?? null });

  return {
    presenter,
    get presenting() { return !!session; },
    /** Call from the click that enters VR: the session request needs its user activation. */
    async enter() {
      if (session) return;
      const request = navigator.xr.requestSession("immersive-vr", { optionalFeatures: ["local"] });
      presenter.unlockAudio();
      const s = await request;
      try {
        if (!gl.getContextAttributes()?.xrCompatible && gl.makeXRCompatible) await gl.makeXRCompatible();
        await renderer.xr.setSession(s);
      } catch (e) {
        s.end().catch(() => {});
        throw new Error(`${e.message} The browser must run on the graphics card the headset is connected to.`);
      }
      session = s;
      display = { ...VR_DISPLAY, presenting: true, frame_rate_hz: s.frameRate ?? null,
        supported_frame_rates: s.supportedFrameRates ? [...s.supportedFrameRates] : null };
      s.addEventListener("selectstart", (e) => presenter.press(e.timeStamp));
      s.addEventListener("end", () => {
        session = null;
        display = { ...display, presenting: false };
        if (presenter.running) { presenter.note("left VR during the session: paused"); presenter.pause(); }
        emit(state());
      });
      emit(state());
    },
    exit() { session?.end().catch(() => {}); },
  };
}
