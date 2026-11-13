// What the control page says about the headset's controllers, from the state the headset side reports (vr.js). Kept apart
// from the page so that it can be tested: the line is what tells the experimenter, before the session starts, whether the
// participant's trigger will register.

const counts = (map) => Object.entries(map ?? {}).map(([k, v]) => `${k} ×${v}`).join(", ");

/** `{ text, warn }` for the *Stimulus window* line while the headset is presenting. `vr` is the headset's state
 *  (`frameRate`, `visibility`, `input: { sources, select_events, polled_edges, by_hand, buttons }`); `running` is whether a
 *  session is running, when presses are expected. */
export function describeHeadset(vr, running = false) {
  const input = vr.input ?? {}, sources = input.sources ?? [];
  const select = input.select_events ?? 0, polled = input.polled_edges ?? 0;
  const head = `in the headset${vr.frameRate ? `, ${vr.frameRate} Hz` : ""}${vr.renderPath ? `, ${vr.renderPath}` : ""}`;
  if (vr.view?.unseen) {
    const share = (n) => `${Math.round(100 * n / vr.view.frames)} %`;
    return { text: `${head}; THE HEADSET MAY NOT BE SHOWING THE PICTURE: view not visible in ${share(vr.view.not_visible)} of the frames, ` +
      `no head pose in ${share(vr.view.no_pose)}. Ask the participant what they see before starting`, warn: true };
  }
  if (!sources.length) {
    return { text: `${head}; NO CONTROLLER listed by the headset session (view: ${vr.visibility ?? "unknown"}): the trigger will not register; use the keyboard clicker`, warn: true };
  }
  const parts = [`${sources.length} controller${sources.length === 1 ? "" : "s"} (${sources.map((x) => x.hand || "?").join(", ")}), ` +
    `trigger presses seen: ${select}${polled ? ` (+${polled} read from the gamepad)` : ""}`];
  if (counts(input.by_hand)) parts.push(`by hand: ${counts(input.by_hand)}`);
  if (counts(input.buttons)) parts.push(`buttons: ${counts(input.buttons)}`);
  const blurred = vr.visibility && vr.visibility !== "visible" ? ` [view: ${vr.visibility}: the browser hides the controllers]` : "";
  return { text: `${head}; ${parts.join("; ")}${blurred}`, warn: running && select + polled === 0 };
}
