# Running a session

## On a monitor

For the glasses campaigns (Pupil Core, Pupil Neon). The experimenter uses the control page on their own display;
the stimuli are shown in a second window, full screen on the participant's monitor, which also plays the n-back's
audio and takes the participant's responses.

### Before the participant arrives

1. **Monitor:** set a fixed brightness. Turn off HDR, automatic brightness, night shift and **local dimming** (with
   local dimming on, a target's luminance depends on its size). Darken the room; the monitor should be the only
   light source.
2. **Audio:** wired headphones on the computer's own output (Bluetooth adds a delay the browser cannot measure
   well). Set a comfortable volume once and keep it for every participant.
3. **Start the server** on the computer that drives both displays:

    ```sh
    python server.py
    ```

    Then open <http://localhost:8000> in Chrome or Edge. The **Saving** line should read *to disk through
    server.py*. Without the server the page still works, but the files only exist in the browser until they are
    downloaded at the end.

4. **Set up:** type the participant ID, the monitor's visible **screen height** (cm, the lit area, not the bezel)
   and the **viewing distance** (cm, eye to screen; a chin rest keeps it fixed). *Largest whole target* is the
   monitor's vertical field: target sizes larger than it are left out of the plan, with a note under the inputs.
   Choose the language; the stimulus window loads that language's clips.
5. **Check the plan.** The timeline shows the load blocks and the visual conditions on one time axis. The balance
   table shows how evenly each condition falls on each load level. The n-back table lists every block's digits.
   **Download plan (JSON)** saves all of it.

### Visual set and practice

Choose the participant's **visual set**: **A, solid colours** (constant, gray steps, equal-luminance colours, natural
scenes) or **B, circle size** (constant, circles of varying size, natural scenes). It is yours to choose and is
saved in `session.json` and in the folder name (`_setA`, `_setB`). The timeline and the balance table show the
chosen set.

Do the **n-back practice** before the recording, with the participant at this computer and headphones on (for the
headset campaign, before the headset goes on): the *n-back practice* card, **Start practice**. It runs 1-, 2- and
3-back once each (about 3 minutes) with a high tone for a correct press and a low tone for a press on a non-target;
responses are Space, Enter, a clicker or a click in the gray box. It saves its own folder
(`<participant>_practice_<date>/`) and shows the scores. It needs the participant ID and the language set above, and
it cannot run during a session.

### The stimulus window

6. **Open stimulus window.** In Chrome and Edge the page asks for permission to manage windows; allow it, and the
   window opens on the other display. Otherwise drag it there. Allow pop-ups if the browser blocks it.
7. **Click it, or press F,** to make it full screen. The *Stimulus window* line then shows its field of view in
   degrees, which should match the monitor. A warning appears if it is smaller than the screen height entered.
   The click also lets the window play sound (browsers allow audio only after a click or a key press in the page):
   the *Audio* line should read *ready*.
8. **Check the display (optional).** Click any step in the timeline to show it in the stimulus window, for example
   a target-size step, to measure the disc with a ruler. A 16° target at 100 cm should measure 2 × 100 × tan 8° =
   28.1 cm across.

### The session

9. **Start session.** The recording starts on the next frame. With *Calibration* ticked it begins with the
   5-minute **calibration** (the participant only looks at the fixation point while the field changes colour), then
   the session proper, which starts with its 2-minute baseline. Untick the box to leave the calibration out. Tell the
   participant before starting that the first part is a colour sequence to watch, with nothing to do. Nothing but the
   stimulus is drawn in the stimulus window from then on.
10. **Responses** go to the stimulus window, so it must keep the focus: Space, Enter, a presentation clicker (Page
    Up/Down, the arrow keys, B, .) or any mouse button. On a one-computer set-up, do not click the control page
    during a block: the participant's presses would go there instead.
11. The **Load**, **Visual**, **Audio** and **Frames** lines follow the session: the current phase and the time left,
    the current visual segment, late cues and stray presses, the frame rate and any dropped frames (a frame longer
    than 1.5 times the usual one). After each block its **scores** appear: hits, false alarms, d′, median reaction
    time.
12. **Pause** freezes the session. The stimulus stays as it is, the audio stops and the session clock stops. The
    running phase and step end at the pause, a *Pause* row is logged, and both continue from the resume. The digit
    being heard is marked *interrupted* and left out of the scores; the rest of the block follows after the resume.
    **Abort** ends the session and keeps what was shown and heard.
13. If the stimulus window leaves full screen (Esc), the session goes on: press F in it to go back. The exit is
    noted in `session.json`.

At the end the *Saving* line confirms the folder on disk. The files are also listed for download, prefixed with
the folder name.

## In the headset

For the VR campaign (Varjo XR-4). Here the control page runs the session itself and draws it in the headset; there
is no second window.

1. **On the Varjo computer**, start Varjo Base, then `python server.py`, and open <http://localhost:8000> in Chrome
   or Edge. WebXR needs `localhost` or HTTPS, and the browser must run on the graphics card the headset is connected
   to.
2. **Choose Headset (VR).** The *Stimulus window* line says whether a WebXR headset was found. The screen size and
   distance are not used: every target size fits in the headset.
3. **Set up** as on a monitor (participant, language) and check the plan.
4. **Enter VR.** The headset shows the gray field and the fixation point. The click also lets the page play sound;
   the participant's headphones must be on this computer's audio output.
5. **Start session** once the headset is on the participant and they are looking ahead. Everything except natural
   scenes moves with the head: the field, the target and the fixation point are locked to the headset. A panorama
   stays fixed in the room, turned so that its view direction is ahead of the participant when the scene starts.
6. **Responses:** the controller's trigger. A clicker or key presses on this page work too.
7. If the headset's session ends during the run (the headset taken off, the Varjo runtime restarting), the session
   **pauses**. Enter VR again, then Resume. The exit is noted in `session.json`.

The files are the same as on a monitor, in `sessions/<participant>_vr_<date>_<time>/`. Varjo's own recording (the
gaze CSV and the capture video) is started in Varjo Base as usual. The nominal luminance in `visual_log.csv` is
computed for cwtool's Varjo field of view (120° × 105°).

## Dry run in this page

**Dry run in this page** shows the stimulus in a frame on the control page instead of a second window. Use it to
rehearse or check the controls on one screen. Its sizes are not real (the frame is not the full screen), and its
files are saved like any session's, so delete those folders afterwards.

## Files

Each session writes `sessions/<participant>_screen_<date>_<time>/`:

| File | Content |
|---|---|
| `<date>_event_log.csv` | the load phases in cwtool's event_log format: copy it into the recording folder |
| `calibration_run_*.csv` | the calibration as played, in the calibration presenter's run format (cwtool's *Load sequence…* reads it, and `run_start_unix` finds the recording time from it) |
| `practice_nback_log.csv` | in the practice's own folder, not the recording's: the practice in the n-back format |
| `visual_log.csv` | one row per visual step shown (the calibration steps included, as segment 0), with its colours, target size, scene, and the nominal luminance of the gaze circle and of the whole display |
| `nback_log.csv` | one row per digit heard: block, level, digit, target or lure, onset, response, reaction time, outcome, interrupted |
| `session.json` | participant, seed, display geometry, frame statistics, pauses, the voice and the audio latencies, the n-back scores, notes |

All times are on the computer's clock, as Unix time and as local time with the UTC offset. Keep that clock in sync
(NTP) with the computers recording the eye tracker and the physiology.

The nominal luminance in `visual_log.csv` (`Y_gaze`, `Y_field`) is the relative luminance of the sRGB values,
averaged over area as a camera would: over cwtool's gaze circle (16.35° radius) and over the display. On a monitor
the part of the gaze circle beyond the screen counts as dark. Scenes have none yet (they need their panoramas
measured), and the `L_` columns (cd/m²) need a display profile.
