// The offset between the server's clock and the computer's. When the page is served by server.py (on this computer or
// on a server) the files are written with the computer's clock (the one the eye tracker and the physiology
// recordings use), while the server has its own. The offset is measured, never applied: it is saved so the files can
// be moved onto the server's clock if needed.
//
// One measurement is a few round trips to `GET api/time` (NTP's method): for each, the offset is the server's time
// minus the middle of the request, and the one with the shortest round trip is kept, because a short trip leaves
// the least room for the two directions to differ (the error is at most half the round trip). The convention:
//
//     server_unix_ms = logged_unix_ms + offset_ms
//
// where "logged" is the clock of this tool's own columns (`performance.timeOrigin + performance.now()`). The page's
// clock can differ from the computer's wall clock if that was stepped (e.g. by an NTP update) after the page opened;
// `page_vs_wall_ms` (wall clock minus the page's) shows it.

import { csvRow } from "./formats.js";

export const CLOCK_LOG_HEADER = ["phase", "session_s", "measured_at_unix_ms", "offset_ms", "rtt_ms", "samples", "spread_ms",
  "server_unix_ms", "page_vs_wall_ms"];

const pageNow = () => performance.timeOrigin + performance.now();

/** `GET api/time` and the server's Unix time (ms); throws if the server does not answer in time. */
export async function fetchServerTime(timeoutMs = 2000) {
  const r = await fetch("api/time", { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`api/time: ${r.status}`);
  return (await r.json()).unix_ms;
}

export class ClockSync {
  /** `fetchTime()` resolves to the server's Unix ms; `now()` is the logged clock; `wall()` the computer's wall clock. */
  constructor({ fetchTime = fetchServerTime, now = pageNow, wall = () => Date.now() } = {}) {
    Object.assign(this, { fetchTime, now, wall });
  }

  /** One measurement from `n` round trips: `{ ok: true, offset_ms, rtt_ms, samples, spread_ms, server_unix_ms,
   *  measured_at_unix_ms, page_vs_wall_ms }`, or `{ ok: false, reason }` when the server cannot be reached. */
  async measure(n = 10) {
    const samples = [];
    try {
      for (let i = 0; i < n; i++) {
        const t0 = this.now();
        const server = await this.fetchTime();
        const t1 = this.now();
        samples.push({ rtt: t1 - t0, offset: server - (t0 + t1) / 2, server, at: (t0 + t1) / 2 });
      }
    } catch (e) {
      if (!samples.length) return { ok: false, reason: String(e.message || e) };
    }
    samples.sort((a, b) => a.rtt - b.rtt);
    const best = samples[0];
    const close = samples.slice(0, Math.min(3, samples.length)).map((s) => s.offset);   // the three shortest trips
    return { ok: true, offset_ms: best.offset, rtt_ms: best.rtt, samples: samples.length,
      spread_ms: Math.max(...close) - Math.min(...close), server_unix_ms: best.server, measured_at_unix_ms: best.at,
      page_vs_wall_ms: this.wall() - this.now() };
  }
}

/** The measurements of one session, written to `clock_offset.csv` as they are made and summarised for session.json. */
export class ClockRecorder {
  constructor(sink, { file = "clock_offset.csv", sync = new ClockSync() } = {}) {
    Object.assign(this, { sink, file, sync });
    this.rows = [];
    this.failure = null;
    this.busy = false;
  }

  /** Measure and record (`phase`: start, during or end; `sessionS`: the session time, or null). Never throws; skips a
   *  measurement while another is running. Resolves to the measurement. */
  async measure(phase, sessionS = null, n = 10) {
    if (this.busy) return null;
    this.busy = true;
    try {
      const m = await this.sync.measure(n);
      if (!m.ok) { this.failure ??= m.reason; return m; }
      if (!this.rows.length) this.sink.append(this.file, csvRow(CLOCK_LOG_HEADER));
      this.rows.push({ phase, session_s: sessionS, ...m });
      const r = (v, d = 3) => (v == null ? null : Number(v.toFixed(d)));
      this.sink.append(this.file, csvRow([phase, r(sessionS), r(m.measured_at_unix_ms), r(m.offset_ms), r(m.rtt_ms), m.samples,
        r(m.spread_ms), r(m.server_unix_ms), r(m.page_vs_wall_ms)]));
      return m;
    } finally {
      this.busy = false;
    }
  }

  /** For session.json: what was measured and how to use it. */
  summary() {
    const convention = "server_unix_ms = logged_unix_ms + offset_ms (logged: this tool's own Unix columns; the server's clock minus the page's)";
    if (!this.rows.length) return { available: false, reason: this.failure ?? "no server (the page was not served by server.py)", convention };
    const first = this.rows[0], last = this.rows.at(-1);
    const minutes = (last.measured_at_unix_ms - first.measured_at_unix_ms) / 60000;
    const pick = ({ phase, session_s, offset_ms, rtt_ms, spread_ms }) => ({ phase, session_s, offset_ms, rtt_ms, spread_ms });
    return {
      available: true, convention, measurements: this.rows.length, file: this.file,
      start: pick(first), end: this.rows.length > 1 ? pick(last) : null,
      uncertainty_ms: Math.max(...this.rows.map((r) => r.rtt_ms)) / 2,
      drift_ms_per_min: this.rows.length > 1 && minutes > 0 ? (last.offset_ms - first.offset_ms) / minutes : null,
      page_vs_wall_ms_max: Math.max(...this.rows.map((r) => Math.abs(r.page_vs_wall_ms))),
    };
  }
}
