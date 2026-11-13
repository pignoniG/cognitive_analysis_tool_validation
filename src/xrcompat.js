// How the headset's picture reaches the WebXR session, and whether the session says it is being shown.
//
// three.js draws into a WebXR Layers projection layer when the browser offers `XRWebGLBinding.createProjectionLayer`, and
// into the classic `XRWebGLLayer` otherwise; it has no setting for the choice. With Chrome and a Quest 3 over Link the
// projection layer is never shown: the headset stays dark ("this page is not responding") while the page receives its
// frames and the run completes. The classic layer, which the WebXR samples use, is shown there. So the function is hidden
// while three.js starts the session (the only moment it looks for it), and put back afterwards.

export const PATH_CLASSIC = "XRWebGLLayer", PATH_LAYERS = "projection layer";

/** Start `session` on three.js's `xr` manager, on the classic layer when `compatible`. Returns the path taken. */
export async function setSession(xr, session, compatible = true, scope = globalThis) {
  const proto = compatible && scope.XRWebGLBinding ? scope.XRWebGLBinding.prototype : null;
  const saved = proto ? Object.getOwnPropertyDescriptor(proto, "createProjectionLayer") : null;
  let hidden = false;
  if (saved) { try { hidden = delete proto.createProjectionLayer; } catch { hidden = false; } }
  try { await xr.setSession(session); }
  finally { if (hidden) Object.defineProperty(proto, "createProjectionLayer", saved); }
  return renderPath(xr, scope);
}

/** Which layer three.js made for the session: `XRWebGLLayer`, `projection layer`, or `unknown`. */
export function renderPath(xr, scope = globalThis) {
  const layer = xr.getBaseLayer?.();
  if (!layer) return "unknown";
  return scope.XRWebGLLayer && layer instanceof scope.XRWebGLLayer ? PATH_CLASSIC : PATH_LAYERS;
}

/** Counts, per frame, what the session says about the view: frames in all, frames while the view was not "visible", and
 *  frames for which the session gave no head pose. A headset that shows nothing may still deliver every frame, so these
 *  are signs, not proof; `unseen` is true when either holds for more than half of at least a second of frames. */
export function viewCounter() {
  const c = { frames: 0, not_visible: 0, no_pose: 0 };
  return {
    counts: c,
    frame(session, frame, space) {
      c.frames++;
      if (session?.visibilityState && session.visibilityState !== "visible") c.not_visible++;
      let pose = null;
      try { pose = frame && space ? frame.getViewerPose(space) : null; } catch { pose = null; }
      if (!pose || !pose.views?.length) c.no_pose++;
    },
    get unseen() { return unseen(c); },
  };
}

export function unseen(c) {
  return !!c && c.frames >= 60 && Math.max(c.not_visible, c.no_pose) > c.frames / 2;
}
