# Running a session on a monitor

For the glasses campaigns (Pupil Core, Pupil Neon). The experimenter uses the control page on their own display;
the stimuli are shown in a second window, full screen on the participant's monitor. The n-back audio is not in
yet: a session now runs the load phases (timed, logged, but silent) and the full visual timeline.

## Before the participant arrives

1. **Monitor:** set a fixed brightness. Turn off HDR, automatic brightness, night shift and **local dimming** (with
   local dimming on, a target's luminance depends on its size). Darken the room; the monitor should be the only
   light source.
2. **Start the server** on the computer that drives both displays:

    ```sh
    python server.py
    ```

    Then open <http://localhost:8000> in Chrome or Edge. The **Saving** line should read *to disk through
    server.py*. Without the server the page still works, but the files only exist in the browser until they are
    downloaded at the end.

3. **Set up:** type the participant ID, the monitor's visible **screen height** (cm, the lit area, not the bezel)
   and the **viewing distance** (cm, eye to screen; a chin rest keeps it fixed). *Largest whole target* is the
   monitor's vertical field: target sizes larger than it are left out of the plan, with a note under the inputs.
   Choose the language.
4. **Check the plan.** The timeline shows the load blocks and the visual conditions on one time axis. The balance
   table shows how evenly each condition falls on each load level. The n-back table lists every block's digits.
   **Download plan (JSON)** saves all of it.

## The stimulus window

5. **Open stimulus window.** In Chrome and Edge the page asks for permission to manage windows; allow it, and the
   window opens on the other display. Otherwise drag it there. Allow pop-ups if the browser blocks it.
6. **Click it, or press F,** to make it full screen. The *Stimulus window* line then shows its field of view in
   degrees, which should match the monitor. A warning appears if it is smaller than the screen height entered.
7. **Check the display (optional).** Click any step in the timeline to show it in the stimulus window, for example
   a target-size step, to measure the disc with a ruler. A 16° target at 55 cm should measure 2 × 55 × tan 8° =
   15.5 cm across.

## The session

8. **Start session.** The session starts on the next frame with the baseline. Nothing but the stimulus is drawn in
   the stimulus window from then on.
9. The **Load**, **Visual** and **Frames** lines follow the session: the current phase and the time left, the
   current visual segment, the frame rate and any dropped frames (a frame longer than 1.5 times the usual one).
10. **Pause** freezes the session. The stimulus stays as it is, and the session clock stops. The running phase and
    step end at the pause, a *Pause* row is logged, and both continue from the resume. **Abort** ends the session
    and keeps what was shown.
11. If the stimulus window leaves full screen (Esc), the session goes on: press F in it to go back. The exit is
    noted in `session.json`.

At the end the *Saving* line confirms the folder on disk. The files are also listed for download, prefixed with
the folder name.

## Dry run in this page

**Dry run in this page** shows the stimulus in a frame on the control page instead of a second window. Use it to
rehearse or check the controls on one screen. Its sizes are not real (the frame is not the full screen), and its
files are saved like any session's, so delete those folders afterwards.

## Files

Each session writes `sessions/<participant>_screen_<date>_<time>/`:

| File | Content |
|---|---|
| `<date>_event_log.csv` | the load phases in cwtool's event_log format: copy it into the recording folder |
| `visual_log.csv` | one row per visual step shown, with its colours, target size, scene, and the nominal luminance of the gaze circle and of the whole display |
| `session.json` | participant, seed, display geometry, frame statistics, pauses, notes |

All times are on the computer's clock, as Unix time and as local time with the UTC offset. Keep that clock in sync
(NTP) with the computers recording the eye tracker and the physiology.

The nominal luminance in `visual_log.csv` (`Y_gaze`, `Y_field`) is the relative luminance of the sRGB values,
averaged over area as a camera would: over cwtool's gaze circle (16.35° radius) and over the display. On a monitor
the part of the gaze circle beyond the screen counts as dark. Scenes have none yet (they need their panoramas
measured), and the `L_` columns (cd/m²) need a display profile.
