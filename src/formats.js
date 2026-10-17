// The files a session writes. Times come in as Unix milliseconds (the computer's clock, which is how the eye
// tracker and physiology recordings are matched) and are written as ISO 8601 with the UTC offset and as Unix
// seconds, like cwtool's tools/event_logger.py.

/** One CSV line (with "\n"): fields quoted only when they need it; null and undefined are empty. */
export function csvRow(values) {
  return values.map((v) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  }).join(",") + "\n";
}

const pad = (v, n = 2) => String(v).padStart(n, "0");

/** ISO 8601 local time with milliseconds and the UTC offset, e.g. 2026-10-15T12:34:56.789+02:00. */
export function isoLocal(unixMs) {
  const d = new Date(Math.round(unixMs));   // the same millisecond as the Unix column
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `.${pad(d.getMilliseconds(), 3)}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

/** The six columns of cwtool's event_log (tools/event_logger.py, cwtool.logger.session.EventLog). */
export const EVENT_LOG_HEADER = ["Event", "Start Time", "End Time", "Duration (s)", "Start (unix s)", "End (unix s)"];

const eventCells = (label, startMs, endMs) =>
  [label, isoLocal(startMs), isoLocal(endMs), ((endMs - startMs) / 1000).toFixed(3), (startMs / 1000).toFixed(3), (endMs / 1000).toFixed(3)];

/** One event_log row for a load phase. */
export const eventLogRow = (label, startMs, endMs) => csvRow(eventCells(label, startMs, endMs));

const rgbCells = (rgb) => (rgb ? rgb : [null, null, null]);

export const VISUAL_LOG_HEADER = [
  ...EVENT_LOG_HEADER, "segment", "step", "condition", "variant", "change",
  "field_r", "field_g", "field_b", "target_r", "target_g", "target_b", "target_diameter_deg", "colour", "scene",
  "Y_gaze", "Y_field", "L_gaze_cd_m2", "L_field_cd_m2", "planned_start_s", "planned_duration_s",
];

/**
 * One visual_log row for a step shown from `startMs` to `endMs`. `Y_gaze` and `Y_field` are the nominal
 * luminances of the gaze circle and of the whole field, and the `L_` columns the measured ones (with a display
 * profile); the renderer works them out because they depend on the display.
 */
export const visualLogRow = (step, startMs, endMs, { yGaze = null, yField = null, lGaze = null, lField = null } = {}) =>
  csvRow([
    ...eventCells(step.type, startMs, endMs), step.segment, step.step, step.type, step.variant, step.change,
    ...rgbCells(step.field), ...rgbCells(step.target?.rgb), step.target?.diameter ?? null, step.colour, step.scene,
    yGaze, yField, lGaze, lField, step.start, step.duration,
  ]);

export const NBACK_LOG_HEADER = [
  "block", "n", "item", "digit", "target", "lure", "target_digit", "onset_unix_ms", "response_unix_ms", "rt_ms",
  "outcome", "extra_presses", "interrupted",
];

/** One nback_log row. `it` is the generated item plus what happened: `{ onsetMs, responseMs, extra }`. */
export const nbackLogRow = (block, n, item, it, targetDigit, outcome) => {
  const rt = it.responseMs != null ? Math.round(it.responseMs - it.onsetMs) : null;
  return csvRow([block, n, item, it.digit, it.target ? 1 : 0, it.lure ? 1 : 0, targetDigit, Math.round(it.onsetMs),
    it.responseMs != null ? Math.round(it.responseMs) : null, rt, outcome, it.extra || 0, it.interrupted ? 1 : 0]);
};

/** Folder name of a session: `<participant>_<screen|vr>_<YYYY-MM-DD_HH-MM-SS>`, safe for any file system. */
export function sessionFolder(participant, mode, unixMs) {
  const d = new Date(unixMs);
  const safe = String(participant).trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "anonymous";
  return `${safe}_${mode}_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The event_log file name, dated like tools/event_logger.py: `2026-Oct-15_12-00-00_event_log.csv`. */
export function eventLogName(unixMs) {
  const d = new Date(unixMs);
  return `${d.getFullYear()}-${MONTHS[d.getMonth()]}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}_event_log.csv`;
}

/** The columns of the calibration presenter's run file (docs/calibration-tool of cwtool). */
export const CALIBRATION_RUN_COLUMNS = ["time", "duration", "r", "g", "b", "label", "index", "source_index", "planned_start_s",
  "planned_duration_s", "onset_unix_ms", "Y", "completed"];

const round = (v, n = 4) => Math.round(v * 10 ** n) / 10 ** n;

/**
 * The calibration run file, in the calibration presenter's format: `# key: value` lines, then one row per step
 * shown. `rows` are `{ time, duration, rgb, label, index, source_index, planned_start_s, planned_duration_s,
 * onset_unix_ms, Y, completed }`. cwtool's *Load sequence…* reads it as it is.
 */
export function calibrationRunCsv(meta, rows) {
  const lines = Object.entries(meta).map(([k, v]) => `# ${k}: ${String(v ?? "").replace(/\s+/g, " ")}\n`);
  lines.push(csvRow(CALIBRATION_RUN_COLUMNS));
  for (const r of rows) {
    lines.push(csvRow([round(r.time), round(r.duration), r.rgb[0], r.rgb[1], r.rgb[2], r.label, r.index, r.source_index,
      round(r.planned_start_s), round(r.planned_duration_s), r.onset_unix_ms.toFixed(3), r.Y.toFixed(5), r.completed]));
  }
  return lines.join("");
}
