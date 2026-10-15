# Open issues

Inconsistencies and suspected problems found while building the validation presenter, between it and cwtool, or
between it and the [design](design.md). The design's own open questions (with their defaults) are listed in the
design.

Each issue says where it is, why it matters, what the presenter currently does and what is proposed.
**Status** is one of: *open* (needs a decision), *kept* (current behaviour until decided), *fixed*, *needs data*
(needs a recording to settle).

---

### 1. cwtool reads one event track per recording
- **Where:** cwtool `devices/common.py` `read_event_log` (finds one `*event_log*` file); here `visual_log.csv`.
- **Problem:** the visual timeline overlaps the load phases, so it cannot go into the same event_log, and cwtool
  cannot yet shade or average ΔPD per visual condition.
- **Now:** the load phases go to the event_log. `visual_log.csv` starts with the same six columns, so a copy renamed
  to `*event_log*.csv` in a separate folder can be read on its own.
- **Proposed:** a second event track in cwtool (e.g. `*visual_log*.csv`, drawn as a band under the load events). To
  be logged in cwtool's open issues when the analysis needs it.
- **Status:** open.

### 2. Two sets of photopic weights for the nominal luminance
- **Where:** the calibration presenter's `Y` column (cwtool `docs/calibration-tool/index.html`, `lum`: 0.2125, 0.7154,
  0.072, Eckert et al. 2022 eq. 1) and `src/colour.js` here (BT.709: 0.2126, 0.7152, 0.0722, as in cwtool's
  luminance model).
- **Problem:** a calibration run played by this tool and one played by the calibration presenter would log slightly
  different nominal Y for the same colour (at most 0.3 %, for pure blue).
- **Now:** BT.709, matching cwtool's analysis. The calibration sequence is not ported yet; when it is, its run file
  should use the presenter's weights so the two tools write identical files, unless the presenter changes first.
- **Proposed:** one set in both tools; BT.709 is what cwtool fits against.
- **Status:** kept.

### 3. How accurate the logged audio onsets are
- **Where:** `src/audio.js` (`getOutputTimestamp`), `nback_log.csv` `onset_unix_ms`.
- **Problem:** the logged onset is when the browser expects the sound to leave the output, which includes the
  browser's estimate of the output latency. Wired headphones on the built-in output are usually within a few
  milliseconds; Bluetooth headphones add 100–300 ms that browsers often under-report. The pupil's response is slow
  (hundreds of ms), but reaction times and event-locked averages would carry the error.
- **Now:** wired headphones are assumed; `session.json` keeps the latencies the browser reported.
- **Proposed:** measure once per set-up: record the headphone output and a frame marker together (a microphone
  and a photodiode into one audio interface) and compare them with the logged onsets.
- **Status:** needs data.

### 4. Piper's synthesis is not repeatable
- **Where:** `tools/make_audio.py`.
- **Problem:** Piper adds random noise when it synthesises, so running the script again gives slightly different
  clips (durations differ by tens of milliseconds). The committed clips are what the sessions use; regenerating them
  changes the stimulus.
- **Now:** the clips are generated once and committed with their manifest (voice, model, date, durations, levels).
  Regenerate only on purpose, and record it.
- **Proposed:** keep it so: the clips are data, not build output.
- **Status:** kept.
