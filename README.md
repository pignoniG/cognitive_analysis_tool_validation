# Validation Task

A web presenter for validating the [Cognitive Workload Tool](https://github.com/pignoniG/cognitive_analysis_tool)
(cwtool 2.0). It gives a graded cognitive load (an auditory n-back) while the light reaching the eye changes in
known ways, on a monitor for eye-tracking glasses (Pupil Core, Pupil Neon) or inside a VR headset (Varjo XR-4,
through WebXR). The same page, the same stimuli and the same files serve both.

**Status:** sessions run on a monitor (the control page and a full-screen stimulus window) or in a headset
(WebXR, not yet tried on the Varjo): every visual condition (scenes are placeholders), the spoken n-back with
responses and scores, and the logs. See [docs/running.md](docs/running.md). See [docs/design.md](docs/design.md) and
[docs/running.md](docs/running.md).

## Run

```sh
python server.py
```

Then open <http://localhost:8000>. The server only uses the Python standard library; it serves the page and saves
each session into `sessions/` as it runs. The page also works from any static host (GitHub Pages), where sessions are
downloaded at the end instead.

## Audio

The spoken digits and instructions are in `assets/audio/`, generated offline: English with Kokoro-82M (Apache 2.0,
voice af_heart); Italian phrases with Kokoro (voice im_nicola) and Italian digits with Chatterbox Multilingual (MIT),
imitating the phrases' voice. See [docs/design.md](docs/design.md#audio).

```sh
pip install kokoro-onnx soundfile numpy
python tools/make_audio.py --candidates    # every candidate voice into audio_candidates/, to listen and compare
python tools/make_audio.py                 # the chosen voices into assets/audio/

# in a separate Python 3.10–3.13 environment
pip install chatterbox-tts "setuptools<81" numpy
python tools/make_digits_chatterbox.py     # the Italian digits (--takes 3=2 to change a take)
```

Both print where to listen to the result (`audio_candidates/current.html`, served by `server.py`).

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
| `assets/audio/`, `tools/make_audio.py` | the n-back's clips (WAV, with a manifest per language) and the script that makes them |
| `vendor/` | three.js r186, reduced to the classes used |
| `docs/` | design, open issues; built with mkdocs like cwtool's docs |
| `tests/` | `*.test.js` (Node's test runner) and `test_server.py` |

## License

MIT, see [LICENSE.md](LICENSE.md). three.js is MIT (`vendor/three.LICENSE`).
