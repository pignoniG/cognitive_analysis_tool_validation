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

### 4. Regenerating the audio
- **Where:** `tools/make_audio.py`, `assets/audio/`.
- **Problem:** the clips are the stimulus; regenerating them with another version of the model, the phonemiser
  (espeak-ng) or the script would change it between participants. (Piper, tried first, was not even repeatable from
  one run to the next.)
- **Now:** Kokoro gives the same clips run after run on the same set-up. The clips are committed with a manifest
  (voice, model, date, durations, levels) and are what every session uses.
- **Proposed:** regenerate only on purpose, before data collection starts, and record it.
- **Status:** kept.

### 5. VR mode on the Varjo: one run, the responses and the frame rate are open
- **Where:** `src/vr.js`, `src/presenter.js`.
- **Run (10 November 2026, P01, set A, Chrome on the Varjo computer, the page from the lab server):** the session completed
  (25 min 36 s, no pauses), its 20 phases within 15 ms of the plan, 185 visual steps and 360 n-back items logged, saved through
  the server. In cwtool the captured video shows the logged colours (Gray 73 as 72, Red 255 as 231) and the pupil follows the
  calibration.
- **Responses:** in that run 1 hit in 120 targets and no other press was received. Since then the control page shows the
  controllers the browser lists and the presses it receives (and reads the trigger's gamepad button as well): both controllers
  are listed, and only the left trigger registers. What the right trigger sends (another button, the squeeze event, nothing) has
  not been read from the page yet.
- **Frames:** the median frame took 11.2 ms (89 Hz), but 20 % took more than 1.5 times that (longest 68 ms; 73 Hz on average), so a
  change of the picture can be a frame or more late. The session's frame rate was not reported by the browser. The 8192 × 4096
  panoramas may be part of it.
- **Timing against the headset:** the Varjo video shows each change 0.338 s before the logged onset (constant over the run);
  cwtool measures it per recording and moves the log's clock (cwtool open issue 54).
- **Not checked:** the head-locked field, target and fixation point by eye; the panorama turned to the head at each scene;
  pausing when the headset leaves VR.
- **Proposed:** read the control page's *buttons* line with the right trigger pressed; a run with responses; look at the dropped
  frames with smaller panoramas.
- **Status:** open (needs data).

### 6. Luminance of the natural scenes is not computed
- **Where:** `src/geometry.js` (`stepLuminance`), `visual_log.csv`, `assets/scenes/manifest.json`.
- **Problem:** for a field or a target the nominal luminance of the gaze circle and of the whole display is
  computed; for a panorama the columns are empty. The luminance reaching the eye depends on the direction looked
  at (on the monitor, the one fixed view; in VR, the head's) and, in the headset, on how much of the sphere is in the
  120° × 105° field. The manifest has each scene's whole-sphere mean, the mean of the monitor's 90° × 60° crop
  (`view.mean_linear_y`) and of a 120° × 105° headset view at its chosen direction.
- **Now:** `session.json` lists the scenes with exposure, mean and clipped fraction; the analysis can use those as a
  scene-level covariate.
- **Proposed:** compute the gaze-circle and display means per scene from the monitor's stored crop (the view is
  fixed, so this is exact), and for VR from the head yaw logged at each scene onset.
- **Status:** open.

### 7. Only four natural scenes
- **Where:** `src/config.js` (`VISUAL.scenes.ids`), `tools/make_scenes.py`.
- **Problem:** one scene per luminance class (night, indoor, overcast, sunny), so scene content and luminance are
  confounded, and each scene repeats many times per session. The meadow's sky is clipped to white (34 % of its
  pixels), which makes its luminance a floor, not a measurement.
- **Now:** chosen by the experimenter for a clear spread of mean luminance (0.01 to 0.35).
- **Proposed:** add more scenes per class if the pilot shows scene identity matters.
- **Status:** kept.

### 8. The calibration is played with a fixation point
- **Where:** `src/prelude.js`, `src/stage.js`.
- **Problem:** the standalone calibration presenter shows only the full-field colour. Here a small gray point with a
  black outline (0.3°, under 0.1 deg²) is drawn as in every other condition, so the luminance of the field is not
  exactly the nominal one: about 0.0003 of the area.
- **Now:** kept, so that gaze is steady during the calibration as in the validation; the run file says so.
- **Proposed:** a switch to hide it during the calibration if the pupil fit shows a difference.
- **Status:** kept.

### 9. The Docker deployment
- **Where:** `Dockerfile`, `docker-compose.yml`, `docker-compose.proxy.yml`, `deploy/nginx-validation.conf`, `deploy/docker-compose.uc4-nginx.yml`.
- **Now:** the image runs on the lab server at `https://validation.137-204-97-86.sslip.io/`, through a front nginx in `/srv/edge`
  with an automatically renewed certificate (`docs/deploying.md`). The first VR run (10 November 2026) was served from it, in
  WebXR over HTTPS, and saved through it (`saving: server`, with `clock_offset.csv`).
- **Open:** a new version reaches the server only by hand (`git pull`, then `docker compose up -d --build`); the old `/validation/`
  route through the UC4 nginx can be retired.
- **Proposed:** an automatic redeploy from GitHub in the style of the server's other services, skipped while a session is
  being saved.
- **Status:** open (the redeploy).

### 10. The clock offset covers the server and the page, not the other devices
- **Where:** `src/clock.js`, `clock_offset.csv`.
- **Problem:** the offset is between the server's clock and the lab computer's. The eye tracker, the headset and the
  physiology devices each have their own clock and are matched to the computer's by other means (cwtool's sync);
  their offsets are not measured here. The server is also only a reference: a server clock that itself drifts or is
  wrong says nothing about the participant's data.
- **Now:** the offset is recorded, not applied; the convention is `server = logged + offset`.
- **First run (10 November 2026):** the server was 1.8 ms ahead of the page at the start and 15.5 ms at the end
  (0.54 ms per minute, round trips of about 5 ms). `page_vs_wall_ms` rose to 14 ms over the same time, so the drift is the
  browser's own clock against the computer's wall clock, not the server's; the server and the wall clock agree within 3 ms.
  It does not explain the 0.338 s between the log and the Varjo video (issue 5).
- **Proposed:** none needed unless the server's clock becomes the reference for several machines.
- **Status:** kept.

