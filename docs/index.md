# Validation Task

A web presenter for validating the [Cognitive Workload Tool](https://github.com/pignoniG/cognitive_analysis_tool)
(cwtool 2.0) for the reworked 2.0 paper. Participants do an auditory n-back (0- to 3-back) while the light reaching
the eye changes in known ways. The pupil, the heart rate and possibly skin conductance are recorded, and the analysis
should show that ΔPD follows the load and not the light.

- **Glasses** (Pupil Core, Pupil Neon): the stimuli are on a large monitor in a dark room. The experimenter's control
  window opens a full-screen stimulus window on the participant's display.
- **VR** (Varjo XR-4): the same stimuli inside the headset, through WebXR (three.js), started from the desktop
  page.

Each participant ID seeds the session: the order of the load blocks, the visual timeline and the n-back sequences.
The same ID always gives the same session.

## Status

| Part | State |
|---|---|
| [Design](design.md) | agreed; the open questions there have defaults |
| Seeded generators (load order, visual timeline, n-back) and file formats | done, with tests |
| Local server (`server.py`) | done, with tests |
| Session preview (`index.html`) | done |
| Screen presenter: control page, stimulus window, all visual conditions, timing, pause, logging ([running a session](running.md)) | done; scenes are placeholders |
| n-back audio: Piper clips in Italian and English, scheduling on the audio clock, responses, scores | done; voices to be judged |
| VR, zip download and crash recovery, photometry, calibration and practice, scenes | to do, in this order |

## Running the preview

```sh
python server.py
```

Open <http://localhost:8000>, type a participant ID and the monitor's height and viewing distance. The page shows:

- the load phases and the visual timeline on one time axis;
- how evenly each visual condition is spread over the load states;
- the digits of every n-back block, with targets and lures marked.

**Download plan (JSON)** saves all of it.

## Tests

```sh
npm test
python -m unittest discover tests
```

The JavaScript tests check the generators against the design: for 40 participant IDs they check the exact target
and lure counts, one variable changed per step, no condition twice in a row, the balance within ±25 %, and the
event_log columns cwtool reads. A generated event_log has also been read with cwtool's `read_event_log`.
