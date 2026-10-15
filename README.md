# Validation Task

A web presenter for validating the [Cognitive Workload Tool](https://github.com/pignoniG/cognitive_analysis_tool)
(cwtool 2.0). It gives a graded cognitive load (an auditory n-back) while the light reaching the eye changes in
known ways, on a monitor for eye-tracking glasses (Pupil Core, Pupil Neon) or inside a VR headset (Varjo XR-4,
through WebXR). The same page, the same stimuli and the same files serve both.

**Status:** sessions run on a monitor: the control page, a full-screen stimulus window, every visual condition
(scenes are placeholders) and the logs. The n-back audio and VR come next. See [docs/design.md](docs/design.md) and
[docs/running.md](docs/running.md).

## Run

```sh
python server.py
```

Then open <http://localhost:8000>. The server only uses the Python standard library; it serves the page and saves
each session into `sessions/` as it runs. The page also works from any static host (GitHub Pages), where sessions are
downloaded at the end instead.

## Tests

```sh
npm test                               # generators and file formats (Node 22 or later, no dependencies)
python -m unittest discover tests      # the local server
```

## Layout

| Path | What |
|---|---|
| `index.html`, `stimulus.html`, `src/` | the control page, the stimulus window and their ES modules: seeding, timelines, n-back, the session engine, the three.js stage, file formats, saving |
| `server.py` | optional local server that saves sessions to disk |
| `vendor/` | three.js r186, reduced to the classes used |
| `docs/` | design, open issues; built with mkdocs like cwtool's docs |
| `tests/` | `*.test.js` (Node's test runner) and `test_server.py` |

## License

MIT, see [LICENSE.md](LICENSE.md). three.js is MIT (`vendor/three.LICENSE`).
