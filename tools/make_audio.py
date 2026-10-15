#!/usr/bin/env python3
"""Generate the spoken digits and instructions of the n-back with Kokoro (offline text-to-speech, Apache 2.0).

    pip install kokoro-onnx soundfile numpy
    python tools/make_audio.py                         # the chosen voices into assets/audio/<lang>/
    python tools/make_audio.py --candidates            # every candidate voice into audio_candidates/, to compare
    python tools/make_audio.py --voice it=im_nicola    # choose another voice

Each clip is trimmed so that speech starts at its first sample (the onset the presenter logs is the onset of
speech), given a 3 ms fade-in and a 20 ms fade-out, and scaled to the same loudness (RMS over the speech).
Clips are 16-bit mono WAV: compressed formats add encoder delay, which would shift the onsets. A manifest.json
per language lists every clip with its text, duration and level, and the voice.

The model (Kokoro-82M v1.0, ONNX export of kokoro-onnx, about 350 MB) is downloaded once into --models.

Piper was tried first (October 2026) and dropped: it clips the start and end of single words ("due", "tre", "sei",
"five"), mispronounced "sette", "otto" and "nine", and garbled "The end. Thank you."
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
import wave
from datetime import date
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
MODEL_FILES = ("kokoro-v1.0.onnx", "voices-v1.0.bin")

# Candidate voices of Kokoro-82M (hexgrad/Kokoro-82M, Apache 2.0). The first of each language is used unless
# --voice says otherwise. `lang` is the espeak-ng language used to phonemise the text.
VOICES = {
    "it": {
        "if_sara": {"lang": "it", "description": "Italian, female"},
        "im_nicola": {"lang": "it", "description": "Italian, male"},
    },
    "en": {
        "af_heart": {"lang": "en-us", "description": "American English, female"},   # chosen, October 2026
        "bf_emma": {"lang": "en-gb", "description": "British English, female"},
        "bm_george": {"lang": "en-gb", "description": "British English, male"},
    },
}

DIGITS = {
    "it": ["uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove"],
    "en": ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"],
}


def phrases(lang: str) -> dict[str, str]:
    """Every clip of a language: id -> text."""
    d = DIGITS[lang]
    out = {f"digit_{i + 1}": f"{w.capitalize()}." for i, w in enumerate(d)}
    if lang == "it":
        out |= {
            "rest": "Riposo. Tieni lo sguardo sul punto.",
            **{f"back_0_{i + 1}": f"Zero indietro. Premi quando senti il numero {w}." for i, w in enumerate(d)},
            "back_1": "Uno indietro. Premi quando un numero è uguale a quello appena prima.",
            "back_2": "Due indietro. Premi quando un numero è uguale a quello di due numeri fa.",
            "back_3": "Tre indietro. Premi quando un numero è uguale a quello di tre numeri fa.",
            "start": "Via!",
            "end": "Fine. Grazie.",
        }
    else:
        out |= {
            "rest": "Rest. Keep your eyes on the dot.",
            **{f"back_0_{i + 1}": f"Zero back. Press when you hear the number {w}." for i, w in enumerate(d)},
            "back_1": "One back. Press when a number is the same as the one just before.",
            "back_2": "Two back. Press when a number is the same as the one two numbers ago.",
            "back_3": "Three back. Press when a number is the same as the one three numbers ago.",
            "start": "Go!",
            "end": "The end. Thank you.",
        }
    return out


TARGET_RMS_DB = -23.0     # loudness of the speech in every clip
PEAK_LIMIT_DB = -1.0
GATE_DB = -40.0           # a 10 ms window is speech when its RMS is within 40 dB of the clip's loudest window


def download(models: Path) -> tuple[Path, Path]:
    models.mkdir(parents=True, exist_ok=True)
    for name in MODEL_FILES:
        if not (models / name).exists():
            print(f"  downloading {name}")
            urllib.request.urlretrieve(RELEASE + name, models / name)
    return models / MODEL_FILES[0], models / MODEL_FILES[1]


def espeak_config(models: Path):
    """espeak-ng's data by a path espeak-ng can hold: it keeps the path in a 160-character buffer and, when the path
    is longer (a deep virtual environment), silently falls back to its build machine's path and fails ("Error
    processing file .../phontab"). A longer path is replaced by a symlink next to the models."""
    import espeakng_loader
    from kokoro_onnx.config import EspeakConfig

    data = Path(espeakng_loader.get_data_path())
    if len(str(data)) >= 150:
        link = models / "espeak-ng-data"
        if link.is_symlink() or link.exists():
            link.unlink()
        link.symlink_to(data, target_is_directory=True)
        if len(str(link)) >= 150:
            sys.exit(f"The espeak-ng data path is too long for espeak-ng: use a shorter --models folder ({link})")
        data = link
    return EspeakConfig(lib_path=espeakng_loader.get_library_path(), data_path=str(data))


def db(x: float) -> float:
    return 20 * np.log10(max(x, 1e-12))


def process(audio: np.ndarray, rate: int) -> tuple[np.ndarray, dict]:
    """Trim to the speech, fade the edges and scale to the common loudness."""
    win = int(0.010 * rate)
    n = len(audio) // win
    rms = np.sqrt(np.mean(audio[: n * win].reshape(n, win) ** 2, axis=1))
    gate = rms.max() * 10 ** (GATE_DB / 20)
    loud = np.flatnonzero(rms > gate)
    a, b = loud[0] * win, min(len(audio), (loud[-1] + 1) * win)
    # start exactly where the speech crosses the gate within its first window, so the onset is the first sample
    above = np.flatnonzero(np.abs(audio[a : a + win]) > gate)
    a += int(above[0]) if len(above) else 0
    clip = audio[a:b].astype(np.float64)
    gain = 10 ** (TARGET_RMS_DB / 20) / np.sqrt(np.mean(clip**2))
    peak = np.abs(clip).max() * gain
    limited = peak > 10 ** (PEAK_LIMIT_DB / 20)
    if limited:
        gain *= 10 ** (PEAK_LIMIT_DB / 20) / peak
    clip *= gain
    fi, fo = int(0.003 * rate), int(0.020 * rate)
    clip[:fi] *= np.linspace(0, 1, fi)
    clip[-fo:] *= np.linspace(1, 0, fo)
    return clip, {"rms_dbfs": round(db(np.sqrt(np.mean(clip**2))), 2), "peak_dbfs": round(db(np.abs(clip).max()), 2),
                  "peak_limited": bool(limited), "trimmed_lead_s": round(a / rate, 4)}


def write_wav(path: Path, clip: np.ndarray, rate: int) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(np.round(np.clip(clip, -1, 1) * 32767).astype("<i2").tobytes())


def generate(kokoro, lang: str, name: str, out: Path) -> None:
    info = VOICES[lang][name]
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.wav"):
        old.unlink()
    clips = {}
    for cid, text in phrases(lang).items():
        audio, rate = kokoro.create(text, voice=name, lang=info["lang"], trim=False)
        clip, levels = process(np.asarray(audio, dtype=np.float64), rate)
        write_wav(out / f"{cid}.wav", clip, rate)
        clips[cid] = {"text": text, "file": f"{cid}.wav", "duration_s": round(len(clip) / rate, 4), **levels}
    manifest = {
        "language": lang, "voice": name, "description": info["description"],
        "model": "Kokoro-82M v1.0 (hexgrad/Kokoro-82M, Apache 2.0), ONNX export of kokoro-onnx",
        "phonemiser": f"espeak-ng, language {info['lang']}", "generated": date.today().isoformat(),
        "sample_rate": rate, "target_rms_dbfs": TARGET_RMS_DB, "clips": clips,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
    digits = [clips[f"digit_{i}"]["duration_s"] for i in range(1, 10)]
    longest = max(clips.values(), key=lambda c: c["duration_s"])
    print(f"{lang}/{name}: {len(clips)} clips; digits {min(digits):.2f}–{max(digits):.2f} s; "
          f"longest {longest['file']} {longest['duration_s']:.2f} s")


def candidates_page(root: Path) -> None:
    """An HTML page to listen to every candidate voice side by side: one play button per clip and voice."""
    parts = []
    for lang, voices in VOICES.items():
        head = "".join(f"<th>{v}<br><small>{VOICES[lang][v]['description']}</small></th>" for v in voices)
        body = "".join(
            f"<tr><td>{text}</td>"
            + "".join(f'<td><button data-src="{lang}/{v}/{cid}.wav" aria-label="Play {v}: {text}">▶</button></td>' for v in voices)
            + "</tr>" for cid, text in phrases(lang).items())
        parts.append(f"<h2>{ {'it': 'Italiano', 'en': 'English'}[lang] }</h2><table><tr><th></th>{head}</tr>{body}</table>")
    (root / "index.html").write_text(
        "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
        "<title>Voice candidates</title><style>"
        "body{font:14px/1.4 system-ui;margin:16px}table{border-collapse:collapse}"
        "td,th{padding:4px 6px;border-bottom:1px solid #ccc;text-align:left;vertical-align:middle}"
        "th small{color:#666;font-weight:normal}button{font-size:16px;width:40px;height:32px;cursor:pointer}"
        "button.on{background:#C1441E;color:#fff}</style>"
        "<h1>Voice candidates (Kokoro)</h1><p>Click ▶ to play a clip.</p>" + "".join(parts) +
        "<script>let a=null,b=null;document.addEventListener('click',e=>{const t=e.target.closest('button[data-src]');"
        "if(!t)return;if(a)a.pause();if(b)b.classList.remove('on');a=new Audio(t.dataset.src);b=t;t.classList.add('on');"
        "a.onended=()=>t.classList.remove('on');a.play();});</script>")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--candidates", action="store_true", help="every candidate voice into audio_candidates/")
    ap.add_argument("--voice", action="append", default=[], metavar="LANG=NAME", help="choose a voice, e.g. it=im_nicola")
    ap.add_argument("--models", type=Path, default=Path.home() / ".cache" / "validation-task" / "kokoro")
    args = ap.parse_args()
    from kokoro_onnx import Kokoro

    model, voices = download(args.models)
    kokoro = Kokoro(str(model), str(voices), espeak_config=espeak_config(args.models))
    if args.candidates:
        root = ROOT / "audio_candidates"
        for lang, names in VOICES.items():
            for name in names:
                generate(kokoro, lang, name, root / lang / name)
        candidates_page(root)
        print("Listen at audio_candidates/index.html (served by server.py)")
        return 0
    chosen = {lang: next(iter(v)) for lang, v in VOICES.items()}
    for item in args.voice:
        lang, _, name = item.partition("=")
        if name not in VOICES.get(lang, {}):
            ap.error(f"unknown voice {item}")
        chosen[lang] = name
    for lang, name in chosen.items():
        generate(kokoro, lang, name, ROOT / "assets" / "audio" / lang)
    return 0


if __name__ == "__main__":
    sys.exit(main())
