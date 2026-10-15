# Validation task: design

Draft for review (October 2026). It describes what the presenter shows, in what order, and what it writes, before
any code is written. Decisions still open are listed at the end, each with the default the code would use.

## Purpose

Data for the validation section of the reworked cwtool 2.0 paper: a known, graded cognitive load, delivered while the
light reaching the eye changes in known ways, recorded with the Varjo XR-4 (in VR) and with Pupil Core and Pupil
Neon (glasses, stimuli on a monitor). The analysis should then show that ΔPD follows the load and not the light.
Heart rate (HRV) and possibly skin conductance are recorded in the same sessions and validated against the same load.

What changes from the 2021 validation (Pignoni et al., IEEE Sensors Journal):

| 2021 | Now | Why |
|---|---|---|
| One light pattern, a full-field 0.1 Hz sinusoid | Five kinds of visual change: constant, steps, central targets, equal-luminance colour, natural scenes | each tests a different part of the 2.0 luminance model |
| Light changes on the same timeline as the task | The visual timeline runs independently of the load blocks | load and light are not confounded |
| Counting and Fibonacci, spoken, unscored | Auditory n-back (0 to 3-back), button responses | graded load with accuracy and reaction time; nothing added to the visual field |
| About 30 s to 1.5 min per task | 2.5 min per block, each level twice | long enough for HRV |
| PsychoPy and a projector | One web page, on a monitor or in a headset (three.js, WebXR) | the same stimuli for VR and glasses |

## Session

Glasses and VR are separate campaigns. A participant takes part in one or both, always in separate sessions. The
session lasts at most 30 minutes, excluding setup.

### Setup (not counted)

1. Device setup and eye-tracker calibration.
2. **Display check** (glasses: screen size and viewing distance, so sizes can be set in degrees) and, if a
   photometer is available, the **display characterisation** (see [Photometry](#photometry)).
3. **Participant calibration** (optional): the cwtool calibration sequence (about 5 min), played by the same page
   and saved in the calibration presenter's run format.
4. **n-back practice**: about 20 items of each level, on a constant gray field, with a feedback sound. It is saved
   separately and not counted in the session.

### Load timeline (about 28 min)

| Phase | Length | Load |
|---|---|---|
| Baseline | 2 min | rest, looking at the fixation point |
| Instruction | 10 s | spoken instruction for the next block |
| Block 1 to 4 | 2.5 min each | 0-, 1-, 2- and 3-back, in a seeded order |
| Rest | 20 s | between blocks, before the next instruction |
| Block 5 to 8 | 2.5 min each | the four levels again, in another seeded order |
| Final rest | 2 min | rest |

In total that is 2 + 8 × (10 s + 2.5 min) + 7 × 20 s + 2 = 27.7 min. Each load level gets 5 minutes over its two
blocks: enough for time-domain HRV per level, and ultra-short measures (1–2.5 min) per block.

**Order.** Each round of four blocks is a permutation of the four levels, seeded by the participant ID (the same
xmur3/mulberry32 seeding as the calibration presenter, so it can be regenerated). The second round does not start with
the level that ended the first. Two rounds rather than one random order of eight keep the time-on-task drift equal across
levels.

### Visual timeline

The visual stimuli run continuously from the start of the baseline to the end of the final rest, in **segments**
of 24–36 s (random lengths, so segment changes drift against block changes). Each segment is one condition (below);
within a segment the stimulus changes in **steps** of 5–10 s.

There are six segment types (the targets have two), about 9 segments of each per session, in a seeded order with no
type twice in a row. After drawing the order, the generator checks that every type spends roughly the same share of
its time in each load phase (rest, 0-, 1-, 2-, 3-back; within ±25 % of an even split), and redraws if not (seed plus
an attempt counter, so it stays reproducible). The per-participant order is previewed before the run and saved with
it.

A segment's first step is a full-field change from whatever came before. Within a segment, **only one variable
changes from step to step**.

### Fixation point

The fixation point is always shown, in every condition: a 0.3° disc of gray 128 with a 0.08° black outline, so it
is visible on black, white and scenes. It is the same in every condition and covers less than 0.1 deg², so it hardly
changes the light. In VR it stays straight ahead, locked to the head.

## Visual conditions

Colours are sRGB (0–255). "Nominal Y" is the relative luminance of an sRGB colour (the photopic weights 0.2126,
0.7152, 0.0722 on linearised RGB). With a [display profile](#photometry), the measured luminance replaces it.

### 1. Constant (control)

A full field of gray 128 for the whole segment. This is the reference: any ΔPD change here is load or noise.

### 2. Steps

Full-field gray steps, 5–10 s each, using the calibration levels (0, 36, 73, 109, 146, 182, 219, 255). No two
consecutive steps are neighbours in brightness (as in the calibration sequence). This tests the global luminance path:
the lux sensor or display luminance and the temporal model (latency, constriction and dilation time constants).

### 3. Central targets

A disc centred on the fixation point, on a **fixed background** for the whole segment. The background is one of
two levels, dark (gray 36) or bright (gray 182), chosen per segment. A segment starts with the background alone for one
step, then the target appears. Two segment types, each changing **one** variable:

- **3a. Target luminance.** The diameter is fixed at 16°; the target steps through gray levels that differ from the
  background (e.g. on the dark background: 0, 109, 182, 255), 5–7 s each, in random order.
- **3b. Target size.** The target luminance is fixed (255 on the dark background, 0 on the bright one); the diameter
  steps through 4°, 8°, 16°, 24° and 32°, 5–7 s each, in random order.

These test the gaze circle of the 2.0 model. Its radius is 16.35° (32.7° across), and its weight against the
background is 26 % (Eckert et al. 2022; cwtool open issue 47). Targets smaller and larger than the circle, at
different contrasts with the whole-field mean, show whether the radius and the weight predict the pupil. On the
monitor the largest target must fit the screen height: a 27" monitor at 50 cm gives 37°, at 60 cm 31°. The setup
step checks this and drops any size that does not fit, with a warning. In VR every size fits.

### 4. Equal-luminance colour

A full field that changes colour but not nominal luminance, in 6 s steps: gray first, then four colours in random
order. There are two sets, and one is chosen per segment:

| Set | Y | Gray | Red | Green | Blue | Yellow | Cyan | Magenta |
|---|---|---|---|---|---|---|---|---|
| Dim | 0.0722 | 76 | 158, 0, 0 | 0, 89, 0 | 0, 0, 255 | 79, 79, 0 | 0, 85, 85 | 138, 0, 138 |
| Bright | 0.2126 | 127 | 255, 0, 0 | 0, 148, 0 | not reachable | 132, 132, 0 | 0, 142, 142 | 224, 0, 224 |

Photopic luminance is held constant, but the pupil does not weight colours photopically (blue in particular,
through melanopsin). cwtool fits per-channel weights on the calibration sequence. This condition tests whether those
fitted weights predict the pupil's response to colour changes with no luminance change, which the photopic weights
alone predict as no change. With a display profile, the colours are recomputed so that the *measured* luminances are
equal.

### 5. Natural scenes

360° panoramas from Poly Haven (CC0), about 20, converted once to 8-bit equirectangular images with a fixed exposure
each. They are chosen so their mean luminance spans night, indoor, overcast and bright snow or beach. A segment shows
four scenes of about 7.5 s each.

- **On the monitor:** a perspective view of the panorama in its chosen direction, with the field of view matching
  the monitor's angular size, so both campaigns see the same content.
- **In VR:** the panorama is fixed in the world. At the start of each scene it is turned so that its chosen
  direction is in front of the participant's head, then it stays put. The fixation point stays straight ahead, locked
  to the head. Head movements therefore change the view, and the Varjo capture records what was seen.

This is the realistic case. The scene is non-uniform, but the gaze is held at the centre.

### VR anchoring

Conditions 1–4 move with the head: the field and the target are attached to the camera, so the participant sees
exactly the planned image whatever the head does. Natural scenes (5) are fixed in the world, as above. The renderer
uses no shading or tone mapping, as in the calibration presenter, so each pixel shows the requested sRGB value.

## Cognitive task: auditory n-back

- **Items:** spoken digits 1–9, one every 2.5 s, so 60 items per block.
- **Targets:** 20 per block (one third).
  - **0-back:** the target is a digit named in the instruction, seeded per block.
  - **1- to 3-back:** a target is a digit equal to the one *n* items back.
  - For 2- and 3-back, about 6 lures per block (equal to the digit *n* − 1 or *n* + 1 back, but not *n*), so
    familiarity alone does not work.
  - No targets in the first *n* items, and no more than two targets in a row.
- **Response:** press on targets only. On screen this is Space, Enter, a presentation clicker (Page Up/Down, the
  arrow keys, B and . are accepted) or any mouse button; in VR it is the controller trigger. A press belongs to the
  item being heard: from that item's onset for one item interval (2.5 s). The first press counts, and extra presses
  are logged. A pause inside the window cuts it short; the item is marked *interrupted* and left out of the scores.
- **Scores per block:** hits, misses, false alarms, correct rejections, d′ and median reaction time. They are shown
  on the control window after each block; the participant gets no feedback during the session.
- **Language:** Italian or English, chosen per participant.

### Audio

The audio is generated offline by a script in the repo (`tools/make_audio.py`) with an open text-to-speech engine,
Piper. Two candidate voices per language were generated for you to compare (`--candidates`); the defaults are the
first of each:

| Language | Voice | Training data |
|---|---|---|
| Italian | **paola** (medium) | Voice-Dataset-Italian, CC0 1.0 |
| Italian | serena (high) | serena-synthetic-it-27h, CC BY 4.0 |
| English | **cori** (high, British) | LibriVox recordings, public domain |
| English | alba (medium, Scottish) | Edinburgh DataShare 10283/3270, CC BY 4.0 |

It covers the digits 1–9 and the instruction phrases. Every clip is trimmed so that speech starts at its first
sample, so the onset logged is the onset of speech. All clips are equally loud (−23 dBFS RMS over the speech, peaks
below −1 dBFS), saved as 16-bit WAV, because compressed formats add encoder delay and would shift the onsets. You
judge the quality before the clips are used.

| Phrase | English | Italiano |
|---|---|---|
| Baseline, rests | Rest. Keep your eyes on the dot. | Riposo. Tieni lo sguardo sul punto. |
| 0-back | Zero back. Press when you hear *five*. | Zero indietro. Premi quando senti *cinque*. |
| 1-back | One back. Press when the number is the same as the one before. | Uno indietro. Premi quando il numero è uguale al precedente. |
| 2-back | Two back. Press when the number is the same as two before. | Due indietro. Premi quando il numero è uguale a quello di due prima. |
| 3-back | Three back. Press when the number is the same as three before. | Tre indietro. Premi quando il numero è uguale a quello di tre prima. |
| Start cue | Start. | Via. |
| End | The end. Thank you. | Fine. Grazie. |

The nine 0-back instructions are synthesised whole, one per target digit, so the digit is spoken with the
sentence's own intonation.

**When the cues play** (on the session clock, which stops while paused):

- the rest phrase 0.3 s into the baseline, every rest and the final rest;
- the next block's instruction 0.3 s into its instruction phase;
- the start cue 1.25 s before the block;
- the digits from the block's start, one every 2.5 s;
- the end phrase 2.5 s before the end of the session.

No clip runs into the next one; this is tested with both languages' clips. Audio is played with the Web Audio API,
scheduled one second ahead. `getOutputTimestamp()` relates the audio clock to the frame clock at the output, so each
clip is scheduled to be *heard* at its time, and its logged onset is when the browser expects it to leave the
output, including its own estimate of the output latency. That estimate, and the latencies the browser reports,
are saved in `session.json`; how accurate it is depends on the audio device (open issue 3).

## Displays and windows

### Glasses: monitor

- **Room:** dark, with the monitor as the only light source.
- **Monitor settings:** fixed brightness. Turn off HDR, automatic brightness, night shift and **local dimming**.
  With local dimming on, a target's luminance would depend on its size.
- **Viewing:** the screen's size and the viewing distance are entered at setup and give pixels per degree; a chin
  rest is recommended (open question 2).
- **Two windows:** the experimenter's **control window** opens a **stimulus window**.
  - In Chrome and Edge, the stimulus window is placed full screen on the chosen display (Window Management API).
    In other browsers the experimenter drags it there and presses **F**.
  - The stimulus window owns the timing and the logging. The control window shows the current phase, time left,
    the current visual segment, the n-back scores, dropped frames, and Pause and Abort buttons.

### VR: Varjo XR-4

- **Browser:** the page runs in a WebXR browser on the Varjo computer (Chrome or Edge with the Varjo OpenXR
  runtime), from `localhost` or HTTPS.
- **Control:** the desktop page is the control window, and the headset shows the stimuli.
- **Responses:** the controller trigger; a keyboard works too.

### Photometry

The tool works without a photometer; with one, it can use measured luminance.

- **Display characterisation page:** shows full-field patches (17 gray levels, and red, green and blue at 5 levels
  each), one at a time. The experimenter types the measured cd/m² for each. The page saves a `display_profile.json`
  for that display (one per monitor and one per headset, measured through the lens).
- **With a profile:**
  - every logged step also carries its luminance in cd/m²;
  - the equal-luminance colour sets are recomputed on the measured luminances;
  - the profile's white and black give cwtool's `Lmax` and `Lmin`.
- **Without a profile:** only the nominal Y is logged, with an optional peak white typed in by hand.

## Output

Each session writes one folder, `<participant>_<screen|vr>_<YYYY-MM-DD_HH-MM-SS>/`. Every time is also in Unix
time (ms), which is how the recordings of the eye tracker and the physiology logger are matched.

| File | Content |
|---|---|
| `<date>_event_log.csv` | cwtool's `event_log` format (`Event, Start Time, End Time, Duration (s), Start (unix s), End (unix s)`), one row per **load** phase: `Baseline`, `Instruction`, `0-back` … `3-back`, `Rest`, `Final rest`. Copy it into the recording folder and cwtool shades and averages ΔPD per load level. |
| `visual_log.csv` | One row per visual **step**. The same six columns first (Event = condition), then segment, condition, step, background RGB, target RGB, target diameter (°), scene, nominal Y of the gaze circle and of the whole field, cd/m² (with a profile), and the frame onset. |
| `nback_log.csv` | One row per item heard: block, n, item, digit, target, lure, the 0-back target digit, onset (Unix ms), response (Unix ms), RT (ms), outcome, extra presses, interrupted. |
| `session.json` | Participant, mode, language, seed and generator attempt, app version, screen geometry, display profile, frame statistics (mean frame time, dropped frames), audio output latency, browser. |
| `calibration_run_*.csv` | When the calibration was played: the calibration presenter's run format, unchanged. |
| `practice_nback_log.csv` | The practice, in the n-back format. |

cwtool reads one event track per recording, so the visual segments cannot yet be shaded alongside the load
phases (open question 7).

**Onset times.** A visual onset is the timestamp of the first frame that shows the change (`requestAnimationFrame`,
or the XR frame time in VR), converted with `performance.timeOrigin`, as in the calibration presenter; the display
adds about one frame. Frames longer than 1.5 times the median frame time are counted as dropped and listed.

## Hosting and saving

- **Static:** the page works from GitHub Pages or any static server, with no install. Rows are kept in the
  browser's storage (IndexedDB) as they happen, and at the end the session is downloaded as one zip. After a crash,
  the stored rows can be downloaded from the start page.
- **Local server:** `server.py` (Python standard library only) serves the page and accepts the rows as they happen,
  appending them to the session folder on disk. The page detects the server and says which mode it is in.
- **Code:** plain ES modules, three.js r186 vendored (the calibration presenter's build, extended with the few classes
  needed for discs and textures), no build step. The pure parts (seeding, n-back generation, timeline balancing, file
  formats) are tested with Node's built-in test runner.

## Known limitations

- **Audio and motor confounds.** The rests are silent and need no presses, while every n-back block has 60 digits
  and about 20 presses. Hearing and pressing cause small pupil and heart-rate responses of their own. Across the four
  n-back levels these are matched (the same items and target rate), so load comparisons *between* levels are clean;
  rest against task includes them. See open question 1.
- **Field of view on the monitor.** A monitor covers only part of the visual field (about 60° × 35°), and the
  rest of the dark room adds a little light that the tool does not control.
- **Nominal luminance.** Without a photometer, "equal luminance" and every cd/m² value are nominal sRGB.
- **Ultra-short HRV.** HRV per 2.5 min block is ultra-short; per load level (5 min over two blocks) it is
  standard short-term.
- **Vergence and accommodation** are not varied: the monitor is at one distance, and the Varjo has a fixed focal
  distance and the fixation point at one depth.

## Open questions

Each has the default the code would use if not decided otherwise.

1. **Rests: silent, or passive listening?** Passive listening would play the same digits with no task, which
   separates the effect of hearing from the load, but the rests would no longer be quiet baselines for HRV.
   *Default: silent rests.*
2. **Chin rest for the glasses sessions?** It fixes the viewing distance (sizes in degrees) and keeps the scene
   camera's view of the monitor stable. *Default: recommended, not required; the distance is entered at setup.*
3. **Target backgrounds:** two levels (gray 36 and 182), or more? *Default: two.*
4. **Equal-luminance sets:** both the dim and the bright set, or only one? *Default: both, alternating.*
5. **Segment and step lengths:** segments of 24–36 s and steps of 5–10 s. Longer steps reach steady state (dilation
   time constants up to about 10 s) but give fewer changes per session. *Default: as above.*
6. **Block length:** 2.5 min, with each level twice, fits 28 minutes. Longer blocks would need fewer levels.
   *Default: 2.5 min, four levels.*
7. **A second event track in cwtool**, so `visual_log.csv` can be shaded next to the load phases. That is a cwtool
   change, to be logged in its open issues. *Default: not needed for the presenter; the visual log is already in the
   event_log columns.*
8. **Session folder names, device labels and how a session is tied to a recording** (e.g. the participant ID typed
   in both the presenter and the recorder). *Default: participant ID, mode and start time in the folder name.*

## Build order

After this document is agreed:

1. Repo scaffold: README, MIT licence, mkdocs site in cwtool's style, `docs/OPEN_ISSUES.md`, vendored three.js,
   `server.py`.
2. Seeded generators (load order, visual timeline with balancing, n-back sequences) and the file formats, with tests.
3. Screen mode: control window and stimulus window, all five conditions, timing and logging.
4. n-back with Web Audio, and the audio generation script.
5. VR mode.
6. Saving: IndexedDB and zip download; the local server.
7. Display characterisation and the display profile.
8. Calibration sequence and practice in the setup.
9. Scene selection and conversion script.
10. Docs pages for running a session and for the files.
